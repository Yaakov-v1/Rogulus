import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'template', '.claude', 'hooks', 'harnestica.mjs');
const CHECKS = [{ name: 'types', command: 'npm run typecheck' }, { name: 'tests', command: 'npm test' }];
const PARALLEL_EDITS = 12;
const PARALLEL_FAILURES = 6;
const LESSON_CAP = 12;

// Creates a throwaway project and removes it when the test ends.
function project(testContext, { checks = CHECKS, claudeMd } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'harnestica hooks '));   // space on purpose: paths with spaces must work
  testContext.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  if (checks) writeFileSync(join(dir, '.claude', 'harnestica.json'), JSON.stringify({ version: 1, checks }));
  if (claudeMd) writeFileSync(join(dir, 'CLAUDE.md'), claudeMd);
  const run = (event, input) => {
    const result = spawnSync(process.execPath, [HOOK, event], {
      input: JSON.stringify({ session_id: 's1', cwd: dir, ...input }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout ? JSON.parse(result.stdout) : null;
  };
  return { dir, run };
}

const edit = (file = 'src/a.ts') => ({ tool_name: 'Edit', tool_input: { file_path: file } });
const bash = command => ({ tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: '', stderr: '' } });
const failedBash = (command, error, extra = {}) => ({ tool_name: 'Bash', tool_input: { command }, error, ...extra });
const stateFile = (dir, ...parts) => join(dir, '.claude', 'harnestica', 'state', ...parts);
const readLog = file => readFileSync(file, 'utf8').trim().split('\n');

// Runs the hook as a separate process without waiting, to exercise real parallel tool calls.
function fire(dir, event, input) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [HOOK, event], { env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    child.on('exit', resolve);
    child.stdin.end(JSON.stringify({ session_id: 's1', ...input }));
  });
}

const fireParallelEdits = (dir, count) => Promise.all(Array.from({ length: count }, (_, i) => fire(dir, 'track', edit(`src/f${i}.ts`))));

test('stop blocks when code changed after the last check', t => {
  const { run } = project(t);
  run('track', edit());
  const out = run('stop', {});
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /npm run typecheck/);
});

test('stop never blocks a continuation turn', t => {
  const { run } = project(t);
  run('track', edit());
  assert.equal(run('stop', { stop_hook_active: true }), null);
});

test('stop gates the same edit only once', t => {
  const { run } = project(t);
  run('track', edit());
  run('stop', {});
  assert.equal(run('stop', {}), null);
});

test('stop gates a new edit again after an earlier one was gated', t => {
  const { run } = project(t);
  run('track', edit());
  run('stop', {});
  run('track', edit('src/b.ts'));
  assert.equal(run('stop', {}).decision, 'block');
});

test('stop allows the turn after a passing check, even with env prefix, cd and extra arguments', t => {
  const { run } = project(t);
  run('track', edit());
  run('track', bash('cd app && FORCE_COLOR=0 npm run typecheck && npm test -- --watch=false'));
  assert.equal(run('stop', {}), null);
});

test('a failed check after the edit is gated with a red message', t => {
  const { run } = project(t);
  run('track', edit());
  run('track', bash('npm run typecheck && npm test'));
  run('track', edit());
  run('failure', failedBash('npm run typecheck', 'Exit code 2\nsrc/a.ts(1,1): error TS2322: bad'));
  assert.match(run('stop', {}).reason, /last check after your edits failed/);
});

test('a red gate is shown only once per edit', t => {
  const { run } = project(t);
  run('track', edit());
  run('failure', failedBash('npm run typecheck', 'Exit code 2\nsrc/a.ts(1,1): error TS2322: bad'));
  run('stop', {});
  assert.equal(run('stop', {}), null);
});

const MASKED_OR_FAKE_CHECK_RUNS = ['echo "npm test"', 'git commit -m "npm test"', 'npm run typecheck:fix', 'npm test | tail -5', 'npm test || true',
  'npm test; echo done', 'npm test &', 'npm test & wait', 'false || npm test', 'echo "a; npm test --x"', "echo 'npm test && npm run typecheck'"];
