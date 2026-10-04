"""Update only the public signature fields in a packaged release manifest."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


ALLOWED = {"signed", "unsigned_external_required"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("status", choices=sorted(ALLOWED))
    parser.add_argument("--signer", default="")
    args = parser.parse_args()
    value = json.loads(args.manifest.read_text(encoding="utf-8"))
    value["signatureStatus"] = args.status
    value["signer"] = args.signer if args.status == "signed" else ""
    args.manifest.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
