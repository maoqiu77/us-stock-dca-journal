# Release Bundle Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce verified Windows and macOS release archives that start on loopback and do not create duplicate platform processes.

**Architecture:** Preserve the entire Next.js standalone tree and calculate the actual app root from `server.js`. Copy static and public assets relative to that root, validate the assembled package on both CI runners, and make launchers resolve the same layout. Launchers use the health endpoints as the ownership-safe duplicate-start signal.

**Tech Stack:** GitHub Actions, Bash, PowerShell, Python `unittest`, Next.js standalone output.

**Spec:** `docs/superpowers/specs/2026-09-05-release-bundle-hardening-design.md`

## Global Constraints

- Keep all runtime data under `storage/local`; never package it.
- Bind packaged web processes only to `127.0.0.1`.
- Support both flat (`web/server.js`) and nested (`web/apps/web/server.js`) standalone layouts.
- Verify release package contents before creating the ZIP on every release runner.

---

### Task 1: Verify package layout

**Files:**
- Create: `scripts/verify_release_bundle_layout.py`
- Create: `apps/api/tests/test_release_bundle_layout.py`

**Interfaces:**
- Consumes: `--package <directory>` and `--platform <windows-x64|macos-*>`.
- Produces: exit code 0 only when the platform executable, launcher, updater, release metadata, server entry point, static assets, and public assets are present.

- [x] **Step 1: Write failing tests**

```python
result = run_verifier(package_dir, "windows-x64")
self.assertEqual(result.returncode, 0)
self.assertIn("web/apps/web/server.js", result.stdout)
```

- [x] **Step 2: Run the focused test and confirm it fails because the verifier does not exist.**

- [x] **Step 3: Implement the verifier with flat and nested entry-point discovery.**

- [x] **Step 4: Run the focused tests and confirm valid packages pass.**

### Task 2: Assemble and check both release layouts

**Files:**
- Modify: `.github/workflows/build-release-packages.yml`
- Test: `apps/api/tests/test_release_bundle_layout.py`

**Interfaces:**
- Consumes: the Next standalone directory and `scripts/verify_release_bundle_layout.py`.
- Produces: an archive tree whose static and public assets are siblings of the detected `server.js`.

- [x] **Step 1: Add a failing assertion that the workflow invokes the verifier after package assembly.**
- [x] **Step 2: Run the focused test and confirm it fails because no package-layout verification exists.**
- [x] **Step 3: Detect the nested app root in Bash and PowerShell, copy static/public assets there, and invoke the verifier before compression.**
- [x] **Step 4: Run the focused tests and assemble a local production package to confirm its entry point and assets pass verification.**

### Task 3: Harden launchers

**Files:**
- Modify: `scripts/windows/Start-StockPlatform.ps1`
- Modify: `scripts/macos/Start-StockPlatform.command`
- Test: `apps/api/tests/test_release_bundle_layout.py`

**Interfaces:**
- Consumes: local health endpoints and either supported web entry-point layout.
- Produces: loopback-only listeners and safe reuse of a healthy existing platform.

- [x] **Step 1: Add a failing source-contract assertion that both launchers bind to `127.0.0.1`, detect an existing healthy platform, and resolve the nested entry point.**
- [x] **Step 2: Run the focused test and confirm it fails on current wide binding and missing duplicate-start handling.**
- [x] **Step 3: Implement loopback binding, health-based reuse, nested-entry fallback, and Windows owned-process cleanup.**
- [x] **Step 4: Run the focused tests and release-readiness check.**

### Task 4: Validate and publish v1.3.1

**Files:**
- Modify: the release-fix files above and the existing QQQ/SPY defaults files only.

**Interfaces:**
- Consumes: a clean `main` branch and GitHub credentials.
- Produces: pushed `main`, tag `v1.3.1`, and three release assets.

- [x] **Step 1: Run `npm run check` and verify the canonical 3000 UI against an isolated API database.**
- [ ] **Step 2: Review the staged diff for public/private-data safety, commit, and push `main`.**
- [ ] **Step 3: Create and push `v1.3.1`; wait for all GitHub Actions jobs and inspect the attached archives.**