for (const command of MASKED_OR_FAKE_CHECK_RUNS) {
  test(`${command} does not count as a passing check run`, t => {
    const { run } = project(t);
    run('track', edit());
    run('track', bash(command));
    assert.equal(run('stop', {})?.decision, 'block');
  });
}

test('twelve parallel edits are all recorded', async t => {
  const { dir } = project(t);
  await fireParallelEdits(dir, PARALLEL_EDITS);
  assert.equal(readLog(stateFile(dir, 'sessions', 's1.jsonl')).length, PARALLEL_EDITS);
});

test('parallel passing checks both count', async t => {
  const { dir, run } = project(t);
  await fireParallelEdits(dir, PARALLEL_EDITS);
  await Promise.all([fire(dir, 'track', bash('npm test')), fire(dir, 'track', bash('npm run typecheck'))]);
  assert.equal(run('stop', {}), null);
});

test('parallel failures are all logged', async t => {
  const { dir } = project(t);
  const failures = Array.from({ length: PARALLEL_FAILURES }, (_, i) => fire(dir, 'failure', failedBash('npm test', `Exit code 1\nfail ${i}`)));
  await Promise.all(failures);
  assert.equal(readLog(stateFile(dir, 'failures.jsonl')).length, PARALLEL_FAILURES);
});

test('every configured check must pass after the last edit', t => {
  const { run } = project(t);
  run('track', edit());
  run('track', bash('npm test'));
  const out = run('stop', {});
  assert.match(out.reason, /npm run typecheck/);
  assert.doesNotMatch(out.reason, /`npm test`/);
});

for (const command of ["sed -i '' s/a/b/ src/a.ts", 'npx prettier --write src', 'git checkout other -- src', 'echo x > src/a.ts', 'rm src/old.ts']) {
  test(`${command} counts as an edit even without bashEditDiff`, t => {
    const { run } = project(t);
    run('track', bash(command));
    assert.equal(run('stop', {})?.decision, 'block');
  });
}

for (const command of ['ls > /dev/null', 'npm run typecheck 2>&1', 'git status']) {
  test(`${command} does not count as an edit`, t => {
    const { run } = project(t);
    run('track', bash(command));
    assert.equal(run('stop', {}), null);
  });
}

test('doc-only edits and non-check commands never trigger the gate', t => {
  const { run } = project(t);
  run('track', edit('README.md'));
  run('track', bash('ls -la'));
  assert.equal(run('stop', {}), null);
});

test('missing checks never trigger the gate', t => {
  const { run } = project(t, { checks: [] });
  run('track', edit());
  assert.equal(run('stop', {}), null);
});

test('a Bash command that edits files counts as an edit', t => {
  const { run } = project(t);
  run('track', { ...bash("sed -i '' s/a/b/ src/a.ts"), tool_response: { stdout: '', bashEditDiff: '--- a' } });
  assert.equal(run('stop', {}).decision, 'block');
});

// The same failure with a different duration, to prove volatile output does not hide a repeat.
const failSameTest = (run, session, milliseconds) => run('failure', failedBash('npm test',
  `Exit code 1\nnot ok 3 - parses dates (${milliseconds}ms)\nAssertionError: expected 2 got 3`, { session_id: session }));

test('the first occurrence of a failure is not a recurrence', t => {
  const { run } = project(t);
  assert.equal(failSameTest(run, 's1', 12), null);
});

test('a retry of the same failure in the same session is not a recurrence', t => {
  const { run } = project(t);
  failSameTest(run, 's1', 12);
  assert.equal(failSameTest(run, 's1', 15), null);
});

test('a failure repeated in a later session is flagged, whatever the duration', t => {
  const { run } = project(t);
  failSameTest(run, 's1', 12);
  const flagged = failSameTest(run, 's2', 40);
  assert.match(flagged.hookSpecificOutput.additionalContext, /failed the same way in an earlier session.*LESSON\?/);
});

test('a repeated failure is flagged once per session', t => {
  const { run } = project(t);
  failSameTest(run, 's1', 12);
  failSameTest(run, 's2', 40);
  assert.equal(failSameTest(run, 's2', 41), null);
});

