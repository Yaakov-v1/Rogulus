import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { fixture, candidate, runCli } from './helpers.mjs';
import { guide } from '../dist/guides.js';
const f = fixture();
const percentile = (xs, p) => [...xs].sort((a,b) => a-b)[Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)];
try {
  const sample = candidate(f.store), row = f.store.lessons()[0];
  f.store.transaction(() => {
    const insert = f.store.db.prepare('INSERT INTO lessons VALUES(?,?,?,?,?,?,?,?,?)');
    for (let i = 0; i < 10000; i++) insert.run(`benchmark-${i}`, 'Prefer existing checks and preserve zero values. ' + i, '[]', sample.session,
      JSON.stringify(row.evidence), 'supported', 'active', new Date().toISOString(), new Date().toISOString());
  });
  const selections = [], bare = [], wrapped = [], added = [];
  for (let i = 0; i < 20; i++) {
    let t = performance.now(); const selected = guide(f.store); selections.push(performance.now() - t);
    if (selected.context.length > 4000 || selected.lessonIds.length > 5) throw new Error('Context cap failed');
    const env = { FAKE_TRANSCRIPT: join(f.dir, 'transcript.jsonl') };
    t = performance.now(); const b = runCli(f.dir, ['start', '--no-harness'], env); bare.push(performance.now() - t);
    t = performance.now(); const h = runCli(f.dir, ['start'], env); wrapped.push(performance.now() - t);
    if (b.status || h.status) throw new Error(b.stderr + h.stderr);
    added.push(wrapped.at(-1) - bare.at(-1));
  }
  const result = { kind: 'synthetic adapter benchmark; not real-model utility evidence', node: process.version, platform: process.platform,
    samples: 20, storedLessons: 10001, selectionP95Ms: percentile(selections, .95),
    bareSessionP95Ms: percentile(bare, .95), wrappedSessionP95Ms: percentile(wrapped, .95),
    addedSessionP50Ms: percentile(added, .5), addedSessionP95Ms: percentile(added, .95),
    worstAddedSessionMs: Math.max(...added), targetMs: 2000,
    passed: Math.max(...added) < 2000,
    note: 'External wall clock includes both Node startups, four hooks, telemetry writes, selection over 10k active lessons, and agent fixture startup. No LLM calls.' };
  console.log(JSON.stringify(result, null, 2));
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  if (!result.passed) process.exitCode = 1;
} finally { f.cleanup(); }
