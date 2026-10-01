#!/usr/bin/env python3
"""Evaluate public synthetic originals offline; never reads model configuration."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps' / 'api'))

from app.modules.ai_journal.agent.evaluation import comparison_template, evaluate_retrieval


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'storage/templates/ai-journal-agent-evaluation.json')
    parser.add_argument('--comparison-template', action='store_true')
    args = parser.parse_args()
    dataset = json.loads(args.input.read_text(encoding='utf-8'))
    report = comparison_template(dataset) if args.comparison_template else evaluate_retrieval(dataset)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if args.comparison_template or report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
