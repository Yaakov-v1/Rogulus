import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL = join(dirname(fileURLToPath(import.meta.url)), '..', 'install.sh');
const EXIT_USAGE = 64;
const EXIT_UNREADABLE_INPUT = 65;
const MAX_HARNESS_BLOCK_LINES = 102;
const TRACKED_FILES = ['CLAUDE.md', '.claude/settings.json', '.gitignore', '.claude/harnestica.json'];
const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'template');
const HOOKS_DIR = '.claude/hooks';
const OTHER_HARNESS_FILES = ['CLAUDE.md', '.claude/rules/CLEAN-CODE.md', '.claude/skills/lesson/SKILL.md', '.claude/agents/explorer.md', '.claude/agents/reviewer.md'];

// Every file under the template hooks folder (recursively), read at test time so new modules are covered automatically.
function templateFiles(relativeDir) {
  return readdirSync(join(TEMPLATE_DIR, relativeDir), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? templateFiles(join(relativeDir, entry.name)) : [join(relativeDir, entry.name)]);
}

const runInstall = target => spawnSync('bash', [INSTALL, target], { encoding: 'utf8' });
const install = target => {
  const result = runInstall(target);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
};
const runProfileInstall = (target, profile) => spawnSync('bash', [INSTALL, target, '--profile', profile], { encoding: 'utf8' });
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const readText = (dir, file) => readFileSync(join(dir, file), 'utf8');

// Creates a throwaway target repo and removes it when the test ends.
function targetRepo(testContext) {
  const dir = mkdtempSync(join(tmpdir(), 'harnestica install '));
  testContext.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function installIntoPackage(testContext) {
  const dir = targetRepo(testContext);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', typecheck: 'tsc --noEmit' } }));
  install(dir);
  return dir;
}

function installIntoExistingProject(testContext) {
  const dir = targetRepo(testContext);
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.md'), '# My project\n\nUse pnpm.\n');
  writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify({
    model: 'sonnet',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
    permissions: { allow: ['Bash(ls)'] },
  }));
  writeFileSync(join(dir, '.claude/agents/reviewer.md'), 'my own reviewer\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules');
  install(dir);
  return dir;
}

test('fresh repo: installs every harness file', t => {
  const dir = installIntoPackage(t);
  const hookFiles = templateFiles(HOOKS_DIR);
  assert.ok(hookFiles.length > 1, 'expected harnestica.mjs plus its modules');
  for (const file of hookFiles) assert.equal(readText(dir, file), readText(TEMPLATE_DIR, file), file);
  for (const file of OTHER_HARNESS_FILES) assert.ok(readText(dir, file).length > 0, file);
});

test('fresh repo: detects package.json checks', t => {
  const dir = installIntoPackage(t);
  assert.deepEqual(readJson(join(dir, '.claude/harnestica.json')).checks.map(check => check.command), ['npm run typecheck', 'npm test']);
});

test('fresh repo: registers the four hooks and allows the check commands', t => {
  const dir = installIntoPackage(t);
  const settings = readJson(join(dir, '.claude/settings.json'));
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['PostToolUse', 'PostToolUseFailure', 'SessionStart', 'Stop']);
  assert.ok(settings.permissions.allow.includes('Bash(npm test:*)'));
  assert.ok(settings.permissions.allow.includes('Bash(node .claude/hooks/harnestica-check.mjs:*)'));
});

test('fresh repo: ignores the hook state directory', t => {
  const dir = installIntoPackage(t);
  assert.match(readText(dir, '.gitignore'), /^\.claude\/harnestica\/state\/$/m);
});

test('fresh repo: the harness block stays about 100 lines', t => {
  const dir = installIntoPackage(t);
  assert.ok(readText(dir, 'CLAUDE.md').split('\n').length <= MAX_HARNESS_BLOCK_LINES);
});

