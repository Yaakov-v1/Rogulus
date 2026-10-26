#!/usr/bin/env node
// Harnestica check runner. From the project root: node .claude/hooks/harnestica-check.mjs
// Runs every check in .claude/harnestica.json in order and prints one line per check, plus an excerpt for failures.
// Exits 0 only when every check passed; the hooks count a trusted run of this command as a pass for every check.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasNoChecks, loadConfig } from './harnestica/config.mjs';
import { EXIT_NO_CHECKS, exitCodeFor, formatReport, runCheck } from './harnestica/runner.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = loadConfig(projectRoot);

if (hasNoChecks(config)) {
  console.log('harnestica: no checks configured in .claude/harnestica.json, so nothing was verified.');
  process.exitCode = EXIT_NO_CHECKS;
} else {
  const results = config.checks.map(check => runCheck(projectRoot, check));
  console.log(formatReport(results));
  process.exitCode = exitCodeFor(results);
}
