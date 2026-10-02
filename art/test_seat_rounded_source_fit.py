import copy
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
import seat_rounded_source_fit as fit
import seat_rounded_diagnostic as geometry
from seat_rounded_reference import interval


class SourceFitTests(unittest.TestCase):
    def original(self):
        return {'size':[2,1],'sits':[[.63,.615,10.15],[1.37,.615,10.15]],
                'parts':[{'part':'seat','u':[.25,1.75],'v':[.1,.71],'z':[8.65,10.15]}]}

    def test_parameters_preserve_contacts_symmetry_and_tied_arm_radii(self):
        original=self.original();before=copy.deepcopy(original)
        p={name:spec[0] for name,spec in fit.PARAMETERS.items()};model=fit.model_from(p,original)
        self.assertEqual(model['sits'],original['sits']);self.assertEqual(original,before)
        for a,b in zip(model['parts'][2]['u'],[2-v for v in reversed(model['parts'][3]['u'])]):self.assertAlmostEqual(a,b)
        declaration=geometry.declare(model)
        self.assertAlmostEqual(declaration['components'][2]['radius'],declaration['components'][3]['radius'])
        self.assertEqual(geometry.contacts_problems(declaration),[])

    def test_fitting_approximation_agrees_with_analytical_front(self):
        model=fit.model_from({name:spec[0] for name,spec in fit.PARAMETERS.items()},self.original())
        declaration=geometry.declare(model)
        rays=[geometry.ray([64,29],[2,1],f,x+.5,y+.5) for f in geometry.FACINGS
              for y in range(0,77,9) for x in range(0,96,11)]
        depths,roles=fit.vector_front(declaration,np.array([r[0] for r in rays]),np.array([r[1] for r in rays]))
        for j,(origin,direction) in enumerate(rays):
            hits=[interval(p['bounds'],p['radius'],origin,direction) for p in declaration['components']]
            hits=[h[1] for h in hits if h]
            self.assertEqual(bool(hits),bool(np.isfinite(depths[j])))
            if hits:self.assertAlmostEqual(max(hits),depths[j],places=4)

    def test_original_body_or_expected_winner_payload_cannot_change_fit_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);inputs=root/'inputs';inputs.mkdir();maps=root/'maps';maps.mkdir()
            a={'width':8,'height':8,'anchor':[4,4],'rgba':[20,40,20,255]*64}
            for f in geometry.FACINGS:(inputs/(f+'.json')).write_text(json.dumps({'sourceArt':a,'contexts':[{'winner':'avatar'}]}))
            before,_=fit.source_targets(inputs,maps,self.original(),2)
            for f in geometry.FACINGS:(inputs/(f+'.json')).write_text(json.dumps({'sourceArt':a,'contexts':[{'winner':'furniture','mask':[1]*64}]}))
            after,_=fit.source_targets(inputs,maps,self.original(),2)
            for left,right in zip(before,after):
                for key in ['origins','directions','alpha','roles']:np.testing.assert_array_equal(left[key],right[key])
            (maps/'sw').mkdir();(maps/'sw'/'surface.json').write_text(json.dumps({'width':8,'height':8,'drawing':'stale','modelParts':json.dumps(self.original()['parts']),'labels':[1]*64}))
            with self.assertRaisesRegex(ValueError,'stale'):fit.source_targets(inputs,maps,self.original(),2)


if __name__=='__main__':unittest.main()
