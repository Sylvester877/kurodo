# Contributing to Kurōdo

PRs are welcome — bug fixes, providers, UI polish, docs, all of it.

## Quick dev loop

```bash
npm install
npm start            # web app on :5173
npm run electron:dev # desktop app
npx tsc --noEmit     # typecheck
npx vitest run       # tests
```

## Ground rules

- **Typecheck + tests must pass** before your PR (`npx tsc --noEmit && npx vitest run`).
- **Match the existing style** — the codebase uses functional React, Zustand stores, TanStack Query, and Tailwind utility classes.
- **No provider spam** — new stream providers must handle failure gracefully (timeouts, negative caching) and never block the rest of the router.
- **Keep the UI dark, glassy, and fast** — animations must be compositor-only (opacity/transform), no per-frame blur/filters.
- One feature or fix per PR. Keep diffs reviewable.

## Areas that especially need help

- Linux/macOS packaging
- Tracker integrations (MAL, Simkl)
- Accessibility passes (focus rings, screen-reader labels)
- Translations / i18n

## Reporting bugs

Open a [bug report](https://github.com/Sylvester877/kurodo/issues/new?template=bug_report.md) with your Kurōdo version, steps to reproduce, and screenshots. DevTools console output (Ctrl+Shift+I) makes fixes dramatically faster.
