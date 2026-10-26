#!/usr/bin/env node
// Harnestica hooks: dependency-free, dispatched by event name. The logic lives in ./harnestica/.
//   start   SessionStart        audit the Lessons slot (cap, 90-day review, format) and the checks config
//   track   PostToolUse         record code edits and passing check runs
//   failure PostToolUseFailure  record failed check runs; flag a failure repeated from an earlier session
//   stop    Stop                block once when code changed after the last passing check, or tests were weakened
// Session state is an append-only event log, so parallel tool calls never lose updates.
// Every error fails open: the session is never broken by the harness.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { onSessionStart, onStop, onToolFailure, onToolUse } from './harnestica/handlers.mjs';
import { readInput } from './harnestica/protocol.mjs';
import { logHookError } from './harnestica/state.mjs';

export { loadConfig } from './harnestica/config.mjs';
export { failureSignature } from './harnestica/failures.mjs';
export { lessonsSection } from './harnestica/lessons.mjs';
export { matchCheck, matchChecks, mutates, shellSegments } from './harnestica/shell.mjs';

const HANDLERS = { start: onSessionStart, track: onToolUse, failure: onToolFailure, stop: onStop };

function isMain() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // An unresolvable script path means we were imported, not run; stay inert.
    return false;
  }
}

function main() {
  const eventName = process.argv[2];
  const input = readInput();
  try {
    HANDLERS[eventName]?.(input);
  } catch (error) {
    logHookError(input, eventName, error);
  }
}

if (isMain()) main();
