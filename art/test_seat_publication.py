"""Publication must stop before copying art when the seating compiler refuses it."""
import argparse
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import json
import studio


class SeatPublicationTests(unittest.TestCase):
    def test_non_seating_does_not_compile(self):
        with patch.object(studio.subprocess, "run") as run:
            studio.compile_publication_seats({"lamp": {"walk": "blocked"}})
            run.assert_not_called()

    def test_compiler_failure_is_fatal(self):
        with patch.object(studio.subprocess, "run", return_value=SimpleNamespace(returncode=1, stderr="bad arm boundary", stdout="")):
            with self.assertRaisesRegex(RuntimeError, "bad arm boundary"):
                studio.compile_publication_seats({"custom-seat": {"walk": "seat", "seat": 10}})

    def test_publication_uses_shared_compiler_and_writes_model(self):
        with patch.object(studio.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
            studio.compile_publication_seats({"custom-seat": {"walk": "seat", "seat": 10}})
            command = run.call_args.args[0]
            self.assertIn("scripts/seat-compile.ts", command)
            self.assertIn("--write", command)
            self.assertEqual(command[command.index("--keys") + 1], "custom-seat")

    def test_lab_publish_does_not_copy_or_save_after_seat_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            entries = Path(tmp) / "entries.json"
            entries.write_text(json.dumps({"custom-seat": {"walk": "seat", "seat": 10}}))
            args = argparse.Namespace(entries=str(entries), sprites=tmp, overwrite=False)
            with patch.object(studio, "ManifestLock"), patch.object(studio, "load_manifest", return_value={"sprites": {}}), \
                 patch.object(studio, "model_check", return_value={"ok": True}), \
                 patch.object(studio, "compile_publication_seats", side_effect=RuntimeError("bad seating")), \
                 patch.object(studio.shutil, "copyfile") as copy, patch.object(studio, "save_manifest") as save:
                with self.assertRaisesRegex(RuntimeError, "bad seating"):
                    studio.cmd_lab_publish(args)
                copy.assert_not_called()
                save.assert_not_called()


if __name__ == "__main__":
    unittest.main()
