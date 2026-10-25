import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './config.js';
export function metrics(root: string) {
  const directory = join(stateDir(root), 'telemetry');
  const totals = new Map<string, { sessionId: string; turn: number; hooks: number; measuredMs: number; failures: number; skipped: number }>();
  for (const file of readdirSync(directory).filter(f => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(directory, file), 'utf8').split('\n')) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      const key = `${row.sessionId}:${row.turn}`;
      const total = totals.get(key) ?? { sessionId: row.sessionId, turn: row.turn, hooks: 0, measuredMs: 0, failures: 0, skipped: 0 };
      total.hooks++; total.measuredMs += row.durationMs;
      if (row.outcome === 'budget_skipped') total.skipped++;
      else if (row.outcome !== 'ok') total.failures++;
      totals.set(key, total);
    }
  }
  return { measurement: 'Supervisor start through worker exit, including SQLite commit/close; excludes Node startup and telemetry append. Benchmark measures full subprocess wall time.', turns: [...totals.values()] };
}
