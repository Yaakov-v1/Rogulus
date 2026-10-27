// The context budget: what the harness loads into every session must stay small, because instructions past the
// budget are followed less reliably and cost tokens on every turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'template');
const RULES_DIR = join(TEMPLATE_DIR, '.claude', 'rules');
const MAX_CLAUDE_MD_LINES = 100;
const LESSON_SLOT_LINES = 12;
// Measured at 4,623 bytes on 2026-10-26; raise it only with a reason in the commit message.
// Raised to 6,200 on 2026-10-27 for the owner-approved trust ranking, model routing and tripwire rules (about 6,170 bytes after review fixes).
const ALWAYS_LOADED_BUDGET_BYTES = 6200;
const AIDLC_RULES = [/Tripwire/, /Trust, highest first/, /Route by model/, /checkpoint of 3 lines/];
const PATHS_FRONTMATTER = /^---\r?\n(?:.*\r?\n)*?paths:/;

const readTemplate = (...parts) => readFileSync(join(TEMPLATE_DIR, ...parts), 'utf8');
const ruleFiles = () => readdirSync(RULES_DIR).filter(file => file.endsWith('.md'));
const isPathScoped = file => PATHS_FRONTMATTER.test(readFileSync(join(RULES_DIR, file), 'utf8'));

test('CLAUDE.md stays within 100 lines even with the Lessons slot full', () => {
  const lines = readTemplate('CLAUDE.md').trimEnd().split('\n').length;
  assert.ok(lines + LESSON_SLOT_LINES <= MAX_CLAUDE_MD_LINES, `${lines} lines + ${LESSON_SLOT_LINES} lessons`);
});

test('every rules file is path-scoped, so none loads into sessions that touch no code', () => {
  for (const file of ruleFiles()) assert.ok(isPathScoped(file), `${file} has no paths: frontmatter`);
});

test('CLAUDE.md keeps the trust, routing, tripwire and checkpoint rules', () => {
  const claudeMd = readTemplate('CLAUDE.md');
  for (const rule of AIDLC_RULES) assert.match(claudeMd, rule);
});

test('the always-loaded text stays within its byte budget', () => {
  const unscopedRules = ruleFiles().filter(file => !isPathScoped(file)).map(file => readFileSync(join(RULES_DIR, file), 'utf8'));
  const bytes = Buffer.byteLength([readTemplate('CLAUDE.md'), ...unscopedRules].join(''));
  assert.ok(bytes <= ALWAYS_LOADED_BUDGET_BYTES, `${bytes} bytes > ${ALWAYS_LOADED_BUDGET_BYTES}`);
});
