export type Outcome = 'unknown' | 'supported' | 'refuted';
export type LessonStatus = 'candidate' | 'active' | 'retired';
export interface Lesson {
  id: string; statement: string; scope: string[]; sessionId: string; evidence: string[];
  outcome: Outcome; status: LessonStatus; createdAt: string; reviewedAt: string | null;
}
export interface Check { name: string; command: string; args: string[]; timeoutMs: number; }
export interface Config {
  version: 1;
  agent: { command: string; args: string[] };
  checks: Check[];
  learning: { model: string; timeoutMs: number; maxBudgetUsd: number; maxInputChars: number };
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
