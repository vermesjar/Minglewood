import copy
import unittest
from unittest.mock import patch
import numpy as np
from seat_curved_authoring import Profile, intersect, serializable
from seat_authored_review import review, drawing_print


class AuthoredReviewTests(unittest.TestCase):
    def fixture(self):
        p=Profile();w,h=72,68
        view={'facing':'ne','width':w,'height':h,'anchor':[36,20]}
        z=intersect(p,view,.1);rgba=np.zeros((h,w,4),dtype=np.uint8);rgba[np.isfinite(z)]=[90,80,40,255]
        art={**view,'rgba':rgba.ravel().tolist()};y,x=np.indices((h,w))
        data={'facing':'ne','sourceArt':art,'contexts':[{'context':{'modelSource':'source','figureContext':{'feet':[0,0]}},
              'figure':{'w':w,'h':h,'ax':0,'ay':0,'rgba':rgba.ravel().tolist()}}]}
        surface={'version':2,'width':w,'height':h,'drawing':drawing_print(art),'authored':{
            'kind':'rolled-rim','anchor':view['anchor'],'profile':serializable(p),
            'correspondence':np.stack([x,y],axis=-1).reshape(-1,2).tolist(),'z':[999]*(w*h)}}
        body={'frontZ':np.full((h,w),10.),'methods':np.full((h,w),'fixture')}
        return data,surface,body

    def test_reference_ignores_tested_depth_and_winners(self):
        data,surface,body=self.fixture()
        with patch('seat_authored_review.body_depths',return_value=body):
            a=review(data,surface)
            surface['authored']['z']=[-999]*len(surface['authored']['z'])
            data['mask']=[1]*len(surface['authored']['z'])
            b=review(data,surface)
        self.assertEqual(a[0]['points'],b[0]['points'])
        self.assertEqual({p['winner'] for p in a[0]['points']},{'avatar','furniture'})
        self.assertEqual(a[0]['coverage']['uncertain'],0)

    def test_unknown_original_body_stays_uncertain(self):
        data,surface,body=self.fixture();body['frontZ'][:]=np.nan
        with patch('seat_authored_review.body_depths',return_value=body):result=review(data,surface)
        self.assertGreater(result[0]['coverage']['uncertain'],0)
        self.assertTrue(all(p['winner']=='uncertain' for p in result[0]['points']))

    def test_stale_beauty_anchor_or_fold_rejected(self):
        data,surface,_=self.fixture()
        for mutation in ['beauty','anchor','fold']:
            bad=copy.deepcopy(surface)
            if mutation=='beauty':bad['drawing']='00000000'
            elif mutation=='anchor':bad['authored']['anchor'][0]+=1
            else:bad['authored']['correspondence']=[[71-x,y] for x,y in bad['authored']['correspondence']]
            with self.assertRaises(ValueError):review(data,bad)


if __name__=='__main__':unittest.main()
