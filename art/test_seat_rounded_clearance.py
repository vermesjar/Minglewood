import unittest
from seat_rounded_clearance import capsule_contact,local_joint,SHIN_RADIUS
from seat_rounded_diagnostic import TILE


class PhysicalClearanceTests(unittest.TestCase):
    def test_capsule_clear_penetrating_and_tangent_box(self):
        box={'bounds':[[0,10],[0,10],[0,10]],'radius':1.}
        self.assertFalse(capsule_contact(box,[5,-2,1],[5,-2,8],.5)['intersects'])
        self.assertTrue(capsule_contact(box,[5,-.2,1],[5,-.2,8],.5)['intersects'])
        self.assertTrue(capsule_contact(box,[5,-.5,1],[5,-.5,8],.5)['intersects'])

    def test_hand_derived_se_joint_points_use_same_metric_as_furniture(self):
        art={'anchor':[64,29]}
        knee=local_joint(art,[2,1],'se',[69.92,29.96],12.15)
        ankle=local_joint(art,[2,1],'se',[71.52,47.76],3.65)
        self.assertAlmostEqual(knee[0]/TILE,.696875)
        self.assertAlmostEqual(knee[1]/TILE,.118125)
        self.assertAlmostEqual(ankle[0]/TILE,.696875)
        self.assertAlmostEqual(ankle[1]/TILE,.068125)
        self.assertAlmostEqual(SHIN_RADIUS,1.775352077758099)


if __name__=='__main__':unittest.main()
