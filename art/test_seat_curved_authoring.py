import unittest
import numpy as np
from seat_curved_authoring import Profile,height,intersect,rays,sample


class CurvedAuthoringTests(unittest.TestCase):
    def test_continuous_rim_and_low_trough(self):
        p=Profile();u=np.linspace(.01,.99,1000);v=np.full_like(u,.6)
        self.assertLess(float(np.max(np.abs(np.diff(height(p,u,v))))),.15)
        self.assertGreater(float(height(p,.5,p.contact_v+.2)),float(height(p,.5,p.contact_v-.2)))
        self.assertEqual(float(height(p,1.1,.5)),0)
        self.assertAlmostEqual(float(height(p,p.contact_u,p.contact_v)),p.seat)

    def test_reprojection_and_surface_residual(self):
        p=Profile()
        for facing in ['ne','nw','se','sw']:
            v={'facing':facing,'width':72,'height':68,'anchor':[36,20]}
            z,n=sample(p,v);u0,v0,du,dv=rays(v);valid=np.isfinite(z)
            self.assertGreater(int(valid.sum()),500)
            u=(u0+du*z)[valid];vv=(v0+dv*z)[valid]
            cap_error=np.abs(z[valid]-height(p,u,vv))
            side_error=np.abs(((u-p.cu)/p.ru)**2+((vv-p.cv)/p.rv)**2-1)
            self.assertTrue(bool(np.all((cap_error<.004)|((side_error<1e-5)&(z[valid]<=p.skirt+.004)))))
            self.assertLess(float(np.max(np.abs(np.linalg.norm(n[valid],axis=1)-1))),1e-8)
            self.assertTrue(bool(np.all((z[valid]>=0)&(z[valid]<=p.seat+p.rise))))

    def test_view_mirroring(self):
        p=Profile()
        a={'facing':'ne','width':72,'height':68,'anchor':[36,20]}
        b={**a,'facing':'nw'}
        x=intersect(p,a);y=intersect(p,b)
        self.assertTrue(np.array_equal(np.isfinite(x),np.isfinite(y[:,::-1])))
        self.assertLess(float(np.nanmax(np.abs(x-y[:,::-1]))),1e-8)


if __name__=='__main__':unittest.main()
