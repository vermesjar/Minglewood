"""Freeze-independent numerical verification of the partial shell experiment."""
import argparse
import json
from pathlib import Path
import numpy as np
from seat_cushion_shell_experiment import shell,projected_depth
from seat_cushion_shell_reference import ray_depth
from seat_rounded_diagnostic import ray,digest


def verify(inputs,experiment):
    root=Path(experiment);report=json.loads((root/'report.json').read_text());params=report['best']['parameters'];result={'status':'PARTIAL_NUMERICAL_CHECK_NOT_APPROVAL','reportSha256':digest(report),'views':{},'referenceSha256':digest(Path(__file__).with_name('seat_cushion_shell_reference.py').read_text())}
    for f in ['se','sw','ne','nw']:
        art=json.loads((Path(inputs)/(f+'.json')).read_text())['sourceArt'];v,t=shell(params,32)
        q=[ray(art['anchor'],[2,1],f,x+.5,y+.5) for y in range(art['height']) for x in range(art['width'])]
        a=ray_depth(v,t,np.array([r[0] for r in q]),np.array([r[1] for r in q]));b=projected_depth(v,t,art,[2,1],f).ravel()
        finer=projected_depth(*shell(params,64),art,[2,1],f).ravel();both=np.isfinite(a)&np.isfinite(b);common=np.isfinite(b)&np.isfinite(finer)
        result['views'][f]={'hitDisagreements':int((np.isfinite(a)!=np.isfinite(b)).sum()),'maxDepthError':float(np.max(np.abs(a[both]-b[both]))),'refinementHitChanges':int((np.isfinite(b)!=np.isfinite(finer)).sum()),'refinementMaxDepthChange':float(np.max(np.abs(b[common]-finer[common])))}
    (root/'independent-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--experiment',required=True);a=p.parse_args();verify(a.inputs,a.experiment)
