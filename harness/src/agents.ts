import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from './process.js';
import type { AgentConfig, AgentKind, Config } from './types.js';

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const hookEvents = ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'] as const;
const outputLimit = 32768;

export function adapterKind(agent: AgentConfig): AgentKind {
  const kind = agent.kind ?? 'claude';
  if (!['claude', 'codex', 'manual'].includes(kind)) throw new Error('Unknown agent adapter.');
  return kind;
}

export function hookSettings(root: string, id?: string) {
  const script = fileURLToPath(new URL('../bin/hook.mjs', import.meta.url));
  const command = [process.execPath, '--disable-warning=ExperimentalWarning', script, root].map(quote).join(' ')
    + ' ' + (id === undefined ? '"$LEAN_HARNESS_SESSION_ID"' : quote(id));
  return { hooks: Object.fromEntries(hookEvents.map(event => [event,
    [{ hooks: [{ type: 'command', command, timeout: 1 }] }]])) };
}

const matchesFlag = (arg: string, flag: string) => arg === flag || arg.startsWith(flag + '=')
  || (flag.length === 2 && arg.startsWith(flag) && arg.length > flag.length);

export function validateCodingArguments(agent: AgentConfig, extraArgs: string[]): void {
  const kind = adapterKind(agent);
  if (kind === 'manual') return;
  const args = [...agent.args, ...extraArgs];
  const forbidden = kind === 'claude'
    ? ['--settings', '--continue', '-c', '--resume', '-r', '--fork-session', '--worktree', '-w', '--cloud', '--bg', '--background', '--safe-mode', '--bare', '--desktop', '--teleport', '--from-pr', '--environment', '--remote-control']
    : ['--remote', '--remote-auth-token-env', '--worktree', '--cd', '-C', '--dangerously-bypass-hook-trust'];
  const valueOptions = new Set(['--model', '-m', '--profile', '-p', '--sandbox', '-s', '--ask-for-approval', '-a', '--image', '-i', '--add-dir', '--enable', '--disable', '--color', '--output-schema', '--output-last-message', '-o']);
  const nonLocal = new Set(['resume', 'fork', 'cloud', 'app', 'app-server', 'exec-server', 'remote-control', 'agents', 'queue', 'archive', 'delete', 'unarchive']);
  let firstPositional = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') break;
    if (forbidden.some(flag => matchesFlag(arg, flag)))
      throw new Error('Harness adapters support new local sessions. Settings/resume/worktree/remote/bare flags require --no-harness. Native settings and permissions are preserved.');
    if (kind !== 'codex') continue;
    const configFlag = arg === '-c' || arg === '--config';
    const assignment = configFlag ? args[++i] : arg.startsWith('--config=') ? arg.slice(9)
      : arg.startsWith('-c') && arg.length > 2 ? arg.slice(2).replace(/^=/, '') : undefined;
    if (assignment !== undefined || configFlag) {
      const key = assignment?.split('=', 1)[0]?.replace(/[\s"']/g, '');
      if (!key || key === 'hooks' || key.startsWith('hooks.') || key === 'features'
        || ['features.hooks', 'features.codex_hooks', 'allow_managed_hooks_only'].includes(key))
        throw new Error('Harness hook configuration cannot be overridden during a wrapped session; use --no-harness.');
      continue;
    }
    if (arg === '--enable' || arg === '--disable') {
      const feature = args[i + 1];
      if (feature === 'hooks' || feature === 'codex_hooks') throw new Error('Harness hook configuration cannot be overridden during a wrapped session; use --no-harness.');
    }
    if (/^--(?:enable|disable)=(?:hooks|codex_hooks)$/.test(arg))
      throw new Error('Harness hook configuration cannot be overridden during a wrapped session; use --no-harness.');
    if (valueOptions.has(arg)) { i++; continue; }
    if (!arg.startsWith('-') && firstPositional) {
      if (nonLocal.has(arg)) throw new Error('Harness adapters support new local Codex sessions; resume/fork/remote commands require --no-harness.');
      // `exec` is itself a new local coding session; inspect its first positional argument too.
      firstPositional = arg === 'exec' || arg === 'e';
    }
  }
}

export function codingLaunch(root: string, agent: AgentConfig, sessionId: string): { args: string[]; env: NodeJS.ProcessEnv } {
  const kind = adapterKind(agent);
  if (kind === 'manual') throw new Error('Manual adapters use explicit session context and finish commands.');
  const settings = hookSettings(root);
  const args = kind === 'claude' ? ['--settings', JSON.stringify(settings)]
    : hookEvents.flatMap(event => {
      const command = settings.hooks[event]![0]!.hooks[0]!.command;
      const context = event === 'SessionStart' ? ',additionalContextLimit=0' : '';
      return ['-c', `hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(command)},timeout=1${context}}]}]`];
    });
  return { args, env: { ...process.env, LEAN_HARNESS_SESSION_ID: sessionId } };
}

export async function extractCandidates(root: string, config: Config, prompt: string, schema: unknown): Promise<{ value: unknown }> {
  const agent = config.learning.agent ?? config.agent;
  const kind = adapterKind(agent);
  if (kind === 'codex')
    throw new Error('Automatic Codex extraction is unavailable: the supported CLI has no verified all-tools-disabled mode or USD cap. Use learn --export/--import with your subscription, capture explicit evidence, or configure an optional Claude learner.');
  if (kind === 'manual') throw new Error('Manual learning requires learn --export/--import or capture; no model was invoked.');
  if (!Number.isFinite(config.learning.maxBudgetUsd) || config.learning.maxBudgetUsd === null || config.learning.maxBudgetUsd <= 0)
    throw new Error('Claude extraction requires a positive maxBudgetUsd.');
  if (!prompt.trim() || prompt.length > config.learning.maxInputChars + 4096)
    throw new Error('Extraction prompt exceeds its bounded input allowance.');
  const scratch = await mkdtemp(join(tmpdir(), 'lean-extraction-'));
  try {
    const command = !isAbsolute(agent.command) && /[/\\]/.test(agent.command) ? resolve(root, agent.command) : agent.command;
    const env = { ...process.env };
    delete env.LEAN_HARNESS_SESSION_ID;
    const result = await runProcess(command, [...agent.args,
      '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', '--disable-slash-commands',
      '--no-session-persistence', ...(config.learning.model ? ['--model', config.learning.model] : []), '-p', '--output-format', 'json',
      '--json-schema', JSON.stringify(schema), '--max-budget-usd', String(config.learning.maxBudgetUsd)], {
      cwd: scratch, timeoutMs: config.learning.timeoutMs, input: prompt, maxOutput: outputLimit + 1, env
    });
    if (result.code !== 0 || result.timedOut || result.interrupted || result.signal)
      throw new Error(`Extraction did not complete (${result.timedOut ? 'timeout' : result.interrupted ? 'interrupted' : result.code ?? 'spawn failure'}). ${result.stderr.slice(0, 300)}`);
    if (result.stdout.length > outputLimit || result.stderr.length > outputLimit) throw new Error('Extraction output limit exceeded.');
    const response: unknown = JSON.parse(result.stdout);
    if (!response || typeof response !== 'object' || Array.isArray(response) || ('is_error' in response && response.is_error)
      || !('structured_output' in response)) throw new Error('Model returned an error or no structured output.');
    return { value: response.structured_output };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
