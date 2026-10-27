// Installs the Harnestica harness into a project. Called by install.sh as: node lib/install.mjs <templateDir> <targetDir> [<profilesDir> <profileName>]
// Plans every change first and writes only after all inputs parsed, so a bad settings.json aborts the install before anything is touched.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const EXIT_USAGE = 64;
const EXIT_UNREADABLE_INPUT = 65;
const ACTION_COLUMN_WIDTH = 10;
const JSON_INDENT = 2;
const HOOKS_DIR = '.claude/hooks';
const SETTINGS_FILE = '.claude/settings.json';
const CONFIG_FILE = '.claude/harnestica.json';
const CUSTOMISABLE_FILES = ['.claude/rules/CLEAN-CODE.md', '.claude/skills/lesson/SKILL.md', '.claude/agents/explorer.md', '.claude/agents/reviewer.md'];
const CHECK_SCRIPTS = [{ name: 'types', script: 'typecheck' }, { name: 'lint', script: 'lint' }, { name: 'tests', script: 'test' }];
const HOOK_SCRIPT_MARKER = 'harnestica.mjs';
const RUNNER_ALLOW_RULE = 'Bash(node .claude/hooks/harnestica-check.mjs:*)';
const BLOCK_START = '<!-- harnestica:start -->';
const BLOCK_END = '<!-- harnestica:end -->';
const STATE_IGNORE_ENTRY = '.claude/harnestica/state';
const IGNORE_ENTRIES_COVERING_STATE = [STATE_IGNORE_ENTRY, '.claude/harnestica', '.claude'];

const phase = { writing: false };

// A failure the user can fix; carries the message to print and the process exit code.
class InstallError extends Error {
  constructor(message, exitCode = EXIT_UNREADABLE_INPUT) {
    super(message);
    this.exitCode = exitCode;
  }
}

function describeFailure(error) {
  if (error instanceof InstallError) return error.message;
  return phase.writing
    ? `Harnestica: write failed (${error.message}); re-run after fixing it.`
    : `Harnestica: unexpected file shape (${error.message}). Fix it, then re-run; nothing was changed.`;
}

function exitWithFailure(error) {
  console.error(describeFailure(error));
  process.exit(error.exitCode ?? EXIT_UNREADABLE_INPUT);
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new InstallError(`Harnestica: cannot parse ${label} (${error.message}). Fix it, then re-run; nothing was changed.`);
  }
}

