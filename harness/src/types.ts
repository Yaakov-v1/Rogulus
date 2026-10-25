export type Outcome = 'unknown' | 'supported' | 'refuted';
export type LessonStatus = 'candidate' | 'active' | 'retired';
export interface Lesson {
  id: string; statement: string; scope: string[]; sessionId: string; evidence: string[];
  outcome: Outcome; status: LessonStatus; createdAt: string; reviewedAt: string | null;
}
export type AgentKind = 'claude' | 'codex' | 'manual';
export interface AgentConfig { kind?: AgentKind; command: string; args: string[]; }
export interface Check { name: string; command: string; args: string[]; timeoutMs: number; parser?: 'tsc'; }
export interface Finding {
  category: string; path: string; line: number; column: number; message: string; evidenceRef: string;
}
export interface CheckResult {
  name: string; status: 'passed' | 'failed' | 'timed_out' | 'not_run'; durationMs: number;
  code: number | null; output: string;
  findingVersion?: 1; checkFingerprint?: string;
  parserStatus?: 'not_configured' | 'parsed' | 'unparsed' | 'error';
  findings?: Finding[]; findingsTruncated?: boolean; outputTruncated?: boolean;
}
export interface Config {
  version: 1;
  agent: AgentConfig;
  checks: Check[];
  learning: { agent?: AgentConfig; model: string; timeoutMs: number; maxBudgetUsd: number | null; maxInputChars: number };
}
export interface Session {
  id: string; startedAt: string; endedAt: string | null; transcript: string | null;
  agentSessionId: string | null; context: string; lessonIds: string[];
  status: string; turn: number; learningStatus: string; learningError: string | null;
}
export interface Evidence { id: string; sessionId: string; kind: string; text: string; source: string; }
export interface Candidate { statement: string; scope: string[]; evidence: string[]; outcome: Outcome; }
export const REVIEW_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const CONTEXT_LIMIT = 4000;
export const LESSON_LIMIT = 5;
