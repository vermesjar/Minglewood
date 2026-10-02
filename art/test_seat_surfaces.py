"""Surface proposals must classify every opaque pixel without altering source alpha."""
import unittest
import copy
import json
from seat_surfaces import rasterize as strict_rasterize, source_view_context, schema, validate_surface_ownership


def rasterize(data, proposal):
    # Numerical fixtures explicitly declare observed ownership; production has no defaults.
    proposal.setdefault("uncertainties", [])
    for region in proposal["regions"]:
        region.setdefault("basis", "observed")
        region.setdefault("convention", "")
        region.setdefault("reason", "Synthetic fixture has exact declared face boundaries")
    return strict_rasterize(data, proposal)

class SurfaceRasterTests(unittest.TestCase):
    def setUp(self):
        self.data={'width':2,'height':2,'rgba':[20,30,40,255]*3+[0,0,0,0],
          'parts':[{},{}],'drawing':'original','modelParts':'unchanged'}

    def ownership_proposal(self):
        return {'regions': [{'part': 0, 'face': 0, 'boundary': [[0,0],[2,0],[2,2],[0,2]],
                             'basis': 'observed', 'convention': '', 'reason': 'Continuous flat support interior'}],
                'uncertainties': []}

    def test_uncertainty_is_never_silently_discarded_even_with_complete_labels(self):
        for uncertainty in ['soft seam unknown', '', 'Shared outline convention was mentioned but other seams remain unknown']:
            proposal = self.ownership_proposal(); proposal['uncertainties'] = [uncertainty]
            before = copy.deepcopy(proposal)
            with self.assertRaisesRegex(ValueError, 'Unresolved source ownership'):
                strict_rasterize(self.data, proposal)
            self.assertEqual(proposal, before)
        proposal = self.ownership_proposal(); proposal['regions'][0]['basis'] = 'unresolved'
        with self.assertRaisesRegex(ValueError, 'Unresolved source ownership'):
            strict_rasterize(self.data, proposal, allow_incomplete=True)

    def test_authored_intent_is_explicit_bound_and_distinct_from_observation(self):
        proposal = self.ownership_proposal(); region = proposal['regions'][0]
        region.update(basis='declared-intent', convention='receiver-shadow', reason='Uninterrupted raised contour encloses continuous receiving cushion material')
        before = copy.deepcopy(self.data)
        surface = json.loads(json.dumps(strict_rasterize(self.data, proposal)))
        validate_surface_ownership(self.data, surface)
        self.assertEqual(surface['ownership']['regions'][0]['basis'], 'declared-intent')
        self.assertEqual(surface['ownership']['status'], 'UNREVIEWED_SOURCE_OWNERSHIP')
        self.assertEqual(self.data, before)
        surface['labels'][0] = 2
        with self.assertRaisesRegex(ValueError, 'label binding'): validate_surface_ownership(self.data, surface)
        surface = strict_rasterize(self.data, proposal); self.data['rgba'][0] += 1
        with self.assertRaisesRegex(ValueError, 'source binding'): validate_surface_ownership(self.data, surface)

    def test_missing_basis_unknown_convention_and_blank_evidence_fail_closed(self):
        for change in [{'basis': None}, {'basis': 'declared-intent', 'convention': ''},
                       {'basis': 'declared-intent', 'convention': 'make-all-visible'},
                       {'convention': 'receiver-shadow'}, {'reason': ' '}]:
            proposal = self.ownership_proposal(); proposal['regions'][0].update(change)
            with self.assertRaises(ValueError): strict_rasterize(self.data, proposal)
        fields = schema()['properties']['regions']['items']['required']
        self.assertTrue({'basis', 'convention', 'reason'} <= set(fields))

    def test_ownership_binds_orientation_declaration_versions_and_cached_proposal(self):
        data = {**self.data, 'key': 'seat', 'facing': 'se', 'mechanicsDigest': 'first',
                'projectedParts': [], 'model': {'size': [1,1]}}
        proposal = self.ownership_proposal(); surface = strict_rasterize(data, proposal)
        for field, value in [('facing','sw'), ('key','other-seat'), ('mechanicsDigest','second'),
                             ('projectedParts',[{'index':0}]), ('model',{'size':[2,1]})]:
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'source binding'):
                validate_surface_ownership({**data, field:value}, surface)
        for field in ['producerVersion', 'conventionVersion']:
            altered = copy.deepcopy(surface); altered['ownership'][field] += 1
            with self.assertRaisesRegex(ValueError, 'version'): validate_surface_ownership(data, altered)
        changed = copy.deepcopy(proposal); changed['regions'][0]['reason'] = 'Different declaration'
        with self.assertRaisesRegex(ValueError, 'disagrees'):
            validate_surface_ownership(data, surface, changed)

    def test_ordered_regions_and_transparency(self):
        proposal={'regions':[
          {'part':0,'face':2,'boundary':[[0,0],[2,0],[2,2],[0,2]]},
          {'part':1,'face':0,'boundary':[[1,0],[2,0],[2,2],[1,2]]}]}
        surface=rasterize(self.data,proposal)
        self.assertEqual(surface['labels'],[3,4,3,0])
        self.assertEqual(surface['drawing'],'original')
        self.assertEqual(surface['modelParts'],'unchanged')

    def test_missing_opaque_pixels_are_not_filled_with_proxy_guess(self):
        with self.assertRaisesRegex(ValueError,'opaque pixels unclassified'):
            rasterize(self.data,{'regions':[]})

    def test_unknown_part_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'Invalid part'):
            rasterize(self.data,{'regions':[{'part':2,'face':0,'boundary':[[0,0],[2,0],[0,2]]}]})

    def test_rotated_physical_arm_indices_follow_projection_not_local_u(self):
        self.data['rgba']=[20,30,40,255]*4
        self.data['parts']=[{'part':'arm'},{'part':'arm'}]
        self.data['projectedParts']=[{'index':0,'kind':'arm','center':[1.5,1]},
          {'index':1,'kind':'arm','center':[.5,1]}]
        proposal={'regions':[
          {'part':0,'face':1,'boundary':[[0,0],[1,0],[1,2],[0,2]]},
          {'part':1,'face':0,'boundary':[[1,0],[2,0],[2,2],[1,2]]}]}
        original=self.data['rgba'][:]
        self.assertEqual(rasterize(self.data,proposal)['labels'],[5,1,5,1])
        self.assertEqual(self.data['rgba'],original)
        self.assertEqual(proposal['physicalPartAssignments'],[
          {'from':0,'to':1,'kind':'arm'},{'from':1,'to':0,'kind':'arm'}])
        self.assertGreater(proposal['physicalAssignmentDiagnostics'][0]['margin'],0)

    def arm_data(self):
        return {'width':5,'height':2,'rgba':sum(([20,30,40,255] if x!=2 else [0,0,0,0] for y in range(2) for x in range(5)),[]),
          'parts':[{'part':'arm'},{'part':'arm'}],'drawing':'art','modelParts':'parts',
          'projectedParts':[{'index':0,'kind':'arm','center':[1,1]},{'index':1,'kind':'arm','center':[4,1]}]}

    def arm_proposal(self):
        return {'regions':[{'part':0,'face':0,'boundary':[[0,0],[2,0],[2,2],[0,2]]},
          {'part':1,'face':0,'boundary':[[3,0],[5,0],[5,2],[3,2]]}]}

    def test_missing_projected_legend_rejected(self):
        data=self.arm_data();data.pop('projectedParts')
        with self.assertRaisesRegex(ValueError,'legend'):rasterize(data,self.arm_proposal())

    def test_tied_and_low_margin_identities_rejected(self):
        for delta in [0,.001]:
            data=self.arm_data();data['projectedParts'][0]['center']=[2.5,1];data['projectedParts'][1]['center']=[2.5+delta,1]
            proposal=self.arm_proposal()
            with self.assertRaisesRegex(ValueError,'Ambiguous'):rasterize(data,proposal)
            self.assertLessEqual(proposal['physicalAssignmentDiagnostics'][0]['relativeMargin'],.05)

    def test_merged_disconnected_arms_rejected(self):
        proposal=self.arm_proposal();proposal['regions'][1]['part']=0
        with self.assertRaisesRegex(ValueError,'Merged or occluded'):rasterize(self.arm_data(),proposal)

    def test_same_arm_visible_above_and_below_occluding_back_is_allowed(self):
        data={'width':7,'height':5,'rgba':[0]*7*5*4,'parts':[{'part':'arm'},{'part':'arm'}],
          'drawing':'art','modelParts':'parts','projectedParts':[{'index':0,'kind':'arm','center':[.5,2.5]},
          {'index':1,'kind':'arm','center':[6.5,2.5]}]}
        for y in range(5):
            for x in [0,6]:
                if x==0 and y==2:continue
                data['rgba'][(y*7+x)*4:(y*7+x+1)*4]=[20,30,40,255]
        proposal={'regions':[{'part':0,'face':1,'boundary':[[0,0],[1,0],[1,5],[0,5]]},
          {'part':1,'face':1,'boundary':[[6,0],[7,0],[7,5],[6,5]]}]}
        labels=rasterize(data,proposal)['labels']
        self.assertEqual([labels[y*7] for y in range(5)],[2,2,0,2,2])
        self.assertEqual(proposal['physicalPartAssignments'],[])
        self.assertTrue(all(c['clear'] and c['part']==0 for c in proposal['physicalAssignmentDiagnostics'][0]['componentChecks'][0]['components']))

    def test_missing_far_arm_not_guessed_into_existence(self):
        data=self.arm_data();data['rgba'][3*4:5*4]=[0]*8;data['rgba'][8*4:10*4]=[0]*8
        proposal=self.arm_proposal();before=copy.deepcopy(data)
        result=rasterize(data,proposal)
        self.assertEqual({(v-1)//3 for v in result['labels'] if v},{0})
        self.assertEqual(data,before)

    def test_correct_identity_is_not_swapped(self):
        proposal=self.arm_proposal();rasterize(self.arm_data(),proposal)
        self.assertEqual(proposal['physicalPartAssignments'],[])

    def wrap_data(self):
        data=self.arm_data()
        data['rgba']=[20,30,40,255]*10
        data['model']={'size':[1,1]}
        data['parts']=[{'part':'wrap','u':[.05,.25]}, {'part':'wrap','u':[.75,.95]}, {'part':'wrap','u':[.15,.85]}]
        data['projectedParts']=[{'index':0,'kind':'wrap','center':[4,1]},
          {'index':1,'kind':'wrap','center':[1,1]}, {'index':2,'kind':'wrap','center':[2.5,1]}]
        return data

    def wrap_proposal(self):
        proposal=self.arm_proposal()
        proposal['regions'].append({'part':2,'face':0,'boundary':[[2,0],[3,0],[3,2],[2,2]]})
        return proposal

    def test_side_wraps_bind_by_projection_without_swapping_center_back(self):
        data=self.wrap_data();proposal=self.wrap_proposal();original=copy.deepcopy(data)
        self.assertEqual(rasterize(data,proposal)['labels'],[4,4,7,1,1]*2)
        self.assertEqual(data,original)
        self.assertEqual(proposal['physicalPartAssignments'],[
          {'from':0,'to':1,'kind':'side-wrap'},{'from':1,'to':0,'kind':'side-wrap'}])

    def test_disconnected_opposite_side_wraps_cannot_merge(self):
        proposal=self.wrap_proposal();proposal['regions'][1]['part']=0
        with self.assertRaisesRegex(ValueError,'Merged or occluded side-wrap'):
            rasterize(self.wrap_data(),proposal)

    def test_wrap_identity_requires_size_and_complete_projected_sides(self):
        data=self.wrap_data();data.pop('model')
        with self.assertRaisesRegex(ValueError,'model size'):rasterize(data,self.wrap_proposal())
        data=self.wrap_data();data['projectedParts']=data['projectedParts'][1:]
        with self.assertRaisesRegex(ValueError,'legend'):rasterize(data,self.wrap_proposal())

    def test_side_wrap_tie_is_not_certified(self):
        data=self.wrap_data();data['projectedParts'][0]['center']=[2.5,1];data['projectedParts'][1]['center']=[2.5,1]
        with self.assertRaisesRegex(ValueError,'Ambiguous'):rasterize(data,self.wrap_proposal())

    def test_cross_view_context_contains_beauty_only_and_skips_duplicate_primary(self):
        data={**self.data,'facing':'nw'}
        data['sourceViews']={'nw':{'width':2,'height':2,'rgba':self.data['rgba'][:]},
          'se':{'width':1,'height':1,'rgba':[1,2,3,255],'anchor':[0,1],
                'sitterMask':'DO_NOT_EXPOSE','expectedWinner':'DO_NOT_EXPOSE','surfaceLabels':'DO_NOT_EXPOSE'}}
        content=source_view_context(data)
        self.assertEqual([c['type'] for c in content],['input_text','input_image'])
        self.assertIn('facing se',content[0]['text'])
        self.assertNotIn('DO_NOT_EXPOSE',str(content))
        self.assertTrue(content[1]['image_url'].startswith('data:image/png;base64,'))

    def test_cross_view_context_rejects_stale_primary_and_invalid_rgba(self):
        data={**self.data,'facing':'nw','sourceViews':{'nw':{'width':2,'height':2,'rgba':[1,2,3,255]*4}}}
        with self.assertRaisesRegex(ValueError,'Primary-facing'):source_view_context(data)
        data['sourceViews']={'se':{'width':1,'height':1,'rgba':[1,2,3,999]}}
        with self.assertRaisesRegex(ValueError,'RGBA'):source_view_context(data)
        data['sourceViews']={'north':{'width':1,'height':1,'rgba':[1,2,3,255]}}
        with self.assertRaisesRegex(ValueError,'facing'):source_view_context(data)

if __name__=='__main__':unittest.main()
