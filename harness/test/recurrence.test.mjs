import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, runCli, saveConfig, candidate } from './helpers.mjs';
import { verify } from '../dist/sensors.js';
import { recurrenceSummaries } from '../dist/findings.js';
import { reviewItems } from '../dist/learning.js';
import { guide } from '../dist/guides.js';

const tsc = lines => ({ name: 'tsc', command: process.execPath, args: ['-e', `console.log(${JSON.stringify(lines.join('\n'))});process.exit(2)`], timeoutMs: 5000, parser: 'tsc' });
const err = (path, msg = 'Type string is not assignable') => `${path}(3,5): error TS2322: ${msg}`;

test('recurrence counts distinct sessions; retries and duplicate rows are not independent', async () => {
  const f = fixture(); try {
    f.config.checks = [tsc([err('src/a.ts'), err('src/a.ts')])];
    const s1 = f.store.createSession('', []), s2 = f.store.createSession('', []), s3 = f.store.createSession('', []);
    await verify(f.dir, f.config, f.store, s1); await verify(f.dir, f.config, f.store, s1); // retry, same snapshot
    let summary = recurrenceSummaries(f.store);
    assert.equal(summary.groups.length, 0, 'one session retried is not a recurrence');
    await verify(f.dir, f.config, f.store, s2);
    summary = recurrenceSummaries(f.store);
    assert.equal(summary.groups.length, 1);
    const g = summary.groups[0];
    assert.equal(g.sessionCount, 2); assert.equal(g.runCount, 3); assert.equal(g.distinctSnapshotCount, 2, 'retry of the same snapshot is one observation');
    assert.equal(g.path, 'src/a.ts'); assert.equal(g.examples.length, 2);
    assert.deepEqual(new Set(g.examples.map(e => e.sessionId)), new Set([s1, s2]));
    // Duplicate evidence/verification rows (INSERT OR IGNORE re-ingestion) do not add sessions.
    f.store.db.prepare('INSERT OR IGNORE INTO evidence SELECT * FROM evidence').run();
    assert.equal(recurrenceSummaries(f.store).groups[0].sessionCount, 2);
    // A timed-out or unparsed run never contributes; unrelated session without findings neither.
    f.config.checks = [{ ...tsc([err('src/a.ts')]), args: ['-e', 'console.log("boom");process.exit(1)'] }];
    await verify(f.dir, f.config, f.store, s3);
    assert.equal(recurrenceSummaries(f.store).groups[0].sessionCount, 2);
  } finally { f.cleanup(); }
});
test('recurrence output is bounded and makes zero model calls', async () => {
  const f = fixture(); try {
    const calls = join(f.dir, 'calls');
    f.config.checks = [tsc(Array.from({ length: 20 }, (_, i) => err(`src/f${i}.ts`, 'Bad ' + i)))]; saveConfig(f.dir, f.config);
    for (let i = 0; i < 5; i++) await verify(f.dir, f.config, f.store, f.store.createSession('', []));
    assert.equal(recurrenceSummaries(f.store).groups.length, 10);
    assert.equal(recurrenceSummaries(f.store).groupsTruncated, true);
    const out = runCli(f.dir, ['recurrence'], { FAKE_CALLS: calls });
    assert.equal(out.status, 0, out.stderr);
    assert.ok(JSON.parse(out.stdout).groups.every(g => g.examples.length <= 3 && g.sessionCount === 5));
    assert.equal(runCli(f.dir, ['review'], { FAKE_CALLS: calls }).status, 0);
    assert.equal(existsSync(calls), false, 'aggregation and review never invoke the agent');
  } finally { f.cleanup(); }
});
test('review shows claim, evidence, checks, recurrence and conflicts together, bounded, without changing state', async () => {
  const f = fixture(); try {
    f.config.checks = [tsc([err('src/a.ts')])]; saveConfig(f.dir, f.config);
    const c = candidate(f.store, 'Keep types aligned in src.', ['src']);
    for (let i = 0; i < 2; i++) await verify(f.dir, f.config, f.store, f.store.createSession('', []));
    const run = await verify(f.dir, f.config, f.store, c.session);
    f.store.linkCheck(c.id, `check:${run.id}:0`, f.config);
    for (let i = 0; i < 8; i++) { const o = candidate(f.store, 'Other src guidance ' + i, ['src/ui']); f.store.review([o.id], 'approve'); }
    const before = JSON.stringify(f.store.lessons());
    const item = reviewItems(f.store, f.config).items.find(x => x.id === c.id);
    assert.match(item.statedClaim, /types aligned/);
    assert.equal(item.evidence.citedEvidence.length, 1); assert.equal(item.evidence.recordedOutcome, item.outcome);
    assert.equal(item.relatedChecks[0].status, 'failed'); assert.equal(item.relatedChecks[0].findings, 1);
    assert.equal(item.recurrence.length, 1); assert.equal(item.recurrence[0].sessionCount, 3);
    assert.equal(item.conflictingLessons.length, 5); assert.equal(item.conflictingLessonsTotal, 8);
    assert.equal(JSON.stringify(f.store.lessons()), before, 'review is read-only');
    assert.equal(item.status, 'candidate'); assert.equal(item.outcome, 'supported');
  } finally { f.cleanup(); }
});
test('MECHANISM FIXTURE (not utility evidence): failure -> extraction candidate -> human approval -> next-session guidance', async () => {
  const f = fixture(); try {
    f.config.checks = [{ name: 'tests', command: process.execPath, args: ['-e', 'console.error("FAIL");process.exit(1)'], timeoutMs: 5000 }]; saveConfig(f.dir, f.config);
    const calls = join(f.dir, 'calls');
    assert.equal(runCli(f.dir, ['start'], { FAKE_TRANSCRIPT: join(f.dir, 't.jsonl') }).status, 0);
    const session = f.store.sessions()[0];
    assert.equal(runCli(f.dir, ['verify', '--session', session.id]).status, 1, 'failure is recorded, never converted to success');
    assert.equal(runCli(f.dir, ['learn'], { FAKE_CALLS: calls }).status, 0);
    assert.equal(readFileSync(calls, 'utf8').trim(), 'extract', 'one bounded extraction call');
    const [lesson] = f.store.lessons(); assert.equal(lesson.status, 'candidate');
    assert.equal(guide(f.store).lessonIds.length, 0, 'unapproved candidates are never injected');
    assert.ok(JSON.parse(runCli(f.dir, ['review']).stdout).items.some(x => x.id === lesson.id));
    assert.equal(runCli(f.dir, ['approve', lesson.id]).status, 0);
    const argFile = join(f.dir, 'args.json');
    const next = runCli(f.dir, ['start'], { FAKE_ARGS: argFile, FAKE_TRANSCRIPT: join(f.dir, 't2.jsonl') });
    assert.equal(next.status, 0, next.stderr);
    assert.match(JSON.parse(JSON.parse(next.stdout).hooks[0].stdout).hookSpecificOutput.additionalContext, /repository test command/);
  } finally { f.cleanup(); }
});
