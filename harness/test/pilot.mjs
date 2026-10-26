import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { initialize, readConfig } from '../dist/config.js';
import { Store } from '../dist/store.js';
import { start } from '../dist/factory.js';
import { verify } from '../dist/sensors.js';
import { cases } from './pilot-cases.mjs';
const run = process.argv.includes('--run');
const modelAt = process.argv.indexOf('--model');
const model = modelAt >= 0 ? process.argv[modelAt + 1] : 'sonnet';
const outAt = process.argv.indexOf('--out');
const out = outAt >= 0 ? process.argv[outAt + 1] : null;
const report = { kind: 'real-model paired pilot', model, status: 'not_run', tasks: cases.map(c => ({ id: c.id, category: c.category })), results: [],
  caveat: 'Seeded toy tasks, not production utility proof. Corrections, regressions beyond assertions, human review effort and observed recurrence require manual annotation (null = not observed). Experimental lessons are explicitly seeded; this is not evidence of automatic learning.' };
function save() { if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); }
if (!run) {
  console.log('Ten paired tasks prepared. To make up to 20 paid Claude calls, pass --run --model <fixed-model> --out <report.json>.');
  console.log(JSON.stringify(report, null, 2)); save();
} else {
  const auth = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8' });
  let authenticated = false; try { authenticated = JSON.parse(auth.stdout).loggedIn === true; } catch {}
  if (!authenticated) { report.status = 'blocked_authentication'; save(); console.error('Claude is not authenticated. Run claude auth login, then rerun the pilot.'); process.exitCode = 1; }
  else {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'lean-pilot-'))); report.scratch = scratch;
    for (let index = 0; index < cases.length; index++) {
      const task = cases[index];
      // Alternate treatment order to reduce systematic ordering effects.
      for (const treatment of index % 2 ? ['harness', 'baseline'] : ['baseline', 'harness']) {
        const root = join(scratch, task.id + '-' + treatment); mkdirSync(root);
        execFileSync('git', ['init', '-q'], { cwd: root });
        for (const [path, text] of Object.entries(task.files)) writeFileSync(join(root, path), text);
        initialize(root); const config = readConfig(root);
        const checkFile = join(scratch, task.id + '-' + treatment + '-assertions.mjs');
        writeFileSync(checkFile, `import assert from 'node:assert/strict';\nconst m = await import(${JSON.stringify(pathToFileURL(join(root, 'index.mjs')).href)});\n${task.test}\n`);
        config.checks = [{ name: 'acceptance', command: process.execPath, args: [checkFile], timeoutMs: 10000 }];
        writeFileSync(join(root, '.lean-harness', 'config.json'), JSON.stringify(config));
        const store = new Store(root, true);
        if (treatment === 'harness') {
          const id = store.createSession('', []); store.endSession(id, 'manual');
          store.db.prepare("UPDATE sessions SET learning_status='done' WHERE id=?").run(id);
          const lessons = ['Preserve valid zero, false and empty-string values; use nullish semantics where required.', 'Avoid mutating caller-owned arrays when producing sorted results.', 'Keep amounts in integer cents and include quantities in line totals.'];
          for (const [i, statement] of lessons.entries()) {
            const evidence = { id: `pilot:${i}`, sessionId: id, kind: 'explicit', text: statement, source: 'authored pilot fixture' };
            store.addEvidence(evidence); const lesson = store.addCandidate(id, { statement, scope: [], evidence: [evidence.id], outcome: 'supported' });
            store.review([lesson], 'approve');
          }
        }
        const started = performance.now();
        const code = await start(root, config, ['-p', '--model', model, '--max-budget-usd', '2', '--permission-mode', 'acceptEdits',
          '--tools', 'Read,Edit,Write', '--allowedTools', 'Read,Edit,Write',
          task.prompt + '\nEdit only the supplied source modules. Do not change configuration or harness state.'], [], treatment === 'baseline');
        const elapsedMs = performance.now() - started;
        const verification = await verify(root, config, store);
        const sessions = store.sessions().filter(s => s.status !== 'manual');
        report.results.push({ task: task.id, treatment, code, elapsedMs, verified: verification.status === 'verified',
          checkMs: verification.results.reduce((n,r)=>n+r.durationMs,0), injectedChars: sessions[0]?.context.length ?? 0,
          humanCorrections: null, regressions: null, batchReviewMs: null,
          humanReview: { itemsReviewed: null, approved: null, rejected: null, retired: null, notes: null },
          observedRecurrence: { priorMistakeRef: null, comparableTaskRef: null, recurred: null, preventedByLesson: null, notes: null } });
        store.close(); report.status = 'running'; save();
      }
    }
    report.status = 'completed_needs_human_review'; save(); console.log(JSON.stringify(report, null, 2));
  }
}
