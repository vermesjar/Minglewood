import copy
import unittest
from seat_rounded_linked_front_diagnostic import safe_geometry


class LinkedFrontTests(unittest.TestCase):
    def fixture(self):
        model={'size':[2,1],'sits':[[.63,.615,10.15],[1.37,.615,10.15]],'parts':[
            {'part':'base','u':[.32,1.68],'v':[-.04,1.08],'z':[2.5,3.]},
            {'part':'seat','u':[.29,1.71],'v':[-.04,.71],'z':[3.,10.15]}]}
        anatomy={'nearLeg':{'knee':[69.92,29.96],'kneeHeight':12.15,'ankle':[71.52,47.76],'ankleHeight':3.65},
                 'farLeg':{'knee':[77.92,28.96],'kneeHeight':12.15,'ankle':[79.52,46.76],'ankleHeight':3.65}}
        views={'se':{'sourceArt':{'anchor':[64,29]},'contexts':[{'id':'fixture','anatomy':anatomy}]}}
        return model,views

    def test_clearance_moves_linked_fronts_together_preserves_source_and_contacts(self):
        model,views=self.fixture();before=copy.deepcopy(model)
        result,receipt=safe_geometry(model,views)
        self.assertEqual(model,before);self.assertEqual(result['sits'],model['sits'])
        self.assertEqual(result['parts'][0]['v'][0],result['parts'][1]['v'][0])
        self.assertGreater(result['parts'][0]['v'][0],.18)
        self.assertEqual(receipt['remainingCollisions'],[]);self.assertGreater(receipt['minimumSignedGap'],0)

    def test_unlinked_obstruction_is_not_hidden_by_relabeling(self):
        model,views=self.fixture();model['parts'].append({'part':'leg','u':[.5,.8],'v':[0,.2],'z':[2,8]})
        with self.assertRaisesRegex(ValueError,'Unlinked solid collision'):safe_geometry(model,views)


if __name__=='__main__':unittest.main()
