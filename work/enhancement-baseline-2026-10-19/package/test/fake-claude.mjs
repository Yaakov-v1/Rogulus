// Contract fixture, not a model. Never used by default product configuration.
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const args = process.argv.slice(2);
if (process.env.FAKE_ARGS) writeFileSync(process.env.FAKE_ARGS, JSON.stringify(args));
if (args.includes('--json-schema')) {
  if (process.env.FAKE_CALLS) appendFileSync(process.env.FAKE_CALLS, 'extract\n');
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  if (process.env.FAKE_MODE === 'timeout') { setTimeout(() => {}, 30000); }
  else if (process.env.FAKE_MODE === 'malformed') console.log('not json');
  else if (process.env.FAKE_MODE === 'error') { console.error('fixture unavailable'); process.exitCode = 1; }
  else {
    const evidence = JSON.parse(input.split('EVIDENCE:\n')[1]);
    console.log(JSON.stringify({ structured_output: { lessons: [{ statement: 'Run the repository test command before completion.', scope: [], outcome: 'supported',
      evidence: [process.env.FAKE_MODE === 'fabricated' ? 'made-up' : evidence[0].id] }] } }));
  }
} else {
  const index = args.indexOf('--settings');
  const settings = index >= 0 ? JSON.parse(args[index + 1]) : {};
  const transcript = process.env.FAKE_TRANSCRIPT || join(tmpdir(), `lean-transcript-${randomUUID()}.jsonl`);
  writeFileSync(transcript, JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'Correction: run the repository test command before completion.' } }) + '\n');
  const observed = [];
  for (const hook_event_name of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']) {
    for (const group of settings.hooks?.[hook_event_name] ?? []) for (const hook of group.hooks) {
      const result = spawnSync(hook.command, { shell: true, encoding: 'utf8', input: JSON.stringify({ hook_event_name, session_id: 'fake-session', transcript_path: transcript }), timeout: 2000 });
      observed.push({ hook_event_name, status: result.status, stdout: result.stdout, stderr: result.stderr });
    }
  }
  console.log(JSON.stringify({ fixture: true, hooks: observed }));
}
