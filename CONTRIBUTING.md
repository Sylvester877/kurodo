# Contributing to Kurōdo

Thanks for taking the time to contribute.

Kurōdo is developed around a simple principle: **ship improvements that make the app faster, clearer, and nicer to use.**

## Start here

New to the codebase? Check the open issues tagged `good first issue` or `help wanted`.

- [Open issues](https://github.com/Sylvester877/kurodo/issues)
- [Discussions](https://github.com/Sylvester877/kurodo/discussions)
- [Roadmap](https://github.com/Sylvester877/kurodo#roadmap)

## Local development

```bash
npm install
npm start
npm run electron:dev
```

## Before opening a PR

Run the same checks used by CI:

```bash
npm run typecheck
npm test
npm run build
```

Or run everything in one command:

```bash
npm run check
```

## What makes a good contribution?

### UI
Keep the visual language dark, cinematic, glassy, and fast. Prefer compositor-friendly animations such as `opacity` and `transform`. Avoid expensive per-frame effects that make scrolling or playback feel heavy.

### Performance
Large episode lists and content rails should remain responsive. Prefer virtualisation, lazy rendering, caching, and targeted network requests over mounting or fetching everything at once.

### Providers and external services
New integrations should fail gracefully. Timeouts, rate limits, bad responses, and temporary outages should not bring down unrelated parts of the app.

### Tests
Add or update tests for behavior that could regress, especially playback logic, caching, provider routing, and shared UI components.

### Pull requests
Keep PRs focused. One feature or fix per PR makes review much easier.

For UI changes, include screenshots or a short recording in the PR description.

## Reporting bugs

Use the [bug report template](https://github.com/Sylvester877/kurodo/issues/new?template=bug_report.md). Include:

- Kurōdo version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Screenshots or a short recording when useful
- Relevant console output when available

## Security

Do not publish security vulnerabilities in a normal issue. See [SECURITY.md](./SECURITY.md) for the private reporting process.

## Areas where help is especially useful

- Linux and macOS packaging
- Accessibility
- Internationalisation
- Tracker integrations
- UI polish and performance
- Documentation

Every useful contribution helps make Kurōdo a stronger project. Thank you.
