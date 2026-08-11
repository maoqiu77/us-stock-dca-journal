# Contributing

Thank you for contributing to Stock Trading Platform Next.

## Before you start

- Search existing issues before opening a new one.
- Use an issue to discuss large behavioral or architectural changes first.
- Never commit real account data, portfolio data, trade records, broker exports,
  API keys, cookies, logs, or local databases.
- Keep private runtime data under `storage/local/`. Public examples belong under
  `storage/templates/` and must contain synthetic data only.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md), not in a
  public issue.

## Development setup

The project requires Python 3.12+ and Node.js 24.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r apps/api/requirements.txt
npm --prefix apps/web ci
```

Start the API and web application in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

## Required checks

Run the complete check suite before submitting a pull request:

```bash
npm run check
```

Pull requests should be focused, explain the user-visible impact, and include
tests for changed behavior. Do not mix unrelated refactoring or formatting into
a functional change.

## Pull requests

- Describe what changed and why.
- Link the related issue when one exists.
- State how the change was tested.
- Call out changes involving credentials, network requests, local file writes,
  subprocesses, dependencies, release artifacts, or update behavior.
- Maintainer review is required before merge or release.
