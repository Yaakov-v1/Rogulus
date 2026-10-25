import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixture, candidate, runCli } from './helpers.mjs';
import { guide } from '../dist/guides.js';
import { validateCandidates } from '../dist/learning.js';
import { verify, verificationStatus, snapshot } from '../dist/sensors.js';
import { REVIEW_AGE_MS } from '../dist/types.js';

test('approval, scope, expiration, rollback, and evidence remain separate', () => {
  const f = fixture(); try {
    const a = candidate(f.store), b = candidate(f.store, 'Use UI keyboard tests.', ['src/ui']);
    assert.equal(guide(f.store).lessonIds.length, 0);
    f.store.review([a.id, b.id], 'approve');
    assert.deepEqual(guide(f.store).lessonIds, [a.id]);
    assert.equal(guide(f.store, ['src/ui/dialog.ts']).lessonIds[0], b.id);
    assert.equal(guide(f.store, [], new Date(Date.now() + REVIEW_AGE_MS + 1)).lessonIds.length, 0);
    f.store.review([a.id], 'retire'); assert.equal(guide(f.store).lessonIds.length, 0);
    assert.throws(() => f.store.review([a.id], 'approve'));
    const refuted = candidate(f.store, 'Wrong assumption.', [], 'refuted');
    assert.throws(() => f.store.review([refuted.id], 'approve'), /refuted/);
  } finally { f.cleanup(); }
});
test('10,000 entries cannot breach context caps or leak inactive lessons', () => {
  const f = fixture(); try {
    f.store.transaction(() => {
      candidate(f.store);
      const seed = f.store.lessons()[0];
      const insert = f.store.db.prepare('INSERT INTO lessons VALUES(?,?,?,?,?,?,?,?,?)');
      for (let i = 0; i < 10000; i++) insert.run(`bulk-${i}`, 'Advice ' + i + ' ' + 'x'.repeat(900), '[]', seed.sessionId,
        JSON.stringify(seed.evidence), 'supported', i % 3 === 0 ? 'active' : i % 3 === 1 ? 'candidate' : 'retired', new Date().toISOString(), new Date().toISOString());
    });
    const result = guide(f.store);
    assert.ok(result.context.length <= 4000); assert.ok(result.lessonIds.length > 0 && result.lessonIds.length <= 5);
    for (const id of result.lessonIds) assert.equal(Number(id.split('-')[1]) % 3, 0);
  } finally { f.cleanup(); }
});
test('duplicate candidates and superseding preserve history atomically', () => {
  const f = fixture(); try {
    const a = candidate(f.store), row = f.store.lessons()[0];
    assert.equal(f.store.addCandidate(a.session, row), a.id);
    f.store.review([a.id], 'approve');
    const b = candidate(f.store, 'Use the new test command.');
    assert.throws(() => f.store.review([b.id], 'approve', 'missing'));
    assert.equal(f.store.lessons().find(l => l.id === b.id).status, 'candidate');
    f.store.review([b.id], 'approve', a.id);
    assert.deepEqual(guide(f.store).lessonIds, [b.id]);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM history').get().n, 3);
  } finally { f.cleanup(); }
});
test('schema rejects fabricated references, excessive results, paths and extra fields', () => {
  const e = [{ id: 'real' }], good = { statement: 'Use tests.', scope: [], evidence: ['real'], outcome: 'unknown' };
  assert.equal(validateCandidates({ lessons: [good] }, e).length, 1);
  for (const data of [{ lessons: [{ ...good, evidence: ['fake'] }] }, { lessons: Array(4).fill(good) },
    { lessons: [{ ...good, scope: ['../other'] }] }, { lessons: [{ ...good, runCommand: 'echo unsafe' }] }]) assert.throws(() => validateCandidates(data, e));
});
test('successful checks become stale after unstaged, staged or untracked changes', async () => {
  const f = fixture(); try {
    execFileSync('git', ['add', 'app.js'], { cwd: f.dir });
    assert.equal((await verify(f.dir, f.config, f.store)).status, 'verified');
    writeFileSync(join(f.dir, 'app.js'), 'changed');
    assert.equal(verificationStatus(f.dir, f.store).status, 'stale');
    await verify(f.dir, f.config, f.store);
    execFileSync('git', ['add', 'app.js'], { cwd: f.dir });
    assert.equal(verificationStatus(f.dir, f.store).status, 'stale');
    await verify(f.dir, f.config, f.store);
    writeFileSync(join(f.dir, 'extra.js'), 'extra');
    assert.equal(verificationStatus(f.dir, f.store).status, 'stale');
  } finally { f.cleanup(); }
});
test('failure, timeout, edit during check and missing commands cannot verify', async () => {
  const f = fixture(); try {
    for (const [args, expected] of [ [['-e', 'process.exit(2)'], 'failed'], [['-e', 'setTimeout(()=>{},10000)'], 'failed'],
      [['-e', 'require("fs").writeFileSync("app.js", "edited")'], 'changed'] ]) {
      f.config.checks[0].args = args; f.config.checks[0].timeoutMs = expected === 'changed' ? 2000 : 200;
      const result = await verify(f.dir, f.config, f.store);
      assert.equal(result.status, expected);
      if (args[1].includes('setTimeout')) assert.equal(result.results[0].status, 'timed_out');
    }
    f.config.checks[0].command = '/nonexistent-command';
    assert.equal((await verify(f.dir, f.config, f.store)).status, 'failed');
    f.config.checks = []; await assert.rejects(verify(f.dir, f.config, f.store), /No checks/);
  } finally { f.cleanup(); }
});
test('snapshot includes symlink targets and deletion without reading outside repository', () => {
  const f = fixture(); try {
    symlinkSync('/not/read', join(f.dir, 'link')); const before = snapshot(f.dir);
    unlinkSync(join(f.dir, 'link')); symlinkSync('/other/not/read', join(f.dir, 'link'));
    assert.notEqual(snapshot(f.dir), before);
  } finally { f.cleanup(); }
});
test('CLI capture is idempotent and approval is explicit', () => {
  const f = fixture(); try {
    const file = join(f.dir, 'capture.json'); writeFileSync(file, JSON.stringify({ statement: 'Use Node 24.', evidenceText: 'User: this project requires Node 24.' }));
    const a = runCli(f.dir, ['capture', '--file', file]), b = runCli(f.dir, ['capture', '--file', file]);
    assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
    assert.equal(JSON.parse(a.stdout).id, JSON.parse(b.stdout).id); assert.equal(f.store.lessons().length, 1);
    assert.equal(runCli(f.dir, ['approve']).status, 1);
    assert.equal(runCli(f.dir, ['approve', JSON.parse(a.stdout).id]).status, 0);
  } finally { f.cleanup(); }
});
