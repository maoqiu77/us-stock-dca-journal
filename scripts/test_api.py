"""Run the complete API suite in a disposable data home, never the real ledger."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import importlib.metadata as metadata
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def isolated_data():
    keys = ('STOCK_APP_DATA_HOME', 'STOCK_APP_DB_PATH', 'PATH')
    previous = {key: os.environ.get(key) for key in keys}
    with tempfile.TemporaryDirectory(prefix='stock-api-tests-') as directory:
        home = Path(directory) / 'local'
        home.mkdir()
        os.environ['STOCK_APP_DATA_HOME'] = str(home)
        os.environ['STOCK_APP_DB_PATH'] = str(home / 'app.db')
        os.environ['PATH'] = str(Path(sys.executable).parent) + os.pathsep + os.environ.get('PATH', '')
        try:
            yield home
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


def agent_lock_error():
    from packaging.requirements import Requirement
    lock = ROOT / 'apps/api/requirements-agent.lock'
    if not lock.is_file():
        return 'Agent mode requires apps/api/requirements-agent.lock.'
    try:
        for line in lock.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            requirement = Requirement(line)
            if requirement.marker and not requirement.marker.evaluate():
                continue
            installed = metadata.version(requirement.name)
            if installed not in requirement.specifier:
                return f'Agent dependency lock mismatch: {requirement.name} {installed} not in {requirement.specifier}.'
    except metadata.PackageNotFoundError as exc:
        return f'Agent dependency missing: {exc.name}.'
    return None


def mode_error(mode, agent_available, lock_error=None):
    if mode == 'agent' and not agent_available:
        return 'Agent mode requires Python 3.12+ and requirements-agent.lock; refusing skipped acceptance.'
    if mode == 'agent' and lock_error:
        return lock_error
    if mode == 'base' and agent_available:
        return 'Base mode requires a separate environment without Agent dependencies.'
    return None


def run_suite(suite, mode, stream):
    result = unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)
    stream.write(f'API mode={mode} tests={result.testsRun} skipped={len(result.skipped)}\n')
    if mode == 'base':
        stream.write('Base acceptance does NOT verify optional Agent execution.\n')
    return int(not result.wasSuccessful() or result.testsRun == 0 or (mode == 'agent' and bool(result.skipped)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('base', 'agent'), required=True)
    args = parser.parse_args()
    if sys.version_info < (3, 12):
        print('API tests require Python 3.12+; use the project base or Agent interpreter.', file=sys.stderr)
        return 2
    sys.path.insert(0, str(ROOT / 'apps/api'))
    with isolated_data():
        try:
            import packaging  # required by launcher lock validation in both suites
            from app.modules.ai_journal.agent.model import runtime_available
        except ImportError as exc:
            print(f'Missing test dependency: {exc.name}; install the selected requirements in this interpreter.', file=sys.stderr)
            return 2
        lock_error = agent_lock_error() if args.mode == 'agent' else None
        error = mode_error(args.mode, runtime_available(), lock_error)
        if error:
            print(error, file=sys.stderr)
            return 2
        suite = unittest.defaultTestLoader.discover(str(ROOT / 'apps/api/tests'), pattern='test_*.py')
        return run_suite(suite, args.mode, sys.stderr)


if __name__ == '__main__':
    raise SystemExit(main())
