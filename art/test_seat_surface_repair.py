import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from seat_surface_repair import apply_review as strict_apply_review, repair


def apply_review(data, original, proposal, bounds, pixels=None):
    proposal.setdefault("uncertainties", [])
    for record in proposal["pixels"]:
        record.setdefault("basis", "observed")
        record.setdefault("convention", "")
        record.setdefault("reason", "Synthetic exact face boundary")
    return strict_apply_review(data, original, proposal, bounds, pixels)


class BoundaryRepairTests(unittest.TestCase):
    def setUp(self):
        self.data = {'width': 3, 'height': 1, 'rgba': [20, 30, 40, 255] * 2 + [0, 0, 0, 0],
                     'parts': [{'part': 'seat'}, {'part': 'back'}], 'drawing': 'original', 'modelParts': 'parts'}
        self.original = {'version': 1, 'width': 3, 'height': 1, 'drawing': 'original', 'modelParts': 'parts', 'labels': [1, 1, 0]}

    def test_unresolved_repair_cannot_produce_surface_or_mutate_historical_map(self):
        import copy
        before = copy.deepcopy(self.original)
        proposal = {'pixels': [{'x': 1, 'y': 0, 'part': 1, 'face': 2,
                               'basis': 'observed', 'convention': '', 'reason': 'Contour'}],
                    'uncertainties': ['Soft junction is unresolved']}
        with self.assertRaisesRegex(ValueError, 'Unresolved source ownership'):
            strict_apply_review(self.data, self.original, proposal, [1,0,2,1])
        self.assertEqual(self.original, before)

    def test_repair_retains_declared_intent_and_marks_unrecorded_legacy_provenance(self):
        proposal = {'pixels': [{'x':1, 'y':0, 'part':1, 'face':2, 'basis':'declared-intent',
                               'convention':'shared-contour', 'reason':'Touching foreground back continues through far-arm outline'}],
                    'uncertainties': []}
        result = strict_apply_review(self.data, self.original, proposal, [1,0,2,1])
        self.assertEqual(result['ownership']['pixels'][0]['basis'], 'declared-intent')
        self.assertEqual(result['ownership']['previousOwnership']['status'], 'HISTORICAL_OWNERSHIP_UNRECORDED')
        self.assertNotIn('ownership', self.original)
        self.assertEqual(json.loads(json.dumps(result)), result)

    def test_changes_only_reviewed_opaque_region(self):
        proposal = {'pixels': [{'x': 1, 'y': 0, 'part': 1, 'face': 2}], 'uncertainties': []}
        revised = apply_review(self.data, self.original, proposal, [1, 0, 2, 1])
        self.assertEqual(revised['labels'], [1, 6, 0])
        self.assertEqual(self.original['labels'], [1, 1, 0])
        self.assertEqual(proposal['uncertainties'], [])

    def test_missing_pixel_does_not_become_an_implicit_approval(self):
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            apply_review(self.data, self.original, {'pixels': []}, [0, 0, 2, 1])

    def test_cannot_write_outside_region_or_on_transparency(self):
        for x in [0, 2]:
            with self.assertRaisesRegex(ValueError, 'out-of-region'):
                apply_review(self.data, self.original, {'pixels': [{'x': x, 'y': 0, 'part': 1, 'face': 0}]}, [1, 0, 2, 1])

    def test_rejects_stale_binding(self):
        with self.assertRaisesRegex(ValueError, 'Stale'):
            apply_review(self.data, {**self.original, 'drawing': 'new'}, {'pixels': []}, [1, 0, 2, 1])

    def test_sparse_domain_cannot_rewrite_intervening_pixels(self):
        points = [{'x': 1, 'y': 0, 'part': 1, 'face': 2}]
        revised = apply_review(self.data, self.original, {'pixels': points}, [0, 0, 2, 1], [[1, 0]])
        self.assertEqual(revised['labels'], [1, 6, 0])
        with self.assertRaisesRegex(ValueError, 'out-of-region'):
            apply_review(self.data, self.original, {'pixels': points + [{'x': 0, 'y': 0, 'part': 1, 'face': 2}]}, [0, 0, 2, 1], [[1, 0]])

    def test_sparse_domain_rejects_transparent_and_duplicate_coordinates(self):
        for pixels in [[[2, 0]], [[1, 0], [1, 0]], []]:
            with self.assertRaisesRegex(ValueError, 'unique opaque'):
                apply_review(self.data, self.original, {'pixels': []}, [0, 0, 3, 1], pixels)

    def test_resuming_identical_source_reuses_paid_response(self):
        data = {**self.data, 'key': 'test', 'facing': 'nw', 'projectedParts': []}
        proposal = {'pixels': [{'x': 1, 'y': 0, 'part': 1, 'face': 2, 'basis': 'observed', 'convention': '', 'reason': 'Synthetic exact face boundary'}], 'uncertainties': [], 'reasoning': 'source'}
        response = {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(proposal)}]}]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'input.json').write_text(json.dumps(data))
            (root/'surface.json').write_text(json.dumps(self.original))
            with patch('seat_surface_repair.studio.post', return_value=response) as post, \
                 patch('seat_surface_repair.studio.spent', return_value=0), \
                 patch('seat_surface_repair.studio.cap', return_value=99), \
                 patch('seat_surface_repair.studio.log') as log:
                first = repair(root/'input.json', root/'surface.json', [0, 0, 2, 1], root/'out', pixels=[[1, 0]])
                second = repair(root/'input.json', root/'surface.json', [0, 0, 2, 1], root/'out', pixels=[[1, 0]])
                self.assertEqual(first, second)
                self.assertEqual(post.call_count, 1)
                self.assertEqual(log.call_count, 1)
                reference = {**data, 'facing': 'se', 'anchor': [1, 2]}
                (root/'front.json').write_text(json.dumps(reference))
                repair(root/'input.json', root/'surface.json', [0, 0, 2, 1], root/'out', pixels=[[1, 0]], context_inputs=[root/'front.json'])
                repair(root/'input.json', root/'surface.json', [0, 0, 2, 1], root/'out', pixels=[[1, 0]], context_inputs=[root/'front.json'])
                self.assertEqual(post.call_count, 2)
                content = post.call_args.kwargs['json']['input'][0]['content']
                self.assertEqual(sum(c['type']=='input_image' for c in content), 3)
                prompt = content[0]['text']
                self.assertIn('SEMANTIC AUTHORING CONVENTION', prompt)
                self.assertIn('isolated far-arm caps or interiors', prompt)
                self.assertEqual(first['labels'][0], self.original['labels'][0], 'A shared-outline repair must leave the separate far-cap source pixel unchanged')
                self.assertTrue(any('facing se' in c.get('text','') for c in content))
                reference['rgba'][0] = 21
                (root/'front.json').write_text(json.dumps(reference))
                repair(root/'input.json', root/'surface.json', [0, 0, 2, 1], root/'out', pixels=[[1, 0]], context_inputs=[root/'front.json'])
                self.assertEqual(post.call_count, 3)
                reference['key'] = 'different-chair'
                (root/'front.json').write_text(json.dumps(reference))
                with self.assertRaisesRegex(ValueError, 'same furniture'):
                    repair(root/'input.json', root/'surface.json', [0, 0, 2, 1], root/'out', pixels=[[1, 0]], context_inputs=[root/'front.json'])
                self.assertEqual(post.call_count, 3)


if __name__ == '__main__':
    unittest.main()
