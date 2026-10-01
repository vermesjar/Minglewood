"""Source-only controls for the independent authored body reference."""
import base64
import copy
import hashlib
import json
from pathlib import Path
import unittest
import zlib

import numpy as np
from seat_body_reference import body_depths, original_lower_garment, original_equipment_hit, authored_discriminant


class DiscriminantTests(unittest.TestCase):
    def test_roundoff_tangent_and_real_miss(self):
        self.assertEqual(authored_discriminant(3.0000000000000004,-95.40000000000002,758.4300000000003),0)
        self.assertEqual(authored_discriminant(.8554562320796089,-5.817102378141341,9.889074042840281),0)
        self.assertLess(authored_discriminant(1,-2,1+1e-10),0)

    def test_positive_arithmetic_and_bounded_scale_invariance(self):
        for a,b,c in [(1,-3,2),(2,5,-3)]:
            self.assertEqual(authored_discriminant(a,b,c),b*b-4*a*c)
        for exponent in [-400,-100,0,100,400]:
            for sign in [-1,1]:
                k=sign*2.**exponent
                self.assertEqual(authored_discriminant(k,-2*k,k),0)
                self.assertLess(authored_discriminant(k,-2*k,(1+1e-10)*k),0)


class LowerGarmentReferenceTests(unittest.TestCase):
    def source(self):
        # A sloping face with analytically known z=14-x-y before cloth relief.
        return {'anatomy': {'hipCenterHeight':10, 'hipRow':20, 'waistRow':13,
                           'nearLeg':{'kneeHeight':12}, 'farLeg':{'kneeHeight':8}},
                'figure': {'w':4, 'h':4, 'owner':[6]*16, 'rgba':[0,0,0,255]*16,
                           'lowerGarment':{'version':1, 'vertices':[
                               {'point':[0,0], 'anchor':'waist', 'drop':0},
                               {'point':[4,0], 'anchor':'hip', 'drop':0},
                               {'point':[4,4], 'anchor':'farKnee', 'drop':4},
                               {'point':[0,4], 'anchor':'nearKnee', 'drop':4}],
                               'triangles':[[0,1,2],[0,2,3]], 'mask':[1]*16}}}

    def test_authored_anchor_plane_at_pixel_centers(self):
        c=self.source(); values=original_lower_garment(c)
        self.assertEqual(len(values),16)
        for (x,y),z in values.items():
            self.assertAlmostEqual(z,14-(x+.5)-(y+.5)+.25,places=10)

    def test_continuous_mirror_preserves_raster_depth(self):
        c=self.source(); expected=original_lower_garment(c)
        for v in c['figure']['lowerGarment']['vertices']:v['point'][0]=4-v['point'][0]
        actual=original_lower_garment(c)
        for (x,y),z in expected.items():self.assertAlmostEqual(actual[(3-x,y)],z,places=10)

    def test_exact_source_mask_and_missing_metadata(self):
        c=self.source();c['figure']['lowerGarment']['mask'][0]=0
        self.assertNotIn((0,0),original_lower_garment(c))
        c['figure'].pop('lowerGarment')
        self.assertEqual(original_lower_garment(c),{})

    def test_later_overdraw_is_excluded(self):
        c=self.source();c['figure']['owner'][0]=7;c['figure']['rgba'][7]=0
        values=original_lower_garment(c)
        self.assertNotIn((0,0),values)
        self.assertNotIn((1,0),values)
        self.assertEqual(len(values),14)

    def test_rejects_uncovered_paint_and_bad_provenance(self):
        for change in ['coverage','version','triangle']:
            c=self.source();f=c['figure'];g=f['lowerGarment']
            if change=='coverage':g['triangles']=[[0,1,2]]
            elif change=='version':g['version']=0
            else:g['triangles']=[[0,0,1]]
            with self.subTest(change=change),self.assertRaises(ValueError):original_lower_garment(c)


class BodyReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        file = Path(__file__).resolve().parents[1] / 'tests/fixtures/seating-body-reference-source.json'
        fixture = json.loads(file.read_text())
        raw = zlib.decompress(base64.b64decode(fixture['zlibBase64']))
        assert hashlib.sha256(raw).hexdigest() == fixture['sha256']
        cls.source = json.loads(raw)
        cls.results = [body_depths(d, d['context']) for d in cls.source]

    def test_legacy_nongarment_arrays_unchanged(self):
        # Preserve archived v12 numeric depths, not platform-sensitive byte hashes
        # of linalg results/NaNs whose original full arrays were never retained.
        path = Path(__file__).resolve().parents[1] / 'tests/fixtures/seating-body-legacy-depth.json'
        fixture = json.loads(path.read_text())
        source_fixture = json.loads((path.parent / 'seating-body-reference-source.json').read_text())
        self.assertEqual(fixture['sourceFixtureSha256'], source_fixture['sha256'])
        raw = zlib.decompress(base64.b64decode(fixture['zlibBase64']))
        self.assertEqual(hashlib.sha256(raw).hexdigest(), fixture['sha256'])
        samples = json.loads(raw)
        self.assertEqual(len(samples), len(self.results))
        self.assertEqual(sum(map(len, samples)), 2994)
        for result, points in zip(self.results, samples):
            actual = [result['frontZ'][y, x] for x, y, z in points]
            np.testing.assert_allclose(actual, [z for x, y, z in points], rtol=0, atol=1e-10)
        # The feature-isolation check covers every pixel, including outside the
        # archived furniture overlap. Legacy fixtures carry no authored cloth.
        from unittest.mock import patch
        for data, result in zip(self.source, self.results):
            self.assertNotIn('lowerGarment', data['context']['figure'])
            with patch('seat_body_reference.original_lower_garment', return_value={}), \
                 patch('seat_body_reference.original_equipment_hit', return_value=None):
                legacy = body_depths(data, data['context'])
            np.testing.assert_array_equal(legacy['frontZ'], result['frontZ'])
            np.testing.assert_array_equal(legacy['methods'], result['methods'])

    def test_equipment_restricts_exact_owner_limb_and_active_kind(self):
        d=copy.deepcopy(self.source[0]);c=d['context'];a=c['anatomy']
        for leg in ['nearLeg','farLeg']:a[leg]['heel']=False
        c['context']['look']['shoes']='shoes.rainboots'
        x,y=a['nearLeg']['ankle']
        self.assertIsNotNone(original_equipment_hit(d,c,x,y-4,7,1))
        for owner,limb in [(6,1),(19,1),(7,0),(7,3),(18,1)]:
            self.assertIsNone(original_equipment_hit(d,c,x,y-4,owner,limb))
        c['context']['look']['shoes']='shoes.slippers'
        self.assertIsNone(original_equipment_hit(d,c,x,y-4,7,1))
        c['context']['look']['mobility']='mob.wheelchair'
        self.assertIsNone(original_equipment_hit(d,c,x,y-4,18))

    def test_equipment_own_limb_and_mirror(self):
        d=copy.deepcopy(self.source[0]);c=d['context'];a=c['anatomy'];f=c['figure']
        c['context']['look']['shoes']='shoes.rainboots'
        for leg in ['nearLeg','farLeg']:a[leg]['heel']=False
        x,y=a['nearLeg']['ankle'];a['farLeg']['ankle']=[x+100,y]
        z=original_equipment_hit(d,c,x,y-4,7,1)
        self.assertIsNone(original_equipment_hit(d,c,x,y-4,7,2))
        ox=round(c['context']['figureContext']['feet'][0])-f['ax']
        for leg in ['nearLeg','farLeg']:a[leg]['ankle'][0]=2*ox+f['w']-a[leg]['ankle'][0]
        d['facing']='sw'
        mirrored=original_equipment_hit(d,c,2*ox+f['w']-1-x,y-4,7,1)
        self.assertAlmostEqual(z,mirrored,places=10)

    def test_cane_source_shaft_and_hook_are_standing_only(self):
        d=copy.deepcopy(self.source[0]);c=d['context'];a=c['anatomy'];f=c['figure']
        feet=c['context']['figureContext']['feet'];ox=round(feet[0])-f['ax'];oy=round(feet[1])-f['ay']
        a['handNear']=[ox+40,oy+80];a['standingFeetRow']=oy+104
        c['context']['look']['mobility']='mob.cane';c['context']['pose']='stand'
        for x,y in [(39,90),(39,78),(40,78),(41,78),(41,79)]:
            self.assertIsNotNone(original_equipment_hit(d,c,ox+x,oy+y,18))
        self.assertIsNone(original_equipment_hit(d,c,ox+45,oy+90,18))
        self.assertIsNone(original_equipment_hit(d,c,ox+39,oy+90,19))
        c['context']['pose']='sit-floor'
        self.assertIsNone(original_equipment_hit(d,c,ox+39,oy+90,18))

    def test_source_pixels_unchanged_and_mirrored_depth(self):
        for d, r in zip(self.source, self.results):
            fig = d['context']['figure']
            opaque = np.asarray(fig['rgba']).reshape(fig['h'], fig['w'], 4)[:, :, 3] > 0
            self.assertEqual(r['unresolved'], 0)
            self.assertTrue(np.isfinite(r['frontZ'][opaque]).all())
            self.assertTrue(np.isnan(r['frontZ'][~opaque]).all())
        for left,right in [(0,1),(2,3)]:
            np.testing.assert_allclose(self.results[left]['frontZ'], self.results[right]['frontZ'][:, ::-1], atol=1e-6, equal_nan=True)

    def test_original_internal_stroke_is_continuous_at_reported_ankle_hole(self):
        d = self.source[0]
        c = d['context']
        f = c['figure']
        feet = c['context']['figureContext']['feet']
        x = 42 - feet[0] + f['ax']
        y = 33 - feet[1] + f['ay']
        depth = self.results[0]['frontZ']
        self.assertEqual(self.results[0]['methods'][y, x], 'original-internal-stroke-harmonic-surface')
        # Independently frozen authored shell depth at the rejected pink hole.
        self.assertGreater(depth[y, x], 5.58734130859375)
        self.assertAlmostEqual(depth[y, x], (depth[y-1, x]+depth[y+1, x]+depth[y, x-1]+depth[y, x+1])/4, places=9)

    def test_rejects_historical_geometry_or_missing_source_provenance(self):
        for field in ['anatomy-version', 'sealed', 'sourceMetadataVersion', 'shoeLimb', 'bodyPocket']:
            d = copy.deepcopy(self.source[0])
            if field == 'anatomy-version':
                d['context']['anatomy'].pop('version')
            else:
                d['context']['figure'].pop(field)
            with self.assertRaises(ValueError):
                body_depths(d, d['context'])

    def test_original_shoe_encloses_its_painted_ankle(self):
        d=copy.deepcopy(self.source[0]);c=d['context'];f=c['figure']
        x=44-c['context']['figureContext']['feet'][0]+f['ax']
        y=33-c['context']['figureContext']['feet'][1]+f['ay'];i=y*f['w']+x
        self.assertEqual(f['owner'][i],7)
        self.assertEqual(f['shoeLimb'][i],2)
        self.assertGreater(self.results[0]['frontZ'][y,x],5.183921814)
        # A disjoint shoe ellipsoid caused the independently rejected hole.
        f['shoeLimb'][i]=0
        self.assertLess(body_depths(d,c)['frontZ'][y,x],5.183921814)

    def test_outline_uses_its_own_ray_instead_of_copying_the_row_above(self):
        d=self.source[0];c=d['context'];f=c['figure']
        x=34-c['context']['figureContext']['feet'][0]+f['ax']
        y=29-c['context']['figureContext']['feet'][1]+f['ay']
        depth=self.results[0]['frontZ']
        self.assertEqual(f['owner'][y*f['w']+x],19)
        self.assertEqual(self.results[0]['methods'][y,x],'source-outline-gradient')
        # The old attachment copied the higher shin row and exposed a floating
        # black pixel above the independently authored pink cushion at 8.205.
        self.assertGreater(depth[y-1,x],8.205)
        self.assertLess(depth[y,x],8.205)

    def test_body_gap_filled_by_hair_routine_keeps_body_boundary_depth(self):
        d=self.source[2];c=d['context'];f=c['figure'];depth=self.results[2]['frontZ']
        x=43-c['context']['figureContext']['feet'][0]+f['ax']
        y=34-c['context']['figureContext']['feet'][1]+f['ay'];i=y*f['w']+x
        self.assertEqual(f['owner'][i],3)
        self.assertEqual(f['sealed'][i],0)
        self.assertEqual(f['bodyPocket'][i],1)
        self.assertEqual(self.results[2]['methods'][y,x],'original-body-pocket-harmonic-surface')
        self.assertAlmostEqual(depth[y,x],(depth[y-1,x]+depth[y+1,x]+depth[y,x-1]+depth[y,x+1])/4,places=9)

    def test_furniture_masks_and_expected_winners_cannot_drive_body_depth(self):
        d = copy.deepcopy(self.source[0])
        before = json.dumps(d, sort_keys=True)
        d['sourceArt']['rgba'] = [255, 0, 255, 255]
        d['actualMask'] = [1] * 11264
        d['expectedWinner'] = 'furniture'
        r = body_depths(d, d['context'])
        np.testing.assert_array_equal(r['frontZ'], self.results[0]['frontZ'])
        # The reference is pure; even incidental input data remains untouched.
        d['sourceArt'].pop('rgba');d.pop('actualMask');d.pop('expectedWinner')
        self.assertEqual(json.dumps(d, sort_keys=True), before)


if __name__ == '__main__':
    unittest.main()
