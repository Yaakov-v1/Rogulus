import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import type { Config } from './types.js';

export function repository(cwd = process.cwd()): string {
  try { return realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
  catch { throw new Error('Run inside a Git repository. Initialize the target repository first.'); }
}
export const stateDir = (root: string) => join(root, '.lean-harness');
export function initialize(root: string): boolean {
  mkdirSync(stateDir(root), { recursive: true, mode: 0o700 });
  mkdirSync(join(stateDir(root), 'telemetry'), { recursive: true, mode: 0o700 });
  const path = join(stateDir(root), 'config.json');
  if (existsSync(path)) return false;
  const config: Config = { version: 1, agent: { command: 'claude', args: [] }, checks: [],
    learning: { model: 'haiku', timeoutMs: 120000, maxBudgetUsd: 1, maxInputChars: 48000 } };
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  const ignore = join(root, '.gitignore');
  const existing = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  for (const rule of ['/.lean-harness/state.sqlite*', '/.lean-harness/telemetry/'])
    if (!existing.split('\n').includes(rule)) appendFileSync(ignore, '\n' + rule + '\n');
  return true;
}
// Claude Code is the only supported agent; a legacy kind:'claude' is tolerated, anything else is rejected.
const validAgent = (a: any): boolean => a && typeof a === 'object' && typeof a.command === 'string' && Boolean(a.command) && strings(a.args);
function rejectOtherAgents(c: any) {
  for (const a of [c?.agent, c?.learning?.agent]) if (a && typeof a === 'object' && a.kind !== undefined && a.kind !== 'claude')
    throw new Error(`Unsupported agent kind "${String(a.kind)}": only Claude Code is supported. Remove "kind" or set it to "claude".`);
  if (c?.learning?.agent !== undefined) throw new Error('learning.agent is not supported; extraction uses the top-level agent (Claude Code).');
}
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === 'string');
export function readConfig(root: string): Config {
  const file = join(stateDir(root), 'config.json');
  if (!existsSync(file)) throw new Error('Run lean-harness init first.');
  const c = JSON.parse(readFileSync(file, 'utf8'));
  rejectOtherAgents(c);
  if (c.version !== 1 || !validAgent(c.agent)
    || !Array.isArray(c.checks) || !c.learning || typeof c.learning.model !== 'string'
    || !Number.isInteger(c.learning.timeoutMs) || c.learning.timeoutMs < 1 || c.learning.timeoutMs > 600000
    || !Number.isFinite(c.learning.maxBudgetUsd) || c.learning.maxBudgetUsd <= 0
    || !Number.isInteger(c.learning.maxInputChars) || c.learning.maxInputChars < 1000 || c.learning.maxInputChars > 100000)
    throw new Error('Invalid harness config. See README configuration.');
  const names = new Set();
  for (const check of c.checks) {
    if (typeof check.name !== 'string' || !check.name || names.has(check.name)
      || typeof check.command !== 'string' || !check.command || !strings(check.args)
      || (check.parser !== undefined && check.parser !== 'tsc')
      || !Number.isInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 3600000)
      throw new Error('Each check needs a unique name, command, args array, and timeoutMs (1–3600000).');
    names.add(check.name);
  }
  return c as Config;
}
export function taskPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)
    || normalized.split('/').some(s => !s || s === '..' || s === '.') || normalized.includes('\0'))
    throw new Error(`Expected a repository-relative path: ${value}`);
  return normalized;
}
export const scopesOverlap = (a: string[], b: string[]) => a.length === 0 || b.length === 0 || a.some(x => b.some(y => x === y || x.startsWith(y + '/') || y.startsWith(x + '/')));
