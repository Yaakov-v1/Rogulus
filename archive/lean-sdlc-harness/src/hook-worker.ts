import { Store } from './store.js';
const [root, id] = process.argv.slice(2);
let store: Store | undefined;
try {
  if (!root || !id) throw new Error('Missing hook context');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length; if (size > 1048576) throw new Error('Hook input exceeds 1 MiB'); chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const event = input.hook_event_name;
  if (!['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'].includes(event)) throw new Error('Unknown hook event');
  store = new Store(root);
  let context = '';
  store.transaction(() => {
    const session = store!.session(id);
    const turn = event === 'UserPromptSubmit' ? session.turn + 1 : session.turn;
    // Store references only. Parsing transcripts belongs exclusively to the offline batch.
    const transcript = typeof input.transcript_path === 'string' ? input.transcript_path : session.transcript;
    const agentId = typeof input.session_id === 'string' ? input.session_id : session.agentSessionId;
    store!.db.prepare('UPDATE sessions SET transcript=?,agent_session_id=?,turn=? WHERE id=?').run(transcript, agentId, turn, id);
    if (event === 'SessionStart') context = session.context;
  });
  if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
} catch { process.exitCode = 1; /* Supervisor reports failure without blocking coding. */ }
finally { store?.close(); }
