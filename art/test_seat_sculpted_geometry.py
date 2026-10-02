import unittest
import numpy as np
from seat_sculpted_geometry_export import rounded_mesh
from seat_rounded_diagnostic import sdf,TILE
from seat_cushion_shell_experiment import shell
from seat_cushion_shell_reference import ray_depth

class SculptGuideTests(unittest.TestCase):
 def test_crown_tessellation_lies_on_declared_surface_and_faces_outward(self):
  part={'bounds':[[0,6],[0,18],[11,16.5]],'radius':2.75};v,t=rounded_mesh(part,8)
  self.assertLess(max(abs(sdf(part['bounds'],part['radius'],p)) for p in v),1e-10)
  center=np.array(part['bounds']).mean(axis=1)
  for tri in t:
   a,b,c=v[tri];n=np.cross(b-a,c-a)
   if np.linalg.norm(n)>1e-10:self.assertGreater(float(n@((a+b+c)/3-center)),0)
 def test_frozen_contact_supported_by_real_cushion_surface(self):
  v,t=shell((.27,9.5,.05,.45),32)
  origins=np.array([[u*TILE,.615*TILE,0] for u in [.63,1.37]])
  z=ray_depth(v,t,origins,np.array([[0,0,1],[0,0,1]]))
  np.testing.assert_allclose(z,[10.15,10.15],atol=1e-10)
if __name__=='__main__':unittest.main()
