import { fileURLToPath } from 'node:url';
import { guide } from './guides.js';
import { Store } from './store.js';
import { runProcess } from './process.js';
import type { Config } from './types.js';

const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function hookSettings(root: string, id: string) {
  const script = fileURLToPath(new URL('../bin/hook.mjs', import.meta.url));
  const command = [process.execPath, '--disable-warning=ExperimentalWarning', script, root, id].map(quote).join(' ');
  return { hooks: Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'].map(event => [event,
    [{ hooks: [{ type: 'command', command, timeout: 1 }] }]])) };
}
export async function start(root: string, config: Config, args: string[], paths: string[], disabled = false) {
  if (process.platform === 'win32' && !disabled) throw new Error('The MVP hook adapter supports macOS and Linux.');
  const unsupported = ['--settings', '--continue', '-c', '--resume', '-r', '--fork-session', '--worktree', '-w', '--cloud', '--bg', '--background', '--safe-mode', '--bare'];
  if (!disabled && [...config.agent.args, ...args].some(a => unsupported.some(f => a === f || a.startsWith(f + '='))))
    throw new Error('MVP supports new local sessions. Settings/resume/worktree/cloud/bare flags require ordinary Claude (--no-harness). Native settings files are preserved.');
  let id: string | undefined;
  let injected: string[] = [];
  if (!disabled) {
    let store: Store | undefined;
    try {
      store = new Store(root);
      const selection = guide(store, paths);
      id = store.createSession(selection.context, selection.lessonIds);
      injected = ['--settings', JSON.stringify(hookSettings(root, id))];
      console.error(`Harness session ${id}; ${selection.lessonIds.length} approved lessons.`);
    } catch (e) { console.error(`Harness unavailable; starting ordinary agent: ${(e as Error).message}`); }
    finally { store?.close(); }
  }
  const result = await runProcess(config.agent.command, [...config.agent.args, ...injected, ...args], { cwd: root, inherit: true });
  if (id) {
    let store: Store | undefined;
    try { store = new Store(root); store.endSession(id, result.interrupted || result.signal ? 'interrupted' : result.code === 0 ? 'ended' : 'failed'); }
    catch (e) { console.error(`Session bookkeeping incomplete: ${(e as Error).message}`); }
    finally { store?.close(); }
  }
  return result.interrupted ? 130 : result.code ?? 1;
}
