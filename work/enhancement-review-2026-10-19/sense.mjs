#!/usr/bin/env node
// Sensors (computational). PostToolUse: fast per-file checks, advisory feedback.
// Stop: whole-change checks, blocking back-pressure with a retry cap. Success is silent.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

if (process.env.HARNESS_NESTED) process.exit(0); // don't sense inside the reviewer's own headless session
const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, '.harness/sensors.json'), 'utf8'));
const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const sid = input.session_id || 'unknown';
const dir = path.join(ROOT, '.harness/state', sid);
fs.mkdirSync(dir, { recursive: true });
const log = (f, o) => fs.appendFileSync(path.join(dir, f), JSON.stringify(o) + '\n');
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const rel = (f) => path.relative(ROOT, path.resolve(ROOT, f));
const globRe = (g) => new RegExp('^' + g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\{([^}]+)\}/g, (_, a) => `(${a.split(',').join('|')})`)
  .replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');

const PARSERS = {
  // eslint --format json  /  biome lint --reporter=json can get its own parser the same way
  'eslint-json': (out) => JSON.parse(out || '[]').flatMap((r) => r.messages.map((m) => ({
    file: rel(r.filePath), line: m.line, category: m.ruleId || 'parse', severity: m.severity === 2 ? 'error' : 'warning', message: m.message }))),
  tsc: (out) => [...out.matchAll(/^(.+?)\((\d+),\d+\): error (TS\d+): (.+)$/gm)].map((m) => ({
    file: rel(m[1]), line: +m[2], category: m[3], severity: 'error', message: m[4] })),
  exitcode: (out, code) => code === 0 ? [] : [{ file: '', line: 0, category: 'failed', severity: 'error',
    message: out.trim().split('\n').slice(-15).join('\n') }],
};

const exec = (cmd, args, timeoutS) => new Promise((resolve) => { // async so sensors run in parallel
  const p = spawn(cmd, args, { cwd: ROOT, timeout: timeoutS * 1000 }); let stdout = '', stderr = '';
  p.stdout.on('data', (d) => (stdout += d)); p.stderr.on('data', (d) => (stderr += d));
  p.on('close', (status) => resolve({ status, stdout, stderr })); p.on('error', () => resolve({ status: 127, stdout, stderr }));
});

async function run(sensor, files) {
  const args = sensor.cmd.flatMap((a) => a === '{files}' ? files : [a.replace('{file}', files[0] || '')]);
  const t0 = Date.now();
  const r = await exec(args[0], args.slice(1), sensor.timeout_s || 30);
  const out = (r.stdout || '') + (sensor.parser === 'eslint-json' ? '' : r.stderr || '');
  let findings = [];
  try { findings = PARSERS[sensor.parser](out, r.status); } catch { findings = PARSERS.exitcode(out, r.status ?? 1); }
  findings = findings.map((f, i) => ({ id: `${sid}:${sensor.id}:${Date.now()}:${i}`, sensor_id: sensor.id, kind: 'computational',
    confidence: 1, remediation: sensor.remediation?.[f.category], ...f }));
  log('sensor_runs.jsonl', { sensor_id: sensor.id, ms: Date.now() - t0, n: findings.length, exit: r.status });
  return findings;
}

const render = (fs_) => fs_.slice(0, 8).map((f) =>
  `${f.file ? `${f.file}:${f.line} ` : ''}[${f.sensor_id}/${f.category}] ${f.message}${f.remediation ? `\n  fix: ${f.remediation}` : ''}`).join('\n')
  + (fs_.length > 8 ? `\n...and ${fs_.length - 8} more (full list: .harness/state/${sid}/findings.jsonl)` : '');

const mode = process.argv[2];
if (mode === 'edit') {
  const file = input.tool_input?.file_path;
  if (!file) process.exit(0);
  const f = rel(file);
  log('edits.jsonl', { file: f, at: new Date().toISOString() });
  const sensors = CFG.sensors.filter((s) => s.on === 'edit' && globRe(s.glob || '**').test(f));
  const findings = (await Promise.all(sensors.map((s) => run(s, [f])))).flat();
  findings.forEach((x) => log('findings.jsonl', x));
  const errors = findings.filter((x) => x.severity === 'error');
  if (!errors.length) process.exit(0); // success is silent
  // PostToolUse cannot undo the edit; decision:block feeds the reason back to Claude immediately.
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `Sensor findings in ${f}:\n${render(errors)}` }));
} else if (mode === 'stop') {
  if (input.stop_hook_active && fs.existsSync(path.join(dir, 'escalated'))) process.exit(0);
  const edits = [...new Set(readJsonl(path.join(dir, 'edits.jsonl')).map((e) => e.file))].filter((f) => fs.existsSync(path.join(ROOT, f)));
  if (!edits.length) process.exit(0);
  const findings = (await Promise.all(CFG.sensors.filter((s) => s.on === 'stop').map((s) => run(s, edits)))).flat();
  findings.forEach((x) => log('findings.jsonl', x));
  // Only block on what this session touched (or whole-run failures); pre-existing errors elsewhere stay advisory.
  const blocking = findings.filter((x) => x.severity === 'error' && (!x.file || edits.includes(x.file)));
  if (!blocking.length) { // cheap checks green -> only now pay for the LLM reviewer (early-exit ordering)
    fs.rmSync(path.join(dir, 'stop_blocks'), { force: true });
    if (!CFG.review) process.exit(0);
    const r = spawnSync('node', [path.join(ROOT, '.harness/bin/review.mjs')], { input: JSON.stringify(input), stdio: ['pipe', 'inherit', 'inherit'] });
    process.exit(r.status ?? 0);
  }
  const nPath = path.join(dir, 'stop_blocks');
  const n = (fs.existsSync(nPath) ? +fs.readFileSync(nPath, 'utf8') : 0) + 1;
  fs.writeFileSync(nPath, String(n));
  if (n > (CFG.max_stop_blocks || 3)) { // escalate to the human instead of looping forever
    fs.writeFileSync(path.join(dir, 'escalated'), '1');
    process.stdout.write(JSON.stringify({ systemMessage: `Harness: ${blocking.length} check failures remain after ${n - 1} retries. Needs a human look.` }));
    process.exit(0);
  }
  process.stderr.write(`Checks failed (attempt ${n}/${CFG.max_stop_blocks || 3}). Fix these before finishing, or explain why they are wrong:\n${render(blocking)}\n`);
  process.exit(2); // Stop + exit 2 = Claude keeps working
}
