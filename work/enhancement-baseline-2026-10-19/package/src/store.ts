import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, chmodSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './config.js';
import type { Candidate, Evidence, Lesson, Session } from './types.js';

export class Store {
  db: DatabaseSync;
  constructor(root: string, initialize = false) {
    root = realpathSync(root);
    const path = join(stateDir(root), 'state.sqlite');
    if (!initialize && !existsSync(path)) throw new Error('Harness database unavailable; run init.');
    this.db = new DatabaseSync(path, { timeout: 100 });
    this.db.exec('PRAGMA foreign_keys=ON;');
    if (initialize) {
      this.db.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT, transcript TEXT,
          agent_session_id TEXT, context TEXT NOT NULL, lesson_ids TEXT NOT NULL,
          status TEXT NOT NULL, turn INTEGER NOT NULL DEFAULT 0,
          learning_status TEXT NOT NULL DEFAULT 'pending', learning_error TEXT);
        CREATE TABLE IF NOT EXISTS evidence (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
          kind TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS lessons (
          id TEXT PRIMARY KEY, statement TEXT NOT NULL, scope TEXT NOT NULL,
          session_id TEXT NOT NULL REFERENCES sessions(id), evidence TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK(outcome IN ('unknown','supported','refuted')),
          status TEXT NOT NULL CHECK(status IN ('candidate','active','retired')),
          created_at TEXT NOT NULL, reviewed_at TEXT);
        CREATE INDEX IF NOT EXISTS active_lessons ON lessons(status, reviewed_at DESC);
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(id),
          action TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS verifications (
          id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id), started_at TEXT NOT NULL,
          ended_at TEXT, before_hash TEXT NOT NULL, after_hash TEXT, status TEXT NOT NULL,
          results TEXT NOT NULL);
      `);
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('root', root);
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('schema', '1');
      chmodSync(path, 0o600);
    }
    const stored = this.db.prepare('SELECT value FROM meta WHERE key=?').get('root');
    if (stored?.value !== root) { this.db.close(); throw new Error('Database belongs to another repository. Do not copy local state across repositories.'); }
    if (this.db.prepare('SELECT value FROM meta WHERE key=?').get('schema')?.value !== '1') {
      this.db.close(); throw new Error('Unsupported database schema.');
    }
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  createSession(context: string, lessonIds: string[], id = randomUUID()): string {
    this.db.prepare('INSERT INTO sessions(id,started_at,context,lesson_ids,status) VALUES(?,?,?,?,?)')
      .run(id, new Date().toISOString(), context, JSON.stringify(lessonIds), 'running');
    return id;
  }
  session(id: string): Session {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
    if (!r) throw new Error(`Unknown session: ${id}`);
    return { id: String(r.id), startedAt: String(r.started_at), endedAt: r.ended_at as string | null,
      transcript: r.transcript as string | null, agentSessionId: r.agent_session_id as string | null,
      context: String(r.context), lessonIds: JSON.parse(String(r.lesson_ids)), status: String(r.status),
      turn: Number(r.turn), learningStatus: String(r.learning_status), learningError: r.learning_error as string | null };
  }
  sessions(): Session[] { return this.db.prepare('SELECT id FROM sessions ORDER BY started_at DESC').all().map(r => this.session(String(r.id))); }
  endSession(id: string, status: string) {
    this.db.prepare('UPDATE sessions SET ended_at=?,status=? WHERE id=?').run(new Date().toISOString(), status, id);
  }
  addEvidence(e: Evidence) {
    this.db.prepare('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?)').run(e.id, e.sessionId, e.kind, e.text, e.source);
  }
  evidence(sessionId: string): Evidence[] {
    return this.db.prepare('SELECT * FROM evidence WHERE session_id=? ORDER BY id').all(sessionId).map(r => ({
      id: String(r.id), sessionId: String(r.session_id), kind: String(r.kind), text: String(r.text), source: String(r.source)
    }));
  }
  addCandidate(sessionId: string, candidate: Candidate): string {
    const evidence = [...new Set(candidate.evidence)].sort();
    const id = createHash('sha256').update(JSON.stringify([sessionId, candidate.statement, [...candidate.scope].sort(), evidence])).digest('hex').slice(0, 24);
    this.db.prepare('INSERT OR IGNORE INTO lessons VALUES(?,?,?,?,?,?,?,?,NULL)').run(id, candidate.statement,
      JSON.stringify(candidate.scope), sessionId, JSON.stringify(evidence), candidate.outcome, 'candidate', new Date().toISOString());
    return id;
  }
  lessons(status?: string): Lesson[] {
    const sql = `SELECT * FROM lessons ${status ? 'WHERE status=?' : ''} ORDER BY reviewed_at DESC, created_at DESC, id`;
    const rows = status ? this.db.prepare(sql).all(status) : this.db.prepare(sql).all();
    return rows.map(r => ({ id: String(r.id), statement: String(r.statement), scope: JSON.parse(String(r.scope)),
      sessionId: String(r.session_id), evidence: JSON.parse(String(r.evidence)), outcome: r.outcome as Lesson['outcome'],
      status: r.status as Lesson['status'], createdAt: String(r.created_at), reviewedAt: r.reviewed_at as string | null }));
  }
  review(ids: string[], action: 'approve' | 'reject' | 'retire' | 'reaffirm', supersedes?: string, now = new Date()) {
    if (!ids.length) throw new Error('Select explicit lesson IDs; there is no approve-all operation.');
    if (supersedes && (action !== 'approve' || ids.length !== 1 || ids.includes(supersedes))) throw new Error('Superseding requires one different candidate.');
    this.transaction(() => {
      const lessons = new Map(this.lessons().map(l => [l.id, l]));
      for (const id of ids) {
        const lesson = lessons.get(id);
        if (!lesson) throw new Error(`Unknown lesson: ${id}`);
        if ((action === 'approve' || action === 'reject') && lesson.status !== 'candidate') throw new Error(`${id} is not a candidate.`);
        if ((action === 'retire' || action === 'reaffirm') && lesson.status !== 'active') throw new Error(`${id} is not active.`);
        if (action === 'approve' || action === 'reaffirm') {
          if (!lesson.evidence.length || lesson.outcome === 'refuted') throw new Error('Cannot activate a refuted or evidence-free lesson.');
          const known = new Set(this.evidence(lesson.sessionId).map(e => e.id));
          if (!lesson.evidence.every(e => known.has(e))) throw new Error('Missing source evidence.');
        }
        this.db.prepare('UPDATE lessons SET status=?,reviewed_at=? WHERE id=?').run(
          action === 'approve' || action === 'reaffirm' ? 'active' : 'retired', now.toISOString(), id);
        this.db.prepare('INSERT INTO history(lesson_id,action,at,detail) VALUES(?,?,?,?)')
          .run(id, action, now.toISOString(), supersedes ? `supersedes ${supersedes}` : 'explicit CLI review');
      }
      if (supersedes) {
        if (lessons.get(supersedes)?.status !== 'active') throw new Error('Superseded lesson must be active.');
        this.db.prepare('UPDATE lessons SET status=? WHERE id=?').run('retired', supersedes);
        this.db.prepare('INSERT INTO history(lesson_id,action,at,detail) VALUES(?,?,?,?)')
          .run(supersedes, 'superseded', now.toISOString(), `replaced by ${ids[0]}`);
      }
    });
  }
}
