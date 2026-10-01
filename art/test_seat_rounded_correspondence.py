import unittest
import numpy as np
from seat_rounded_correspondence_diagnostic import warp,count_topology
from seat_rounded_diagnostic import project,FACINGS


class CorrespondenceTests(unittest.TestCase):
    def test_all_contacts_pinned_and_normal_coordinate_strictly_ordered(self):
        contacts=[[.63,.615,10.15],[1.37,.615,10.15]];anchor=[64,29]
        for face in FACINGS:
            points=np.array([project(anchor,[2,1],face,*s) for s in contacts])-.5
            np.testing.assert_allclose(warp(points,anchor,[2,1],face,contacts,7,16),points,atol=1e-10)
            normal=np.array([1 if face in ['se','nw'] else -1,2])/np.sqrt(5)
            samples=points[0]+np.linspace(-50,50,1001)[:,None]*normal
            mapped=warp(samples,anchor,[2,1],face,contacts,7,16)
            self.assertTrue(np.all(np.diff(mapped@normal)>0))
            self.assertLessEqual(np.max(np.linalg.norm(mapped-samples,axis=1)),7+1e-10)

    def test_rejects_fold_or_excess_displacement_and_counts_holes(self):
        for amplitude,span in [(7,5),(8,20)]:
            with self.assertRaises(ValueError):warp(np.zeros((1,2)),[0,0],[1,1],'se',[[.5,.5,10]],amplitude,span)
        mask=np.zeros((9,9),dtype=bool);mask[1:5,1:5]=True;mask[2:4,2:4]=False;mask[7,7]=True
        self.assertEqual(count_topology(mask),{'components':2,'holes':1})


if __name__=='__main__':unittest.main()
