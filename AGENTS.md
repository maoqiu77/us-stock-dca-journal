# Project Agent Rules

This project is the new shadcn/Next/FastAPI implementation. Do not edit the older Streamlit project when working here.

## Scope

- Keep changes small and tied to the requested feature.
- Prefer existing shadcn components and local feature folders.
- Preserve the public/private data boundary.

## Public/Private Data

- Public examples live in `storage/templates`.
- Private runtime data lives in `storage/local` and must stay gitignored.
- Do not commit real portfolio data, trading logs, account identifiers, API keys, cookies, exported broker files, or local SQLite databases.

## Frontend

- Use shadcn/ui components before custom markup.
- Use semantic CSS variables and Tailwind tokens.
- Use `gap-*`, not `space-*`.
- Client components that use browser APIs must include `"use client"`.
- Chart code belongs under `apps/web/src/features/charts`.

## Backend

- Keep the FastAPI API local-first.
- External market providers must degrade to deterministic sample data so the UI remains usable.
- Runtime writes must target `storage/local` by default.

## Local Runtime

- Treat `http://127.0.0.1:3000` as the canonical frontend and `http://127.0.0.1:8000` as the canonical API.
- Reuse the project runtime started by `一键打开股票交易平台.command`; it runs Next.js in development mode with hot reload.
- Do not start a persistent frontend on `3001` or another port when `3000` is already owned by this project.
- Identify process ownership before stopping or restarting a service. Ask before interrupting a user-owned runtime.
- Use another port only for a necessary temporary check, and stop that temporary process before completion.
- Verify user-facing changes on the canonical `3000` page. Do not claim completion based only on a temporary port or static checks.
- If a dependency, environment, or configuration change requires a restart, state that clearly and ask before restarting the canonical runtime.
