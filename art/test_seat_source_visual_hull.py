import unittest
import numpy as np
from seat_source_visual_hull import alpha_intervals,intersect


class VisualHullTests(unittest.TestCase):
    def test_disjoint_alpha_runs_not_filled(self):
        alpha=np.array([[True,False,True]])
        self.assertEqual(alpha_intervals(np.array([0.,.5]),np.array([1.,0]),alpha,-1,4),[(0,1),(2,3)])

    def test_reverse_diagonal_and_constant_outside(self):
        alpha=np.eye(3,dtype=bool)
        self.assertEqual(alpha_intervals(np.array([3.,3.]),np.array([-1.,-1.]),alpha,0,4),[(0,3)])
        self.assertEqual(alpha_intervals(np.array([8.,8.]),np.array([0.,0.]),alpha,0,4),[])

    def test_no_shared_height_despite_individual_view_hits(self):
        self.assertEqual(intersect([(0,1)],[(2,3)]),[])
        self.assertEqual(intersect([(0,2),(4,6)],[(1,5)]),[(1,2),(4,5)])


if __name__=='__main__':unittest.main()
