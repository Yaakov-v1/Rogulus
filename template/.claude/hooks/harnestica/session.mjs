// The per-session event log: edits, passing checks, failures, gates and flags, in the order they happened.
// Positions in the log (1-based) stand in for time: "a pass after the last edit" is a larger position.
import { join } from 'node:path';
import { appendJsonLine, readJsonLines, stateDir } from './state.mjs';

const UNKNOWN_SESSION = 'unknown';

function sessionFile(root, sessionId) {
  const safeName = String(sessionId || UNKNOWN_SESSION).replace(/[^\w.-]/g, '_');
  return join(stateDir(root), 'sessions', `${safeName}.jsonl`);
}

function lastPosition(events, type, checkName) {
  const isForCheck = event => !checkName || event.check === checkName;
  const isMatch = event => event.type === type && isForCheck(event);
  return events.findLastIndex(isMatch) + 1;
}

function collect(events, type, field) {
  return new Set(events.filter(event => event.type === type).map(event => event[field]));
}

export function openSession(root, sessionId, config) {
  const file = sessionFile(root, sessionId);
  const events = readJsonLines(file);
  const lastEdit = lastPosition(events, 'edit');
  const checks = config?.checks ?? [];
  return {
    lastEdit,
    lastFail: lastPosition(events, 'fail'),
    unpassed: checks.filter(check => lastPosition(events, 'pass', check.name) < lastEdit),
    gated: collect(events, 'gate', 'edit'),
    flagged: collect(events, 'flag', 'sig'),
    record: event => appendJsonLine(file, event),
  };
}
