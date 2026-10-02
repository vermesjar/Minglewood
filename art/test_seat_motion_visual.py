import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
import seat_motion_visual as motion

class MotionVisualTests(unittest.TestCase):
    def test_exact_request_images_and_completed_response_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);image=root/'frame.png';Image.new('RGBA',(2,2),'red').save(image)
            m={'key':'test','contexts':[{'id':f'{f}-L{l}','frames':[{}],'pages':[{'image':motion.proof(image,root)}]} for f in ['se','sw','ne','nw'] for l in range(4)]}
            path=root/'manifest.json';path.write_text(json.dumps(m));seen=[]
            def provider(payload):
                seen.append(payload)
                contexts=[{'id':c['id'],'verdict':'pass','reason':'Mock independent whole-film review','issues':[],'uncertainties':[],'risks':[]} for c in m['contexts']]
                return {'status':'completed','metadata':payload['metadata'],'output':[{'content':[{'type':'output_text','text':json.dumps({'contexts':contexts})}]}]}
            decision=motion.review(path,root,provider=provider);d=json.loads(decision.read_text())
            self.assertEqual(d['manifestSha256'],motion.sha(path));self.assertEqual(len(seen[0]['input'][0]['content']),33)
            request=json.loads(motion.checked(d['provenance']['request'],root).read_text());self.assertEqual(request,seen[0])
            response=motion.checked(d['provenance']['response'],root);old=json.loads(response.read_text());old['metadata']['seat_motion_manifest']='old';response.write_text(json.dumps(old))
            with self.assertRaisesRegex(ValueError,'different images'):motion.review(path,root,provider=provider)

    def test_full_film_pages_cannot_use_small_fixed_budget_reservation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);image=root/'page.png';Image.new('RGBA',(2,2),'red').save(image)
            m={'key':'test','contexts':[{'id':f'se-L{i}','frames':[{}],'pages':[{'image':motion.proof(image,root)}]} for i in range(16)]}
            path=root/'manifest.json';path.write_text(json.dumps(m))
            with patch('studio.spent',return_value=0),patch('studio.cap',return_value=2),patch('studio.post') as post:
                with self.assertRaisesRegex(RuntimeError,'complete evidence'):motion.review(path,root,allow_paid=True)
                post.assert_not_called()

    def test_no_implicit_paid_request(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);path=root/'manifest.json';path.write_text(json.dumps({'key':'test','contexts':[]}))
            with self.assertRaisesRegex(RuntimeError,'paid review disabled'):motion.review(path,root)
            self.assertFalse((root/'decision.json').exists())

if __name__=='__main__':unittest.main()
