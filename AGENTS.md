# Changelog Notifier

GitHub Action that parses Conventional Commits, sends a Telegram changelog, and exports DORA metrics to InfluxDB.

## Build and Test

```bash
npm test                   # run Jest test suite
npm run test:coverage      # with coverage report
npm run build              # bundle via ncc → dist/index.js (required before release)
```

Tests live in `tests/`, matching `src/` structure. Always run tests after changes.

## Architecture

```
index.js          # orchestrator — reads action inputs, calls modules in order
src/
  parsing.js      # pure string utils: commit parsing, MarkdownV2 escaping
  detectors.js    # pure DORA signal detection: reverts, hotfixes, incident types
  changelog.js    # builds changelog text; calls parsing.js + Yogile for enrichment
  metrics.js      # DORA metric calculation + InfluxDB push; calls detectors, GitHub API, Yogile
  telegram.js     # thin fetch wrapper for Telegram Bot API sendMessage
  yogile.js       # YouGile HTTP client (class Yogile); bearer auth
locale.json       # section headers, per-prefix emojis, Russian UI labels
```

## Conventions

**Commit format**: `prefix(TASK-ID): message` — e.g. `feat(TECH-123): add login`  
Task IDs match `[A-Z]+-\d+`. Use `extractTaskId` / `hasTaskId` from `parsing.js`.

**MarkdownV2**: All user-visible strings sent to Telegram must be escaped via `escapeMarkdown()` from `parsing.js`. Forgetting this breaks message delivery.

**Error handling**: non-fatal failures (metrics, YouGile enrichment) use `core.warning()` and continue. Fatal errors use `core.setFailed()`. Do not re-throw inside `getCardInfo` or metric helpers.

**Locale**: add new UI strings to `locale.json` — do not hardcode Russian text in source files.

**Outlier filtering**: lead time capped at 30 days, cycle time at 180 days — do not remove these guards.

**CommonJS**: all modules use `require`/`module.exports`. No ESM.

## Key Pitfalls

- Run `npm run build` before committing a release — `dist/index.js` is what the action executes.
- `influxdb_url` is optional; metrics are skipped when absent — keep that branch non-fatal.
- `yougile_api_key` is required by `action.yml` but enrichment failures must not abort the action.
