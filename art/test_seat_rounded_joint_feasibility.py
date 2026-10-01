import unittest
import numpy as np
from seat_rounded_joint_feasibility import minimum_capsule_gap
from seat_rounded_clearance import SHIN_RADIUS


class JointFeasibilityTests(unittest.TestCase):
    def test_capsule_endpoint_and_interior_take_worst_segment(self):
        segments=[([0,0,0],[0,0,2]),([10,0,0],[10,0,2])]
        self.assertAlmostEqual(minimum_capsule_gap(np.array([[2.,0,1],[10.,0,3]]),segments),1-SHIN_RADIUS)
        self.assertAlmostEqual(minimum_capsule_gap(np.array([[SHIN_RADIUS,0,1]]),segments),0)

    def test_displayed_shift_can_consume_safe_gap(self):
        segments=[([0,0,0],[0,0,2])]
        authored=np.array([[SHIN_RADIUS+1,0,1]])
        self.assertGreater(minimum_capsule_gap(authored,segments),0)
        self.assertLess(minimum_capsule_gap(authored-np.array([[2.,0,0]]),segments),0)


if __name__=='__main__':unittest.main()
