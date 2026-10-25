#!/usr/bin/env node
// Inferential sensor: CodeRabbit-style review of the session diff.
// Generate (LLM, read-only) -> ground (deterministic) -> filter (thresholds, learnings) -> gate (policy).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

if (process.env.HARNESS_NESTED) process.exit(0);
const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, '.harness/sensors.json'), 'utf8')).review || {};
const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const sid = input.session_id || 'unknown';
const dir = path.join(ROOT, '.harness/state', sid);
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const globRe = (g) => new RegExp('^' + g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\{([^}]+)\}/g, (_, a) => `(${a.split(',').join('|')})`)
  .replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');

// 1. Called by sense.mjs only after computational checks pass. Skip if nothing changed since last review.
const edits = [...new Set(readJsonl(path.join(dir, 'edits.jsonl')).map((e) => e.file))];
if (!edits.length) process.exit(0);
const diff = execFileSync('git', ['diff', 'HEAD', '--unified=3', '--', ...edits], { cwd: ROOT, encoding: 'utf8' });
if (!diff.trim()) process.exit(0);
const hash = crypto.createHash('sha1').update(diff).digest('hex');
const seenPath = path.join(dir, 'review_seen');
if (fs.existsSync(seenPath) && fs.readFileSync(seenPath, 'utf8') === hash) process.exit(0); // incremental: same diff, no re-review
fs.writeFileSync(seenPath, hash);

// 2. Context: path instructions + active sensor-side learnings that match changed files.
const pathInstr = (CFG.path_instructions || []).filter((p) => edits.some((f) => globRe(p.path).test(f)))
  .map((p) => `- ${p.path}: ${p.instructions}`);
const learnings = fs.existsSync(path.join(ROOT, '.harness/ledger/entries')) ? fs.readdirSync(path.join(ROOT, '.harness/ledger/entries'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, '.harness/ledger/entries', f), 'utf8')))
  .filter((e) => ['active', 'enforced'].includes(e.status) && e.injection.target !== 'guide' &&
    (!e.scope.paths?.length || edits.some((f) => e.scope.paths.some((g) => globRe(g).test(f)))))
  .map((e) => `- ${e.injection.text} (${e.id})`) : [];

const SCHEMA = { type: 'object', required: ['summary', 'findings'], properties: {
  summary: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', required: ['file', 'line', 'category', 'severity', 'confidence', 'message', 'evidence'],
    properties: { file: { type: 'string' }, line: { type: 'integer' }, category: { enum: ['correctness', 'security', 'data_loss', 'performance', 'maintainability', 'style'] },
      severity: { enum: ['critical', 'major', 'minor', 'nit'] }, confidence: { type: 'number' }, message: { type: 'string' },
      evidence: { type: 'string', description: 'Exact code text copied from the file that shows the problem.' } } } } } };

const prompt = `You are a code reviewer. Review ONLY this diff. Report real defects you can point to; silence is fine.
For each finding give file, line, a verbatim code snippet as evidence, and confidence 0-1. Below 0.7, do not report.
Do not report formatting or lint-style issues; linters already ran.
${pathInstr.length ? `Path instructions:\n${pathInstr.join('\n')}` : ''}
${learnings.length ? `Team learnings (follow these; they override your defaults):\n${learnings.join('\n')}` : ''}
<diff>\n${diff.slice(0, CFG.max_diff_chars || 60000)}\n</diff>`;

const bin = process.env.HARNESS_CLAUDE_BIN || 'claude';
const r = spawnSync(bin, ['-p', '--model', CFG.model || 'sonnet', '--output-format', 'json', '--no-session-persistence',
  '--allowedTools', 'Read,Grep,Glob', '--permission-mode', 'dontAsk', '--json-schema', JSON.stringify(SCHEMA), prompt],
  { cwd: ROOT, encoding: 'utf8', timeout: (CFG.timeout_s || 240) * 1000, env: { ...process.env, HARNESS_NESTED: '1' } });
let out;
try { const j = JSON.parse(r.stdout); out = j.structured_output ?? JSON.parse(j.result); } catch { process.exit(0); } // fail open: advisory sensor

// 3. Ground: the cited file must be in the change, and the evidence text must exist near the cited line.
const grounded = (f) => {
  if (!edits.includes(f.file) || !fs.existsSync(path.join(ROOT, f.file))) return false;
  const lines = fs.readFileSync(path.join(ROOT, f.file), 'utf8').split('\n');
  const win = lines.slice(Math.max(0, f.line - 4), f.line + 3).join('\n');
  return f.evidence.trim().length > 0 && win.replace(/\s+/g, ' ').includes(f.evidence.trim().replace(/\s+/g, ' ').slice(0, 80));
};
const minConf = CFG.min_confidence || { security: 0.6, data_loss: 0.6, correctness: 0.75, performance: 0.8, maintainability: 0.85, style: 1.01 };
const all = (out.findings || []).map((f, i) => ({ id: `${sid}:review:${Date.now()}:${i}`, sensor_id: 'review', kind: 'inferential', ...f,
  grounded: grounded(f) }));
const kept = all.filter((f) => f.grounded && f.confidence >= (minConf[f.category] ?? 0.8));
fs.mkdirSync(dir, { recursive: true });
for (const f of all) fs.appendFileSync(path.join(dir, 'findings.jsonl'), JSON.stringify({ ...f, dropped: !kept.includes(f) }) + '\n');

// 4. Gate: block once for grounded critical/major in high-blast-radius categories; everything else is advisory.
const block = kept.filter((f) => ['critical', 'major'].includes(f.severity) && ['security', 'data_loss', 'correctness'].includes(f.category));
const fmt = (fs_) => fs_.slice(0, 6).map((f) => `${f.file}:${f.line} [${f.severity}/${f.category}, conf ${f.confidence}] ${f.message}`).join('\n');
const blockedPath = path.join(dir, 'review_blocked');
if (block.length && !fs.existsSync(blockedPath)) {
  fs.writeFileSync(blockedPath, '1');
  process.stderr.write(`Review (${CFG.model || 'sonnet'}) found issues. Fix them, or reply with why each is wrong:\n${fmt(block)}\n`);
  process.exit(2);
}
if (kept.length) process.stdout.write(JSON.stringify({ systemMessage: `Review: ${out.summary}\n${fmt(kept)}` }));
