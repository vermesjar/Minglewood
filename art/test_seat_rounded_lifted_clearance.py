import math
import unittest
from seat_rounded_lifted_clearance import segment_gap
from seat_rounded_diagnostic import ray,TILE


class LiftedClearanceTests(unittest.TestCase):
    def test_point_capsule_gap_interior_and_endpoint(self):
        self.assertAlmostEqual(segment_gap([1,0,5],[0,0,0],[0,0,10],2),-1)
        self.assertAlmostEqual(segment_gap([0,0,13],[0,0,0],[0,0,10],2),1)

    def test_source_normal_warp_lifts_front_forward_even_with_unchanged_height(self):
        A=6.;n=[1/math.sqrt(5),2/math.sqrt(5)];p=[70.,45.];q=[v-A*d for v,d in zip(p,n)]
        origin,d=ray([64,29],[2,1],'se',*p);mapped,dm=ray([64,29],[2,1],'se',*q)
        displayed=[o+v*5 for o,v in zip(origin,d)];physical=[o+v*5 for o,v in zip(mapped,dm)]
        self.assertAlmostEqual((displayed[1]-physical[1])/TILE,-math.sqrt(5)*A/64)
        self.assertEqual(displayed[2],physical[2])


if __name__=='__main__':unittest.main()
