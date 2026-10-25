#!/usr/bin/env node
// PreToolUse guard: the agent may not edit its own evaluators, tests it is graded by, or the ledger.
// This is the DGM / ImpossibleBench lesson: anything the agent can edit, it can game.
import fs from 'node:fs';

const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const t = input.tool_name, ti = input.tool_input || {};
const PROTECTED = [/(^|\/)\.harness\//, /(^|\/)\.claude\/(settings[^/]*\.json|rules\/learned\/)/,
  /(\.test\.|\.spec\.)[jt]sx?$/, /(^|\/)__tests__\//, /(^|\/)vitest\.config|jest\.config/];
const deny = (why) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
    permissionDecision: 'deny', permissionDecisionReason: why } }));
  process.exit(0);
};
// New test files are fine; changing existing ones is not (ImpossibleBench: read-only tests stop test-editing hacks).
const allowTests = process.env.HARNESS_ALLOW_TEST_EDITS === '1'; // human opt-in for test-refactoring tasks

if (['Write', 'Edit', 'MultiEdit'].includes(t)) {
  const f = ti.file_path || '';
  const isTest = /(\.test\.|\.spec\.|__tests__)/.test(f);
  if (PROTECTED.some((re) => re.test(f)) && !(isTest && (allowTests || !fs.existsSync(f))))
    deny(`${f} is protected (evaluator, test, or ledger file). If the spec and tests conflict, stop and say so: ` +
         `run \`node .harness/bin/ledger.mjs capture\` with the conflicting assumption instead of editing the check.`);
}
if (t === 'Bash') {
  const c = ti.command || '';
  if (/ledger\.mjs\s+(teach|evidence|approve|transition)/.test(c)) deny('Only humans and the harness can teach, approve or score ledger entries.');
  if (/(>|\b(tee|rm|mv|cp|truncate)\b|sed\s+-i)[^|;&]*\.harness\//.test(c)) deny('The .harness/ directory is read-only for the agent.');
  if (/--no-verify|git\s+push\s+.*--force/.test(c)) deny('Skipping hooks or force-pushing is not allowed.');
}
process.exit(0);
