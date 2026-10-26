// The cross-session failure log: a failure signature stable enough to recognise the same failure later.
import { createHash } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendJsonLine, readJsonLines, stateDir } from './state.mjs';

const FAILURE_LOG_MAX = 1000;
const TRIM_SLACK_FACTOR = 1.2;
const TRIM_THRESHOLD = FAILURE_LOG_MAX * TRIM_SLACK_FACTOR;
const SIGNATURE_LINES = 3;
const SIGNATURE_LENGTH = 16;
const EXCERPT_LENGTH = 300;

const EXIT_CODE_LINE = /^exit code \d+$/i;
export const ERROR_LINE = /error|fail|assert|expected|cannot|not found|TS\d+/i;
const DURATION = /\b\d+(\.\d+)?\s?(ms|s|m)\b/g;
const HEX_NUMBER = /\b0x[0-9a-f]+\b/gi;
const NUMBER = /\b\d+\b/g;

function significantLines(error) {
  return String(error ?? '').split('\n').map(line => line.trim()).filter(line => line && !EXIT_CODE_LINE.test(line));
}

function evidenceLines(lines) {
  const errorLines = lines.filter(line => ERROR_LINE.test(line)).slice(0, SIGNATURE_LINES);
  return errorLines.length ? errorLines : lines.slice(0, SIGNATURE_LINES);
}

// Volatile parts (durations, counts, hex ids) are masked so the same failure matches across sessions.
function maskVolatileParts(text) {
  return text.replace(DURATION, '#t').replace(HEX_NUMBER, '#h').replace(NUMBER, '#');
}

export function failureSignature(check, error) {
  const text = maskVolatileParts(evidenceLines(significantLines(error)).join('\n'));
  return createHash('sha256').update(check.name + '\n' + text).digest('hex').slice(0, SIGNATURE_LENGTH);
}

function failureLogFile(root) {
  return join(stateDir(root), 'failures.jsonl');
}

function isRecordedByOtherSession(entry, sessionId) {
  return Boolean(entry.session) && entry.session !== sessionId;
}

function isFromOtherSession(entry, signature, sessionId) {
  return entry.sig === signature && isRecordedByOtherSession(entry, sessionId);
}

// Writes via a per-process temp file so a concurrent append never sees a half-written log.
function trimLog(file) {
  const tempFile = `${file}.${process.pid}.tmp`;
  const kept = readJsonLines(file).slice(-FAILURE_LOG_MAX).map(entry => JSON.stringify(entry));
  writeFileSync(tempFile, kept.join('\n') + '\n');
  renameSync(tempFile, file);
}

// Logs the failure and returns the earlier occurrence from another session, if any.
export function recordFailure(root, { sessionId, check, signature, error }) {
  const file = failureLogFile(root);
  const entries = readJsonLines(file);
  const earlier = sessionId ? entries.find(entry => isFromOtherSession(entry, signature, sessionId)) : undefined;
  appendJsonLine(file, {
    at: new Date().toISOString(),
    session: sessionId ?? null,
    check: check.name,
    sig: signature,
    excerpt: String(error ?? '').slice(0, EXCERPT_LENGTH),
  });
  // Trim only occasionally: the log may grow past the cap in between, which is cheaper than rewriting on every failure.
  if (entries.length >= TRIM_THRESHOLD) trimLog(file);
  return earlier;
}
