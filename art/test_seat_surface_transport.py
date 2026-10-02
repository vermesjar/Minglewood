"""A semantic model must reach the common publication gate without being discarded."""
import argparse
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import designlab
import studio


class StopBeforePublish(Exception):
    pass


class SeatSurfaceTransportTests(unittest.TestCase):
    def test_design_lab_passes_checked_model_to_publication_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "stage").mkdir()
            model = {"surfaces": {"nw": {"drawing": "12345678", "labels": [1, 0]}}}
            draft = {"key": "seat-test", "views": {"nw": {"accepted": True}}, "furniture": {"seatModel": {"model": model}}}
            entry = {"walk": "seat", "seat": 10}

            def intercept(args, _label):
                self.assertEqual(args[0], "lab-publish")
                staged = json.loads(Path(args[args.index("--entries") + 1]).read_text())
                self.assertEqual(staged["seat-test"]["seatModel"], model)
                raise StopBeforePublish()

            with patch.object(designlab, "draft_dir", return_value=root), \
                 patch.object(designlab, "load", return_value=draft), \
                 patch.object(designlab, "stage", return_value=(entry, root)), \
                 patch.object(designlab, "seat_checks", return_value=[]), \
                 patch.object(designlab, "studio_json", side_effect=intercept):
                with self.assertRaises(StopBeforePublish):
                    designlab.cmd_furniture_publish(argparse.Namespace(draft="unused"))

    def test_common_compiler_receives_exact_surface_metadata(self):
        model = {"surfaces": {"nw": {"drawing": "12345678", "labels": [1, 0]}}}
        entries = {"seat-test": {"walk": "seat", "seat": 10, "seatModel": model}}

        def inspect(command, **_kwargs):
            staged = json.loads(Path(command[command.index("--entries") + 1]).read_text())
            self.assertEqual(staged, entries)
            return SimpleNamespace(returncode=0)

        with patch.object(studio.subprocess, "run", side_effect=inspect):
            studio.compile_publication_seats(entries)


if __name__ == "__main__":
    unittest.main()
