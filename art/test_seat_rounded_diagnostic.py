"""Analytic geometry fixtures; no captured renderer output or paid calls."""
import copy
import math
import random
import unittest
import seat_rounded_diagnostic as producer
import seat_rounded_reference as reference


class RoundedDiagnosticTests(unittest.TestCase):
    def check(self,bounds,radius,origin,direction,expected):
        for solver in [producer.interval,reference.interval]:
            actual=solver(bounds,radius,origin,direction)
            if expected is None:self.assertIsNone(actual)
            else:
                self.assertIsNotNone(actual)
                for a,b in zip(actual,expected):self.assertAlmostEqual(a,b,places=6)

    def test_flat_face_rounded_edge_and_corner_have_exact_continuous_depth(self):
        box=[[-2,2]]*3
        self.check(box,.5,(0,0,0),(0,0,1),(-2,2))
        edge=1.5+math.sqrt(.5**2-.25**2)
        self.check(box,.5,(1.75,0,0),(0,0,1),(-edge,edge))
        corner=1.5+math.sqrt(.5**2-2*.25**2)
        self.check(box,.5,(1.75,1.75,0),(0,0,1),(-corner,corner))
        # A tiny step across the nominal top/edge junction has no depth jump.
        before=producer.interval(box,.5,(1.5-1e-6,0,0),(0,0,1))[1]
        after=producer.interval(box,.5,(1.5+1e-6,0,0),(0,0,1))[1]
        self.assertLess(abs(before-after),1e-10)

    def test_sphere_limit_tangent_parallel_miss_and_surface_plateau(self):
        sphere=[[-1,1]]*3
        self.check(sphere,1,(0,0,0),(1,1,1),(-1/math.sqrt(3),1/math.sqrt(3)))
        self.check(sphere,1,(1,0,0),(0,0,1),(0,0))
        self.check(sphere,1,(1.00001,0,0),(0,0,1),None)
        self.check([[-2,2]]*3,.5,(2,0,0),(0,0,1),(-1.5,1.5))

    def test_zero_radius_box_and_thin_interval(self):
        self.check([[-2,2],[-3,3],[4,4.000001]],0,(0,0,0),(0,0,1),(4,4.000001))
        self.check([[-2,2]]*3,0,(3,0,0),(0,0,1),None)

    def test_union_preserves_separated_hit_intervals_and_frontmost_surface(self):
        components=[{'bounds':[[-1,1],[-1,1],[0,2]],'radius':.25},
                    {'bounds':[[-1,1],[-1,1],[5,7]],'radius':.25}]
        self.assertEqual(reference.union_intervals(components,(0,0,0),(0,0,1)),[(0.,2.),(5.,7.)])
        hits=[producer.interval(p['bounds'],p['radius'],(0,0,0),(0,0,1)) for p in components]
        self.assertAlmostEqual(max(hit[1] for hit in hits),7)
        components.append({'bounds':[[-1,1],[-1,1],[1,6]],'radius':0})
        self.assertEqual(reference.union_intervals(components,(0,0,0),(0,0,1)),[(0.,7.)])

    def test_all_facings_multiwidth_projection_and_metric(self):
        anchor=[64,29];size=[3,1];local=[2.4,.7,9.2]
        for facing in producer.FACINGS:
            px,py=producer.project(anchor,size,facing,*local)
            o,d=producer.ray(anchor,size,facing,px,py)
            actual=[a+b*local[2] for a,b in zip(o,d)]
            expected=[local[0]*producer.TILE,local[1]*producer.TILE,local[2]]
            for a,b in zip(actual,expected):self.assertAlmostEqual(a,b)
        # Independent hand-calculated projection catches mutually wrong forward/inverse rotations.
        self.assertEqual(producer.project([0,0],[2,1],'se',1.5,.25,4),(-24.,28.))
        self.assertEqual(producer.project([0,0],[2,1],'nw',1.5,.25,4),(-8.,4.))

    def test_fixed_contact_validation_and_no_source_mutation(self):
        model={'size':[2,1],'parts':[{'part':'seat','u':[0,2],'v':[0,1],'z':[8,10]}],
               'sits':[[.5,.5,10],[1.5,.5,10]]}
        original=copy.deepcopy(model);declaration=producer.declare(model)
        self.assertEqual(producer.contacts_problems(declaration),[])
        self.assertEqual(model,original)
        declaration['contacts']=[[0,.5,10]]
        self.assertTrue(producer.contacts_problems(declaration))
        declaration=producer.declare(model);declaration['components'].append(
            {'part':2,'role':'back','bounds':[[0,40],[0,20],[11,15]],'radius':0})
        self.assertTrue(any('blocks' in p['problem'] for p in producer.contacts_problems(declaration)))

    def test_independent_methods_agree_on_random_rays_and_radius_limits(self):
        rng=random.Random(713)
        for i in range(180):
            extents=[rng.uniform(.2,4) for _ in range(3)]
            bounds=[[-v,v] for v in extents];radius=min(extents)*rng.random()
            origin=[rng.uniform(-5,5) for _ in range(3)]
            direction=[rng.uniform(-2,2) for _ in range(3)]
            a=producer.interval(bounds,radius,origin,direction)
            b=reference.interval(bounds,radius,origin,direction)
            self.assertEqual(a is None,b is None,(i,a,b))
            if a:
                for x,y in zip(a,b):self.assertAlmostEqual(x,y,places=6)
        for solver in [producer.interval,reference.interval]:
            with self.assertRaises(ValueError):solver([[-1,1]]*3,1.1,(0,0,0),(0,0,1))
            with self.assertRaises(ValueError):solver([[-1,1]]*3,.5,(0,0,0),(0,0,math.nan))
            with self.assertRaises(ValueError):solver([[-1,1]]*2,.5,(0,0,0),(0,0,1))


if __name__=='__main__':unittest.main()
