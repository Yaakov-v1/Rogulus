import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initialize, readConfig } from '../dist/config.js';
import { Store } from '../dist/store.js';
export const cli = fileURLToPath(new URL('../bin/lean-harness.mjs', import.meta.url));
export const fake = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "lean harness's test-"));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'app.js'), 'export const value = 1;\n');
  initialize(dir);
  const config = readConfig(dir);
  config.agent = { command: process.execPath, args: [fake] };
  config.checks = [{ name: 'pass', command: process.execPath, args: ['-e', 'console.log("passed")'], timeoutMs: 2000 }];
  saveConfig(dir, config);
  const store = new Store(dir, true);
  return { dir, store, config, cleanup() { try { store.close(); } catch {} rmSync(dir, { recursive: true, force: true }); } };
}
export function saveConfig(dir, config) { writeFileSync(join(dir, '.lean-harness', 'config.json'), JSON.stringify(config)); }
export function runCli(dir, args, env = {}) { return spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 10000 }); }
export function candidate(store, text = 'Use the repository test command.', scope = [], outcome = 'supported') {
  const session = store.createSession('', []);
  store.endSession(session, 'ended');
  const evidence = { id: 'e:' + session, sessionId: session, kind: 'explicit', text: 'User correction: ' + text, source: 'fixture' };
  store.addEvidence(evidence);
  const id = store.addCandidate(session, { statement: text, scope, outcome, evidence: [evidence.id] });
  return { id, session, evidence };
}
