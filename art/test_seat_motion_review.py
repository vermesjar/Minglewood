import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import seat_motion_review as motion


class MotionReviewTests(unittest.TestCase):
    def fixture(self,root):
        draft_dir=root/'draft';stage=draft_dir/'stage';(stage/'sprites').mkdir(parents=True)
        model={'size':[2,1],'parts':[],'sits':[[.5,.5,10],[1.5,.5,10]]};draft={'key':'user-seat','furniture':{'seatModel':{'model':model}}}
        (stage/'surface-models.json').write_text(json.dumps({'user-seat':model}))
        (stage/'entries.json').write_text(json.dumps({'user-seat':{'footprint':[2,1],'facings':{'se':{'file':'front.png'}}}}));(stage/'sprites/front.png').write_bytes(b'original staged beauty')
        (draft_dir/'surface-review-contract.json').write_text('{}');(root/'body.ts').write_text('original body')
        (draft_dir/'seat-verification.bundle.json').write_text(json.dumps({'rendererSources':{'body.ts':motion.digest(root/'body.ts')}}))
        for name in ['tests/e2e/seat-models.spec.ts','tests/e2e/helpers.ts','scripts/lib/seat-motion-candidate.ts','scripts/seat-motion-check.py','scripts/seat-motion-postcheck.py']:
            p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('test command source')
        expected=root/'expected.json';expected.write_text(json.dumps({'context':{},'points':[{'x':0,'y':0,'winner':'avatar'}]}))
        return draft_dir,draft,expected

    def test_records_real_command_and_never_calls_invariant_success_visual_approval(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);d,draft,expected=self.fixture(root);calls=[]
            def execute(command,**kwargs):
                calls.append(command)
                if 'env' in kwargs:
                    env=kwargs['env'];self.assertLessEqual(len('Playtest Bot '+env['PLAYTEST_TAG']+' 1'),40);self.assertEqual(env['SEAT_CANDIDATE_DIR'],str(d/'stage'));self.assertEqual(env['SEAT_MODEL_STRICT_LOOKS'],'1')
                    out=root/'art/review/models-live'/env['SEAT_MODEL_RUN'];out.mkdir(parents=True);(out/'seat-film.json').write_text('{}')
                else:
                    self.assertEqual(command[1],'scripts/seat-motion-postcheck.py')
                    films=Path(command[2]);(films/'motion-independent-check.json').write_text(json.dumps({'invariantsPassed':True,'scope':'Exterior and settled only'}))
                return SimpleNamespace(returncode=0,stdout='mock receipt',stderr='')
            with patch.object(motion,'ROOT',root),patch.object(motion.subprocess,'run',side_effect=execute):
                result=motion.run(d,draft,'http://localhost:5195',[expected]);self.assertEqual(result['state'],'INVARIANTS_PASSED_VISUAL_PENDING');self.assertFalse(result['visualApproval'])
                cached=motion.run(d,draft,'http://localhost:5195',[expected]);self.assertEqual(cached['identity'],result['identity']);self.assertEqual(len(calls),2)
                (root/'body.ts').write_text('changed body')
                with self.assertRaisesRegex(ValueError,'renderer is stale'):motion.run(d,draft,'http://localhost:5195',[expected])

    def test_failed_recording_is_preserved_and_not_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);d,draft,expected=self.fixture(root)
            with patch.object(motion,'ROOT',root),patch.object(motion.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='',stderr='missing actual exit')):
                result=motion.run(d,draft,'http://localhost:5195',[expected]);self.assertEqual(result['state'],'FAILED');self.assertFalse(result['visualApproval'])


if __name__=='__main__':unittest.main()
