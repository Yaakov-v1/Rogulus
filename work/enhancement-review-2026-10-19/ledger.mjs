#!/usr/bin/env node
// Assumption ledger (MVP). Append-only events -> deterministic fold -> injected guides.
// LLMs may PROPOSE (capture events). Only this code counts evidence and changes status.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DIR = path.join(ROOT, '.harness/ledger');
const EVENTS = path.join(DIR, 'events.jsonl');
const ENTRIES = path.join(DIR, 'entries');
const RULES = path.join(ROOT, '.claude/rules/learned');
const STATE = path.join(ROOT, '.harness/state');

// Evidence weights by source (pseudo-counts). Self-report never counts.
const W = { human: 1, hidden_test: 1, truth_check: 1, ci_test: 0.8, static_analysis: 0.8,
            llm_panel: 0.5, llm_judge: 0.3, self_report: 0 };
const HALF_LIFE = { tool_fact: 14, assumption: 30, pitfall: 60, anti_pattern: 60,
                    convention: 90, preference: 180 };
const T = { candidateSessions: 2, trialLB: 0.55, activeLB: 0.70, demoteLB: 0.40, demoteMinN: 8,
            refuteHarm: 2, maxTrials: 3, trialMinPerArm: 20, trialMinDrop: 0.15,
            injectMax: 12, injectChars: 2000, mineSessions: 3 };
const RISKY = /(\bskip\b|\bxit\b|\.only\b|snapshot|eslint-disable|ts-ignore|ts-expect-error|\brelax|\bloosen|delete .*test|exit\(0\)|--no-verify|update the test)/i;
const CHECK_ALLOW = new Set(['rg', 'grep', 'test', 'jq']);

const now = () => new Date().toISOString();
const days = (a, b) => (b - new Date(a)) / 864e5;
const readJsonl = (f) => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const append = (ev) => { fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(EVENTS, JSON.stringify({ ts: now(), ...ev }) + '\n'); };
// IDs are content hashes, not counters, so ledgers from parallel branches merge (merge=union) without collisions.
const capture = (ev) => { const id = 'A-' + crypto.createHash('sha1').update(now() + ev.statement + Math.random()).digest('hex').slice(0, 8);
  append({ op: 'capture', id, ...ev }); return id; };
const stdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };

export function wilsonLB(pos, n, z = 1.96) {
  if (n <= 0) return 0;
  const p = pos / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}
const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
const inScope = (e, file) => !e.scope.paths?.length || e.scope.paths.some((g) => globRe(g).test(file));
const arm = (sid, id) => (crypto.createHash('sha1').update(sid + id).digest()[0] % 2 ? 'treatment' : 'control');

function newEntry(ev, id) {
  const kind = ev.kind || 'assumption';
  const text = ev.text || ev.statement;
  const flags = new Set(ev.risk_flags || []);
  if (RISKY.test(ev.statement + ' ' + text)) flags.add('weakens_check');
  if (['language', 'org', 'global'].includes(ev.scope?.level)) flags.add('global_scope');
  if (ev.untrusted) flags.add('untrusted_source');
  return {
    id, statement: ev.statement, kind, scope: ev.scope || { level: 'repo' }, status: 'captured',
    origin: { session_id: ev.session_id, task_id: ev.task_id, module: ev.module, author: ev.author, created_at: ev.ts },
    ...(ev.check ? { check: ev.check } : {}), ...(ev.sensor_link ? { sensor_link: ev.sensor_link } : {}),
    evidence: [], stats: { helpful_w: 0, harmful_w: 0, wilson_lb: 0, confirm_sessions: 0, applied_count: 0,
      trial: { treatment_n: 0, treatment_fired: 0, control_n: 0, control_fired: 0 } },
    decay: { half_life_days: ev.half_life_days || HALF_LIFE[kind] || 30, last_confirmed_at: null },
    temporal: { valid_from: ev.ts, invalid_at: null, recorded_at: ev.ts, expired_at: null },
    links: { depends_on: ev.depends_on || [], contradicts: [], supersedes: ev.supersedes || null, superseded_by: null },
    injection: { target: ev.target || 'guide', text },
    governance: { requires_human: flags.size > 0, risk_flags: [...flags], approved_by: null, approved_at: null },
  };
}

