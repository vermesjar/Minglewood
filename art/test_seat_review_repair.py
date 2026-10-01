import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import seat_review_repair as repair

class RepairTests(unittest.TestCase):
    def fixture(self,root,winner='avatar'):
        model={'compiler':{'source':'original'},'surfaces':{'nw':{'labels':[1,1]}}}
        record={'facing':'ne','cushion':0,'pose':'sit','look':{},'model':model,'feet':[0,0],'legs':{},'height':10,
            'figure':{'w':2,'h':1,'ax':0,'ay':0,'rgba':[1,2,3,255]*2,'actual':[0]*8,'owner':[20,20]},
            'art':{'w':2,'h':1,'rgba':[4,5,6,255]*2}}
        ctx={'key':'seat','facing':'ne','cushion':0,'pose':'sit','look':{},'modelSource':'original','figureContext':repair.figure_context(record)}
        review={'context':ctx,'points':[{'x':0,'y':0,'winner':winner},{'x':1,'y':0,'winner':'uncertain'}]}
        capture=root/'capture.json';capture.write_text(json.dumps([record]));expected=root/'expected.json';expected.write_text(json.dumps(review))
        return model,record,review,capture,expected

    def test_confident_mismatch_maps_to_physical_mirror_without_sending_winner(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);model,r,e,capture,expected=self.fixture(root)
            plan=repair.repair_pixels(capture,[expected],'seat',model)
            self.assertEqual(plan,{'conflicts':1,'uncertain':1,'groups':{'nw':[[1,0]]}})
            self.assertNotIn('winner',json.dumps(plan))

    def test_uncertainty_only_never_requests_repair_and_stale_anatomy_rejects(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);model,r,e,capture,expected=self.fixture(root,'uncertain')
            self.assertFalse(repair.repair_pixels(capture,[expected],'seat',model)['groups'])
            r['feet'][0]=1;capture.write_text(json.dumps([r]))
            with self.assertRaisesRegex(ValueError,'stale review'):repair.repair_pixels(capture,[expected],'seat',model)

    def test_missing_domain_and_placement_concerns_cannot_be_surface_repaired(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);model,r,e,capture,expected=self.fixture(root)
            e['placementProblems']=['hip unsupported'];expected.write_text(json.dumps(e))
            with self.assertRaisesRegex(ValueError,'placement'):repair.repair_pixels(capture,[expected],'seat',model)
            del e['placementProblems'];e['points'].pop();expected.write_text(json.dumps(e))
            with self.assertRaisesRegex(ValueError,'missing'):repair.repair_pixels(capture,[expected],'seat',model)

    def test_changed_current_labels_require_a_fresh_capture_before_repair(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);model,r,e,capture,expected=self.fixture(root)
            model['surfaces']['nw']['labels'][0]=2
            with self.assertRaisesRegex(ValueError,'current exact model'):repair.repair_pixels(capture,[expected],'seat',model)

    def test_repair_receives_only_coordinates_and_all_source_context_and_preserves_reviews(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);model,r,e,capture,expected=self.fixture(root);before=expected.read_bytes()
            for facing in ['se','sw','ne','nw']:
                folder=root/'stage'/'surface-inputs'/facing;folder.mkdir(parents=True)
                (folder/'input.json').write_text(json.dumps({'key':'seat','facing':facing,'rgba':[1,2,3,255]*2,'anchor':[1,1]}))
            draft={'key':'seat','furniture':{'seatModel':{'model':model}}}
            def provider(primary,original,bounds,out,**kwargs):
                self.assertEqual(kwargs['pixels'],[[1,0]])
                self.assertEqual(len(kwargs['context_inputs']),3)
                self.assertEqual(bounds,[1,0,2,1])
                (out/'proposal.json').write_text(json.dumps({'uncertainties':['keep pending']}))
                return {'labels':[1,2]}
            with patch.object(repair.seat_surface_repair,'repair',side_effect=provider) as call:
                result=repair.repair_round(root,draft,capture,[expected])
                self.assertTrue(result['changed']);self.assertEqual(call.call_count,1)
                self.assertEqual(result['uncertainties'],['keep pending'])
            self.assertEqual(expected.read_bytes(),before)
            self.assertEqual(model['surfaces']['nw']['labels'],[1,1], 'caller must explicitly validate and attach atomically')

if __name__=='__main__':unittest.main()
