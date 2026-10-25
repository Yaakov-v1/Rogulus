import { spawn } from 'node:child_process';
export interface ProcessResult { code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; interrupted: boolean; durationMs: number; }
export function killTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGKILL') {
  if (!pid) return;
  try { process.kill(process.platform === 'win32' ? pid : -pid, signal); } catch { /* already exited */ }
}
export async function runProcess(command: string, args: string[], options: {
  cwd: string; timeoutMs?: number; input?: string; inherit?: boolean; env?: NodeJS.ProcessEnv; maxOutput?: number;
}): Promise<ProcessResult> {
  const started = performance.now(), maxOutput = options.maxOutput ?? 65536;
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env,
      detached: !options.inherit && process.platform !== 'win32',
      stdio: options.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, interrupted = false, done = false;
    const terminate = () => { if (options.inherit) child.kill('SIGKILL'); else killTree(child.pid); };
    // Claude receives terminal Ctrl+C itself; preserve its normal cancellation.
    const interrupt = () => { if (!options.inherit) { interrupted = true; terminate(); } };
    const stop = () => { interrupted = true; terminate(); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', stop);
    const timer = options.timeoutMs ? setTimeout(() => { timedOut = true; terminate(); }, options.timeoutMs) : undefined;
    const finish = (code: number | null, signal: string | null) => {
      if (done) return; done = true; clearTimeout(timer);
      process.off('SIGINT', interrupt); process.off('SIGTERM', stop);
      resolve({ code, signal, stdout, stderr, timedOut, interrupted, durationMs: performance.now() - started });
    };
    child.stdout?.on('data', c => { stdout = (stdout + c.toString()).slice(0, maxOutput); });
    child.stderr?.on('data', c => { stderr = (stderr + c.toString()).slice(0, maxOutput); });
    child.on('error', e => { stderr = e.message; finish(null, null); });
    child.on('close', finish);
    if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(options.input ?? ''); }
  });
}
