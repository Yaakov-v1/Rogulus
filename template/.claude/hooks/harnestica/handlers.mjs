// The four hook events. Each handler reads the event, updates session state, and may reply to Claude Code.
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { hasNoChecks, loadConfig } from './config.mjs';
import { failureSignature, recordFailure } from './failures.mjs';
import { auditLessons } from './lessons.mjs';
import { replyBlock, replyWithContext } from './protocol.mjs';
import { openSession } from './session.mjs';
import { matchCheck, matchChecks, mutates } from './shell.mjs';
import { projectRoot } from './state.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const ISO_DATE_LENGTH = 10;
const NO_CHECKS_NOTE = 'Harnestica: no checks configured in .claude/harnestica.json, so nothing can be verified green. Ask the owner for the real check commands.';
const UNREADABLE_CONFIG_NOTE = 'Harnestica: unreadable .claude/harnestica.json (see .claude/harnestica/state/errors.log), so nothing can be verified green. Fix the file.';

function readClaudeMd(root) {
  try {
    return readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  } catch {
    // A project without CLAUDE.md has no Lessons slot to audit; that is not an error.
    return '';
  }
}

// `now` in the event lets callers pin the clock; otherwise the real date is used.
function eventClock(input) {
  return input.now ? new Date(input.now) : new Date();
}

export function onSessionStart(input) {
  const root = projectRoot(input);
  const config = loadConfig(root);
  const notes = hasNoChecks(config) ? [config.unreadable ? UNREADABLE_CONFIG_NOTE : NO_CHECKS_NOTE] : [];
  notes.push(...auditLessons(readClaudeMd(root), config, eventClock(input)));
  if (notes.length) replyWithContext('SessionStart', notes.join('\n'));
}

function isCodeEdit(config, input) {
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '';
  return !config.docExtensions.includes(extname(String(path)).toLowerCase());
}

function bashChangedFiles(input) {
  return Boolean(input.tool_response?.bashEditDiff) || mutates(input.tool_input?.command);
}

function trackBash(root, config, input) {
  const session = openSession(root, input.session_id);
  if (bashChangedFiles(input)) session.record({ type: 'edit' });
  for (const hit of matchChecks(config, input.tool_input?.command)) {
    session.record({ type: hit.trusted ? 'pass' : 'masked', check: hit.check.name });
  }
}

export function onToolUse(input) {
  const root = projectRoot(input);
  const config = loadConfig(root);
  if (EDIT_TOOLS.has(input.tool_name)) {
    if (isCodeEdit(config, input)) openSession(root, input.session_id).record({ type: 'edit' });
  } else if (input.tool_name === 'Bash') {
    trackBash(root, config, input);
  }
}

function repeatFailureNote(checkName, earlier) {
  return `Harnestica: check "${checkName}" failed the same way in an earlier session (${earlier.at.slice(0, ISO_DATE_LENGTH)}). After fixing it, propose a LESSON? so it does not repeat.`;
}

export function onToolFailure(input) {
  if (input.tool_name !== 'Bash' || input.is_interrupt) return;
  const root = projectRoot(input);
  const hit = matchCheck(loadConfig(root), input.tool_input?.command);
  if (!hit) return;
  const session = openSession(root, input.session_id);
  const signature = failureSignature(hit.check, input.error);
  session.record({ type: 'fail', check: hit.check.name, sig: signature });
  const earlier = recordFailure(root, { sessionId: input.session_id, check: hit.check, signature, error: input.error });
  if (!earlier || session.flagged.has(signature)) return;
  session.record({ type: 'flag', sig: signature });
  replyWithContext('PostToolUseFailure', repeatFailureNote(hit.check.name, earlier));
}

function isGateDue(session) {
  if (!session.lastEdit) return false;
  if (!session.unpassed.length) return false;
  return !session.gated.has(session.lastEdit);
}

function gateReason(session) {
  const commands = session.unpassed.map(check => '`' + check.command + '`').join(', ');
  if (session.lastFail > session.lastEdit) {
    return `Harnestica: the last check after your edits failed. Fix the cause and re-run ${commands}, or report the task as red / not verified and quote the failure.`;
  }
  return `Harnestica: code changed and these checks have not passed since: ${commands}. Run them and quote the results. If a check cannot run, report the task as not verified and say why.`;
}

export function onStop(input) {
  if (input.stop_hook_active) return;
  const root = projectRoot(input);
  const config = loadConfig(root);
  if (!config.checks.length) return;
  const session = openSession(root, input.session_id, config);
  if (!isGateDue(session)) return;
  session.record({ type: 'gate', edit: session.lastEdit });
  replyBlock(gateReason(session));
}