function readTextOrEmpty(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function createPlan() {
  const writes = [];
  const notes = [];
  return {
    writes,
    notes,
    writeText(path, text, action, label) {
      writes.push({ path, text });
      notes.push([action, label]);
    },
    copyFile(path, from, action, label) {
      writes.push({ path, from });
      notes.push([action, label]);
    },
    note(action, label) {
      notes.push([action, label]);
    },
  };
}

function applyPlan(plan) {
  phase.writing = true;
  for (const write of plan.writes) {
    mkdirSync(dirname(write.path), { recursive: true });
    if (write.from) copyFileSync(write.from, write.path);
    else writeFileSync(write.path, write.text);
  }
  for (const [action, label] of plan.notes) console.log('  ' + action.padEnd(ACTION_COLUMN_WIDTH) + ' ' + label);
}

function listFiles(root, relativeDir = '') {
  const entries = readdirSync(join(root, relativeDir), { withFileTypes: true });
  return entries.flatMap(entry => {
    const relativePath = join(relativeDir, entry.name);
    return entry.isDirectory() ? listFiles(root, relativePath) : [relativePath];
  }).sort();
}

// Harness-owned hook files (the entry script and its modules): always updated.
function planHookFiles({ src, target }, plan) {
  for (const file of listFiles(join(src, HOOKS_DIR))) {
    plan.copyFile(join(target, HOOKS_DIR, file), join(src, HOOKS_DIR, file), 'updated', join(HOOKS_DIR, file));
  }
}

// Rules, skill and agents: copied when absent, kept when the project customised them.
function planCustomisableFiles({ src, target }, plan) {
  for (const file of CUSTOMISABLE_FILES) {
    const to = join(target, file);
    const from = join(src, file);
    if (!existsSync(to)) plan.copyFile(to, from, 'added', file);
    else if (readFileSync(to, 'utf8') === readFileSync(from, 'utf8')) plan.note('current', file);
    else plan.note('kept', `${file} (customised; left as is)`);
  }
}

function packageRunner(target) {
  if (existsSync(join(target, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(target, 'yarn.lock'))) return 'yarn';
  return 'npm run';
}

function checkCommand(runner, script) {
  if (script === 'test' && runner === 'npm run') return 'npm test';
  return `${runner} ${script}`;
}

function detectChecks(target) {
  const packagePath = join(target, 'package.json');
  if (!existsSync(packagePath)) return [];
  const scripts = readJson(packagePath, 'package.json').scripts ?? {};
  const runner = packageRunner(target);
  return CHECK_SCRIPTS.filter(({ script }) => scripts[script])
    .map(({ name, script }) => ({ name, command: checkCommand(runner, script) }));
}

// harnestica.json: created once, detecting check scripts from package.json when present. Returns the checks in use.
function planConfig({ src, target }, plan) {
  const configPath = join(target, CONFIG_FILE);
  if (existsSync(configPath)) {
    plan.note('kept', CONFIG_FILE);
    return readJson(configPath, CONFIG_FILE).checks ?? [];
  }
  const config = readJson(join(src, CONFIG_FILE), 'template config');
  const checks = detectChecks(target);
  config.checks = checks;
  const detected = checks.length ? checks.map(check => check.command).join(', ') : 'no checks detected — add them';
  plan.writeText(configPath, JSON.stringify(config, null, JSON_INDENT) + '\n', 'added', `${CONFIG_FILE} (${detected})`);
  return checks;
}

function isUnexpectedSettingsShape(settings) {
  if (typeof settings !== 'object' || Array.isArray(settings)) return true;
  return Boolean(settings.hooks) && typeof settings.hooks !== 'object';
}

function hasHarnesticaHook(entries) {
  return entries.some(entry => (entry.hooks ?? []).some(hook => String(hook.command ?? '').includes(HOOK_SCRIPT_MARKER)));
}

function addHookEntries(settings, ourHooks) {
  settings.hooks ??= {};
  for (const [event, ourEntries] of Object.entries(ourHooks)) {
    settings.hooks[event] ??= [];
    const entries = settings.hooks[event];
    if (!Array.isArray(entries)) throw new InstallError(`Harnestica: settings.hooks.${event} is not a list; nothing was changed.`);
    if (!hasHarnesticaHook(entries)) entries.push(...ourEntries);
  }
}

function allowChecks(settings, checks) {
  settings.permissions ??= {};
  settings.permissions.allow ??= [];
  const allow = settings.permissions.allow;
  const rules = [RUNNER_ALLOW_RULE, ...checks.map(check => `Bash(${check.command}:*)`)];
  for (const rule of rules) {
    if (!allow.includes(rule)) allow.push(rule);
  }
}

// settings.json: add Harnestica hook entries once and allow the check runner and commands; other settings are untouched.
function planSettings({ src, target }, plan, checks) {
  const settingsPath = join(target, SETTINGS_FILE);
  const settings = existsSync(settingsPath) ? readJson(settingsPath, SETTINGS_FILE) : {};
  if (isUnexpectedSettingsShape(settings)) throw new InstallError(`Harnestica: ${SETTINGS_FILE} has an unexpected shape; nothing was changed.`);
  const ourHooks = readJson(join(src, SETTINGS_FILE), 'template settings').hooks;
  const before = JSON.stringify(settings);
  addHookEntries(settings, ourHooks);
  allowChecks(settings, checks);
  if (JSON.stringify(settings) === before) plan.note('current', SETTINGS_FILE);
  else plan.writeText(settingsPath, JSON.stringify(settings, null, JSON_INDENT) + '\n', 'merged', SETTINGS_FILE);
}

// CLAUDE.md: the harness block is appended once, between markers, so project content and lessons are preserved.
function planClaudeMd({ src, target }, plan) {
  const mdPath = join(target, 'CLAUDE.md');
  const block = `${BLOCK_START}\n${readFileSync(join(src, 'CLAUDE.md'), 'utf8').trim()}\n${BLOCK_END}\n`;
  const existing = readTextOrEmpty(mdPath);
  if (existing.includes(BLOCK_START)) plan.note('kept', 'CLAUDE.md (harness block already present)');
  else if (!existing) plan.writeText(mdPath, block, 'added', 'CLAUDE.md');
  else plan.writeText(mdPath, existing.replace(/\s*$/, '\n\n') + block, 'appended', 'CLAUDE.md');
}

function endWithNewline(text) {
  return text && !text.endsWith('\n') ? text + '\n' : text;
}

function normalizeIgnoreLine(line) {
  return line.trim().replace(/^\//, '').replace(/\/$/, '');
}

// .gitignore: hook state is local to each machine.
function planGitignore({ target }, plan) {
  const ignorePath = join(target, '.gitignore');
  const ignore = readTextOrEmpty(ignorePath);
  const isCovered = ignore.split(/\r?\n/).map(normalizeIgnoreLine).some(line => IGNORE_ENTRIES_COVERING_STATE.includes(line));
  if (!isCovered) plan.writeText(ignorePath, endWithNewline(ignore) + STATE_IGNORE_ENTRY + '/\n', 'updated', '.gitignore');
}

// Opt-in profile (e.g. unreal): its rules file becomes an active rule; every other file is copied inert, for reference only.
function planProfile({ profilesDir, profile, target }, plan) {
  if (!profile) return;
  const profileDir = join(profilesDir, profile);
  const rulesFile = `${profile.toUpperCase()}.md`;
  if (!/^[a-z][a-z0-9-]*$/.test(profile) || !existsSync(join(profileDir, rulesFile))) {
    throw new InstallError(`Harnestica: unknown profile "${profile}". Available: ${listProfiles(profilesDir).join(', ') || 'none'}.`, EXIT_USAGE);
  }
  copyUnlessCustomised(plan, join(target, '.claude/rules', rulesFile), join(profileDir, rulesFile), join('.claude/rules', rulesFile));
  // Reference files can hold the owner's evidence log (VERIFY.md), so a re-run never overwrites them.
  for (const file of listFiles(profileDir).filter(name => name !== rulesFile)) {
    const reference = join('.claude/profiles', profile, file);
    copyUnlessCustomised(plan, join(target, reference), join(profileDir, file), `${reference} (reference only, inactive)`);
  }
}

function copyUnlessCustomised(plan, to, from, displayPath) {
  if (!existsSync(to)) plan.copyFile(to, from, 'added', displayPath);
  else if (readFileSync(to, 'utf8') === readFileSync(from, 'utf8')) plan.note('current', displayPath);
  else plan.note('kept', `${displayPath} (customised; left as is)`);
}

function listProfiles(profilesDir) {
  if (!existsSync(profilesDir)) return [];
  const hasRulesFile = name => existsSync(join(profilesDir, name, `${name.toUpperCase()}.md`));
  return readdirSync(profilesDir, { withFileTypes: true }).filter(entry => entry.isDirectory() && hasRulesFile(entry.name)).map(entry => entry.name).sort();
}

function main() {
  const [src, target, profilesDir, profile] = process.argv.slice(2);
  const paths = { src, target };
  const plan = createPlan();
  planProfile({ profilesDir, profile, target }, plan);
  planHookFiles(paths, plan);
  planCustomisableFiles(paths, plan);
  const checks = planConfig(paths, plan);
  planSettings(paths, plan, checks);
  planClaudeMd(paths, plan);
  planGitignore(paths, plan);
  applyPlan(plan);
}

try {
  main();
} catch (error) {
  exitWithFailure(error);
}
