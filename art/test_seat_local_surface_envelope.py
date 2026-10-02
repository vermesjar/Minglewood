import unittest
import numpy as np
from seat_local_surface_envelope import capsule_interval,subtract


class LocalEnvelopeTests(unittest.TestCase):
    def test_cylinder_endcaps_and_tangent(self):
        A=[0,0,0];B=[0,0,2]
        self.assertEqual(capsule_interval([-3,0,1],[1,0,0],A,B,1),(2,4))
        self.assertEqual(capsule_interval([0,0,-3],[0,0,1],A,B,1),(2,6))
        self.assertEqual(capsule_interval([-3,1,1],[1,0,0],A,B,1),(3,3))
        self.assertIsNone(capsule_interval([-3,2,1],[1,0,0],A,B,1))

    def test_arbitrary_axis_roots_against_independent_point_distance(self):
        rng=np.random.default_rng(28)
        for _ in range(100):
            A=rng.normal(size=3);B=A+rng.normal(size=3);d=rng.normal(size=3);o=(A+B)/2
            interval=capsule_interval(o,d,A,B,.7)
            self.assertIsNotNone(interval)
            def distance(t):
                p=o+t*d;v=B-A;s=max(0,min(1,float((p-A)@v/(v@v))))
                return np.linalg.norm(p-A-s*v)
            for t in interval:self.assertAlmostEqual(distance(t),.7,places=9)
            self.assertLess(distance(sum(interval)/2),.7)

    def test_subtraction_preserves_disconnected_possibilities(self):
        self.assertEqual(subtract([(0,10)],[(2,4),(6,8)]),[(0,2),(4,6),(8,10)])
        self.assertEqual(subtract([(0,1)], [(-1,2)]),[])


if __name__=='__main__':unittest.main()