test('every failure is appended to the failure log', t => {
  const { dir, run } = project(t);
  failSameTest(run, 's1', 12);
  failSameTest(run, 's1', 15);
  failSameTest(run, 's2', 40);
  failSameTest(run, 's2', 41);
  assert.equal(readLog(stateFile(dir, 'failures.jsonl')).length, 4);
});

test('a different failure is not a repeat', t => {
  const { run } = project(t);
  failSameTest(run, 's1', 12);
  assert.equal(run('failure', failedBash('npm test', 'Exit code 1\nTypeError: x is undefined', { session_id: 's3' })), null);
});

test('an interrupted check is not recorded as a failure', t => {
  const { run } = project(t);
  assert.equal(run('failure', failedBash('npm test', 'Exit code 130', { session_id: 's4', is_interrupt: true })), null);
});

const lessonLines = count => Array.from({ length: count }, (_, i) => `- [2026-10-0${(i % 9) + 1} · repo] rule ${i} — evidence`).join('\n');
const claudeMdWithLessons = count => `# P\n\n## 6. Lessons\nFormat: \`- [YYYY-MM-DD · scope] rule — evidence\`\n\n${lessonLines(count)}\n`;
const startContext = (run, input) => run('start', input).hookSpecificOutput.additionalContext;

test('session start is silent when the Lessons slot is healthy and checks exist', t => {
  const { run } = project(t, { claudeMd: claudeMdWithLessons(3) });
  assert.equal(run('start', { source: 'startup', now: '2026-10-26' }), null);
});

test('session start reports lessons older than the review window', t => {
  const { run } = project(t, { claudeMd: claudeMdWithLessons(3) });
  assert.match(startContext(run, { source: 'startup', now: '2027-03-01' }), /3 lesson\(s\) older than 90 days/);
});

test('session start reports a Lessons slot over the cap', t => {
  const { run } = project(t, { claudeMd: claudeMdWithLessons(LESSON_CAP + 1) });
  assert.match(startContext(run, { now: '2026-10-26' }), /13\/12/);
});

test('session start reports missing checks', t => {
  const { run } = project(t, { checks: null, claudeMd: claudeMdWithLessons(0) });
  assert.match(startContext(run, {}), /no checks configured/);
});

test('session start reports an unreadable config and logs why', t => {
  const { dir, run } = project(t, { claudeMd: claudeMdWithLessons(0) });
  writeFileSync(join(dir, '.claude', 'harnestica.json'), '{not json');
  const context = startContext(run, {});
  assert.match(context, /unreadable \.claude\/harnestica\.json/);
  assert.doesNotMatch(context, /no checks configured/);
  assert.match(readFileSync(stateFile(dir, 'errors.log'), 'utf8'), /loadConfig/);
});

test('CRLF lessons parse cleanly', t => {
  const { run } = project(t, { claudeMd: claudeMdWithLessons(2).replace(/\n/g, '\r\n') });
  assert.equal(run('start', { now: '2026-10-26' }), null);
});

test('the harness block is audited, not the project heading', t => {
  const installed = `# P\n\n## Lessons learned\n- old project note\n\n<!-- harnestica:start -->\n${claudeMdWithLessons(2)}- [2026-13-45 · repo] bad date — x\n- loose note\n<!-- harnestica:end -->\n`;
  const { run } = project(t, { claudeMd: installed });
  assert.match(startContext(run, { now: '2026-10-26' }), /2 lesson line\(s\) do not match/);
});

test('hooks fail open on garbage input and an unreadable config', t => {
  const { dir } = project(t);
  writeFileSync(join(dir, '.claude', 'harnestica.json'), '{not json');
  const result = spawnSync(process.execPath, [HOOK, 'stop'], { input: 'nonsense', env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('hooks write no session state when there are no checks to gate', t => {
  const { dir } = project(t);
  writeFileSync(join(dir, '.claude', 'harnestica.json'), '{not json');
  spawnSync(process.execPath, [HOOK, 'stop'], { input: 'nonsense', env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  assert.deepEqual(readdirSync(stateFile(dir)), ['errors.log']);
});
