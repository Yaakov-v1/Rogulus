// The check runner: runs every configured check and reports only what matters, so a green run costs a few lines
// of context and a red one shows the failing lines instead of the whole log.
import { spawnSync } from 'node:child_process';
import { ERROR_LINE } from './failures.mjs';

export const RUNNER_SCRIPT = '.claude/hooks/harnestica-check.mjs';
export const RUNNER_COMMAND = `node ${RUNNER_SCRIPT}`;
// How the hooks see a run of this runner: one check standing for all of them (its output names the ones that failed).
export const RUNNER_CHECK = { name: 'all checks', command: RUNNER_COMMAND };
export const EXIT_FAILED = 1;
export const EXIT_NO_CHECKS = 2;

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const EXCERPT_ERROR_LINES = 25;
const EXCERPT_TAIL_LINES = 15;
const EXCERPT_LINE_LENGTH = 300;
const MS_PER_SECOND = 1000;
const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]/g;

// On POSIX shells stderr is merged into stdout in order, so the excerpt's tail is the real end of the output.
function withMergedOutput(command) {
  return process.platform === 'win32' ? command : `{ ${command}\n} 2>&1`;
}

export function runCheck(root, check) {
  const startedAt = Date.now();
  const result = spawnSync(withMergedOutput(check.command), { cwd: root, shell: true, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES });
  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n');
  return { check, passed: result.status === 0, exit: result.status ?? result.signal, seconds: (Date.now() - startedAt) / MS_PER_SECOND, output };
}

// Error-looking lines first (where the cause usually is), then the tail (where the summary usually is), without repeats.
export function failureExcerpt(output) {
  const lines = output.replace(ANSI_ESCAPE, '').split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean);
  const errorLines = lines.filter(line => ERROR_LINE.test(line)).slice(0, EXCERPT_ERROR_LINES);
  const unique = new Set([...errorLines, ...lines.slice(-EXCERPT_TAIL_LINES)]);
  return [...unique].map(line => line.slice(0, EXCERPT_LINE_LENGTH));
}

function resultLines(result) {
  const timing = `${result.seconds.toFixed(1)}s`;
  if (result.passed) return [`✓ ${result.check.name} (${timing})`];
  const header = `✗ ${result.check.name} (exit ${result.exit}, ${timing}): ${result.check.command}`;
  return [header, ...failureExcerpt(result.output).map(line => '    ' + line)];
}

export function formatReport(results) {
  const failedCount = results.filter(result => !result.passed).length;
  const summary = failedCount
    ? `harnestica: ${failedCount} of ${results.length} checks failed`
    : `harnestica: all ${results.length} checks passed`;
  return [...results.flatMap(resultLines), summary].join('\n');
}

export function exitCodeFor(results) {
  return results.every(result => result.passed) ? 0 : EXIT_FAILED;
}
