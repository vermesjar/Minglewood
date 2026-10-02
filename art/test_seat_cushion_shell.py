import unittest
import numpy as np
from seat_cushion_shell_experiment import shell,profile,projected_depth,triangulate_polygon
from seat_cushion_shell_reference import ray_depth
from seat_rounded_diagnostic import ray


class ShellTests(unittest.TestCase):
    def test_concave_cap_triangulation_preserves_polygon_area(self):
        points=np.array([[0.,0],[3,0],[3,3],[2,1],[0,3]])
        cross=lambda a,b:a[0]*b[1]-a[1]*b[0]
        area=abs(sum(cross(a,b) for a,b in zip(points,np.roll(points,-1,axis=0))))/2
        triangles=triangulate_polygon(points)
        self.assertEqual(len(triangles),len(points)-2)
        self.assertAlmostEqual(sum(abs(cross(points[b]-points[a],points[c]-points[a]))/2 for a,b,c in triangles),area)

    def test_world_triangle_ray_fixture(self):
        v=np.array([[0.,0,3],[1.,0,3],[0.,1,3]])
        z=ray_depth(v,np.array([[0,1,2]]),np.array([[.2,.2,0],[1,1,0]]),np.array([[0.,0,1],[0.,0,1]]))
        self.assertEqual(z[0],3);self.assertFalse(np.isfinite(z[1]))

    def test_closed_mesh_and_fixed_horizontal_contact(self):
        v,t=shell((.21,7.5,.05,.45));edges={}
        for a,b,c in t:
            for x,y in [(a,b),(b,c),(c,a)]:edges[tuple(sorted((x,y)))]=edges.get(tuple(sorted((x,y))),0)+1
        self.assertTrue(all(n==2 for n in edges.values()))
        p=profile(.21,7.5,.05,.45,32)
        self.assertEqual(p[32,1],10.15);self.assertEqual(p[33,1],10.15)
        self.assertLess(p[32,0],.615);self.assertGreater(p[33,0],.615)

    def test_independent_world_reference_all_rotations(self):
        v,t=shell((.21,7.5,.05,.45),8);art={'width':96,'height':77,'anchor':[48,29]}
        for f in ['se','sw','ne','nw']:
            q=[ray(art['anchor'],[2,1],f,x+.5,y+.5) for y in range(77) for x in range(96)]
            z=ray_depth(v,t,np.array([r[0] for r in q]),np.array([r[1] for r in q]));r=projected_depth(v,t,art,[2,1],f).ravel()
            self.assertTrue(np.array_equal(np.isfinite(z),np.isfinite(r)))
            self.assertLess(np.max(np.abs(z[np.isfinite(z)]-r[np.isfinite(z)])),1e-10)


if __name__=='__main__':unittest.main()
