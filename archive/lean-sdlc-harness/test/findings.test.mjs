import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, runCli, saveConfig } from './helpers.mjs';
import { verify } from '../dist/sensors.js';
import { readConfig } from '../dist/config.js';
import { Store } from '../dist/store.js';
import { FINDING_LIMIT } from '../dist/findings.js';

const tscCheck = (script, parser = 'tsc') => ({ name: 'tsc', command: process.execPath, args: ['-e', script], timeoutMs: 5000, ...(parser ? { parser } : {}) });
const emit = (lines, code) => `console.log(${JSON.stringify(lines.join('\n'))});process.exit(${code})`;
const line = (path, n, msg = 'Type error') => `${path}(${n},5): error TS2322: ${msg}`;

test('tsc findings are parsed with bounds and preserve raw run identity', async () => {
  const f = fixture(); try {
    const lines = [line('src/a.ts', 1, 'Type string is not assignable'), line('/etc/passwd', 2), line('../out.ts', 3), line('src/b.ts', 0),
      ...Array.from({ length: 60 }, (_, i) => line('src/c.ts', i + 1)), 'unrelated noise'];
    f.config.checks = [tscCheck(emit(lines, 2))];
    const run = await verify(f.dir, f.config, f.store, f.store.createSession('', []));
    const r = run.results[0];
    assert.equal(run.status, 'failed'); assert.equal(r.status, 'failed'); assert.equal(r.code, 2);
    assert.equal(r.parserStatus, 'parsed'); assert.equal(r.findings.length, FINDING_LIMIT); assert.equal(r.findingsTruncated, true);
    assert.equal(r.findings[0].path, 'src/a.ts'); assert.equal(r.findings[0].category, 'typescript:TS2322');
    assert.ok(r.findings.every(x => !x.path.startsWith('/') && !x.path.includes('..') && x.line >= 1 && x.evidenceRef === `check:${run.id}:0`));
    assert.ok(r.output.includes('unrelated noise') && r.output.includes('/etc/passwd'), 'raw output preserved');
    assert.ok(typeof r.durationMs === 'number' && r.checkFingerprint);
    const row = f.store.db.prepare('SELECT * FROM verifications WHERE id=?').get(run.id);
    assert.ok(row.before_hash && row.after_hash);
  } finally { f.cleanup(); }
});
test('nonzero exit without parseable findings stays failed and unparsed', async () => {
  const f = fixture(); try {
    f.config.checks = [tscCheck(emit(['something exploded', '../x.ts(1,1): error TS1: out of tree'], 1))];
    const run = await verify(f.dir, f.config, f.store);
    assert.equal(run.status, 'failed'); assert.equal(run.results[0].status, 'failed');
    assert.equal(run.results[0].parserStatus, 'unparsed'); assert.deepEqual(run.results[0].findings, []);
    f.config.checks = [tscCheck(emit(['x'], 1), null)];
    assert.equal((await verify(f.dir, f.config, f.store)).results[0].parserStatus, 'not_configured');
  } finally { f.cleanup(); }
});
test('parsed findings cannot flip failure to success, and timeouts stay timed_out', async () => {
  const f = fixture(); try {
    // Exit 0 with error-looking output is still passed by process status; nonzero with none is never verified.
    f.config.checks = [tscCheck(emit([line('app.js', 1)], 3))];
    const failed = await verify(f.dir, f.config, f.store);
    assert.equal(failed.status, 'failed'); assert.notEqual(failed.results[0].status, 'passed');
    f.config.checks = [{ ...tscCheck(`console.log(${JSON.stringify(line('app.js', 1))});setTimeout(()=>{},10000)`), timeoutMs: 300 }];
    const timed = await verify(f.dir, f.config, f.store);
    assert.equal(timed.results[0].status, 'timed_out'); assert.equal(timed.status, 'failed');
    assert.equal(runCli(f.dir, ['status']).status, 0);
  } finally { f.cleanup(); }
});
test('invalid or forged check references are rejected and never prove or approve a lesson', async () => {
  const f = fixture(); try {
    f.config.checks = [tscCheck(emit([line('app.js', 1)], 2))]; saveConfig(f.dir, f.config);
    const s1 = f.store.createSession('', []), s2 = f.store.createSession('', []);
    const run = await verify(f.dir, f.config, f.store, s1); const ref = `check:${run.id}:0`;
    const ev = { id: 'e1', sessionId: s1, kind: 'explicit', text: 'User correction.', source: 'fixture' }; f.store.addEvidence(ev);
    const id = f.store.addCandidate(s1, { statement: 'Mind types.', scope: [], outcome: 'unknown', evidence: ['e1'] });
    const other = f.store.addCandidate(s2, { statement: 'Other session.', scope: [], outcome: 'unknown', evidence: [] });
    for (const bad of ['check:nope:0', `check:${run.id}:5`, 'check:' + run.id, 'manual:1', 'e1', `check:${run.id}:00`])
      assert.throws(() => f.store.linkCheck(id, bad, f.config), undefined, bad);
    assert.throws(() => f.store.linkCheck(other, ref, f.config), /does not belong/);
    assert.throws(() => f.store.linkCheck('missing', ref, f.config), /Unknown lesson/);
    // Forged evidence row: text differs from the actual verification result.
    f.store.db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?)').run(`check:${run.id}:1`, s1, 'check', '{"name":"tsc"}', run.id);
    assert.throws(() => f.store.linkCheck(id, `check:${run.id}:1`, f.config));
    // Real run whose check is no longer configured cannot be linked.
    assert.throws(() => f.store.linkCheck(id, ref, { ...f.config, checks: [] }), /not a configured check/);
    const r = runCli(f.dir, ['link-check', id, 'check:fake:0']); assert.equal(r.status, 1);
    // A valid link is explanatory only.
    assert.equal(f.store.linkCheck(id, ref, f.config).check, 'tsc');
    const lesson = f.store.lessons().find(l => l.id === id);
    assert.equal(lesson.status, 'candidate'); assert.equal(lesson.outcome, 'unknown'); assert.deepEqual(lesson.evidence, ['e1']);
    assert.equal(f.store.lessonChecks(id, f.config).length, 1);
    // Generated commands in capture data never become checks.
    const file = join(f.dir, 'cap.json');
    writeFileSync(file, JSON.stringify({ statement: 'Run it.', evidenceText: 'User said so.', checks: [{ name: 'evil', command: 'rm', args: ['-rf', '/'] }], command: 'rm' }));
    assert.equal(runCli(f.dir, ['capture', '--file', file]).status, 0);
    assert.deepEqual(readConfig(f.dir).checks.map(c => c.name), ['tsc']);
    writeFileSync(file, JSON.stringify({ statement: 'Run it 2.', evidenceText: 'User said so 2.', checkRefs: [ref] }));
    assert.equal(runCli(f.dir, ['capture', '--file', file]).status, 1, 'manual session cannot claim another session\'s run');
  } finally { f.cleanup(); }
});
test('old configs and databases still load; non-Claude agents are rejected', () => {
  const f = fixture(); try {
    const old = { version: 1, agent: { command: 'claude', args: [] }, checks: [{ name: 'x', command: 'true', args: [], timeoutMs: 1000 }],
      learning: { model: 'haiku', timeoutMs: 120000, maxBudgetUsd: 1, maxInputChars: 48000 } };
    saveConfig(f.dir, old); assert.equal(readConfig(f.dir).checks.length, 1);
    saveConfig(f.dir, { ...old, agent: { kind: 'claude', command: 'claude', args: [] } }); assert.equal(readConfig(f.dir).agent.command, 'claude');
    for (const kind of ['codex', 'manual']) {
      saveConfig(f.dir, { ...old, agent: { kind, command: 'x', args: [] } });
      assert.throws(() => readConfig(f.dir), new RegExp(`Unsupported agent kind "${kind}"`));
    }
    saveConfig(f.dir, { ...old, learning: { ...old.learning, maxBudgetUsd: null } }); assert.throws(() => readConfig(f.dir), /Invalid harness config/);
    saveConfig(f.dir, old);
    // A pre-enhancement DB (no lesson_checks table, check results without finding fields) opens and reads.
    f.store.close();
    const db = new DatabaseSync(join(f.dir, '.lean-harness', 'state.sqlite'));
    db.exec('DROP TABLE IF EXISTS lesson_checks');
    db.prepare('INSERT INTO sessions(id,started_at,context,lesson_ids,status) VALUES(?,?,?,?,?)').run('old', 'now', '', '[]', 'ended');
    db.prepare('INSERT INTO verifications VALUES(?,?,?,?,?,?,?,?)').run('v-old', 'old', 'now', 'now', 'h', 'h', 'failed',
      JSON.stringify([{ name: 'x', status: 'failed', durationMs: 1, code: 1, output: 'old' }]));
    db.close();
    const store = new Store(f.dir);
    assert.equal(store.session('old').id, 'old');
    assert.equal(JSON.parse(store.db.prepare('SELECT results FROM verifications').get().results)[0].output, 'old');
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='lesson_checks'").get().n, 0, 'opening never runs DDL');
    assert.deepEqual(store.lessonChecks('none'), []);
    store.close();
    const r = runCli(f.dir, ['status']); assert.equal(r.status, 0, r.stderr);
    f.store = new Store(f.dir);
  } finally { f.cleanup(); }
});