function computeStats(e, at) {
  // Independence: one vote per (session, outcome); keep the strongest source.
  const best = new Map();
  for (const ev of e.evidence) {
    const k = `${ev.task_id || ev.session_id}|${ev.outcome}`;
    if ((W[ev.source] ?? 0) > (W[best.get(k)?.source] ?? -1)) best.set(k, ev);
  }
  let h = 0, x = 0; const sessions = new Set();
  for (const ev of best.values()) {
    const w = (W[ev.source] ?? 0) * 0.5 ** (days(ev.at, at) / e.decay.half_life_days); // decay counts, not score
    if (ev.outcome === 'confirm' && w > 0) { h += w; sessions.add(ev.task_id || ev.session_id); }
    if (ev.outcome === 'refute') x += w;
  }
  const lastC = e.evidence.filter((v) => v.outcome === 'confirm' && W[v.source] > 0).map((v) => v.at).sort().pop();
  Object.assign(e.stats, { helpful_w: +h.toFixed(3), harmful_w: +x.toFixed(3),
    wilson_lb: +wilsonLB(h, h + x).toFixed(3), confirm_sessions: sessions.size });
  e.decay.last_confirmed_at = lastC || null;
}

function nextStatus(e, ctx) {
  const s = e.stats, gated = e.governance.requires_human && !e.governance.approved_by;
  const humans = e.evidence.filter((v) => v.source === 'human');
  const checks = e.evidence.filter((v) => v.source === 'truth_check').slice(-2);
  if (['refuted', 'superseded', 'contested'].includes(e.status)) return null; // only humans/new entries move these
  if (humans.at(-1)?.outcome === 'refute') return 'refuted';
  if (checks.length === 2 && checks.every((v) => v.outcome === 'refute')) return 'refuted';
  if (e.status !== 'trial' && s.harmful_w >= T.refuteHarm && s.harmful_w >= s.helpful_w) return 'refuted'; // trials end by A/B
  switch (e.status) {
    case 'captured':
      if ((e.origin.module === 'human' || e.governance.approved_by) && !gated) return 'active'; // taught/approved by a human
      return s.confirm_sessions >= T.candidateSessions && s.harmful_w === 0 ? 'candidate' : null;
    case 'candidate':
      // Enough evidence the claim/pitfall is real: LB >= 0.55, or a sensor-linked pitfall seen in >= 3 sessions.
      const real = s.wilson_lb >= T.trialLB || (e.sensor_link && s.confirm_sessions >= T.mineSessions);
      if (real && !gated && ctx.trials < T.maxTrials) { ctx.trials++; return 'trial'; }
      return null;
    case 'trial': {
      const t = s.trial; if (gated) return null;
      // No sensor to A/B against: an agent-written guide needs a human yes (LLM-written context files hurt; ETH 2026).
      if (!e.sensor_link) return s.wilson_lb >= T.activeLB && (e.origin.module !== 'factory' || e.governance.approved_by) ? 'active' : null;
      // Fixed-horizon A/B, decided once (no peeking): treatment = rule injected, control = not.
      if (t.treatment_n < T.trialMinPerArm || t.control_n < T.trialMinPerArm) return null;
      const drop = t.control_fired / t.control_n - t.treatment_fired / t.treatment_n;
      if (drop >= T.trialMinDrop) return 'active';
      e.trial_failed = true; return 'decayed';
    }
    case 'active': case 'enforced': {
      const anchor = e.decay.last_confirmed_at || e.governance.approved_at || e.origin.created_at;
      const stale = days(anchor, ctx.at) > 2 * e.decay.half_life_days;      // unconfirmed for 2 half-lives
      const n = s.helpful_w + s.harmful_w;
      const losing = n >= T.demoteMinN && s.wilson_lb < T.demoteLB;       // enough evidence, and it says "not useful"
      return losing || stale ? 'decayed' : null;
    }
    case 'decayed': // a rule that lost its A/B needs a human (teach/approve) to come back
      return !e.trial_failed && s.wilson_lb >= T.trialLB ? 'candidate' : null;
  }
  return null;
}

