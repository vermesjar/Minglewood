import unittest
from collections import Counter
import numpy as np
from seat_sculpted_scroll_parts import lathe,sculpt_meshes
from seat_cushion_shell_reference import ray_depth

class ScrollPartsTests(unittest.TestCase):
 def test_closed_manifold_nonzero_triangles(self):
  for part in sculpt_meshes(24):
   v=np.array(part['vertices']);t=np.array(part['triangles']);edges=Counter(tuple(sorted((int(tri[i]),int(tri[(i+1)%3])))) for tri in t for i in range(3))
   self.assertTrue(all(count==2 for count in edges.values()))
   self.assertTrue(np.all(np.linalg.norm(np.cross(v[t[:,1]]-v[t[:,0]],v[t[:,2]]-v[t[:,0]]),axis=1)>1e-10))
   self.assertGreater(float(np.sum(np.einsum('ij,ij->i',v[t[:,0]],np.cross(v[t[:,1]],v[t[:,2]])))),0)
 def test_axis_aligned_cylinder_reference(self):
  v,t=lathe([(0,0),(0,2),(5,2),(5,0)],1,[0,0,0],32)
  actual=ray_depth(v,t,np.array([[0,2,0],[3,2,0],[0,-1,0]]),np.array([[0,0,1]]*3))
  self.assertAlmostEqual(actual[0],2);self.assertTrue(np.isneginf(actual[1:]).all())
 def test_common_paired_profiles(self):
  parts=sculpt_meshes(24)
  self.assertEqual(parts[0]['authoringProfile']['profile'],parts[3]['authoringProfile']['profile'])
  self.assertEqual(parts[4]['authoringProfile']['profile'],parts[5]['authoringProfile']['profile'])
if __name__=='__main__':unittest.main()
