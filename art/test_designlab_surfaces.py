"""Automatic map orchestration with no paid image or vision calls."""
import json
import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import designlab


class AutomaticSurfaceTests(unittest.TestCase):
    def setUp(self):
        coverage = patch.object(designlab.seat_wardrobe_review, 'run', return_value={
            'state': 'FINITE_BODY_DEPTH_ACCEPTED', 'receipt': 'wardrobe-coverage.json',
            'contexts': 24, 'looks': 2833, 'visualApproval': False, 'wardrobeOverlapApproval': False})
        self.wardrobe_review = coverage.start()
        self.addCleanup(coverage.stop)

    def test_resume_reuses_only_exact_verified_capture_without_regenerating_expectations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);draft,_=self.fixture(root);model=draft['furniture']['seatModel']['model']
            model['surfaces']={'se':{'version':1,'labels':[1]}}
            contract={'key':draft['key'],'draftSource':designlab.seating_draft_source(root,draft),
                      'surfaceDigests':designlab.surface_digests(root,model['surfaces'])}
            (root/'surface-review-contract.json').write_text(json.dumps(contract))
            captures=[];stale=[False]
            def run(command,**kwargs):
                if 'scripts/seat-pixel-audit.ts' in command:
                    folder=Path(command[command.index('--out')+1]);captures.append(folder)
                    (folder/(draft['key']+'.json')).write_text('[]')
                if 'scripts/seat-verify-bundle.ts' in command:
                    if '--create' in command:
                        capture=Path(command[command.index('--captures')+1])
                        (root/'seat-verification.bundle.json').write_text(json.dumps({'captures':[{'path':capture.relative_to(root).as_posix()}]}))
                    elif '--model' in command and stale[0]:
                        return SimpleNamespace(returncode=1,stdout='{"ok":false,"problems":["renderer changed"]}',stderr='')
                return SimpleNamespace(returncode=0,stdout='{"ok":true}',stderr='')
            with patch.object(designlab.subprocess,'run',side_effect=run), \
                 patch.object(designlab.seat_independent_review,'propose',side_effect=lambda path,out:out/path.stem) as independent, \
                 patch.object(designlab.seat_visual_review,'prepare',return_value=root/'visual-review/manifest.json'), \
                 patch.object(designlab.seat_visual_review,'review',return_value=root/'visual-review/decision.json'), \
                 patch.object(designlab.seat_visual_review,'validate',return_value=[]), \
                 patch.object(designlab.seat_motion_review,'run',return_value={'state':'INVARIANTS_PASSED_VISUAL_PENDING','identity':'motion'}):
                designlab.generate_seating_review(root,draft,allow_visual_paid=False)
                designlab.generate_seating_review(root,draft,allow_visual_paid=False)
                self.assertEqual(len(captures),1,'identical valid proof should preserve visual request/cache identity')
                stale[0]=True
                designlab.generate_seating_review(root,draft,allow_visual_paid=False)
                self.assertEqual(len(captures),2,'renderer or context rejection requires a new capture')
                self.assertEqual(independent.call_count,4,'never relabel original expectations to fit a new runtime')

    def test_v2_publish_gate_requires_visual_evidence_for_exact_numerical_bundle(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);draft,_=self.fixture(root);model=draft['furniture']['seatModel']['model']
            model['surfaces']={'se':{'version':2,'labels':[1]}}
            contract={'key':draft['key'],'compiler':None,'sits':model['sits'],'modelParts':json.dumps(model['parts']),
                      'surfaceDigests':{'se':'a'*64},'producerVersion':designlab.seat_surfaces.SURFACE_PRODUCER_VERSION}
            contract_path=root/'surface-review-contract.json';contract_path.write_text(json.dumps(contract))
            bundle=root/'seat-verification.bundle.json';bundle.write_text('{}')
            with patch.object(designlab,'surface_digests',return_value={'se':'a'*64}), \
                 patch.object(designlab.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='{"ok":true}',stderr='')):
                self.assertTrue(designlab.seating_surface_publish_problems(root,draft))
                (root/'visual-review').mkdir()
                visual=root/'visual-review/manifest.json'
                visual.write_text(json.dumps({'bundle':{'sha256':'wrong'},'contract':{'sha256':'wrong'}}))
                self.assertIn('different seating',designlab.seating_surface_publish_problems(root,draft)[0])
                visual.write_text(json.dumps({'bundle':{'sha256':hashlib.sha256(bundle.read_bytes()).hexdigest()},
                                             'contract':{'sha256':hashlib.sha256(contract_path.read_bytes()).hexdigest()}}))
                with patch.object(designlab.seat_visual_review,'validate',return_value=['shoe pinhole']):
                    self.assertIn('shoe pinhole',designlab.seating_surface_publish_problems(root,draft)[0])
                with patch.object(designlab.seat_visual_review,'validate',return_value=[]):
                    self.assertTrue(designlab.seating_surface_publish_problems(root,draft))
                    (root/'motion-visual-review').mkdir()
                    (root/'motion-visual-review/manifest.json').write_text(visual.read_text())
                    with patch.object(designlab.seat_motion_visual,'validate',return_value=['transition penetration']):
                        self.assertIn('transition penetration',designlab.seating_surface_publish_problems(root,draft)[0])
                    with patch.object(designlab.seat_motion_visual,'validate',return_value=[]):
                        self.assertEqual(designlab.seating_surface_publish_problems(root,draft),[])

    def test_curved_surface_hash_uses_exact_javascript_number_encoding(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            maps={'se':{'version':2,'values':[1.0,1e-7,1e-6,1e20]}}
            expected=hashlib.sha256(b'{"values":[1,1e-7,0.000001,100000000000000000000],"version":2}').hexdigest()
            self.assertEqual(designlab.surface_digests(Path(tmp),maps),{'se':expected})
            self.assertNotEqual(expected,designlab.seat_review_repair.digest(maps['se']))

    def test_wrap_generation_automatically_authors_curved_depth_without_approving_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);draft,entry=self.fixture(root)
            draft['furniture']['seatModel']['model']['parts'].append({'part':'wrap','u':[0,1],'v':[.8,1],'z':[0,16]})
            export=self.exporter(draft);commands=[]
            def run(command,**kwargs):
                commands.append(command)
                if 'scripts/seat-surface-digests.ts' in command:
                    return SimpleNamespace(returncode=0,stdout=json.dumps({f:'a'*64 for f in ['se','sw','ne','nw']}),stderr='')
                if 'scripts/seat-curved-author.ts' not in command:return export(command,**kwargs)
                if '--prepare' in command:
                    Path(command[command.index('--request')+1]).write_text('{}')
                else:
                    model=json.loads(json.dumps(draft['furniture']['seatModel']['model']))
                    model['surfaces']={f:{'version':2,'labels':[1,0],'authored':{'provenance':'authored-intent'}} for f in ['se','sw','ne','nw']}
                    Path(command[command.index('--out')+1]).write_text(json.dumps(model))
                return SimpleNamespace(returncode=0,stdout='',stderr='')
            with patch.object(designlab,'model_check',return_value=[]),patch.object(designlab.subprocess,'run',side_effect=run), \
                 patch.object(designlab.seat_surfaces,'propose',side_effect=self.producer), \
                 patch.object(designlab.seat_curved_generate,'produce',return_value={'generatorSha256':'a'*64,'sourceInputsSha256':'b'*64,'audits':{}}) as author:
                self.assertEqual(designlab.generate_seating_surfaces(root,draft,entry,root),[])
                author.assert_called_once()
                self.assertEqual(len([c for c in commands if 'scripts/seat-curved-author.ts' in c]),2)
                self.assertEqual(set(draft['furniture']['seatModel']['model']['surfaces']),{'se','sw','ne','nw'})
                self.assertEqual(draft['seatingSurfaceReview']['status'],'UNREVIEWED')
                self.assertTrue(designlab.seating_surface_publish_problems(root,draft))

    def test_authored_depth_failure_cannot_be_replaced_by_semantic_only_repair(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);draft,_=self.fixture(root)
            draft['furniture']['seatModel']['model']['surfaces']={'se':{'version':2,'labels':[1]}}
            (root/'surface-review-contract.json').write_text(json.dumps({'key':draft['key']}))
            def run(command,**kwargs):
                bad='scripts/seat-verify-bundle.ts' in command
                return SimpleNamespace(returncode=1 if bad else 0,stdout=json.dumps({'ok':not bad}),stderr='')
            with patch.object(designlab.subprocess,'run',side_effect=run), \
                 patch.object(designlab.seat_independent_review,'propose',side_effect=lambda path,out:out/path.stem), \
                 patch.object(designlab.seat_authored_review,'propose',side_effect=lambda path,model,out:out/path.stem), \
                 patch.object(designlab.seat_review_repair,'repair_round') as repair:
                result=designlab.generate_seating_review(root,draft)
                self.assertTrue(result);repair.assert_not_called()
                self.assertIn('cannot discard',result[0])
                self.assertEqual(draft['furniture']['seatModel']['model']['surfaces']['se']['version'],2)

    def test_authored_numerical_pass_is_not_visual_approval(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);draft,_=self.fixture(root)
            draft['furniture']['seatModel']['model']['surfaces']={'se':{'version':2,'labels':[1]}}
            (root/'surface-review-contract.json').write_text(json.dumps({'key':draft['key']}))
            with patch.object(designlab.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='{"ok":true}',stderr='')), \
                 patch.object(designlab.seat_authored_review,'propose',side_effect=lambda path,model,out:out/path.stem) as reference, \
                 patch.object(designlab.seat_independent_review,'propose') as vision:
                result=designlab.generate_seating_review(root,draft)
                self.assertTrue(result)
                self.assertEqual(reference.call_count,4);vision.assert_not_called()
                self.assertEqual(draft['independentSeatReview']['state'],'NUMERICAL_EVIDENCE_ACCEPTED')
                self.assertEqual(draft['independentSeatReview']['visualQuality'],'PENDING')

    def test_authored_publication_readiness_requires_independent_visual_result(self):
        for visual_problems in [[], ['isolated upholstery hole in shin']]:
            with self.subTest(visual_problems=visual_problems),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);draft,_=self.fixture(root)
                draft['furniture']['seatModel']['model']['surfaces']={'se':{'version':2,'labels':[1]}}
                (root/'surface-review-contract.json').write_text(json.dumps({'key':draft['key']}))
                with patch.object(designlab.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='{"ok":true}',stderr='')), \
                     patch.object(designlab.seat_authored_review,'propose',side_effect=lambda path,model,out:out/path.stem), \
                     patch.object(designlab.seat_visual_review,'prepare',return_value=root/'visual-review/manifest.json') as prepare, \
                     patch.object(designlab.seat_visual_review,'review',return_value=root/'visual-review/decision.json') as visual, \
                     patch.object(designlab.seat_motion_review,'run',return_value={'state':'INVARIANTS_PASSED_VISUAL_PENDING','identity':'motion'}) as motion, \
                     patch.object(designlab.seat_visual_review,'validate',return_value=visual_problems):
                    result=designlab.generate_seating_review(root,draft,allow_visual_paid=False)
                    self.assertTrue(result)
                    self.assertEqual(len(prepare.call_args.kwargs['source_inputs']),4)
                    self.assertFalse(visual.call_args.kwargs['allow_paid'])
                    self.assertEqual(draft['independentSeatReview']['state'],'NUMERICAL_EVIDENCE_ACCEPTED' if visual_problems else 'EVIDENCE_ACCEPTED')
                    self.assertEqual(motion.call_count,0 if visual_problems else 1)
                    if not visual_problems:
                        self.assertIn('transition visual review remains pending',result[0])
                        self.assertFalse(draft['seatMotionReview']['visualApproval'])

    def test_complete_pipeline_requires_motion_visual_validation_before_acceptance(self):
        for motion_problems, wardrobe_failure in [([], False), (['entry pelvis penetrates seat'], False), ([], True)]:
            with self.subTest(motion_problems=motion_problems, wardrobe_failure=wardrobe_failure),tempfile.TemporaryDirectory() as tmp:
                self.wardrobe_review.reset_mock()
                self.wardrobe_review.side_effect = RuntimeError('unresolved original skirt pixel') if wardrobe_failure else None
                root=Path(tmp);draft,_=self.fixture(root)
                draft['furniture']['seatModel']['model']['surfaces']={'se':{'version':2,'labels':[1]}}
                (root/'surface-review-contract.json').write_text(json.dumps({'key':draft['key']}))
                with patch.object(designlab.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='{"ok":true}',stderr='')), \
                     patch.object(designlab.seat_authored_review,'propose',side_effect=lambda path,model,out:out/path.stem), \
                     patch.object(designlab.seat_visual_review,'prepare',return_value=root/'visual-review/manifest.json'), \
                     patch.object(designlab.seat_visual_review,'review',return_value=root/'visual-review/decision.json'), \
                     patch.object(designlab.seat_visual_review,'validate',return_value=[]), \
                     patch.object(designlab.seat_motion_review,'run',return_value={'state':'INVARIANTS_PASSED_VISUAL_PENDING','identity':'motion'}), \
                     patch.object(designlab.seat_motion_visual,'prepare',return_value=root/'motion-visual-review/manifest.json') as prepare, \
                     patch.object(designlab.seat_motion_visual,'review',return_value=root/'motion-visual-review/decision.json') as review, \
                     patch.object(designlab.seat_motion_visual,'validate',return_value=motion_problems):
                    problems=designlab.generate_seating_review(root,draft,allow_visual_paid=False)
                    self.assertEqual(bool(problems),bool(motion_problems) or wardrobe_failure)
                    self.assertEqual(self.wardrobe_review.call_count, 0 if motion_problems else 1)
                    if wardrobe_failure:
                        self.assertEqual(draft['seatWardrobeReview']['state'], 'FAILED')
                        self.assertIn('wardrobe coverage remains pending', problems[0])
                    elif not motion_problems:
                        self.assertFalse(draft['seatWardrobeReview']['visualApproval'])
                    self.assertEqual(draft['seatMotionReview']['visualApproval'],not bool(motion_problems))
                    self.assertEqual(prepare.call_args.args[0],root/'motion-review/motion/result.json')
                    self.assertFalse(review.call_args.kwargs['allow_paid'])
                    if not motion_problems:self.assertEqual(draft['seatMotionReview']['state'],'EVIDENCE_ACCEPTED')

    def test_repairs_are_bounded_preserve_first_reviews_and_require_fresh_capture_validation(self):
        for eventually_passes in [True,False]:
            with self.subTest(eventually_passes=eventually_passes),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);draft,entry=self.fixture(root)
                draft['furniture']['seatModel']['model']['surfaces']={'se':{'labels':[1]}}
                (root/'surface-review-contract.json').write_text(json.dumps({'key':draft['key']}))
                (root/'stage'/'entries.json').write_text(json.dumps({draft['key']:entry}))
                commands=[];checks=[]
                def run(command,**kwargs):
                    commands.append(command)
                    if 'scripts/seat-verify-bundle.ts' in command:
                        checks.append(command);ok=eventually_passes and len(checks)>=3
                        return SimpleNamespace(returncode=0 if ok else 1,stdout=json.dumps({'ok':ok,'problems':[] if ok else ['wrong pixel']}),stderr='')
                    return SimpleNamespace(returncode=0,stdout='{}',stderr='')
                def propose_repair(*args):
                    labels=draft['furniture']['seatModel']['model']['surfaces']['se']['labels']
                    return {'surfaces':{'se':{'labels':[labels[0]+1]}},'changed':True,'identity':str(labels[0]),'artifact':'repair','uncertainties':[]}
                with patch.object(designlab.subprocess,'run',side_effect=run),patch.object(designlab,'model_check',return_value=[]), \
                     patch.object(designlab.seat_independent_review,'propose',side_effect=lambda path,out:out/path.stem) as judge, \
                     patch.object(designlab.seat_review_repair,'repair_pixels',return_value={'groups':{'se':[[0,0]]}}), \
                     patch.object(designlab.seat_visual_review,'prepare',return_value=root/'visual-manifest.json'), \
                     patch.object(designlab.seat_visual_review,'review',return_value=root/'visual-decision.json'), \
                     patch.object(designlab.seat_visual_review,'validate',return_value=[]), \
                     patch.object(designlab.seat_motion_review,'run',return_value={'state':'INVARIANTS_PASSED_VISUAL_PENDING','identity':'motion'}), \
                     patch.object(designlab.seat_review_repair,'repair_round',side_effect=propose_repair) as repair:
                    result=designlab.generate_seating_review(root,draft)
                    self.assertTrue(result)
                    if eventually_passes:self.assertIn('transition visual review remains pending',result[0])
                    self.assertEqual(repair.call_count,2)
                    self.assertEqual(judge.call_count,4,'never regenerate expectations to agree with the repaired output')
                    self.assertEqual(sum('scripts/seat-pixel-audit.ts' in c for c in commands),3)
                    if not eventually_passes:
                        self.assertTrue(designlab.generate_seating_review(root,draft))
                        self.assertEqual(repair.call_count,2,'resume must not reset repair budget')

    def test_uncertain_only_review_does_not_spend_on_repairs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);draft,entry=self.fixture(root)
            draft['furniture']['seatModel']['model']['surfaces']={'se':{'labels':[1]}}
            (root/'surface-review-contract.json').write_text(json.dumps({'key':draft['key']}))
            def run(command,**kwargs):
                bad='scripts/seat-verify-bundle.ts' in command
                return SimpleNamespace(returncode=1 if bad else 0,stdout=json.dumps({'ok':not bad}),stderr='')
            with patch.object(designlab.subprocess,'run',side_effect=run), \
                 patch.object(designlab.seat_independent_review,'propose',side_effect=lambda path,out:out/path.stem), \
                 patch.object(designlab.seat_review_repair,'repair_pixels',return_value={'groups':{}}), \
                 patch.object(designlab.seat_review_repair,'repair_round') as repair:
                self.assertTrue(designlab.generate_seating_review(root,draft));repair.assert_not_called()

    def test_context_view_pixel_and_anchor_changes_invalidate_cached_surface_proposals(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);draft,entry=self.fixture(root);export=self.exporter(draft);revision=[0]
            def changed_export(command,**kwargs):
                result=export(command,**kwargs)
                if command[command.index('--facing')+1]=='ne':
                    path=Path(command[command.index('--out')+1])/'input.json';data=json.loads(path.read_text())
                    data['rgba'][0]+=revision[0];data['anchor'][0]+=revision[0];path.write_text(json.dumps(data))
                return result
            with patch.object(designlab,'model_check',return_value=[]),patch.object(designlab.subprocess,'run',side_effect=changed_export), \
                 patch.object(designlab.seat_surfaces,'propose',side_effect=self.producer) as provider:
                self.assertEqual(designlab.generate_seating_surfaces(root,draft,entry,root),[])
                source=json.loads(provider.call_args.args[0].read_text());self.assertEqual(set(source['sourceViews']),{'se','sw','ne','nw'})
                self.assertEqual(source['model'],{'size':[1,1]})
                revision[0]=1
                self.assertEqual(designlab.generate_seating_surfaces(root,draft,entry,root),[])
                self.assertEqual(provider.call_count,4,'other-view beauty is part of every proposal identity')
    def fixture(self, root):
        (root / "stage").mkdir()
        model = {"size": [1, 1], "parts": [{"part": "seat", "u": [0, 1], "v": [0, 1], "z": [0, 10]}], "sits": [[.5, .5, 10]]}
        draft = {"key": "custom-seat", "furniture": {"category": "seating", "seatModel": {"model": model}}}
        entry = {"walk": "seat", "facings": {"se": {"file": "front.png"}, "nw": {"file": "rear.png"}}}
        return draft, entry

    def exporter(self, draft):
        def run(command, **_kwargs):
            folder = Path(command[command.index("--out") + 1])
            folder.mkdir(parents=True, exist_ok=True)
            facing = command[command.index("--facing") + 1]
            model = draft["furniture"]["seatModel"]["model"]
            source = {"key": draft["key"], "facing": facing, "width": 2, "height": 1,
                      "drawing": "12345678", "mechanicsDigest": "a" * 64, "modelParts": json.dumps(model["parts"]), "parts": model["parts"],
                      "anchor": [1, 1], "rgba": [10, 20, 30, 255, 0, 0, 0, 0], "model": model}
            (folder / "input.json").write_text(json.dumps(source))
            return SimpleNamespace(returncode=0)
        return run

    def producer(self, path, reasoning_effort="medium"):
        source = json.loads(path.read_text())
        proposal = {'regions': [{'part': 0, 'face': 0, 'boundary': [[0,0],[2,0],[2,1],[0,1]],
                                'basis': 'observed', 'convention': '', 'reason': 'Synthetic exact seat top'}],
                    'uncertainties': []}
        surface = designlab.seat_surfaces.rasterize(source, proposal)
        (path.parent / "surface.json").write_text(json.dumps(surface))
        (path.parent / "proposal.json").write_text(json.dumps(proposal))

    def test_independent_pipeline_requires_exact_validator_and_all_facings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            draft, _ = self.fixture(root)
            draft["furniture"]["seatModel"]["model"]["surfaces"] = {"se": {"labels": [1]}}
            (root / "surface-review-contract.json").write_text(json.dumps({"key":draft["key"]}))
            commands = []
            def run(command, **kwargs):
                commands.append(command)
                return SimpleNamespace(returncode=0, stdout='{"ok":true}', stderr="")
            with patch.object(designlab.subprocess, "run", side_effect=run), \
                 patch.object(designlab.seat_visual_review,'prepare',return_value=root/'visual-manifest.json') as visual_prepare, \
                 patch.object(designlab.seat_visual_review,'review',return_value=root/'visual-decision.json'), \
                 patch.object(designlab.seat_visual_review,'validate',return_value=[]), \
                 patch.object(designlab.seat_motion_review,'run',return_value={'state':'INVARIANTS_PASSED_VISUAL_PENDING','identity':'motion'}), \
                 patch.object(designlab.seat_independent_review, "propose", side_effect=lambda path, out: out / path.stem) as produce:
                self.assertIn('transition visual review remains pending',designlab.generate_seating_review(root, draft)[0])
                self.assertEqual([call.args[0].stem for call in produce.call_args_list], ["se", "sw", "ne", "nw"])
                self.assertIn("scripts/seat-verify-bundle.ts", commands[-1])
                self.assertEqual(draft["independentSeatReview"]["state"], "EVIDENCE_ACCEPTED")
                self.assertEqual([p.name for p in visual_prepare.call_args.kwargs['body_files']],['seat_independent_review.py'])
            with patch.object(designlab.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="wrong pixel", stderr="")):
                self.assertTrue(designlab.generate_seating_review(root, draft))
                self.assertEqual(draft["independentSeatReview"]["state"], "REVIEW_PENDING")

    def test_generates_physical_views_resolves_four_contracts_and_reuses_exact_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            draft, entry = self.fixture(root)
            with patch.object(designlab, "model_check", return_value=[]) as check, \
                 patch.object(designlab.subprocess, "run", side_effect=self.exporter(draft)), \
                 patch.object(designlab.seat_surfaces, "propose", side_effect=self.producer) as propose:
                self.assertEqual(designlab.generate_seating_surfaces(root, draft, entry, root), [])
                self.assertEqual(propose.call_count, 2)
                self.assertEqual(check.call_count, 2)
                self.assertEqual(set(draft["furniture"]["seatModel"]["model"]["surfaces"]), {"se", "nw"})
                self.assertEqual(draft["seatingSurfaceReview"]["status"], "UNREVIEWED")
                contract = json.loads((root / "surface-review-contract.json").read_text())
                self.assertEqual(set(contract["resolvedViews"]), {"se", "sw", "ne", "nw"})
                self.assertEqual(designlab.generate_seating_surfaces(root, draft, entry, root), [])
                self.assertEqual(propose.call_count, 2, "identical source contracts must not spend again")
                self.assertTrue(designlab.seating_surface_publish_problems(root, draft))
                draft["seatingSurfaceReview"]["status"] = "VERIFIED"
                self.assertTrue(designlab.seating_surface_publish_problems(root, draft), "a status flag is not evidence")

    def test_invalid_cached_alpha_coverage_is_regenerated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            draft, entry = self.fixture(root)
            with patch.object(designlab, "model_check", return_value=[]), \
                 patch.object(designlab.subprocess, "run", side_effect=self.exporter(draft)), \
                 patch.object(designlab.seat_surfaces, "propose", side_effect=self.producer) as propose:
                designlab.generate_seating_surfaces(root, draft, entry, root)
                cached = next((root / "surface-proposals").glob("*/se/surface.json"))
                data = json.loads(cached.read_text()); data["labels"] = [0, 1]; cached.write_text(json.dumps(data))
                # Simulate resuming source identification before maps were attached. An already
                # valid attached/repaired map should not be replaced merely because an old cache is corrupt.
                draft['furniture']['seatModel']['model'].pop('surfaces')
                (root/'surface-review-contract.json').unlink()
                self.assertEqual(designlab.generate_seating_surfaces(root, draft, entry, root), [])
                self.assertEqual(propose.call_count, 3)

    def test_resuming_surface_job_preserves_bound_repaired_maps(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);draft,entry=self.fixture(root)
            with patch.object(designlab,'model_check',return_value=[]),patch.object(designlab.subprocess,'run',side_effect=self.exporter(draft)), \
                 patch.object(designlab.seat_surfaces,'propose',side_effect=self.producer) as provider:
                self.assertEqual(designlab.generate_seating_surfaces(root,draft,entry,root),[])
                model=draft['furniture']['seatModel']['model']
                from seat_surface_repair import apply_review
                source=json.loads(next((root/'surface-proposals').glob('*/se/input.json')).read_text())
                model['surfaces']['se']=apply_review(source,model['surfaces']['se'],
                    {'pixels':[{'x':0,'y':0,'part':0,'face':1,'basis':'observed','convention':'',
                                'reason':'Synthetic explicit revised side face'}],'uncertainties':[]},[0,0,1,1])
                contract_path=root/'surface-review-contract.json';contract=json.loads(contract_path.read_text())
                contract['surfaceDigests']={f:designlab.seat_review_repair.digest(m) for f,m in model['surfaces'].items()}
                contract['repairArtifacts']=[{'identity':'validated-repair'}];contract_path.write_text(json.dumps(contract))
                self.assertEqual(designlab.generate_seating_surfaces(root,draft,entry,root),[])
                self.assertEqual(model['surfaces']['se']['labels'][0],2)
                self.assertEqual(provider.call_count,2)

    def test_cached_new_generation_cannot_drop_or_hide_ownership_uncertainty(self):
        for mode in ['proposal-unknown', 'surface-unknown', 'missing-record', 'proposal-disagreement']:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);draft,entry=self.fixture(root)
                with patch.object(designlab,'model_check',return_value=[]), \
                     patch.object(designlab.subprocess,'run',side_effect=self.exporter(draft)), \
                     patch.object(designlab.seat_surfaces,'propose',side_effect=self.producer) as provider:
                    self.assertEqual(designlab.generate_seating_surfaces(root,draft,entry,root),[])
                    folder=next((root/'surface-proposals').glob('*/se'))
                    file=folder/('proposal.json' if mode.startswith('proposal-') else 'surface.json')
                    record=json.loads(file.read_text())
                    if mode=='proposal-unknown': record['uncertainties']=['Rounded seam has no established owner']
                    elif mode=='proposal-disagreement': record['regions'][0]['reason']='A different valid observation'
                    elif mode=='surface-unknown': record['ownership']['regions'][0]['basis']='unresolved'
                    else: record.pop('ownership')
                    file.write_text(json.dumps(record))
                    draft['furniture']['seatModel']['model'].pop('surfaces')
                    (root/'surface-review-contract.json').unlink()
                    errors=designlab.generate_seating_surfaces(root,draft,entry,root)
                    self.assertTrue(errors)
                    self.assertIn('ownership',' '.join(errors).lower())
                    self.assertEqual(provider.call_count,2,'Unresolved cached evidence must block, not spend to reinterpret it')
                    self.assertNotIn('surfaces',draft['furniture']['seatModel']['model'])

    def test_publish_consumes_the_full_validator_and_rejects_relabeling_before_calling_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            draft, entry = self.fixture(root)
            with patch.object(designlab, "model_check", return_value=[]), \
                 patch.object(designlab.subprocess, "run", side_effect=self.exporter(draft)), \
                 patch.object(designlab.seat_surfaces, "propose", side_effect=self.producer):
                self.assertEqual(designlab.generate_seating_surfaces(root, draft, entry, root), [])
            (root / "seat-verification.bundle.json").write_text("{}")
            (root/'visual-review').mkdir()
            (root/'visual-review/manifest.json').write_text(json.dumps({
                'bundle':{'sha256':hashlib.sha256((root/'seat-verification.bundle.json').read_bytes()).hexdigest()},
                'contract':{'sha256':hashlib.sha256((root/'surface-review-contract.json').read_bytes()).hexdigest()}}))
            (root/'motion-visual-review').mkdir()
            (root/'motion-visual-review/manifest.json').write_text((root/'visual-review/manifest.json').read_text())
            with patch.object(designlab.seat_visual_review,'validate',return_value=[]), \
                 patch.object(designlab.seat_motion_visual,'validate',return_value=[]), \
                 patch.object(designlab.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout='{"ok":true,"problems":[]}')) as verify:
                self.assertEqual(designlab.seating_surface_publish_problems(root, draft), [])
                self.assertIn("scripts/seat-verify-bundle.ts", verify.call_args.args[0])
                command=verify.call_args.args[0]
                self.assertIn("--model",command)
                current=json.loads(Path(command[command.index("--model")+1]).read_text())
                self.assertEqual(current,draft["furniture"]["seatModel"]["model"])
                draft["furniture"]["seatModel"]["model"]["surfaces"]["se"]["labels"][0] = 2
                self.assertIn("stale", designlab.seating_surface_publish_problems(root, draft)[0])
                self.assertEqual(verify.call_count, 1)
            draft["furniture"]["seatModel"]["model"]["surfaces"]["se"]["labels"][0] = 1
            with patch.object(designlab.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout='{"ok":false,"problems":["missing required capture"]}')):
                self.assertIn("missing required capture", designlab.seating_surface_publish_problems(root, draft)[0])

    def test_stale_mechanical_edit_fails_without_dropping_existing_maps_or_calling_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            draft, entry = self.fixture(root)
            draft["furniture"]["seatModel"]["model"]["surfaces"] = {"nw": {"old": "binding"}}
            with patch.object(designlab, "model_check", return_value=["stale parts"]), \
                 patch.object(designlab.seat_surfaces, "propose") as propose:
                self.assertTrue(designlab.generate_seating_surfaces(root, draft, entry, root))
                propose.assert_not_called()
                self.assertEqual(draft["furniture"]["seatModel"]["model"]["surfaces"], {"nw": {"old": "binding"}})
                self.assertEqual(draft["seatingSurfaceReview"]["status"], "FAILED")

    def test_full_single_image_and_asymmetric_models_need_all_resolved_views(self):
        with tempfile.TemporaryDirectory() as tmp:
            draft, entry = self.fixture(Path(tmp))
            model = draft["furniture"]["seatModel"]["model"]
            self.assertEqual(designlab.surface_source_views(entry, model), ["nw", "se"])
            self.assertEqual(len(designlab.surface_source_views({"file": "radial.png"}, model)), 4)
            model["parts"][0]["u"] = [0, .9]
            self.assertEqual(len(designlab.surface_source_views(entry, model)), 4)

    def test_only_a_successful_beauty_take_invalidates_and_archives_previous_surfaces(self):
        class Finished(Exception):
            pass
        for failed in [True, False]:
            with self.subTest(failed=failed), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                draft, entry = self.fixture(root)
                draft["furniture"].update(rotation="mirror", footprint=[1, 1])
                old = json.loads(json.dumps(draft["furniture"]["seatModel"]))
                result = {"error": "beauty failed"} if failed else {"views": {
                    facing: {"file": str(root / f"new-{facing}.png"), "anchor": [1, 1]} for facing in ["se", "nw"]}}

                def identify(*_args):
                    self.assertIsNone(draft["furniture"]["seatModel"])
                    self.assertEqual(json.loads((root / "takes" / "1" / "previous-seat-model.json").read_text()), old)
                    return []

                with patch.object(designlab, "draft_dir", return_value=root), patch.object(designlab, "load", return_value=draft), \
                     patch.object(designlab, "ref_pngs", return_value=[]), patch.object(designlab, "draw_spec", return_value={}), \
                     patch.object(designlab, "usage_rows", return_value=0), patch.object(designlab, "spent_on", return_value=0), \
                     patch.object(designlab, "studio_json", return_value=(0, result)), \
                     patch.object(designlab, "stage", return_value=(entry, root)), \
                     patch.object(designlab, "generate_seating_surfaces", side_effect=identify) as generate, \
                     patch.object(designlab, "out", side_effect=Finished):
                    with self.assertRaises(Finished):
                        designlab.cmd_furniture_generate(SimpleNamespace(draft="unused", view=None, note=None, quality=None))
                    if failed:
                        self.assertEqual(draft["furniture"]["seatModel"], old)
                        generate.assert_not_called()
                    else:
                        generate.assert_called_once()


if __name__ == "__main__":
    unittest.main()
