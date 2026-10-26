import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixture, candidate, runCli, cli } from './helpers.mjs';
import { hookSettings } from '../dist/factory.js';
import { metrics } from '../dist/metrics.js';

test('adapter injects frozen guidance and never extracts during coding', () => {
  const f = fixture(); try {
    const a = candidate(f.store); f.store.review([a.id], 'approve');
    const argFile = join(f.dir, 'args.json'), calls = join(f.dir, 'calls'), transcript = join(f.dir, 'transcript.jsonl');
    const result = runCli(f.dir, ['start', '--', '--permission-mode', 'plan'], { FAKE_ARGS: argFile, FAKE_CALLS: calls, FAKE_TRANSCRIPT: transcript });
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.hooks.length, 4); assert.ok(observed.hooks.every(h => h.status === 0));
    assert.match(JSON.parse(observed.hooks[0].stdout).hookSpecificOutput.additionalContext, /repository test command/);
    assert.equal(existsSync(calls), false);
    const args = JSON.parse(readFileSync(argFile));
    assert.deepEqual(args.slice(-2), ['--permission-mode', 'plan']); assert.ok(!args.includes('--dangerously-skip-permissions'));
    const session = f.store.sessions().find(s => s.agentSessionId === 'fake-session');
    assert.equal(session.transcript, transcript); assert.equal(session.status, 'ended');
    f.store.review([a.id], 'retire');
    const command = hookSettings(f.dir, session.id).hooks.SessionStart[0].hooks[0].command;
    const again = spawnSync(command, { shell: true, input: JSON.stringify({ hook_event_name: 'SessionStart' }), encoding: 'utf8' });
    assert.match(again.stdout, /repository test command/);
    assert.equal(metrics(f.dir).turns.reduce((n, t) => n + t.hooks, 0), 5);
  } finally { f.cleanup(); }
});
test('learning processes once, validates citations, and never activates candidates', () => {
  const f = fixture(); try {
    const transcript = join(f.dir, 'transcript.jsonl'), calls = join(f.dir, 'calls');
    assert.equal(runCli(f.dir, ['start'], { FAKE_TRANSCRIPT: transcript }).status, 0);
    const first = runCli(f.dir, ['learn'], { FAKE_CALLS: calls });
    assert.equal(first.status, 0, first.stderr); assert.equal(f.store.lessons().length, 1);
    assert.equal(f.store.lessons()[0].status, 'candidate');
    assert.equal(runCli(f.dir, ['learn'], { FAKE_CALLS: calls }).status, 0);
    assert.equal(readFileSync(calls, 'utf8').trim(), 'extract');
  } finally { f.cleanup(); }
});
test('malformed or invented extraction evidence leaves learning incomplete', () => {
  for (const mode of ['malformed', 'fabricated', 'error']) {
    const f = fixture(); try {
      runCli(f.dir, ['start'], { FAKE_TRANSCRIPT: join(f.dir, 'transcript.jsonl') });
      const result = runCli(f.dir, ['learn'], { FAKE_MODE: mode });
      assert.equal(result.status, 1); assert.equal(f.store.lessons().length, 0);
      assert.equal(f.store.sessions()[0].learningStatus, 'incomplete');
    } finally { f.cleanup(); }
  }
});
test('database failure degrades to ordinary agent; disable injects no hooks', () => {
  const f = fixture(); try {
    const ordinary = runCli(f.dir, ['start', '--no-harness'], { FAKE_TRANSCRIPT: join(f.dir, 'plain.jsonl') });
    assert.equal(JSON.parse(ordinary.stdout).hooks.length, 0);
    f.store.close(); writeFileSync(join(f.dir, '.lean-harness', 'state.sqlite'), 'corrupt');
    const result = runCli(f.dir, ['start'], { FAKE_TRANSCRIPT: join(f.dir, 'corrupt.jsonl') });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /Harness unavailable/);
    assert.equal(JSON.parse(result.stdout).hooks.length, 0);
  } finally { f.cleanup(); }
});
test('locked database hook exits promptly and records failure outside SQLite', () => {
  const f = fixture(); try {
    const id = f.store.createSession('', []);
    f.store.db.exec('BEGIN IMMEDIATE');
    const command = hookSettings(f.dir, id).hooks.Stop[0].hooks[0].command;
    const start = performance.now();
    const result = spawnSync(command, { shell: true, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'Stop' }), timeout: 1500 });
    const elapsed = performance.now() - start;
    f.store.db.exec('ROLLBACK');
    assert.equal(result.status, 0); assert.ok(elapsed < 1000, `elapsed ${elapsed}`);
    assert.equal(result.stdout, ''); assert.equal(metrics(f.dir).turns[0].failures, 1);
  } finally { f.cleanup(); }
});
test('repeated hooks skip optional work after the cumulative budget', () => {
  const f = fixture(); try {
    const id = f.store.createSession('', []);
    const log = join(f.dir, '.lean-harness', 'telemetry', id + '.jsonl');
    writeFileSync(log, JSON.stringify({ sessionId: id, turn: 1, event: 'Stop', durationMs: 1990, outcome: 'ok' }) + '\n');
    const command = hookSettings(f.dir, id).hooks.Stop[0].hooks[0].command;
    const result = spawnSync(command, { shell: true, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'Stop' }), timeout: 1500 });
    assert.equal(result.status, 0); assert.equal(metrics(f.dir).turns[0].skipped, 1);
  } finally { f.cleanup(); }
});
test('concurrent learning commands claim one extraction per session', async () => {
  const f = fixture(); try {
    const calls = join(f.dir, 'calls');
    runCli(f.dir, ['start'], { FAKE_TRANSCRIPT: join(f.dir, 'transcript.jsonl') });
    const invoke = () => new Promise(resolve => {
      const child = spawn(process.execPath, [cli, 'learn'], { cwd: f.dir, env: { ...process.env, FAKE_CALLS: calls }, stdio: 'ignore' });
      child.on('exit', code => resolve(code));
    });
    assert.deepEqual(await Promise.all([invoke(), invoke(), invoke()]), [0, 0, 0]);
    assert.equal(readFileSync(calls, 'utf8').trim(), 'extract'); assert.equal(f.store.lessons().length, 1);
  } finally { f.cleanup(); }
});
test('interrupted verification cannot return verified or execute remaining checks', async () => {
  const f = fixture(); try {
    f.config.checks = [
      { name: 'wait', command: process.execPath, args: ['-e', 'setTimeout(()=>{},30000)'], timeoutMs: 10000 },
      { name: 'must-not-run', command: process.execPath, args: ['-e', 'process.exit(0)'], timeoutMs: 1000 }
    ];
    writeFileSync(join(f.dir, '.lean-harness', 'config.json'), JSON.stringify(f.config));
    const child = spawn(process.execPath, [cli, 'verify'], { cwd: f.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => output += chunk);
    const exit = new Promise(resolve => child.on('exit', resolve));
    // Wait for the persisted running row, not a guessed startup delay.
    for (let i = 0; i < 100; i++) {
      if (f.store.db.prepare("SELECT id FROM verifications WHERE status='running'").get()) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    child.kill('SIGTERM'); assert.equal(await exit, 1);
    const result = JSON.parse(output); assert.equal(result.status, 'interrupted'); assert.equal(result.results[1].status, 'not_run');
  } finally { f.cleanup(); }
});
test('hook installation in paths with spaces decodes its worker path', () => {
  const f = fixture(); try {
    const base = fileURLToPath(new URL('..', import.meta.url));
    const install = join(f.dir, 'installation with spaces');
    cpSync(join(base, 'bin'), join(install, 'bin'), { recursive: true });
    cpSync(join(base, 'dist'), join(install, 'dist'), { recursive: true });
    writeFileSync(join(install, 'package.json'), '{"type":"module"}');
    const id = f.store.createSession('Frozen guidance', []);
    const result = spawnSync(process.execPath, [join(install, 'bin', 'hook.mjs'), f.dir, id], {
      encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'SessionStart' }), timeout: 1500
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, 'Frozen guidance');
  } finally { f.cleanup(); }
});
test('supervisor exits on deadline even when input never completes', async () => {
  const f = fixture(); try {
    const id = f.store.createSession('', []), started = performance.now();
    const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/hook.mjs', import.meta.url)), f.dir, id], { stdio: ['pipe', 'pipe', 'pipe'] });
    const code = await new Promise(resolve => child.on('exit', resolve));
    assert.equal(code, 0); assert.ok(performance.now() - started < 1500);
    assert.equal(metrics(f.dir).turns[0].failures, 1);
  } finally { f.cleanup(); }
});
test('extraction timeout remains incomplete with no automatic retry', () => {
  const f = fixture(); try {
    f.config.learning.timeoutMs = 200;
    writeFileSync(join(f.dir, '.lean-harness', 'config.json'), JSON.stringify(f.config));
    runCli(f.dir, ['start'], { FAKE_TRANSCRIPT: join(f.dir, 'transcript.jsonl') });
    const result = runCli(f.dir, ['learn'], { FAKE_MODE: 'timeout' });
    assert.equal(result.status, 1); assert.match(result.stdout, /timeout/);
    assert.equal(f.store.sessions()[0].learningStatus, 'incomplete');
    assert.equal(f.store.lessons().length, 0);
    assert.deepEqual(JSON.parse(runCli(f.dir, ['learn']).stdout), []);
  } finally { f.cleanup(); }
});
test('Ctrl+C of wrapper leaves native interactive child running', async () => {
  const f = fixture(); try {
    const processModule = pathToFileURL(fileURLToPath(new URL('../dist/process.js', import.meta.url))).href;
    const script = join(f.dir, 'interrupt-wrapper.mjs');
    writeFileSync(script, `import {runProcess} from ${JSON.stringify(processModule)};\nconst r=await runProcess(process.execPath,['-e','console.log("ready");setTimeout(()=>console.log("survived"),250)'],{cwd:process.cwd(),inherit:true});process.exitCode=r.code??1;`);
    const child = spawn(process.execPath, [script], { cwd: f.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', sent = false;
    child.stdout.on('data', c => { output += c; if (!sent && output.includes('ready')) { sent = true; child.kill('SIGINT'); } });
    const code = await new Promise(resolve => child.on('exit', resolve));
    assert.equal(code, 0); assert.match(output, /survived/);
  } finally { f.cleanup(); }
});
