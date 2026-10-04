from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('public_safety', ROOT / 'scripts/check_public_safety.py')
safety = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safety)


class ReleaseSourceSafetyTest(unittest.TestCase):
    def test_chinese_paths_are_scanned_and_private_symlinks_not_read(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            (root / '说明.md').write_text('public documentation')
            with patch.object(safety, 'ROOT', root):
                self.assertIn(root / '说明.md', safety.candidate_files())
                (root / '说明.md').write_text('api_key' + ' = ' + repr('synthetic-fixture'))
                self.assertEqual(safety.main(), 1)
                (root / '说明.md').write_text('public documentation')
                (root / 'private-link').symlink_to(root / '说明.md')
                self.assertEqual(safety.main(), 1)

    def test_source_archive_refuses_dirty_tree_and_excludes_ignored_files(self):
        script = ROOT / 'scripts/create_source_archive.py'
        self.assertTrue(script.exists(), 'safe source archive entry is missing')
        import zipfile
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'repo'; root.mkdir()
            def git(*args):
                return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True)
            git('init', '-q')
            (root / '.gitignore').write_text('storage/local/\noutput/\n')
            (root / '公开.md').write_text('synthetic release')
            git('add', '.')
            git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'fixture')
            (root / 'storage/local').mkdir(parents=True)
            (root / 'storage/local/private.txt').write_text('synthetic private sentinel')
            output = Path(temp) / 'release.zip'
            spec = importlib.util.spec_from_file_location('source_archive', script)
            archive = importlib.util.module_from_spec(spec); spec.loader.exec_module(archive)
            archive.create_archive(root, output)
            with zipfile.ZipFile(output) as zipped:
                self.assertIn('公开.md', zipped.namelist())
                self.assertNotIn('storage/local/private.txt', zipped.namelist())
            original = output.read_bytes()
            (root / '公开.md').write_text('uncommitted')
            with self.assertRaises(ValueError):
                archive.create_archive(root, output)
            self.assertEqual(output.read_bytes(), original)
