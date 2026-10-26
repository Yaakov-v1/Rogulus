// Where hook state lives on disk, and the JSON-lines files inside it.
// Records are added by appending, which keeps parallel tool calls from losing each other's records;
// the only rewrite is the occasional atomic trim of the failure log (see failures.mjs).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function projectRoot(input) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

export function stateDir(root) {
  return join(root, '.claude', 'harnestica', 'state');
}

export function readJsonLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(parseJsonOrNull).filter(Boolean);
}

function parseJsonOrNull(line) {
  try {
    return JSON.parse(line);
  } catch {
    // A torn line from a crashed writer must not hide the intact lines around it.
    return null;
  }
}

export function appendJsonLine(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + '\n');
}

export function logHookError(input, eventName, error) {
  const message = `${new Date().toISOString()} ${eventName} ${error?.stack ?? error}\n`;
  try {
    const dir = stateDir(projectRoot(input));
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'errors.log'), message);
  } catch {
    // Fail open: if even the error log cannot be written, there is nowhere left to report to.
  }
}
