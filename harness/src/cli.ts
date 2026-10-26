import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initialize, readConfig, repository, taskPath } from './config.js';
import { Store } from './store.js';
import { start } from './factory.js';
import { guide } from './guides.js';
import { verify, verificationStatus } from './sensors.js';
import { learn, reviewItems, validateCandidates } from './learning.js';
import { recurrenceSummaries } from './findings.js';
import { metrics } from './metrics.js';

const help = `lean-harness — local lessons, explicit checks

  init                              Create config, local DB and Git ignore rule
  start [--paths a,b] [--no-harness] -- [Claude arguments]
  context [--paths a,b]              Preview bounded approved guidance
  verify [--session ID]              Run configured checks (nonzero unless verified)
  status                            Current verification and session summaries
  learn [--session ID]               One bounded extraction attempt per ended session
  capture --file FILE               Import one explicit candidate with evidence
  review                            Candidates/overdue lessons with claim, evidence, checks, recurrence, conflicts (bounded)
  recurrence                        Offline repeated-failure groups across distinct sessions (no model call)
  link-check ID CHECK_REF            Link a lesson to a real check run (explanatory only; not proof)
  approve ID... [--supersedes ID]    Human-operated batch approval
  reject ID...                      Reject candidates, preserving history
  retire ID...                      Roll back active lessons
  reaffirm ID...                    Renew active lessons for 90 days
  history [ID]                      Approval / retirement history
  metrics                           Recorded hook time by session and turn

Run inside a Git repository. Native Claude settings remain intact.
Configure checks in .lean-harness/config.json. See README for evidence import.
`;
function options(args: string[], allowed: string[], flags: string[] = []) {
  const values: Record<string, string> = {}, rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (flags.includes(arg)) { values[arg] = 'true'; continue; }
    if (allowed.includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      values[arg] = value; continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    rest.push(arg);
  }
  return { values, rest };
}
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
export async function main(argv: string[]): Promise<number> {
  const [command = 'help', ...args] = argv;
  if (['help', '--help', '-h'].includes(command)) { console.log(help); return 0; }
  const root = repository();
  if (command === 'init') {
    if (args.length) throw new Error('init takes no arguments.');
    const created = initialize(root); const store = new Store(root, true); store.close();
    print({ root, initialized: true, configCreated: created, next: 'Configure checks before running verify.' }); return 0;
  }
  const config = readConfig(root);
  if (command === 'start') {
    const separator = args.indexOf('--');
    const local = separator < 0 ? args : args.slice(0, separator), agent = separator < 0 ? [] : args.slice(separator + 1);
    const o = options(local, ['--paths'], ['--no-harness']);
    if (o.rest.length) throw new Error('Place agent arguments after --.');
    return start(root, config, agent, o.values['--paths']?.split(',').map(taskPath) ?? [], Boolean(o.values['--no-harness']));
  }
  if (command === 'metrics') {
    if (args.length) throw new Error('metrics takes no arguments.');
    print(metrics(root)); return 0;
  }
  const store = new Store(root);
  try {
    switch (command) {
      case 'context': {
        const o = options(args, ['--paths']); if (o.rest.length) throw new Error('Unexpected arguments.');
        print(guide(store, o.values['--paths']?.split(',') ?? [])); break;
      }
      case 'verify': {
        const o = options(args, ['--session']); if (o.rest.length) throw new Error('Unexpected arguments.');
        const result = await verify(root, config, store, o.values['--session']); print(result); return result.status === 'verified' ? 0 : 1;
      }
      case 'status':
        if (args.length) throw new Error('status takes no arguments.');
        print({ verification: verificationStatus(root, store), sessions: store.sessions() }); break;
      case 'learn': {
        const o = options(args, ['--session']); if (o.rest.length) throw new Error('Unexpected arguments.');
        const results = await learn(root, config, store, o.values['--session']); print(results);
        return results.some(r => r.status === 'incomplete') ? 1 : 0;
      }
      case 'capture': {
        const o = options(args, ['--file']); if (!o.values['--file'] || o.rest.length) throw new Error('capture requires --file.');
        const data = JSON.parse(readFileSync(o.values['--file'], 'utf8'));
        if (typeof data.evidenceText !== 'string' || !data.evidenceText.trim() || data.evidenceText.length > 6000)
          throw new Error('Provide evidenceText (1–6000 characters).');
        const digest = createHash('sha256').update(JSON.stringify([data.sessionId ?? null, data.statement, data.scope ?? [], data.outcome ?? 'unknown', data.evidenceText])).digest('hex').slice(0, 24);
        const sessionId = typeof data.sessionId === 'string' ? data.sessionId : 'manual:' + digest;
        const evidence = { id: 'manual:' + digest, sessionId, kind: 'explicit', text: data.evidenceText, source: 'human capture' };
        const candidate = validateCandidates({ lessons: [{ statement: data.statement, scope: data.scope ?? [], outcome: data.outcome ?? 'unknown', evidence: [evidence.id] }] }, [evidence])[0]!;
        const id = store.transaction(() => {
          if (data.sessionId) store.session(sessionId);
          else if (!store.db.prepare('SELECT id FROM sessions WHERE id=?').get(sessionId)) {
            store.createSession('', [], sessionId); store.endSession(sessionId, 'manual'); store.db.prepare("UPDATE sessions SET learning_status='done' WHERE id=?").run(sessionId);
          }
          store.addEvidence(evidence); const lessonId = store.addCandidate(sessionId, candidate);
          if (data.checkRefs !== undefined && (!Array.isArray(data.checkRefs) || data.checkRefs.length > 8)) throw new Error('checkRefs must be an array of at most 8 references.');
          for (const ref of data.checkRefs ?? []) store.linkCheck(lessonId, String(ref), config);
          return lessonId;
        }); print({ id, status: store.lessons().find(l => l.id === id)!.status }); break;
      }
      case 'review': {
        if (args.length) throw new Error('review takes no arguments.');
        print(reviewItems(store, config)); break;
      }
      case 'recurrence':
        if (args.length) throw new Error('recurrence takes no arguments.');
        print(recurrenceSummaries(store)); break;
      case 'link-check': {
        const o = options(args, []); if (o.rest.length !== 2) throw new Error('link-check requires a lesson ID and a check evidence reference.');
        print(store.linkCheck(o.rest[0]!, o.rest[1]!, config)); break;
      }
      case 'approve': case 'reject': case 'retire': case 'reaffirm': {
        const o = options(args, command === 'approve' ? ['--supersedes'] : []);
        store.review(o.rest, command, o.values['--supersedes']); print({ action: command, ids: o.rest }); break;
      }
      case 'history': {
        if (args.length > 1) throw new Error('history accepts at most one ID.');
        print(args[0] ? store.db.prepare('SELECT * FROM history WHERE lesson_id=? ORDER BY id').all(args[0]) : store.db.prepare('SELECT * FROM history ORDER BY id').all()); break;
      }
      default: throw new Error(`Unknown command: ${command}. Run --help.`);
    }
    return 0;
  } finally { store.close(); }
}
