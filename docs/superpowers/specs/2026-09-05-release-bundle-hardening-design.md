# Release Bundle Hardening Design

## Goal

Ensure the tagged Windows and macOS archives start reliably, remain loopback-only, and keep their process metadata valid across repeated launches.

## Design

Next.js may place its standalone entry point either at `web/server.js` or at `web/apps/web/server.js`, depending on the workspace tracing root. The release workflow will retain the complete standalone tree, copy static and public assets beside the detected entry point, and run a platform-neutral verifier on the assembled package before zipping it. Launchers will resolve the same two supported entry-point layouts.

Packaged launchers will bind the web process to `127.0.0.1`. Before starting new children, they will detect a healthy existing local platform and open it rather than clear PID files or start duplicates. The Windows launcher will remove only the PIDs for processes it started when its own session exits.

## Verification

Unit tests exercise the release-package verifier and assert loopback binding plus workflow verification. The full project check, a local standalone-package assembly, the canonical 3000 UI flow, and the tagged GitHub Actions release workflow provide successive verification layers.
