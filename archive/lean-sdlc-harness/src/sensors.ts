import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult, Config } from './types.js';
import type { Store } from './store.js';
import { runProcess } from './process.js';
import { structureFindings } from './findings.js';
export type { CheckResult } from './types.js';

export function snapshot(root: string): string {
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const hash = createHash('sha256');
  hash.update(git(['ls-files', '--stage', '-z']));
  try { hash.update(git(['rev-parse', '--verify', 'HEAD'])); } catch { hash.update('unborn'); }
  const files = new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean));
  // Configuration changes invalidate evidence even if a user's ignore rules exclude it.
  files.add('.lean-harness/config.json');
  for (const file of [...files].sort()) {
    if (file.startsWith('.lean-harness/state.sqlite') || file.startsWith('.lean-harness/telemetry/')) continue;
    const path = join(root, file);
    let stat;
    try { stat = lstatSync(path); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      hash.update(JSON.stringify([file, 'deleted'])); continue;
    }
    if (stat.isDirectory()) throw new Error(`Cannot verify submodule/directory entry: ${file}`);
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Cannot snapshot special file: ${file}`);
    const content = stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path);
    hash.update(JSON.stringify([file, stat.mode, createHash('sha256').update(content).digest('hex')]));
  }
  return hash.digest('hex');
}
export async function verify(root: string, config: Config, store: Store, sessionId?: string) {
  if (!config.checks.length) throw new Error('No checks configured. An empty check list cannot verify a task.');
  if (sessionId) store.session(sessionId);
  const id = randomUUID(), before = snapshot(root);
  const results: CheckResult[] = config.checks.map(c => ({ name: c.name, status: 'not_run', durationMs: 0, code: null, output: '' }));
  let interrupted = false;
  // Listen before the running row is visible: a signal that lands before runProcess installs its own
  // handlers must mark the run interrupted, not kill verify with the default action.
  const onSignal = () => { interrupted = true; };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try {
    store.db.prepare('INSERT INTO verifications VALUES(?,?,?,NULL,?,NULL,?,?)').run(id, sessionId ?? null,
      new Date().toISOString(), before, 'running', JSON.stringify(results));
    for (let i = 0; i < config.checks.length; i++) {
      if (interrupted) break;
      const check = config.checks[i]!;
      const result = await runProcess(check.command, check.args, { cwd: root, timeoutMs: check.timeoutMs });
      interrupted ||= result.interrupted;
      const output = result.stdout + '\n' + result.stderr;
      const evidenceRef = `check:${id}:${i}`;
      results[i] = structureFindings(root, check, {
        name: check.name, status: result.timedOut ? 'timed_out' : result.code === 0 && !result.interrupted && !result.signal ? 'passed' : 'failed',
        durationMs: result.durationMs, code: result.code, output: output.slice(0, 65536),
        outputTruncated: output.length > 65536 || result.stdoutTruncated || result.stderrTruncated
      }, evidenceRef);
      store.transaction(() => {
        store.db.prepare('UPDATE verifications SET results=? WHERE id=?').run(JSON.stringify(results), id);
        if (sessionId) store.addEvidence({ id: evidenceRef, sessionId, kind: 'check', text: JSON.stringify(results[i]), source: id });
      });
      if (interrupted) break;
    }
  } finally { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); }
  let after: string | null = null;
  try { after = snapshot(root); } catch { /* Snapshot failure means incomplete verification. */ }
  const status = interrupted ? 'interrupted' : after === null ? 'incomplete' : before !== after ? 'changed' : results.every(r => r.status === 'passed') ? 'verified' : 'failed';
  store.db.prepare('UPDATE verifications SET ended_at=?,after_hash=?,status=?,results=? WHERE id=?')
    .run(new Date().toISOString(), after, status, JSON.stringify(results), id);
  return { id, status, results };
}
export function verificationStatus(root: string, store: Store) {
  const row = store.db.prepare('SELECT * FROM verifications ORDER BY started_at DESC LIMIT 1').get();
  if (!row) return { status: 'not_run' };
  let status = String(row.status);
  if (status === 'verified') {
    try { if (snapshot(root) !== row.after_hash) status = 'stale'; } catch { status = 'incomplete'; }
  }
  return { id: row.id, status, startedAt: row.started_at, results: JSON.parse(String(row.results)) };
}
