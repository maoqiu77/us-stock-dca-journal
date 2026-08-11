# Security Policy

## Supported versions

Security fixes are provided for the latest release. Users should upgrade to the
newest available version before reporting a problem that only affects an older
release.

## Reporting a vulnerability

Please do not disclose vulnerabilities, credentials, account data, portfolio
data, trade records, or reproduction data in a public issue.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/maoqiu77/stock-trading-platform-next/security/advisories/new>

Include the affected version, impact, reproduction steps, and any suggested
mitigation. Remove all real credentials and financial data from the report.
The maintainer will acknowledge the report, investigate it, and coordinate a
fix and disclosure when appropriate.

For ordinary bugs that do not contain sensitive information or create a
security impact, use the public issue tracker.

## Scope notes

The application stores runtime data locally and may connect to market-data and
user-configured AI providers. Public releases contain sample data only. The AI
features provide advice and do not place trades.
