// The project's .claude/harnestica.json: which checks gate a turn, and the Lessons limits.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logHookError } from './state.mjs';

const DEFAULTS = { checks: [], lessonCap: 12, reviewDays: 90, docExtensions: ['.md', '.mdx', '.txt'] };

export function loadConfig(root) {
  try {
    const projectConfig = JSON.parse(readFileSync(join(root, '.claude', 'harnestica.json'), 'utf8'));
    return { ...DEFAULTS, ...projectConfig };
  } catch (error) {
    // Fail open: a missing or unreadable config means "no checks". `missing` and `unreadable` let session start say which.
    if (error.code === 'ENOENT') return { ...DEFAULTS, missing: true };
    logHookError({ cwd: root }, 'loadConfig', error);
    return { ...DEFAULTS, unreadable: true };
  }
}

export function hasNoChecks(config) {
  return config.missing || config.unreadable || !config.checks.length;
}
