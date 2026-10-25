import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { taskPath } from './config.js';
import type { Check, CheckResult, Config, Finding } from './types.js';
import type { Store } from './store.js';

export const FINDING_LIMIT = 20;
export const FINDING_CHAR_LIMIT = 16000;
export const checkFingerprint = (check: Check): string => createHash('sha256')
  .update(JSON.stringify([check.name, check.command, check.args, check.timeoutMs, check.parser ?? null])).digest('hex');

export function structureFindings(root: string, check: Check, result: CheckResult, evidenceRef: string): CheckResult {
  const base: CheckResult = { ...result, findingVersion: 1, checkFingerprint: checkFingerprint(check),
    parserStatus: check.parser ? 'unparsed' : 'not_configured', findings: [], findingsTruncated: false };
  if (!check.parser) return base;
  try {
    const findings: Finding[] = [];
    const lines = result.output.split('\n');
    for (const line of lines) {
      const match = /^(.*?)\((\d+),(\d+)\):\s*(?:error|warning)\s+(TS\d+):\s*(.+)$/.exec(line.replace(/\x1b\[[0-9;]*m/g, ''));
      if (!match) continue;
      const inputPath = match[1]!;
      let path: string;
      try {
        path = taskPath(isAbsolute(inputPath) ? relative(root, inputPath) : inputPath);
        // Resolve lexically only; diagnostics must never cause reads of referenced files.
        const inside = relative(root, resolve(root, path));
        if (inside.startsWith('..') || isAbsolute(inside) || path.length > 512) continue;
      } catch { continue; }
      const row = Number(match[2]), column = Number(match[3]);
      if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 1 || column < 1) continue;
      const finding: Finding = { category: 'typescript:' + match[4], path, line: row, column,
        message: match[5]!.slice(0, 1000), evidenceRef };
      if (findings.length >= FINDING_LIMIT || JSON.stringify([...findings, finding]).length > FINDING_CHAR_LIMIT) {
        base.findingsTruncated = true; break;
      }
      findings.push(finding);
    }
    return { ...base, findings, parserStatus: findings.length ? 'parsed' : 'unparsed' };
  } catch { return { ...base, parserStatus: 'error' }; }
}

export function checkObservation(store: Store, reference: string, sessionId: string, config?: Config) {
  const match = /^check:([^:]+):(0|[1-9][0-9]*)$/.exec(reference);
  if (!match) throw new Error('Invalid check evidence reference.');
  const evidence = store.db.prepare('SELECT * FROM evidence WHERE id=?').get(reference);
  const run = store.db.prepare('SELECT * FROM verifications WHERE id=?').get(match[1]!);
  const index = Number(match[2]);
  if (!evidence || evidence.kind !== 'check' || evidence.session_id !== sessionId || evidence.source !== match[1]
    || !run || run.session_id !== sessionId || !Number.isSafeInteger(index))
    throw new Error('Check reference does not belong to an actual verification for this session.');
  let results: CheckResult[];
  try { results = JSON.parse(String(run.results)); } catch { throw new Error('Unreadable check record.'); }
  const result = Array.isArray(results) ? results[index] : undefined;
  if (!result || typeof result.name !== 'string' || evidence.text !== JSON.stringify(result))
    throw new Error('Check evidence does not match its actual verification result.');
  const current = config?.checks.find(c => c.name === result.name);
  return { evidenceRef: reference, verificationId: String(run.id), sessionId, check: result.name,
    verificationStatus: String(run.status), beforeHash: String(run.before_hash), afterHash: run.after_hash,
    configuration: !result.checkFingerprint ? 'unknown' : current && checkFingerprint(current) === result.checkFingerprint ? 'current' : 'changed_or_removed',
    result, note: 'Observed check outcome; relevance is not proof of this lesson or its usefulness.' };
}

export function recurrenceSummaries(store: Store) {
  const rows = store.db.prepare(`SELECT v.id, v.session_id, v.status, v.ended_at, v.before_hash, v.after_hash,
    j.key AS result_index, j.value AS result_json
    FROM verifications v, json_each(CASE WHEN json_valid(v.results) THEN v.results ELSE '[]' END) j
    ORDER BY v.started_at DESC, v.id DESC, CAST(j.key AS INTEGER) DESC LIMIT 1001`).all();
  type Group = { id: string; check: string; category: string; path: string; message: string;
    runs: Set<string>; sessions: Set<string>; examples: { sessionId: string; evidenceRef: string; verificationId: string }[] };
  const grouped = new Map<string, Group>();
  let partialFindings = false;
  for (const row of rows.slice(0, 1000)) {
    if (!row.session_id || row.status !== 'failed' || !row.ended_at || row.before_hash !== row.after_hash) continue;
    let result: CheckResult;
    try { result = JSON.parse(String(row.result_json)); } catch { continue; }
    if (result.findingVersion !== 1 || !result.checkFingerprint || result.status !== 'failed'
      || result.code === null || result.code === 0 || result.parserStatus !== 'parsed' || !Array.isArray(result.findings)) continue;
    const evidenceRef = `check:${row.id}:${row.result_index}`;
    try { checkObservation(store, evidenceRef, String(row.session_id)); } catch { continue; }
    partialFindings ||= Boolean(result.findingsTruncated || result.outputTruncated);
    for (const finding of result.findings.slice(0, FINDING_LIMIT)) {
      if (finding.evidenceRef !== evidenceRef || typeof finding.message !== 'string' || typeof finding.category !== 'string'
        || typeof finding.path !== 'string') continue;
      const message = finding.message.replace(/\s+/g, ' ').trim();
      const id = createHash('sha256').update(JSON.stringify([result.checkFingerprint, finding.category, finding.path, message])).digest('hex').slice(0, 24);
      const group = grouped.get(id) ?? { id, check: result.name, category: finding.category, path: finding.path,
        message, runs: new Set<string>(), sessions: new Set<string>(), examples: [] };
      if (!group.runs.has(evidenceRef) && group.examples.length < 3)
        group.examples.push({ sessionId: String(row.session_id), evidenceRef, verificationId: String(row.id) });
      group.runs.add(evidenceRef); group.sessions.add(String(row.session_id)); grouped.set(id, group);
    }
  }
  const recurring = [...grouped.values()].filter(g => g.runs.size > 1)
    .sort((a, b) => b.sessions.size - a.sessions.size || b.runs.size - a.runs.size || a.id.localeCompare(b.id));
  return { examinedChecks: Math.min(rows.length, 1000), historyTruncated: rows.length > 1000,
    groupsTruncated: recurring.length > 10, partialFindings,
    groups: recurring.slice(0, 10).map(({ runs, sessions, ...group }) => ({ ...group, runCount: runs.size, sessionCount: sessions.size,
      examplesTruncated: runs.size > group.examples.length })),
    note: 'Descriptive failure recurrence within bounded history. Counts do not infer a root cause, factual support, independent experiments, or prevented mistakes.' };
}
