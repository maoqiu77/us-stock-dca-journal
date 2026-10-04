from __future__ import annotations

import importlib.util
import io
import os
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]


class ApiTestRunnerTest(unittest.TestCase):
    def runner(self):
        path = ROOT / 'scripts/test_api.py'
        self.assertTrue(path.is_file(), 'isolated dual-mode test runner is missing')
        spec = importlib.util.spec_from_file_location('api_test_runner', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_agent_skips_fail_but_base_skips_are_explicit(self):
        runner = self.runner()
        class OptionalCase(unittest.TestCase):
            @unittest.skip('optional Agent runtime')
            def test_optional(self):
                pass
        for mode, expected in [('agent', 1), ('base', 0)]:
            stream = io.StringIO()
            code = runner.run_suite(unittest.defaultTestLoader.loadTestsFromTestCase(OptionalCase), mode, stream)
            self.assertEqual(code, expected)
            self.assertIn('skipped=1', stream.getvalue())

    def test_empty_suite_fails_in_both_modes(self):
        for mode in ('base', 'agent'):
            self.assertEqual(self.runner().run_suite(unittest.TestSuite(), mode, io.StringIO()), 1)

    def test_isolation_overrides_private_paths_and_restores_environment(self):
        runner = self.runner()
        with patch.dict(os.environ, {'STOCK_APP_DATA_HOME': '/never-use-private', 'STOCK_APP_DB_PATH': '/never-use-private/app.db'}):
            with runner.isolated_data() as home:
                self.assertNotEqual(str(home), '/never-use-private')
                self.assertEqual(os.environ['STOCK_APP_DB_PATH'], str(home / 'app.db'))
                self.assertTrue(home.is_dir())
            self.assertFalse(home.exists())
            self.assertEqual(os.environ['STOCK_APP_DATA_HOME'], '/never-use-private')

    def test_mode_preflight_rejects_mislabeled_environment(self):
        runner = self.runner()
        self.assertIsNotNone(runner.mode_error('agent', False))
        self.assertIsNotNone(runner.mode_error('base', True))
        self.assertIsNone(runner.mode_error('agent', True))
        self.assertIsNone(runner.mode_error('base', False))
