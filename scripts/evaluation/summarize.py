"""Score retained raw Gateway results; never infer success from intended model."""
import collections
import json
import math
import pathlib
import re
import statistics
import sys

root = pathlib.Path('evidence/evaluation') / sys.argv[1]
cases = {c['id']: c for c in json.loads(pathlib.Path('fixtures/evaluation/cases.json').read_text())}
manifest = json.loads((root/'manifest.json').read_text())
selected = manifest.get('selectedCaseIds', list(cases))
cases = {k: v for k, v in cases.items() if k in selected}
rows = []
for path in sorted(root.glob('*.json')):
    if path.name in ['manifest.json', 'summary.json']:
        continue
    record = json.loads(path.read_text())
    if 'caseId' not in record:
        continue
    case = cases[record['caseId']]
    try:
        result = json.loads(record['stdout'])
    except json.JSONDecodeError:
        result = {}
    meta = result.get('result', {}).get('meta', {})
    agent = meta.get('agentMeta', {})
    text = '\n'.join(p.get('text', '') for p in result.get('result', {}).get('payloads', []))
    try:
        answer = json.loads(text.strip())
    except json.JSONDecodeError:
        answer = None
    strict_json = answer is not None
    if answer is None:
        fenced = re.fullmatch(r"```(?:json)?\s*([\s\S]*?)\s*```", text.strip())
        if fenced:
            try:
                answer = json.loads(fenced.group(1))
            except json.JSONDecodeError:
                pass
    expected_model = 'gemma4:e2b' if record['arm'] == 'local' else 'gpt-6-luna'
    effective = agent.get('terminalReceipt', {}).get('effective', {})
    served = effective.get('model', agent.get('model'))
    success = record['exit'] == 0 and result.get('status') == 'ok' and served == expected_model and bool(text)
    expected = case['expected']
    matched = sum(isinstance(answer, dict) and answer.get(k) == v for k, v in expected.items())
    rows.append({'caseId': case['id'], 'type': case['type'], 'arm': record['arm'], 'servedModel': served, 'success': success, 'exactCorrect': success and strict_json and answer == expected, 'contentCorrect': success and answer == expected, 'strictJson': strict_json, 'fieldsMatched': matched if success else 0, 'fieldsTotal': len(expected), 'elapsedMs': record['elapsedMs'], 'agentDurationMs': meta.get('durationMs'), 'usage': agent.get('usage'), 'catalogCostEstimateUsd': agent.get('costUsd'), 'answer': text})
groups = []
for task_type in sorted({r['type'] for r in rows}):
    for arm in ['local', 'cloud']:
        selected = [r for r in rows if r['type'] == task_type and r['arm'] == arm]
        times = sorted(r['elapsedMs'] for r in selected if r['success'])
        groups.append({'type': task_type, 'arm': arm, 'attempts': len(selected), 'successful': sum(r['success'] for r in selected), 'exactCorrect': sum(r['exactCorrect'] for r in selected), 'contentCorrect': sum(r['contentCorrect'] for r in selected), 'fieldAccuracy': sum(r['fieldsMatched'] for r in selected)/sum(r['fieldsTotal'] for r in selected) if selected else None, 'medianMs': statistics.median(times) if times else None, 'p95Ms': times[math.ceil(.95*len(times))-1] if times else None})
summary = {'expectedTurns': len(cases)*2, 'recordedTurns': len(rows), 'complete': len(rows) == len(cases)*2, 'groups': groups, 'rows': rows}
(root/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='rows'}, indent=2))
