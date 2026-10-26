// The four hook events. Each handler reads the event, updates session state, and may reply to Claude Code.
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { hasNoChecks, loadConfig } from './config.mjs';
import { failureSignature, recordFailure } from './failures.mjs';
import { auditLessons } from './lessons.mjs';
import { replyBlock, replyWithContext } from './protocol.mjs';
import { findTestTampering } from './tamper.mjs';
import { RUNNER_CHECK, RUNNER_COMMAND } from './runner.mjs';
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

// Test changes already in the working tree when the session starts are the owner's, not the agent's.
function recordTamperBaseline(root, config, input) {
  if (hasNoChecks(config)) return;
  const session = openSession(root, input.session_id);
  if (!session.hasTamperBaseline) session.record({ type: 'baseline', findings: findTestTampering(root) });
}

export function onSessionStart(input) {
  const root = projectRoot(input);
  const config = loadConfig(root);
  recordTamperBaseline(root, config, input);
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

// A run of the check runner covers every configured check.
function checksCoveredBy(config, hit) {
  return hit.check === RUNNER_CHECK ? config.checks : [hit.check];
}

function trackBash(root, config, input) {
  const session = openSession(root, input.session_id);
  if (bashChangedFiles(input)) session.record({ type: 'edit' });
  for (const hit of matchChecks(config, input.tool_input?.command, root)) {
    const type = hit.trusted ? 'pass' : 'masked';
    for (const check of checksCoveredBy(config, hit)) session.record({ type, check: check.name });
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
  const hit = matchCheck(loadConfig(root), input.tool_input?.command, root);
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
  const runAll = `all at once with \`${RUNNER_COMMAND}\``;
  if (session.lastFail > session.lastEdit) {
    return `Harnestica: the last check after your edits failed. Fix the cause and re-run ${commands} (or ${runAll}), or report the task as red / not verified and quote the failure.`;
  }
  return `Harnestica: code changed and these checks have not passed since: ${commands}. Run them (or ${runAll}) and quote the result lines. If a check cannot run, report the task as not verified and say why.`;
}

function isScanDue(session) {
  return Boolean(session.lastEdit) && !session.scanned.has(session.lastEdit);
}

// Tampering found now that was neither there at session start nor reported already.
function newTampering(root, session) {
  return findTestTampering(root).filter(finding => !session.knownTampering.has(finding));
}

function tamperReason(findings) {
  return `Harnestica: compared with HEAD, tests were skipped or lost assertions: ${findings.join('; ')}. Restore them, or, if the change is intended, say why in your report (rule T3).`;
}

// Everything is recorded only after the slow work, so a hook killed by its timeout leaves the gates due for next time.
function recordStop(session, { gateDue, scanDue, tampering }) {
  if (gateDue) session.record({ type: 'gate', edit: session.lastEdit });
  if (scanDue) session.record({ type: 'scan', edit: session.lastEdit });
  for (const finding of tampering) session.record({ type: 'tamper', finding });
}

export function onStop(input) {
  if (input.stop_hook_active) return;
  const root = projectRoot(input);
  const config = loadConfig(root);
  if (!config.checks.length) return;
  const session = openSession(root, input.session_id, config);
  const gateDue = isGateDue(session);
  const scanDue = isScanDue(session);
  const tampering = scanDue ? newTampering(root, session) : [];
  const reasons = [gateDue && gateReason(session), tampering.length && tamperReason(tampering)].filter(Boolean);
  recordStop(session, { gateDue, scanDue, tampering });
  if (reasons.length) replyBlock(reasons.join('\n'));
}
