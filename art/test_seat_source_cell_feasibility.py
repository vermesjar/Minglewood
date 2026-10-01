import unittest
import numpy as np
from seat_source_cell_feasibility import solve_rectangle,prepare
from seat_rounded_diagnostic import project


class CellTests(unittest.TestCase):
    def test_height_elimination_rejects_disjoint_slabs(self):
        self.assertIsNone(solve_rectangle([0,1,0,1],[(0,1,0,0),(2,3,0,0)]))
        point=solve_rectangle([0,1,0,1],[(0,1,0,0),(.5,1.5,1,0)])
        self.assertIsNotNone(point)
        self.assertLess(point['hInterval'][0],point['hInterval'][1])

    def test_tangent_only_does_not_make_covered_pixel(self):
        self.assertIsNone(solve_rectangle([0,1,0,1],[(0,1,0,0),(1,2,0,0)]))

    def test_affine_world_projection_matches_original_camera(self):
        arts={f:{'anchor':[32,29],'width':1,'height':1,'rgba':[0,0,0,255]} for f in ['se','sw','ne','nw']};specs,_=prepare(arts)
        for f,(xo,sg,axis,yo,a,b) in specs.items():
            for u,v,z in [(0.,0.,0.),(.63,.615,10.15),(1.74,.11,3.)]:
                s=32*(u+v);t=32*(u-v);h=-2*z
                expected=project([32,29],[2,1],f,u,v,z)
                np.testing.assert_allclose([xo+sg*[s,t][axis],yo+a*s+b*t+h],expected,atol=1e-10)


if __name__=='__main__':unittest.main()
