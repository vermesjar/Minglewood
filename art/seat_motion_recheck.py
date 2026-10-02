"""Recheck immutable motion films with a newer independent checker; never pretend to recapture."""
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def verify_original_films(source, previous, files):
    receipts={str((source/p['path']).resolve()):p['sha256'] for p in previous.get('artifacts',[])
              if p['path'].endswith(('-film.json','-film.png'))}
    actual={str(p.resolve()):digest(p) for p in files}
    if not receipts or receipts!=actual:
        raise ValueError('Original film receipt is missing or recorded film bytes changed')


def recheck(result_path, checker=None):
    result_path=Path(result_path).resolve(); previous=json.loads(result_path.read_text()); source=result_path.parent
    checker=Path(checker or ROOT/'scripts/seat-motion-postcheck.py').resolve()
    canonical_checker=str((ROOT/'scripts/seat-motion-check.py').resolve())
    # Recording/runtime/art/model/expectation dependencies remain exact. Only
    # independent postprocessing may change, explicitly recorded below.
    recording_bindings=previous['bindings']
    for name,expected in recording_bindings.items():
        if str(Path(name).resolve())!=canonical_checker and digest(name)!=expected:raise ValueError('Original motion recording dependency changed: '+name)
    films=source/'films'; labels=source/'settled-expectations'
    files=sorted(p for p in films.iterdir() if p.name.endswith('-film.json') or p.name.endswith('-film.png'))
    if not files:raise ValueError('No immutable recorded motion films')
    verify_original_films(source,previous,files)
    original_proofs=[{'path':str(p),'sha256':digest(p)} for p in files]
    identity=hashlib.sha256(json.dumps({'recording':digest(result_path),'films':original_proofs,'checker':digest(checker)},sort_keys=True).encode()).hexdigest()
    output=source/'rechecks'/identity; destination=output/'films'; destination.mkdir(parents=True,exist_ok=True)
    for p in files:shutil.copyfile(p,destination/p.name)
    checked=subprocess.run([sys.executable,str(checker),str(destination),str(labels),'--require-complete'],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
    (output/'checking.log').write_text(checked.stdout+'\n'+checked.stderr)
    verdict=json.loads((destination/'motion-independent-check.json').read_text())
    if any(digest(p['path'])!=p['sha256'] for p in original_proofs):raise ValueError('Original films changed during replay')
    bindings=dict(recording_bindings)
    bindings[str(checker)]=digest(checker);bindings[str(Path(__file__).resolve())]=digest(__file__)
    state={'version':1,'scope':previous['scope'],'state':'INVARIANTS_PASSED_VISUAL_PENDING' if not checked.returncode and verdict.get('invariantsPassed') is True else 'FAILED',
           'identity':identity,'bindings':bindings,'run':previous['run'],'visualApproval':False,
           'postprocessing':{'generatedAt':datetime.now(timezone.utc).isoformat(),'recordingResult':{'path':str(result_path),'sha256':digest(result_path)},
                             'recordingBindings':recording_bindings,'originalFilms':original_proofs,'checker':{'path':str(checker),'sha256':digest(checker)},
                             'claim':'New independent postprocessing of unchanged historical capture bytes; no new recording.'},
           'artifacts':[{'path':p.relative_to(output).as_posix(),'sha256':digest(p)} for p in destination.iterdir() if p.is_file()]}
    if state['state']=='FAILED':state['error']='Motion replay invariants failed'
    result=output/'result.json';result.write_text(json.dumps(state,indent=2));return result
