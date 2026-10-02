import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import seat_visual_review as visual


class VisualReviewTests(unittest.TestCase):
    def fixture(self, root):
        def save(name, value):
            path=root/name;path.write_text(json.dumps(value));return {'path':name,'sha256':visual.sha(path)}
        contract=save('contract.json',{'key':'testseat','sits':[[.5,.5,10]],'mechanicsDigest':'a'*64,'surfaceDigests':{'se':'b'*64}})
        rgba=[100,100,100,255]*9;records=[];expectations=[];anatomy=[]
        for facing in ['se','sw','ne','nw']:
            for look in range(4):
                context={'key':'testseat','facing':facing,'cushion':0,'look':{'test':look}}
                anatomy.append({'context':context,'anatomy':{'hipContact':[1,1]}})
                points=[{'x':x,'y':y,'winner':'furniture' if (x,y)==(1,1) else 'avatar'} for y in range(3) for x in range(3)]
                expectations.append(save(f'{facing}-{look}-review.json',{'context':context,'points':points,'uncertainties':[]}))
                records.append({'facing':facing,'reviewLook':look,'cushion':0,'look':context['look'],'feet':[0,0],
                    'art':{'w':3,'h':3,'rgba':rgba},'figure':{'w':3,'h':3,'ax':0,'ay':0,'rgba':rgba},
                    'finalCanvas':{'rect':{'width':3,'height':3},'actual':rgba}})
        capture=save('capture.json',records);capture['receipt']=save('receipt.json',{'unchanged':True})
        save('bundle.json',{'version':1,'contract':contract,'captures':[capture],'expectations':expectations,'rendererSources':{'body':'hash'}})
        (root/'body.py').write_text('# independent body reference')
        save('original-anatomy.json',{'contexts':anatomy})
        return visual.prepare(root/'bundle.json',root/'contract.json',root/'visual-review',[root/'body.py'],[root/'original-anatomy.json'])

    def provider(self, manifest):
        def response(payload):
            self.assertIn('Numerical agreement is not quality approval',payload['input'][0]['content'][0]['text'])
            contexts=[{'id':c['id'],'verdict':'pass','reason':'Mock whole-image judgment','issues':[],'uncertainties':[],
                       'risks':[{'id':r['id'],'verdict':'acceptable','reason':'Mock independent adjudication'} for r in c['risks']]} for c in manifest['contexts']]
            return {'status':'completed','metadata':payload['metadata'],'output':[{'content':[{'type':'output_text','text':json.dumps({'contexts':contexts})}]}]}
        return response

    def test_topology_is_question_not_automatic_verdict(self):
        original={(x,y) for y in range(3) for x in range(3)}
        risks=visual.topology_risks(original,original-{(1,1)})
        self.assertEqual(risks[0]['kind'],'enclosed-furniture-pixels')
        self.assertNotIn('verdict',risks[0])
        open_gap=visual.topology_risks(original,original-{(1,0),(1,1)})
        self.assertFalse(any(r['kind']=='enclosed-furniture-pixels' for r in open_gap))
        fragments=visual.topology_risks(original,original-{(1,0),(1,1),(1,2)})
        self.assertTrue(any(r['kind']=='new-disconnected-body-fragment' for r in fragments))

    def test_full_bound_mocked_review_and_stale_body_rejection(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);manifest=self.fixture(root);m=json.loads(manifest.read_text())
            self.assertEqual(len(m['contexts']),16)
            self.assertTrue(all(c['risks'] for c in m['contexts']))
            decision=visual.review(manifest,manifest.parent,provider=self.provider(m))
            self.assertEqual(visual.validate(manifest,decision),[])
            (root/'body.py').write_text('# changed reference')
            self.assertIn('Evidence changed',' '.join(visual.validate(manifest,decision)))

    def test_numerical_evidence_cannot_approve_without_visual_provider(self):
        with tempfile.TemporaryDirectory() as temp:
            manifest=self.fixture(Path(temp))
            with self.assertRaisesRegex(RuntimeError,'paid review is disabled'):visual.review(manifest,manifest.parent)
            self.assertFalse((manifest.parent/'decision.json').exists())

    def test_omitted_context_unresolved_risk_and_edited_decision_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            manifest=self.fixture(Path(temp));m=json.loads(manifest.read_text());decision=visual.review(manifest,manifest.parent,provider=self.provider(m));original=json.loads(decision.read_text())
            for mode in ['context','risk','scope']:
                d=json.loads(json.dumps(original))
                if mode=='context':d['contexts'].pop()
                elif mode=='risk':d['contexts'][0]['risks'][0]['verdict']='unresolved'
                else:d['scope']='Numerical parity only'
                decision.write_text(json.dumps(d));self.assertTrue(visual.validate(manifest,decision))

    def test_old_provider_response_cannot_be_rebound(self):
        with tempfile.TemporaryDirectory() as temp:
            manifest=self.fixture(Path(temp));m=json.loads(manifest.read_text())
            decision=visual.review(manifest,manifest.parent,provider=self.provider(m));d=json.loads(decision.read_text())
            response=visual.checked(d['provenance']['response'],decision.parent)
            raw=json.loads(response.read_text());raw['metadata']['seat_visual_manifest']='0'*64;response.write_text(json.dumps(raw))
            d['provenance']['response']=visual.proof(response,decision.parent);decision.write_text(json.dumps(d))
            self.assertIn('another manifest',' '.join(visual.validate(manifest,decision)))

    def test_complete_image_budget_is_reserved_before_any_paid_request(self):
        with tempfile.TemporaryDirectory() as temp:
            manifest=self.fixture(Path(temp))
            with patch('studio.spent',return_value=0),patch('studio.cap',return_value=2),patch('studio.post') as post:
                with self.assertRaisesRegex(RuntimeError,'complete evidence'):visual.review(manifest,manifest.parent,allow_paid=True)
                post.assert_not_called()

    def test_prepare_rejects_missing_actual_context(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.fixture(root);rows=json.loads((root/'capture.json').read_text());rows.pop();(root/'capture.json').write_text(json.dumps(rows))
            bundle=json.loads((root/'bundle.json').read_text());bundle['captures'][0]['sha256']=visual.sha(root/'capture.json');(root/'bundle.json').write_text(json.dumps(bundle))
            with self.assertRaisesRegex(ValueError,'every exact'):visual.prepare(root/'bundle.json',root/'contract.json',root/'new-visual',[root/'body.py'])


if __name__=='__main__':unittest.main()
