import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from seat_curved_authoring import Profile, intersect
from seat_curved_generate import FACINGS, generate, produce


def fixture():
    profile = Profile()
    model = {'size': [1, 1], 'sits': [[profile.contact_u, profile.contact_v, profile.seat]],
             'parts': [{'part': 'seat', 'z': [0, 10]}, {'part': 'wrap', 'z': [0, 16]}]}
    views = {}
    for f in FACINGS:
        view = {'facing': f, 'width': 72, 'height': 68, 'anchor': [36, 20]}
        opaque = np.isfinite(intersect(profile, view))
        rgba = np.zeros((68, 72, 4), dtype=np.uint8)
        rgba[opaque] = [90, 80, 40, 255]
        views[f] = {**view, 'rgba': rgba.ravel().tolist(), 'surface': {
            'version': 1, 'width': 72, 'height': 68, 'drawing': f, 'modelParts': 'fixture',
            'labels': np.where(opaque, 1, 0).ravel().tolist()}}
    return {'model': model, 'style': 'floor', 'geometry': 'fixture', 'views': views}, profile


class CurvedGenerationTests(unittest.TestCase):
    def test_complete_source_geometry_preserves_alpha_and_contact(self):
        request, profile = fixture()
        # Isolate correspondence from the separately tested optimizer.
        with patch('seat_curved_generate.fit', return_value=(profile, 0)):
            result = generate(request, 'a' * 64)
        self.assertEqual(result['status'], 'UNREVIEWED_AUTHORED_INTENT')
        self.assertEqual(set(result['surfaces']), set(FACINGS))
        for f, m in result['surfaces'].items():
            self.assertEqual(m['labels'], request['views'][f]['surface']['labels'])
            self.assertEqual([z is not None for z in m['authored']['z']], [x > 0 for x in m['labels']])
            self.assertEqual(result['audits'][f]['problems'], [])
            self.assertLess(result['audits'][f]['discreteContactError'], .05)

    def test_missing_face_bad_alpha_and_unsupported_family_rejected(self):
        request, _ = fixture()
        for mutation in ['face', 'alpha', 'family']:
            bad = copy.deepcopy(request)
            if mutation == 'face': del bad['views']['nw']
            elif mutation == 'alpha': bad['views']['se']['surface']['labels'] = [0] * (72 * 68)
            else: bad['model']['size'] = [2, 1]
            with self.assertRaises(ValueError): generate(bad, 'a' * 64)

    def test_cache_binds_all_source_bytes_and_generator(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'input.json', Path(directory) / 'output.json'
            source.write_text(json.dumps({'source': 1}))
            def fake(request, digest):
                return {'sourceInputsSha256': digest, 'generatorSha256': 'version1'}
            with patch('seat_curved_generate.generator_hash', return_value='version1'), \
                 patch('seat_curved_generate.generate', side_effect=fake) as build:
                produce(source, output); produce(source, output)
                self.assertEqual(build.call_count, 1)
                source.write_text(json.dumps({'source': 2}))
                produce(source, output)
                self.assertEqual(build.call_count, 2)
            with patch('seat_curved_generate.generator_hash', return_value='version2'), \
                 patch('seat_curved_generate.generate', side_effect=fake) as build:
                produce(source, output)
                self.assertEqual(build.call_count, 1)


if __name__ == '__main__': unittest.main()
