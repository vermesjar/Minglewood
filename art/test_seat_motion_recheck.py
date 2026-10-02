import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import seat_motion_recheck as replay

class MotionReplayTests(unittest.TestCase):
    def fixture(self,root):
        source=root/'capture';(source/'films').mkdir(parents=True);(source/'settled-expectations').mkdir()
        old=root/'scripts/seat-motion-check.py';old.parent.mkdir();old.write_text('old recording checker')
        new=root/'scripts/seat-motion-postcheck.py';new.write_text('strict continuous height checker')
        body=root/'body.ts';body.write_text('frozen body')
        film=source/'films/example-film.json';film.write_text('{"original":"recorded bytes"}')
        result=source/'result.json';result.write_text(json.dumps({'bindings':{str(old):replay.digest(old),str(body):replay.digest(body)},'scope':'motion','run':'old-recording','state':'FAILED','artifacts':[{'path':'films/example-film.json','sha256':replay.digest(film)}]}))
        return result,new,body,film

    def test_replay_preserves_recording_and_separately_binds_new_checker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);result,checker,body,film=self.fixture(root);before=result.read_bytes();film_before=film.read_bytes()
            def execute(command,**kwargs):
                (Path(command[2])/'motion-independent-check.json').write_text('{"invariantsPassed":true}')
                return SimpleNamespace(returncode=0,stdout='',stderr='')
            with patch.object(replay,'ROOT',root),patch.object(replay.subprocess,'run',side_effect=execute):
                out=replay.recheck(result,checker)
            d=json.loads(out.read_text());self.assertEqual(d['state'],'INVARIANTS_PASSED_VISUAL_PENDING');self.assertFalse(d['visualApproval'])
            self.assertEqual(result.read_bytes(),before);self.assertEqual(film.read_bytes(),film_before)
            self.assertEqual(d['postprocessing']['recordingResult']['sha256'],replay.digest(result))
            self.assertEqual(d['bindings'][str(checker)],replay.digest(checker))
            self.assertIn('no new recording',d['postprocessing']['claim'])

    def test_changed_recording_source_cannot_be_rebound_by_replaying(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);result,checker,body,film=self.fixture(root);body.write_text('changed body')
            with patch.object(replay,'ROOT',root),patch.object(replay.subprocess,'run') as execute:
                with self.assertRaisesRegex(ValueError,'dependency changed'):replay.recheck(result,checker)
                execute.assert_not_called()

class FilmReceiptTests(unittest.TestCase):
    def test_original_bytes_required_and_exact_coverage(self):
        source=Path('art/review/receipt-test');film=source/'films/example-film.json'
        receipt={'artifacts':[{'path':'films/example-film.json','sha256':'original'}]}
        with patch.object(replay,'digest',return_value='original'):
            replay.verify_original_films(source,receipt,[film])
            for files in [[],[film,source/'films/extra-film.json']]:
                with self.assertRaisesRegex(ValueError,'receipt'):replay.verify_original_films(source,receipt,files)
            with self.assertRaisesRegex(ValueError,'receipt'):replay.verify_original_films(source,{},[film])
        with patch.object(replay,'digest',return_value='altered'):
            with self.assertRaisesRegex(ValueError,'bytes changed'):replay.verify_original_films(source,receipt,[film])

if __name__=='__main__':unittest.main()