test('existing CLAUDE.md keeps its content and gains the harness block', t => {
  const dir = installIntoExistingProject(t);
  const claudeMd = readText(dir, 'CLAUDE.md');
  assert.ok(claudeMd.startsWith('# My project\n\nUse pnpm.\n'));
  assert.match(claudeMd, /<!-- harnestica:start -->[\s\S]*## 6\. Lessons[\s\S]*<!-- harnestica:end -->/);
});

test('existing settings keep their values and gain our hook beside theirs', t => {
  const dir = installIntoExistingProject(t);
  const settings = readJson(join(dir, '.claude/settings.json'));
  assert.equal(settings.model, 'sonnet');
  assert.equal(settings.hooks.Stop.length, 2);
  assert.ok(settings.permissions.allow.includes('Bash(ls)'));
});

test('a customised agent file is kept', t => {
  const dir = installIntoExistingProject(t);
  assert.equal(readText(dir, '.claude/agents/reviewer.md'), 'my own reviewer\n');
});

test('an existing .gitignore gains the state entry on its own line', t => {
  const dir = installIntoExistingProject(t);
  assert.equal(readText(dir, '.gitignore'), 'node_modules\n.claude/harnestica/state/\n');
});

test('no package.json means no guessed checks', t => {
  const dir = installIntoExistingProject(t);
  assert.deepEqual(readJson(join(dir, '.claude/harnestica.json')).checks, []);
});

test('a second run changes nothing', t => {
  const dir = installIntoExistingProject(t);
  const snapshot = TRACKED_FILES.map(file => readText(dir, file));
  install(dir);
  assert.deepEqual(TRACKED_FILES.map(file => readText(dir, file)), snapshot);
});

test('a CRLF .gitignore that already covers state is left alone', t => {
  const dir = targetRepo(t);
  const crlfIgnore = 'node_modules\r\n/.claude/harnestica/state/\r\n';
  writeFileSync(join(dir, '.gitignore'), crlfIgnore);
  install(dir);
  install(dir);
  assert.equal(readText(dir, '.gitignore'), crlfIgnore);
});

test('unparseable settings abort before any write', t => {
  const dir = targetRepo(t);
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude/settings.json'), '{ // comment\n}');
  assert.equal(runInstall(dir).status, EXIT_UNREADABLE_INPUT);
  assert.deepEqual(readdirSync(join(dir, '.claude')), ['settings.json']);
});

test('settings of an unexpected shape abort before any write', t => {
  const dir = targetRepo(t);
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [null] } }));
  const result = runInstall(dir);
  assert.equal(result.status, EXIT_UNREADABLE_INPUT);
  assert.match(result.stderr, /nothing was changed/);
  assert.deepEqual(readdirSync(join(dir, '.claude')), ['settings.json']);
});

test('refuses a missing target', () => {
  assert.equal(runInstall('/nonexistent/harnestica-target').status, EXIT_USAGE);
});

const PROFILE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'profiles', 'unreal');
const PROFILE_REFERENCE_FILES = ['VERIFY.md', 'bootstrap-check.sh', 'checks.unverified.json'];

function installUnrealProfile(testContext) {
  const dir = installIntoPackage(testContext);
  const result = runProfileInstall(dir, 'unreal');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return dir;
}

test('profile unreal: installs the rules file with paths frontmatter', t => {
  const dir = installUnrealProfile(t);
  const rules = readText(dir, '.claude/rules/UNREAL.md');
  assert.equal(rules, readText(PROFILE_DIR, 'UNREAL.md'));
  assert.match(rules, /^---\npaths:\n  - "/);
});

test('profile unreal: copies the other files as inactive reference', t => {
  const dir = installUnrealProfile(t);
  for (const file of PROFILE_REFERENCE_FILES) assert.equal(readText(dir, join('.claude/profiles/unreal', file)), readText(PROFILE_DIR, file), file);
});

test('profile unreal: a second run changes nothing', t => {
  const dir = installUnrealProfile(t);
  const files = [...TRACKED_FILES, '.claude/rules/UNREAL.md', ...PROFILE_REFERENCE_FILES.map(file => join('.claude/profiles/unreal', file))];
  const snapshot = files.map(file => readText(dir, file));
  assert.equal(runProfileInstall(dir, 'unreal').status, 0);
  assert.deepEqual(files.map(file => readText(dir, file)), snapshot);
});

test('profile unreal: a re-run keeps the owner\'s evidence log in VERIFY.md', t => {
  const dir = installUnrealProfile(t);
  const verifyPath = join(dir, '.claude/profiles/unreal/VERIFY.md');
  const withEvidence = `${readText(dir, '.claude/profiles/unreal/VERIFY.md')}\nverified 2026-11-01: Build.sh exit 0\n`;
  writeFileSync(verifyPath, withEvidence);
  assert.equal(runProfileInstall(dir, 'unreal').status, 0);
  assert.equal(readText(dir, '.claude/profiles/unreal/VERIFY.md'), withEvidence);
});

test('profile unreal: never merges candidate checks into the active config', t => {
  const dir = installUnrealProfile(t);
  const config = readText(dir, '.claude/harnestica.json');
  assert.deepEqual(readJson(join(dir, '.claude/harnestica.json')).checks.map(check => check.command), ['npm run typecheck', 'npm test']);
  assert.ok(!config.includes('unverified') && !config.includes('UnrealEditor'));
  assert.ok(!readText(dir, '.claude/settings.json').includes('Unreal'));
});

test('an unknown profile fails with a clear message and writes nothing', t => {
  const dir = targetRepo(t);
  const result = runProfileInstall(dir, 'nope');
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /unknown profile "nope".*Available: unreal/);
  assert.deepEqual(readdirSync(dir), []);
});

test('without --profile no profile files are installed', t => {
  const dir = installIntoPackage(t);
  assert.deepEqual(readdirSync(join(dir, '.claude/rules')), ['CLEAN-CODE.md']);
  assert.ok(!readdirSync(join(dir, '.claude')).includes('profiles'));
});
