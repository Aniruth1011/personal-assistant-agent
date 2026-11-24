"""Sequential end-to-end paired evaluation through the deployed Gateway.
Run from repository root: python3 scripts/evaluation/run.py RUN_ID
Raw results are exclusive-create; resume skips existing results without overwriting.
"""
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys
import time

run_id = sys.argv[1]
if not run_id.replace('-', '').isalnum():
    raise SystemExit('Use an alphanumeric/dash run ID')
root = pathlib.Path('evidence/evaluation') / run_id
root.mkdir(parents=True, exist_ok=True)
cases_path = pathlib.Path('fixtures/evaluation/cases.json')
cases = json.loads(cases_path.read_text())
if len(sys.argv) > 2:
    selected = set(json.loads(pathlib.Path(sys.argv[2]).read_text()))
    cases = [case for case in cases if case['id'] in selected]
    if len(cases) != len(selected):
        raise SystemExit('Unknown selected case ID')
manifest = root / 'manifest.json'
if not manifest.exists():
    manifest.write_text(json.dumps({'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'selectedCaseIds': [c['id'] for c in cases], 'casesSha256': hashlib.sha256(cases_path.read_bytes()).hexdigest(), 'design': 'Identical public synthetic prompts; main/private workspace selects local, isolated public-research selects cloud. Full platform turns, different workspace/system contexts: deployed-path comparison, not a controlled model-only benchmark.', 'arms': {'local': 'main', 'cloud': 'public-research'}, 'costPolicy': 'Native catalog cost estimates are not OAuth charges. Local provider charge is zero; electricity/hardware and shared infrastructure are excluded.'}, indent=2)+'\n')
for index, case in enumerate(cases):
    arms = ['local', 'cloud'] if index % 2 == 0 else ['cloud', 'local']
    for arm in arms:
        target = root / (case['id']+'-'+arm+'.json')
        if target.exists():
            continue
        ident = run_id+'-'+case['id']+'-'+arm
        request = {'method': 'agent', 'expectFinal': True, 'params': {'agentId': 'main' if arm == 'local' else 'public-research', 'sessionId': ident, 'message': case['prompt'], 'deliver': False, 'idempotencyKey': ident}}
        request_path = pathlib.Path('.runtime/evaluation-request.json')
        request_path.write_text(json.dumps(request))
        started = datetime.datetime.now(datetime.timezone.utc).isoformat()
        begin = time.monotonic()
        try:
            proc = subprocess.run(['node', 'scripts/evaluation/gateway-rpc.mjs', str(request_path)], capture_output=True, text=True, timeout=270)
            stdout, stderr, code = proc.stdout, proc.stderr, proc.returncode
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout.decode() if isinstance(exc.stdout, bytes) else exc.stdout or ''
            stderr, code = 'CLIENT_TIMEOUT', 124
        record = {'caseId': case['id'], 'type': case['type'], 'arm': arm, 'startedAt': started, 'elapsedMs': round((time.monotonic()-begin)*1000), 'exit': code, 'stdout': stdout, 'stderr': stderr}
        with target.open('x') as output:
            json.dump(record, output, indent=2)
        print(case['id'], arm, code, record['elapsedMs'], flush=True)
