import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'template', '.claude', 'hooks');
const EXIT_FAILED = 1;
const EXIT_NO_CHECKS = 2;
const NOISY_LINE_COUNT = 500;
const MAX_REPORT_LINES = 45;

const nodeCheck = (name, script) => ({ name, command: `node -e "${script}"` });
const PASSING = nodeCheck('types', "console.log('PASS-NOISE')");
const FAILING = nodeCheck('tests', "console.log('setup ok'); console.error('AssertionError: expected 2 got 3'); process.exit(3)");
const NOISY_FAILING = nodeCheck('lint', `for (let i = 0; i < ${NOISY_LINE_COUNT}; i++) console.log('line ' + i); process.exit(1)`);

// Creates a throwaway project with the runner installed and the given checks, and removes it when the test ends.
function projectWithChecks(testContext, checks) {
  const dir = mkdtempSync(join(tmpdir(), 'harnestica runner '));   // space on purpose: paths with spaces must work
  testContext.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(TEMPLATE_HOOKS, join(dir, '.claude', 'hooks'), { recursive: true });
  if (checks) writeFileSync(join(dir, '.claude', 'harnestica.json'), JSON.stringify({ version: 1, checks }));
  return dir;
}

function runRunner(dir) {
  return spawnSync(process.execPath, [join(dir, '.claude', 'hooks', 'harnestica-check.mjs')], { cwd: tmpdir(), encoding: 'utf8' });
}

test('all checks passing exits 0 with one line per check and none of their output', t => {
  const result = runRunner(projectWithChecks(t, [PASSING]));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^✓ types \(\d+\.\ds\)$/m);
  assert.match(result.stdout, /all 1 checks passed/);
  assert.doesNotMatch(result.stdout, /PASS-NOISE/);
});

test('a failing check exits non-zero and shows its error lines', t => {
  const result = runRunner(projectWithChecks(t, [PASSING, FAILING]));
  assert.equal(result.status, EXIT_FAILED);
  assert.match(result.stdout, /✗ tests \(exit 3, .*\): node -e/);
  assert.match(result.stdout, /AssertionError: expected 2 got 3/);
  assert.match(result.stdout, /1 of 2 checks failed/);
});

test('a noisy failure is cut down to a short excerpt that keeps the end', t => {
  const result = runRunner(projectWithChecks(t, [NOISY_FAILING]));
  const lines = result.stdout.trim().split('\n');
  assert.ok(lines.length <= MAX_REPORT_LINES, `${lines.length} lines`);
  assert.match(result.stdout, new RegExp(`line ${NOISY_LINE_COUNT - 1}$`, 'm'));
  assert.doesNotMatch(result.stdout, /line 100$/m);
});

test('checks run from the project root, wherever the runner is called from', t => {
  const dir = projectWithChecks(t, [nodeCheck('root', "require('fs').accessSync('.claude/harnestica.json')")]);
  assert.equal(runRunner(dir).status, 0);
});

test('no configured checks is not a pass', t => {
  const result = runRunner(projectWithChecks(t, []));
  assert.equal(result.status, EXIT_NO_CHECKS);
  assert.match(result.stdout, /nothing was verified/);
});

test('a missing config is not a pass', t => {
  assert.equal(runRunner(projectWithChecks(t, null)).status, EXIT_NO_CHECKS);
});
