import unittest
import numpy as np
from seat_apron_shell_experiment import apron
from seat_cushion_shell_experiment import projected_depth
from seat_cushion_shell_reference import ray_depth
from seat_rounded_diagnostic import ray,TILE


class ApronTests(unittest.TestCase):
    def test_join_covers_frozen_cushion_underside(self):
        v,t,p=apron(.5,.04,rear=.75)
        self.assertEqual(p[0,1],3);self.assertAlmostEqual(p[0,0]/TILE,.26)
        self.assertGreaterEqual(p[1,0]/TILE,.71)
        edges={}
        for a,b,c in t:
            for x,y in [(a,b),(b,c),(c,a)]:edges[tuple(sorted((x,y)))]=edges.get(tuple(sorted((x,y))),0)+1
        self.assertTrue(all(n==2 for n in edges.values()))

    def test_slope_world_reference_all_facings(self):
        v,t,p=apron(.5,.04,rear=.75);art={'width':96,'height':77,'anchor':[48,29]}
        for f in ['se','sw','ne','nw']:
            q=[ray(art['anchor'],[2,1],f,x+.5,y+.5) for y in range(77) for x in range(96)]
            a=ray_depth(v,t,np.array([r[0] for r in q]),np.array([r[1] for r in q]));b=projected_depth(v,t,art,[2,1],f).ravel();mask=np.isfinite(a)
            self.assertTrue(np.array_equal(mask,np.isfinite(b)))
            self.assertLess(np.max(np.abs(a[mask]-b[mask])),1e-10)


if __name__=='__main__':unittest.main()
