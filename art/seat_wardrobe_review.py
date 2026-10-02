"""Numerical body prerequisite after source-bound settled and movement review."""
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(draft_dir, bundle, contract):
    import studio
    draft_dir = Path(draft_dir)
    # Retain every receipt. Only a verified complete new receipt becomes current.
    output = draft_dir / 'wardrobe-review' / (str(time.time_ns()) + '.json')
    command = ['node', '--no-maglev', '--import', 'tsx', 'scripts/seat-wardrobe-coverage.ts',
               str(bundle), str(contract), str(output)]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    if result.returncode:
        raise RuntimeError('Original-body wardrobe coverage failed: ' + (result.stdout + result.stderr)[-3000:])
    summary = json.loads(result.stdout)
    receipt = json.loads(output.read_text(encoding='utf-8'))
    if summary.get('ok') is not True or receipt.get('ok') is not True or receipt.get('visualApproval') is not False:
        raise RuntimeError('Original-body wardrobe coverage is incomplete')
    studio.write_atomic(draft_dir / 'wardrobe-coverage.json', output.read_text(encoding='utf-8'))
    return {'state': 'FINITE_BODY_DEPTH_ACCEPTED', 'receipt': 'wardrobe-coverage.json',
            'contexts': len(receipt['contexts']), 'looks': receipt['looks'],
            'visualApproval': False, 'wardrobeOverlapApproval': False}
