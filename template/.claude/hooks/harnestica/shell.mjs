// Shell command parsing: which configured check a Bash command runs, and whether it may have changed files.
import { join } from 'node:path';
import { RUNNER_CHECK, RUNNER_SCRIPT } from './runner.mjs';

const QUOTES = ["'", '"'];
const TWO_CHAR_OPERATORS = ['&&', '||'];
const ONE_CHAR_OPERATORS = [';', '|', '&', '\n'];
const OPERATORS_BEFORE_TRUSTED_RUN = ['&&', ';', '\n'];

// Reads a quoted span starting at the opening quote. Inside double quotes a backslash escapes the next character.
function readQuoted(text, start) {
  const quote = text[start];
  let chunk = quote;
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    chunk += char;
    index += 1;
    if (char === quote) return { chunk, end: index, closed: true };
    if (char === '\\' && quote === '"') {
      chunk += text.slice(index, index + 1);
      index += 1;
    }
  }
  return { chunk, end: index, closed: false };
}

// `&` next to `>` belongs to a redirection (`2>&1`, `&> log`), not the background operator.
function isRedirectionAmpersand(text, index) {
  return text[index] === '&' && (text[index - 1] === '>' || text[index + 1] === '>');
}

function operatorAt(text, index) {
  const pair = text.slice(index, index + 2);
  if (TWO_CHAR_OPERATORS.includes(pair)) return pair;
  if (isRedirectionAmpersand(text, index)) return null;
  return ONE_CHAR_OPERATORS.includes(text[index]) ? text[index] : null;
}

// One lexical step at `index`: a quoted span, an escaped character, an operator, or a plain character.
function nextToken(text, index) {
  const char = text[index];
  if (QUOTES.includes(char)) return readQuoted(text, index);
  if (char === '\\') return { chunk: text.slice(index, index + 2), end: index + 2, closed: true };
  const op = operatorAt(text, index);
  if (op) return { op, end: index + op.length, closed: true };
  return { chunk: char, end: index + 1, closed: true };
}

// Split a shell command on top-level operators, honouring quotes. `balanced` is false for unterminated quotes.
export function shellSegments(command) {
  const text = String(command ?? '');
  const segments = [];
  const ops = [];
  let current = '';
  let balanced = true;
  let index = 0;
  while (index < text.length) {
    const token = nextToken(text, index);
    if (token.op) {
      segments.push(current);
      ops.push(token.op);
      current = '';
    } else {
      current += token.chunk;
    }
    balanced = balanced && token.closed;
    index = token.end;
  }
  segments.push(current);
  return { segments, ops, balanced };
}

const LEADING_ENV_ASSIGNMENTS = /^(\w+=\S*\s+)+/;
const NODE_SCRIPT = /^node (.+)$/;
const FD_REDIRECTIONS = /( \d*>&\d+)+$/;
const SURROUNDING_QUOTES = /^(["'])(.*)\1$/;
const PROJECT_DIR_PREFIX = /^\$\{?CLAUDE_PROJECT_DIR\}?\//;
const CURRENT_DIR_PREFIX = /^\.\//;

function normalizeCommand(command) {
  return String(command ?? '').trim().replace(/\s+/g, ' ').replace(LEADING_ENV_ASSIGNMENTS, '');
}

function runsCheck(segment, check) {
  if (!check.command) return false;
  const checkCommand = normalizeCommand(check.command);
  return segment === checkCommand || segment.startsWith(checkCommand + ' ');
}

// The exit status is trusted only when the check surely ran (not after `||` or a pipe) and nothing after it can
// mask the result: every later operator must be `&&`, so a pipe, `||`, `;` or `&` makes the run untrusted.
function isTrustedRun({ balanced, before, after }) {
  const surelyRan = before === undefined || OPERATORS_BEFORE_TRUSTED_RUN.includes(before);
  const nothingMasksResult = after.every(op => op === '&&');
  return balanced && (surelyRan && nothingMasksResult);
}

function nodeScriptPath(segment) {
  const script = segment.replace(FD_REDIRECTIONS, '').match(NODE_SCRIPT)?.[1];
  return script?.replace(SURROUNDING_QUOTES, '$2');
}

// The runner of *this* project: by its relative path, through $CLAUDE_PROJECT_DIR, or by its absolute path.
function isRunnerInvocation(segment, root) {
  const script = nodeScriptPath(segment);
  if (!script) return false;
  const relative = script.replace(PROJECT_DIR_PREFIX, '').replace(CURRENT_DIR_PREFIX, '');
  return relative === RUNNER_SCRIPT || script === join(root, RUNNER_SCRIPT);
}

function checkRunBy(segment, config, root) {
  if (isRunnerInvocation(segment, root)) return RUNNER_CHECK;
  return config.checks.find(candidate => runsCheck(segment, candidate));
}

// A check counts only when a top-level segment IS the check command (env assignments and extra arguments allowed),
// or the project's check runner, which is reported as RUNNER_CHECK.
export function matchChecks(config, command, root) {
  const { segments, ops, balanced } = shellSegments(command);
  const hits = [];
  segments.forEach((rawSegment, index) => {
    const segment = normalizeCommand(rawSegment);
    const check = checkRunBy(segment, config, root);
    if (!check) return;
    const trusted = isTrustedRun({ balanced, before: ops[index - 1], after: ops.slice(index) });
    hits.push({ check, trusted });
  });
  return hits;
}

export function matchCheck(config, command, root) {
  return matchChecks(config, command, root)[0] ?? null;
}

// Bash commands that commonly change files; used when Claude Code does not report a Bash edit itself.
const FILE_CHANGING_PATTERNS = [
  String.raw`\b(sed|perl)\s+(-\w*i|--in-place)`,
  String.raw`\s--(write|fix)\b`,
  String.raw`\bgit\s+(checkout|restore|apply|merge|rebase|pull|reset|stash\s+(pop|apply))\b`,
  String.raw`\b(mv|cp|rm|touch|patch)\s`,
  String.raw`(^|[^0-9&>])>>?\s*(?!\/dev\/null)[\w.\/~-]`,
];
const FILE_CHANGING_COMMAND = new RegExp(FILE_CHANGING_PATTERNS.join('|'));

export function mutates(command) {
  return FILE_CHANGING_COMMAND.test(String(command ?? ''));
}