export function fold(at = new Date()) {
  const E = new Map();
  for (const ev of readJsonl(EVENTS)) {
    const e = E.get(ev.id);
    switch (ev.op) {
      case 'capture': { const id = ev.id; E.set(id, newEntry(ev, id));
        if (ev.supersedes && E.get(ev.supersedes)) Object.assign(E.get(ev.supersedes), { status: 'superseded' },
          { links: { ...E.get(ev.supersedes).links, superseded_by: id } }); break; }
      case 'evidence': if (e && ev.attested_by !== 'agent') e.evidence.push({ at: ev.ts, session_id: ev.session_id,
        task_id: ev.task_id, source: ev.source, outcome: ev.outcome, ref: ev.ref, attested_by: ev.attested_by }); break;
      case 'trial_obs': if (e && !(e._seen ??= new Set()).has(ev.session_id)) { e._seen.add(ev.session_id); // idempotent per session
        e.stats.trial[`${ev.arm}_n`]++; if (ev.fired) e.stats.trial[`${ev.arm}_fired`]++; } break;
      case 'injected': for (const id of ev.ids) if (E.get(id)) E.get(id).stats.applied_count++; break;
      case 'approve': if (e) { Object.assign(e.governance, { approved_by: ev.by, approved_at: ev.ts }); delete e.trial_failed; } break;
      case 'transition': if (e) { e.status = ev.to; if (ev.from === 'trial' && ev.to === 'decayed') e.trial_failed = true;
        if (ev.to === 'trial') e.stats.trial = { treatment_n: 0, treatment_fired: 0, control_n: 0, control_fired: 0 };
        if (['refuted', 'superseded'].includes(ev.to)) Object.assign(e.temporal, { invalid_at: ev.ts, expired_at: ev.ts });
        if (ev.contradicts) e.links.contradicts.push(ev.contradicts); } break;
    }
  }
  const ctx = { at, trials: [...E.values()].filter((e) => e.status === 'trial').length };
  fs.mkdirSync(ENTRIES, { recursive: true });
  for (const e of E.values()) {
    computeStats(e, at);
    const to = nextStatus(e, ctx);
    if (to) { append({ op: 'transition', id: e.id, from: e.status, to, by: 'fold' }); e.status = to;
      if (to === 'trial') e.stats.trial = { treatment_n: 0, treatment_fired: 0, control_n: 0, control_fired: 0 };
      if (to === 'refuted') Object.assign(e.temporal, { invalid_at: now(), expired_at: now() }); }
    const { trial_failed, _seen, ...out } = e;
    fs.writeFileSync(path.join(ENTRIES, `${e.id}.json`), JSON.stringify(out, null, 2) + '\n');
  }
  renderRules(E);
  return E;
}

function renderRules(E) {
  // Active, path-scoped guides become lazily loaded Claude Code rules (paths frontmatter).
  fs.mkdirSync(RULES, { recursive: true });
  for (const f of fs.readdirSync(RULES)) if (f.startsWith('A-')) fs.unlinkSync(path.join(RULES, f));
  for (const e of E.values()) {
    if (e.status !== 'active' || e.injection.target === 'sensor' || !e.scope.paths?.length) continue;
    const fm = `---\npaths:\n${e.scope.paths.map((p) => `  - "${p}"`).join('\n')}\n---\n`;
    fs.writeFileSync(path.join(RULES, `${e.id}.md`),
      `${fm}<!-- generated from .harness/ledger; do not edit. lb=${e.stats.wilson_lb} -->\n- ${e.injection.text} (${e.id})\n`);
  }
}

