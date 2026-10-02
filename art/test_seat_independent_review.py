import unittest
import tempfile
import json
from pathlib import Path
from unittest.mock import patch
import seat_independent_review as review

class IndependentReviewTests(unittest.TestCase):
    def data(self):
        return {'sourceArt':{'width':2,'height':1,'rgba':[1,2,3,255]*2},'contexts':[{
            'id':'se-0-0','case':'chair/se/0','context':{'figureContext':{'feet':[0,0]}},
            'figure':{'w':2,'h':1,'ax':0,'ay':0,'rgba':[4,5,6,255]*2}}]}
    def proposal(self,winner='avatar'):
        return {'contexts':[{'id':'se-0-0','regions':[{'winner':winner,'sourceRole':'support','boundary':[[0,0],[1,0],[1,1],[0,1]],'reason':'support'}],
                             'uncertainties':[],'placementProblems':[]}]}
    def test_bounded_paid_retry_and_reuse_never_relies_on_runtime_winners(self):
        data=self.data();data.update(key='seat',facing='se')
        proposal=self.proposal();proposal['contexts'][0]['regions'][0]['boundary']=[[0,0],[2,0],[2,1],[0,1]]
        response={'status':'completed','output':[{'content':[{'type':'output_text','text':json.dumps(proposal)}]}]}
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'input.json';path.write_text(json.dumps(data))
            with patch.object(review,'content',return_value=[]), patch.object(review.studio,'spent',return_value=0), \
                 patch.object(review.studio,'cap',return_value=10), patch.object(review.studio,'log'), \
                 patch.object(review.studio,'post',return_value=response) as post:
                first=review.propose(path,Path(tmp)/'out')
                self.assertEqual(first,review.propose(path,Path(tmp)/'out'))
                self.assertEqual(post.call_count,1)
                self.assertEqual(json.loads(next(first.glob('*.json')).read_text())['coverage']['uncertain'],0)

    def test_prompt_omits_runtime_answers_and_model_labels(self):
        data=self.data();data.update(key='seat',facing='se',ownerNames={'1':'pelvis'})
        c=data['contexts'][0];c['figure']['owner']=[1,1]
        c['context']['modelSource']='SECRET_MODEL_SOURCE'
        c['figure']['actual']=['SECRET_MASKED_FIGURE']
        data['surfaceLabels']='SECRET_SURFACE_LABELS'
        data['finalCanvas']='SECRET_CANVAS'
        serialized=json.dumps(review.content(data))
        self.assertNotIn('SECRET_',serialized)
        self.assertIn('opaqueOverlap',serialized)

    def test_pixel_override_is_exact_and_cannot_invent_overlap(self):
        proposal=self.proposal();proposal['contexts'][0]['pixels']=[{'x':1,'y':0,'winner':'furniture','sourceRole':'near-arm','reason':'foreground edge'}]
        result=review.rasterize(self.data(),proposal,{})[0]
        self.assertEqual([p['winner'] for p in result['points']],['avatar','furniture'])
        proposal['contexts'][0]['pixels'][0]['x']=2
        with self.assertRaises(ValueError):review.rasterize(self.data(),proposal,{})

    def test_source_topology_prompt_keeps_all_other_whole_object_views(self):
        data=self.data();data.update(key='seat',facing='ne',ownerNames={'1':'pelvis'})
        data['contexts'][0]['figure']['owner']=[1,1]
        data['sourceViews']={f:data['sourceArt'] for f in ['ne','nw','se','sw']}
        items=review.content(data)
        labels=[item.get('text','') for item in items if item.get('text','').startswith('Same furniture, bare source view')]
        self.assertEqual(labels,['Same furniture, bare source view nw','Same furniture, bare source view se','Same furniture, bare source view sw'])

    def test_intentional_shared_outline_is_explicit_and_does_not_approve_uncertain_anatomy(self):
        proposal=self.proposal();row=proposal['contexts'][0]
        row['pixels']=[{'x':0,'y':0,'winner':'uncertain','sourceRole':'back','reason':'shared outline intent; body depth unresolved'}]
        row['intentionalBoundaryPixels']=[[0,0]]
        result=review.rasterize(self.data(),proposal,{})[0]
        self.assertEqual(result['points'][0]['winner'],'uncertain')
        self.assertEqual(result['points'][0]['source'],'intentional-boundary-convention')
        self.assertEqual(result['provenance']['intentionalBoundaryConvention']['pixels'],[[0,0]])
        row['pixels'][0]['sourceRole']='far-arm'
        with self.assertRaises(ValueError):review.rasterize(self.data(),proposal,{})
        row['pixels'][0]['sourceRole']='back';row['intentionalBoundaryPixels']=[[1,0]]
        with self.assertRaises(ValueError):review.rasterize(self.data(),proposal,{})

    def test_body_ray_hints_ignore_furniture_labels_and_masks(self):
        data=self.data();data['sourceArt']['anchor']=[0,0]
        leg={'hip':[0,0],'knee':[4,0],'ankle':[4,8],'hipHeight':5,'kneeHeight':5,'ankleHeight':1}
        context=data['contexts'][0];context['anatomy']={'nearLeg':leg,'farLeg':leg}
        before=review.anatomy_hints(data,context)
        self.assertTrue(before)
        data['depth']={'z':[-999]*2};context['figure']['mask']=[1,1]
        self.assertEqual(before,review.anatomy_hints(data,context))
        self.assertTrue(all(hit['frontZ']>=hit['rearZ'] for hits in before.values() for hit in hits))

    def test_uncertain_surface_cannot_produce_confident_winner(self):
        p=self.proposal();p['contexts'][0]['regions'][0]['sourceRole']='uncertain'
        r=review.rasterize(self.data(),p,{})[0]
        self.assertEqual(r['coverage']['uncertain'],2)

    def test_focused_review_sends_coordinates_without_prior_winners(self):
        data=self.data();prior=review.rasterize(data,self.proposal(),{})
        refined=review.refinement_input(data,prior)
        self.assertEqual(set(map(tuple,refined['contexts'][0]['reviewPixels'])),{(0,0),(1,0)})
        self.assertNotIn('winner',json.dumps(refined))
        with self.assertRaises(ValueError):review.rasterize(refined,self.proposal(),{})
        p=self.proposal();p['contexts'][0]['regions']=[]
        p['contexts'][0]['pixels']=[{'x':x,'y':0,'winner':'avatar','sourceRole':'support','reason':'pelvis above support'} for x in [0,1]]
        self.assertEqual(review.rasterize(refined,p,{})[0]['coverage']['uncertain'],0)

    def test_empty_overlap_needs_no_paid_oracle(self):
        data=self.data();data.update(key='seat',facing='se');data['sourceArt']['rgba']=[0]*8
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'input.json';path.write_text(json.dumps(data))
            with patch.object(review.studio,'post') as post:
                folder=review.propose(path,Path(tmp)/'out')
                self.assertFalse(post.called)
                self.assertEqual(json.loads(next(folder.glob('*.json')).read_text())['points'],[])

    def test_uncovered_never_guessed(self):
        r=review.rasterize(self.data(),self.proposal(),{})[0]
        self.assertEqual([p['winner'] for p in r['points']],['avatar','uncertain'])
        self.assertEqual(r['coverage']['uncertain'],1)
    def test_duplicate_or_missing_context_rejected(self):
        p=self.proposal();p['contexts']*=2
        with self.assertRaises(ValueError):review.rasterize(self.data(),p,{})
        with self.assertRaises(ValueError):review.rasterize(self.data(),{'contexts':[]},{})
    def test_bad_placement_blocks_even_full_labels(self):
        p=self.proposal();p['contexts'][0]['placementProblems']=['Floating pelvis']
        self.assertIn('Floating pelvis',review.rasterize(self.data(),p,{})[0]['uncertainties'])
    def test_domain_uses_unmasked_pixels_and_alpha(self):
        d=self.data();d['contexts'][0]['figure']['actual']=[0]*8;d['sourceArt']['rgba'][7]=0
        self.assertEqual(review.domain(d,d['contexts'][0]),[(0,0)])

if __name__=='__main__':unittest.main()
