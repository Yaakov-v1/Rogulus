// How the hook talks to Claude Code: JSON event in on stdin, JSON reply out on stdout.
import { readFileSync } from 'node:fs';
import { logHookError, projectRoot } from './state.mjs';

export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch (error) {
    // Fail open: an unreadable event is treated as an empty one, so the hook does nothing instead of breaking the session.
    logHookError({}, 'readInput', error);
    return {};
  }
}

export function reply(payload) {
  process.stdout.write(JSON.stringify(payload));
}

export function replyWithContext(eventName, text) {
  reply({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } });
}

export function replyBlock(reason) {
  reply({ decision: 'block', reason });
}
