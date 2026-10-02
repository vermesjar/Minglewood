"""Run real draft interactions and byte invariants. This does not approve motion aesthetics."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
VERSION=1
SCOPE='Real clicks, server occupancy, approach/contact/every cushion/exit, all four facings and four exact outfits; exterior/final-canvas byte invariants and independently reviewed settled overlaps. Transition-overlap aesthetics remain pending.'


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(draft_dir, draft, url, expectations, timeout=1200):
    draft_dir=Path(draft_dir).resolve();stage=draft_dir/'stage';models=stage/'surface-models.json'
    # The already reviewed exact model is transported, never recompiled for motion.
    reviewed=json.loads(models.read_text())
    if reviewed.get(draft['key'])!=draft['furniture']['seatModel']['model']:raise ValueError('Motion candidate differs from the currently reviewed draft model')
    dependencies=[models,stage/'entries.json',draft_dir/'surface-review-contract.json',draft_dir/'seat-verification.bundle.json',
                  ROOT/'tests/e2e/seat-models.spec.ts',ROOT/'tests/e2e/helpers.ts',ROOT/'scripts/lib/seat-motion-candidate.ts',
                  ROOT/'scripts/seat-motion-check.py',ROOT/'scripts/seat-motion-postcheck.py',Path(__file__)]
    entries=json.loads((stage/'entries.json').read_text())
    numerical_bundle=json.loads((draft_dir/'seat-verification.bundle.json').read_text())
    for name,expected in numerical_bundle.get('rendererSources',{}).items():
        source=ROOT/name
        if digest(source)!=expected:raise ValueError('Settled evidence renderer is stale; recapture before motion review')
        dependencies.append(source)
    if not numerical_bundle.get('rendererSources'):raise ValueError('Capture-time renderer inventory is required for motion review')
    for entry in entries.values():dependencies.extend(stage/'sprites'/v['file'] for v in entry['facings'].values())
    review_files=[]
    for path in map(Path,expectations):review_files.extend(sorted(path.rglob('*.json')) if path.is_dir() else [path])
    review_files=[p for p in review_files if isinstance(json.loads(p.read_text()).get('points'),list)]
    if not review_files:raise ValueError('Immutable settled expectations are required for motion checking')
    dependencies.extend(review_files);bindings={str(p):digest(p) for p in dict.fromkeys(dependencies)}
    identity=hashlib.sha256(json.dumps(bindings,sort_keys=True).encode()).hexdigest();output=draft_dir/'motion-review'/identity;output.mkdir(parents=True,exist_ok=True)
    result_file=output/'result.json'
    if result_file.exists():
        existing=json.loads(result_file.read_text())
        if existing.get('state')=='INVARIANTS_PASSED_VISUAL_PENDING' and all(digest(output/p['path'])==p['sha256'] for p in existing['artifacts']):return existing
    labels=output/'settled-expectations';labels.mkdir(exist_ok=True)
    for i,path in enumerate(review_files):shutil.copyfile(path,labels/f'context-{i}.json')
    # Demo account display names include this tag and must stay within 40 characters.
    run_id='s-'+hashlib.sha256(f'{identity}:{time.time_ns()}'.encode()).hexdigest()[:20];live=ROOT/'art/review/models-live'/run_id
    env={**os.environ,'PLAYTEST_URL':url,'PLAYTEST_TAG':run_id,'SEAT_MODEL_RUN':run_id,'SEAT_MODEL_KEYS':draft['key'],
         'SEAT_MODEL_FACINGS':'se,sw,ne,nw','SEAT_MODEL_FILM_LOOKS':'0,1,2,3','SEAT_MODEL_STRICT_LOOKS':'1',
         'SEAT_CANDIDATE_DIR':str(stage),'SEAT_CANDIDATE_MODELS':str(models)}
    state={'version':VERSION,'scope':SCOPE,'state':'RECORDING','identity':identity,'bindings':bindings,'run':run_id,'visualApproval':False}
    result_file.write_text(json.dumps(state,indent=2))
    command=['node','--no-maglev','node_modules/@playwright/test/cli.js','test','tests/e2e/seat-models.spec.ts','--workers','1','--retries','0']
    try:
        capture=subprocess.run(command,cwd=ROOT,env=env,capture_output=True,text=True,encoding='utf-8',timeout=timeout)
        (output/'recording.log').write_text(capture.stdout+'\n'+capture.stderr)
        if capture.returncode:raise RuntimeError('Real draft motion recording failed; see recording.log')
        if any(digest(p)!=value for p,value in bindings.items()):raise RuntimeError('Draft/model/checker inputs changed during motion recording')
        films=output/'films';shutil.copytree(live,films,dirs_exist_ok=True)
        # Retain original film hashes even when the independent checker fails.
        state['artifacts']=[{'path':p.relative_to(output).as_posix(),'sha256':digest(p)} for p in films.rglob('*') if p.is_file()]
        result_file.write_text(json.dumps(state,indent=2))
        checked=subprocess.run([sys.executable,'scripts/seat-motion-postcheck.py',str(films),str(labels),'--require-complete'],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=timeout)
        (output/'checking.log').write_text(checked.stdout+'\n'+checked.stderr)
        verdict=json.loads((films/'motion-independent-check.json').read_text())
        if checked.returncode or verdict.get('invariantsPassed') is not True:raise RuntimeError('Motion pixel/context invariants failed; see motion-independent-check.json')
        state.update(state='INVARIANTS_PASSED_VISUAL_PENDING',artifacts=[{'path':p.relative_to(output).as_posix(),'sha256':digest(p)} for p in films.rglob('*') if p.is_file()])
    except Exception as error:
        state.update(state='FAILED',error=str(error))
    result_file.write_text(json.dumps(state,indent=2));return state
