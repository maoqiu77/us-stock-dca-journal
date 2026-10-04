"""Archive a clean, committed source tree; never recurse through runtime data."""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import tempfile


def create_archive(root: Path, destination: Path):
    root, destination = root.resolve(), destination.resolve()
    status = subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain', '-z'])
    if status:
        raise ValueError('Source archive requires a clean committed worktree; no stash/reset is performed.')
    if destination.exists():
        raise ValueError('Destination exists; use a new version/path to preserve the previous artifact.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='source-archive-') as temp:
        archive = Path(temp) / 'source.zip'
        subprocess.run(['git', '-C', str(root), 'archive', '--format=zip', f'--output={archive}', 'HEAD'], check=True)
        with destination.open('xb') as output, archive.open('rb') as source:
            import shutil
            shutil.copyfileobj(source, output)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    try:
        print(create_archive(Path(__file__).resolve().parents[1], args.destination))
    except (ValueError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'{exc}\n')


if __name__ == '__main__':
    main()