function inject(input) {
  // SessionStart: repo-wide active guides + this session's treatment-arm trials, ranked, budgeted.
  const sid = input.session_id || 'unknown';
  // Backstop: settle earlier sessions whose SessionEnd hook timed out or never ran.
  if (fs.existsSync(STATE)) for (const d of fs.readdirSync(STATE))
    if (d !== sid && !fs.existsSync(path.join(STATE, d, '.settled')) &&
        Date.now() - fs.statSync(path.join(STATE, d)).mtimeMs > 30 * 60e3) settle({ session_id: d }); // idle > 30 min
  const E = fold();
  const pick = [...E.values()].filter((e) => e.injection.target !== 'sensor' && (
    (e.status === 'active' && !e.scope.paths?.length) || (e.status === 'trial' && arm(sid, e.id) === 'treatment')))
    .sort((a, b) => b.stats.wilson_lb - a.stats.wilson_lb);
  const lines = []; let used = 0;
  for (const e of pick.slice(0, T.injectMax)) {
    const where = e.scope.paths?.length ? ` [when editing ${e.scope.paths.join(', ')}]` : '';
    const line = `- ${e.injection.text}${where} (${e.id})`;
    if (used + line.length > T.injectChars) break;
    lines.push(line); used += line.length;
  }
  if (lines.length) append({ op: 'injected', session_id: sid, ids: lines.map((l) => l.match(/\((A-[0-9a-f]+)\)$/)[1]) });
  const ctx = lines.length ? `Project lessons learned from earlier sessions (verified by tests/review):\n${lines.join('\n')}` : '';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } }));
}

