import unittest
import numpy as np
from seat_cushion_corner_experiment import mesh
from seat_cushion_shell_experiment import projected_depth
from seat_cushion_shell_reference import ray_depth
from seat_rounded_diagnostic import ray,TILE


class CornerTests(unittest.TestCase):
    def test_closed_shell_and_flat_contact_ray(self):
        v,t=mesh(.27,-.35,10.15,8,8);edges={}
        for a,b,c in t:
            for x,y in [(a,b),(b,c),(c,a)]:edges[tuple(sorted((x,y)))]=edges.get(tuple(sorted((x,y))),0)+1
        self.assertTrue(all(n==2 for n in edges.values()))
        z=ray_depth(v,t,np.array([[.63*TILE,.615*TILE,0],[1.37*TILE,.615*TILE,0]]),np.array([[0.,0,1],[0.,0,1]]))
        np.testing.assert_allclose(z,[10.15,10.15],atol=1e-10)

    def test_independent_reference_in_all_views(self):
        v,t=mesh(.27,-.35,10.15,4,4);art={'width':96,'height':77,'anchor':[48,29]}
        for f in ['se','sw','ne','nw']:
            q=[ray(art['anchor'],[2,1],f,x+.5,y+.5) for y in range(77) for x in range(96)]
            a=ray_depth(v,t,np.array([p[0] for p in q]),np.array([p[1] for p in q]));b=projected_depth(v,t,art,[2,1],f).ravel();mask=np.isfinite(a)
            self.assertTrue(np.array_equal(mask,np.isfinite(b)));self.assertLess(np.max(abs(a[mask]-b[mask])),1e-10)


if __name__=='__main__':unittest.main()
