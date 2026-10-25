"""Isolated reproductions of unmodified code fences; no model or network calls."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
NODE = shutil.which('node')
RESULTS = []

def sandbox(name):
    root = Path(tempfile.mkdtemp(prefix=name + '-', dir=HERE))
    (root / '.harness').mkdir()
    return root

def run(root, script, *args, data=None, env=None):
    return subprocess.run([NODE, str(HERE / script), *args], cwd=root,
        input=json.dumps(data or {}), text=True, capture_output=True, timeout=15,
        env={**os.environ, 'CLAUDE_PROJECT_DIR': str(root), 'HARNESS_NESTED': '', **(env or {})})

def jsonl(file):
    return [json.loads(s) for s in file.read_text().splitlines()] if file.exists() else []

def entry(root, eid):
    return json.loads((root / '.harness/ledger/entries' / (eid + '.json')).read_text())

def edits(root, sid='session-1'):
    state = root / '.harness/state' / sid
    state.mkdir(parents=True)
    (state / 'edits.jsonl').write_text(json.dumps({'file': 'src/a.ts'}) + '\n')
    (root / 'src').mkdir(exist_ok=True)
    (root / 'src/a.ts').write_text('export const value = 1;\n')
    return state

root = sandbox('forged-approval')
eid = run(root, 'ledger.mjs', 'capture', data={'statement': 'Use the configured formatter.'}).stdout.strip()
run(root, 'ledger.mjs', 'fold')
before = entry(root, eid)['status']
guard = run(root, 'guard.mjs', data={'tool_name': 'Bash', 'tool_input': {'command': 'node .harness/bin/ledger.mjs capture'}})
run(root, 'ledger.mjs', 'capture', data={'op': 'approve', 'id': eid, 'by': 'pretend-human'})
run(root, 'ledger.mjs', 'fold')
after = entry(root, eid)
assert before == 'captured' and after['status'] == 'active' and guard.stdout == ''
RESULTS.append({'case': 'capture_can_forge_approval', 'reproduced': True, 'before': before,
    'after': after['status'], 'approved_by': after['governance']['approved_by'], 'guard_denied': False})

root = sandbox('missing-sensor-run')
eid = run(root, 'ledger.mjs', 'teach', data={'statement': 'Check nullable values.',
    'scope': {'level': 'path', 'paths': ['src/**']}, 'sensor_link': {'sensor_id': 'types'}}).stdout.strip()
run(root, 'ledger.mjs', 'fold')
state = edits(root)
run(root, 'ledger.mjs', 'settle', data={'session_id': 'session-1'})
evidence = entry(root, eid)['evidence']
assert len(evidence) == 1 and evidence[0]['outcome'] == 'confirm' and not (state / 'sensor_runs.jsonl').exists()
RESULTS.append({'case': 'no_sensor_run_still_confirms', 'reproduced': True,
    'sensor_run_count': 0, 'evidence': evidence})

root = sandbox('failed-types')
state = edits(root)
(root / '.harness/sensors.json').write_text(json.dumps({'sensors': [{'id': 'types', 'on': 'stop', 'parser': 'tsc',
    'cmd': [NODE, '-e', 'console.error("error TS18003: No inputs were found in config file."); process.exit(2)'], 'timeout_s': 2}]}))
r = run(root, 'sense.mjs', 'stop', data={'session_id': 'session-1'})
runs = jsonl(state / 'sensor_runs.jsonl')
assert r.returncode == 0 and runs[0]['exit'] == 2 and runs[0]['n'] == 0
RESULTS.append({'case': 'failed_sensor_treated_as_green', 'reproduced': True,
    'hook_exit': r.returncode, 'sensor_runs': runs})

root = sandbox('uncapped-rules')
for n in range(20):
    run(root, 'ledger.mjs', 'teach', data={'statement': f'Lesson {n}: ' + 'Review relevant edge cases. ' * 20,
        'scope': {'level': 'path', 'paths': ['src/**']}})
r = run(root, 'ledger.mjs', 'inject', data={'session_id': 'session-1'})
files = list((root / '.claude/rules/learned').glob('*.md'))
chars = sum(len(f.read_text()) for f in files)
assert len(files) == 20 and chars > 4000
RESULTS.append({'case': 'path_rule_files_bypass_injection_budget', 'reproduced': True,
    'matching_rule_files': len(files), 'rule_file_characters': chars,
    'session_start_context_characters': len(json.loads(r.stdout)['hookSpecificOutput']['additionalContext']),
    'note': 'Generated files measured; live Claude rule loading not exercised.'})

root = sandbox('failed-review-cache')
state = edits(root)
(root / '.harness/sensors.json').write_text(json.dumps({'review': {'timeout_s': 2}}))
subprocess.run(['git', 'init', '-q'], cwd=root, check=True, capture_output=True)
subprocess.run(['git', 'add', 'src/a.ts'], cwd=root, check=True, capture_output=True)
subprocess.run(['git', '-c', 'user.name=Harness Review', '-c', 'user.email=review@example.invalid',
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'], cwd=root, check=True, capture_output=True)
(root / 'src/a.ts').write_text('export const value = 2;\n')
stub = root / 'fake-claude'
stub.write_text('#!/bin/sh\nprintf "called\\n" >> "$CLAUDE_PROJECT_DIR/calls.txt"\nexit 1\n')
stub.chmod(0o700)
first = run(root, 'review.mjs', data={'session_id': 'session-1'}, env={'HARNESS_CLAUDE_BIN': str(stub)})
second = run(root, 'review.mjs', data={'session_id': 'session-1'}, env={'HARNESS_CLAUDE_BIN': str(stub)})
calls = len((root / 'calls.txt').read_text().splitlines())
assert calls == 1 and first.returncode == second.returncode == 0
RESULTS.append({'case': 'failed_review_cached_as_seen', 'reproduced': True,
    'hook_invocations': 2, 'reviewer_invocations': calls, 'hook_exit_codes': [first.returncode, second.returncode]})

out = HERE.parents[1] / 'outputs/enhancement-review-evidence.json'
out.write_text(json.dumps({'node': subprocess.check_output([NODE, '--version'], text=True).strip(),
    'method': 'Unmodified JavaScript code fences from the attachment, isolated local fixtures, no inference calls.',
    'results': RESULTS}, indent=2) + '\n')
print(out)
print(json.dumps(RESULTS, indent=2))
