import ast
import math
import os
import unittest
from pathlib import Path

class MotionHeightTests(unittest.TestCase):
    def setUp(self):
        path=Path(os.environ.get('SEAT_HEIGHT_CHECKER','scripts/seat-motion-postcheck.py'))
        tree=ast.parse(path.read_text())
        function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='exact_height')
        scope={'math':math,'height_offsets':{'sit-floor':7.,'sit':8.}}
        exec(compile(ast.Module(body=[function],type_ignores=[]),str(path),'exec'),scope)
        self.matches=scope['exact_height']

    def test_rounded_identical_exit_frame_has_different_physical_height(self):
        settled={'pose':'sit-floor','lift':4.65}; context={'height':11.65}
        self.assertTrue(self.matches(settled,{},context))
        self.assertFalse(self.matches({**settled,'lift':4.65091892904271},{},context))
        self.assertFalse(self.matches({**settled,'lift':4.65+1e-7},{},context))

    def test_world_elevation_is_removed_and_unknown_pose_does_not_match(self):
        self.assertTrue(self.matches({'pose':'sit','lift':6.125},{'z':2.5},{'height':11.625}))
        self.assertFalse(self.matches({'pose':'sit','lift':6.125},{'z':2.},{'height':11.625}))
        self.assertFalse(self.matches({'pose':'not-recorded','lift':3},{},{'height':3}))

if __name__=='__main__':unittest.main()
