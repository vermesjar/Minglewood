import unittest
import numpy as np
from seat_correspondence import audit_correspondence


class CorrespondenceTests(unittest.TestCase):
    def test_identity_preserves_contact_and_orientation(self):
        y,x=np.indices((12,12));r=audit_correspondence(x,y,np.ones(x.shape,bool),(5.3,4.7))
        self.assertEqual(r['problems'],[]);self.assertEqual(r['maxDisplacement'],0)
        self.assertAlmostEqual(r['minJacobian'],1);self.assertLess(r['discreteContactError'],1e-12)

    def test_fold_and_hidden_shear_rejected(self):
        y,x=np.indices((12,12));mask=np.ones(x.shape,bool)
        self.assertTrue(audit_correspondence(11-x,y,mask,(5.5,5.5))['problems'])
        report=audit_correspondence(x+4*(y-5.5),y,mask,(5.5,5.5))
        self.assertAlmostEqual(report['minJacobian'],1)
        self.assertIn('Correspondence stretch exceeds threefold',report['problems'])

    def test_contact_cannot_be_claimed_without_measurement(self):
        y,x=np.indices((12,12));r=audit_correspondence(x+.2,y,np.ones(x.shape,bool),(5.3,4.7))
        self.assertIn('Discrete contact drift exceeds .05 source pixel',r['problems'])

    def test_invalid_neighbor_cannot_hide_outside_alpha(self):
        y,x=np.indices((12,12),dtype=float);mask=np.zeros(x.shape,bool);mask[5:7,5:7]=True;x[0,0]=float('nan')
        with self.assertRaises(ValueError):audit_correspondence(x,y,mask,(5.3,4.7))


if __name__=='__main__':unittest.main()
