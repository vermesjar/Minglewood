import unittest
import numpy as np
from seat_foot_geometry_experiment import feet,PARAMS
from seat_cushion_shell_reference import ray_depth
from seat_rounded_diagnostic import TILE


class FootTests(unittest.TestCase):
    def test_tapered_foot_top_and_enclosing_box(self):
        p={k:v[0] for k,v in PARAMS.items()};v,t,boxes=feet(p)
        z=ray_depth(v,t,np.array([[(p['inset']+p['width']/2)*TILE,(p['front']+p['depth']/2)*TILE,-1.]]),np.array([[0.,0,1]]))
        self.assertAlmostEqual(z[0],p['height']+1)
        for i,box in enumerate(boxes):
            points=v[i*8:(i+1)*8];b=np.array(box['bounds']);self.assertTrue(np.all(points>=b[:,0]));self.assertTrue(np.all(points<=b[:,1]))


if __name__=='__main__':unittest.main()
