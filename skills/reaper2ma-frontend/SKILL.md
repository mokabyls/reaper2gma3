---
name: reaper2ma-frontend
description: Project-specific guidance for updating the Reaper2MA React/Vite static frontend, local project library, styling, accessibility, assets, base-path handling, build scripts, or GitHub Pages deployment.
---

# Reaper2MA Frontend

## Overview

Use this skill for the React/Vite product surface while preserving its static, browser-only behavior. Conversion logic belongs in `src/lib/reaper2ma/`; versioned project persistence belongs in `src/lib/projects/`.

## First steps

1. Read `research.md` for current architecture, validation and watchpoints.
2. Inspect `src/App.tsx`, then only the relevant component or service.
3. Use pnpm, not yarn.
4. Keep the app deployable as static files under `/reaper2ma/` in production.

## React and storage constraints

- Vite builds one SPA into `build/`; development base is `/` and production base is `/reaper2ma/`.
- There are no server endpoints. File analysis and XML/ZIP generation stay in the browser.
- Project data uses the `ProjectRepository` interface and IndexedDB implementation. Do not put CSV or project documents in cookies/localStorage.
- Only language/theme and legacy first-project defaults use localStorage.
- Keep wizard state typed and persisted through the existing project model.
- Generated XML, ZIP and timeline data are derived; do not persist them.

## UI guidance

- With no projects, show the creation question; with projects, show the library rather than a marketing page.
- Preserve click, keyboard and drag/drop file input.
- Keep project and timecode identity independent after creation.
- Reveal expert settings progressively and retain every existing conversion option.
- Desktop region browsing uses a grid plus one mounted marker panel; mobile uses accordions. Keep long lists virtualized.
- The canvas timeline is an optional visual inspector, never the only accessible representation.
- Maintain French/English copy, dynamic document language, system/light/dark themes and responsive layouts.
- Prefer labeled controls, inline errors, focus-safe dialogs and reduced-motion support.

## Build and deployment

- Canonical validation is `pnpm test`, `pnpm check` and `pnpm build`.
- GitHub Actions must install with `pnpm install --frozen-lockfile`.
- Do not commit `node_modules`, `.test-build` or `build`.
- Use Vite-managed asset imports or base-safe URLs because production runs under `/reaper2ma/`.

## Watchpoints

- IndexedDB transactions that replace a project must remain atomic.
- Never auto-delete projects when quota is low.
- Pointer and trackpad timeline changes need mouse, touch and resize coverage.
- Avoid moving grandMA3 naming or command semantics into React components.
- Keep import/export schema validation strict and versioned.

## Validation

Run:

```sh
pnpm test
pnpm check
pnpm build
```

For visible changes, also run the app and inspect desktop/mobile, light/dark, both locales and keyboard focus when browser control is available.
