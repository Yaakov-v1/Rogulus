#!/usr/bin/env node
// The supervisor stays responsive while the worker waits on SQLite or I/O.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
const started = performance.now();
const [root, sessionId] = process.argv.slice(2);
const log = root && sessionId ? join(root, '.lean-harness', 'telemetry', sessionId + '.jsonl') : null;
let child, event = 'unknown', turn = 0, finished = false;
const finish = async (outcome, output = '') => {
  if (finished) return; finished = true; clearTimeout(deadline); child?.kill('SIGKILL');
  const durationMs = performance.now() - started;
  // Locked SQLite must not hide a timeout. This is disposable telemetry, not lesson state.
  const exitTimer = setTimeout(() => process.exit(0), 25);
  try { if (log) await appendFile(log, JSON.stringify({ sessionId, event, turn, durationMs, outcome, at: new Date().toISOString() }) + '\n', { mode: 0o600 }); } catch {}
  // Keep the forced exit armed: an earlier stalled async read must not keep us alive.
  if (output) process.stdout.write(output, () => process.exit(0));
  else process.exit(0);
};
const deadline = setTimeout(() => void finish('timeout'), 450);
try {
  if (!log) throw new Error('Missing context');
  let input = '', size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length; if (size > 1048576) throw new Error('Oversized input'); input += chunk;
  }
  if (finished) process.exit(0);
  event = JSON.parse(input).hook_event_name;
  let records = [];
  try {
    const fd = await open(log, 'r');
    try {
      const size = (await fd.stat()).size, offset = Math.max(0, size - 262144);
      const buffer = Buffer.alloc(size - offset); const { bytesRead } = await fd.read(buffer, 0, buffer.length, offset);
      let lines = buffer.subarray(0, bytesRead).toString('utf8').trimEnd().split('\n'); if (offset) lines.shift();
      records = lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    } finally { await fd.close(); }
  } catch {}
  turn = records.at(-1)?.turn ?? 0;
  if (event === 'UserPromptSubmit') turn++;
  const used = records.filter(r => r.turn === turn).reduce((sum, r) => sum + r.durationMs, 0);
  const remaining = 2000 - used - (performance.now() - started);
  if (finished) process.exit(0);
  if (remaining < 50) await finish('budget_skipped');
  else {
    clearTimeout(deadline);
    const workerTimer = setTimeout(() => void finish('timeout'), Math.min(remaining, Math.max(1, 450 - (performance.now() - started))));
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('../dist/hook-worker.js', import.meta.url)), root, sessionId], {
      stdio: ['pipe', 'pipe', 'ignore']
    });
    let output = '', outputSize = 0;
    child.stdout.on('data', chunk => { outputSize += chunk.length; if (outputSize <= 32768) output += chunk; else { clearTimeout(workerTimer); void finish('output_limit'); } });
    child.on('error', () => { clearTimeout(workerTimer); void finish('worker_error'); });
    child.on('close', code => { clearTimeout(workerTimer); void finish(code === 0 ? 'ok' : 'worker_error', code === 0 ? output : ''); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  }
} catch { await finish('input_or_storage_error'); }
