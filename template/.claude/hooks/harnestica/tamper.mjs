// Test-tamper sensor: compares the working tree with HEAD and reports tests that were newly skipped or lost
// assertions overall (deleting a test file loses its assertions). Agents that cannot make a test pass most often
// edit the test instead. Assertions are counted net across all test files, so moving or renaming tests is not flagged.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logHookError } from './state.mjs';

const GIT_TIMEOUT_MS = 3000;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const TEST_LOCATION = /(^|\/)(tests?|__tests__|spec)\/|[._](test|spec)\.\w+$|(^|\/)test_[^/]*$/;
const CODE_FILE = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|kt|kts|rb|php|cs|swift|scala|c|cc|cpp)$/;
const SKIP_MARKER = /\.(skip|only)\(|\b(xit|xdescribe|xtest)\(|@pytest\.mark\.(skip|xfail)|\bt\.Skip\(|@(Disabled|Ignore)\b/;
const ASSERTION = /\bassert|\bexpect\s*\(|\brequire\.\w|\bt\.(Error|Fatal)/;
const NEW_PATH_PREFIX = '+++ b/';
const OLD_PATH_PREFIX = '--- a/';
const HEADER_TRAILING_TAB = /\t$/;

function gitOutput(root, args) {
  const options = { cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_GIT_OUTPUT_BYTES };
  const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], options);
  // Fail open. A missing git, a timeout or an oversized diff is logged; git's own non-zero exit (not a repository,
  // no commit yet) only means there is no baseline to compare with, which is not an error.
  if (result.error) logHookError({ cwd: root }, 'tamper', result.error);
  return result.status === 0 ? result.stdout : null;
}

function isTestFile(path) {
  return TEST_LOCATION.test(path) && CODE_FILE.test(path);
}

function headerPath(lines, prefix) {
  const header = lines.find(line => line.startsWith(prefix));
  return header ? header.slice(prefix.length).replace(HEADER_TRAILING_TAB, '') : null;
}

// One file's section of a `git diff -U0`: its path (the old one when deleted) and its added and removed lines.
function parseFileDiff(section) {
  const lines = section.split('\n');
  const firstHunk = lines.findIndex(line => line.startsWith('@@'));
  const changes = firstHunk < 0 ? [] : lines.slice(firstHunk);
  const linesStartingWith = sign => changes.filter(line => line.startsWith(sign)).map(line => line.slice(1));
  const path = headerPath(lines, NEW_PATH_PREFIX) ?? headerPath(lines, OLD_PATH_PREFIX);
  return { path, added: linesStartingWith('+'), removed: linesStartingWith('-') };
}

function readLinesOrNone(file) {
  try {
    return readFileSync(file, 'utf8').split('\n');
  } catch {
    // A file deleted since git listed it has no lines left to count.
    return [];
  }
}

// New test files git does not track yet: their assertions count as added, so moving tests into them is not a loss.
function untrackedTestLines(root) {
  const listing = gitOutput(root, ['ls-files', '--others', '--exclude-standard']) ?? '';
  return listing.split('\n').filter(isTestFile).flatMap(path => readLinesOrNone(join(root, path)));
}

function countMatching(lines, pattern) {
  return lines.filter(line => pattern.test(line)).length;
}

function skipFindings(files) {
  return files
    .filter(file => countMatching(file.added, SKIP_MARKER) > countMatching(file.removed, SKIP_MARKER))
    .map(file => `skip/only marker added in ${file.path}`);
}

function assertionFindings(files, untrackedLines) {
  const net = file => countMatching(file.added, ASSERTION) - countMatching(file.removed, ASSERTION);
  const netTotal = files.reduce((total, file) => total + net(file), countMatching(untrackedLines, ASSERTION));
  if (netTotal >= 0) return [];
  return files.filter(file => net(file) < 0).map(file => `assertions removed from ${file.path}`);
}

// Returns one stable line per finding; empty when the tests look intact or git cannot tell.
export function findTestTampering(root) {
  const diff = gitOutput(root, ['diff', 'HEAD', '-U0', '-M', '--no-color', '--no-ext-diff']);
  if (diff === null) return [];
  const files = diff.split(/^diff --git /m).slice(1).map(parseFileDiff).filter(file => file.path && isTestFile(file.path));
  return [...skipFindings(files), ...assertionFindings(files, untrackedTestLines(root))];
}