function settle(input) {
  // SessionEnd: turn this session's sensor findings into evidence, trial observations and new candidates.
  const sid = input.session_id; const dir = path.join(STATE, sid);
  if (!sid || fs.existsSync(path.join(dir, '.settled'))) return;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, '.settled'), now());
  const edits = [...new Set(readJsonl(path.join(dir, 'edits.jsonl')).map((r) => r.file))];
  const findings = readJsonl(path.join(dir, 'findings.jsonl'));
  if (!edits.length) return;
  let testsTouched = false;
  try { testsTouched = execFileSync('git', ['diff', '--name-only', '--diff-filter=MD', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').some((f) => /(\.test\.|\.spec\.|__tests__\/|(^|\/)tests?\/)/.test(f)); } catch {}
  const injected = new Set(readJsonl(EVENTS).filter((v) => v.op === 'injected' && v.session_id === sid).flatMap((v) => v.ids));
  const E = fold();
  for (const e of E.values()) {
    if (!e.sensor_link || !edits.some((f) => inScope(e, f))) continue;
    const hits = findings.filter((f) => f.sensor_id === e.sensor_link.sensor_id &&
      (!e.sensor_link.category || f.category === e.sensor_link.category) && inScope(e, f.file));
    const fired = hits.length > 0;
    const source = hits[0]?.kind === 'inferential' ? 'llm_judge' : 'static_analysis';
    if (e.status === 'trial') append({ op: 'trial_obs', id: e.id, session_id: sid, arm: arm(sid, e.id), fired });
    const exposed = ['active', 'enforced'].includes(e.status) || (e.status === 'trial' && injected.has(e.id));
    if (exposed) { // the rule was in context (or path-loaded) this session: did its sensor stay quiet?
      if (fired) append({ op: 'evidence', id: e.id, session_id: sid, source, outcome: 'refute', ref: hits[0].id, attested_by: 'harness' });
      else if (!testsTouched) append({ op: 'evidence', id: e.id, session_id: sid, source, outcome: 'confirm', ref: `session:${sid}`, attested_by: 'harness' });
    }
  }
  // Mining: the same (sensor, category) firing in >= N distinct sessions becomes a captured pitfall.
  const hist = path.join(DIR, 'findings.jsonl');
  // MVP mines only deterministic findings; clustering LLM review findings into rules is a v1 job (needs embeddings + a human).
  for (const f of findings.filter((x) => x.kind === 'computational')) fs.appendFileSync(hist, JSON.stringify({ ...f, session_id: sid }) + '\n');
  const groups = new Map();
  for (const f of readJsonl(hist)) { const k = `${f.sensor_id}|${f.category}`;
    if (!groups.has(k)) groups.set(k, { f, s: new Set() }); groups.get(k).s.add(f.session_id); }
  const known = new Set([...E.values()].filter((e) => e.sensor_link).map((e) => `${e.sensor_link.sensor_id}|${e.sensor_link.category}`));
  for (const [k, g] of groups) if (g.s.size >= T.mineSessions && !known.has(k)) {
    const dirGlob = path.dirname(g.f.file) + '/**';
    const id = capture({ session_id: sid, module: 'sensors', author: 'harness', kind: 'pitfall',
      statement: `Recurring ${g.f.sensor_id}/${g.f.category} findings under ${dirGlob}: ${g.f.message}`.slice(0, 400),
      text: (g.f.remediation || g.f.message).slice(0, 300), scope: { level: 'path', paths: [dirGlob] },
      sensor_link: { sensor_id: g.f.sensor_id, category: g.f.category }, target: 'guide' });
    // Mined from N sessions of harness-attested sensor output: that history is its first evidence.
    for (const s of g.s) append({ op: 'evidence', id, session_id: s, source: 'static_analysis', outcome: 'confirm',
      ref: `mined:${k}`, attested_by: 'harness' });
    known.add(k);
  }
  fold();
}

function verify() {
  // Run allow-listed truth checks (exit 0 = claim still holds on this branch).
  for (const e of fold().values()) {
    if (!e.check || !['captured', 'candidate', 'trial', 'active', 'enforced'].includes(e.status)) continue;
    const [cmd, ...args] = e.check.cmd;
    if (!CHECK_ALLOW.has(cmd)) continue;
    let ok = true;
    try { execFileSync(cmd, args, { cwd: ROOT, timeout: (e.check.timeout_s || 10) * 1000, stdio: 'ignore' }); } catch { ok = false; }
    append({ op: 'evidence', id: e.id, session_id: 'verify', task_id: `verify:${now().slice(0, 10)}`,
      source: 'truth_check', outcome: ok ? 'confirm' : 'refute', ref: e.check.cmd.join(' '), attested_by: 'harness' });
  }
  fold();
}

if (process.env.HARNESS_NESTED) process.exit(0); // the reviewer's headless session must not touch the ledger
const [cmd, ...rest] = process.argv.slice(2);
const json = () => { const s = stdin(); return s.trim() ? JSON.parse(s) : {}; };
// 'capture' is the agent's door (always module=factory); 'teach' is the human's door (guard denies it to the agent).
if (cmd === 'capture') console.log(capture({ session_id: 'unknown', author: process.env.HARNESS_MODEL || 'agent', ...json(), module: 'factory' }));
else if (cmd === 'teach') console.log(capture({ session_id: 'human', author: process.env.USER || 'human', ...json(), module: 'human' }));
else if (cmd === 'evidence') append({ op: 'evidence', attested_by: 'human', ...json() });
else if (cmd === 'approve') append({ op: 'approve', id: rest[0], by: rest[1] || process.env.USER });
else if (cmd === 'transition') append({ op: 'transition', id: rest[0], to: rest[1], by: process.env.USER, contradicts: rest[2] });
else if (cmd === 'fold') { const E = fold(); for (const e of E.values()) console.log(e.id, e.status, e.stats.wilson_lb, e.statement.slice(0, 60)); }
else if (cmd === 'inject') inject(json());
else if (cmd === 'settle') settle(json());
else if (cmd === 'verify') verify();
else if (cmd) { console.error('usage: ledger.mjs capture|teach|evidence|approve|transition|fold|inject|settle|verify'); process.exit(1); }
