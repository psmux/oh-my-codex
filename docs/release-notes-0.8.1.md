# Release Notes - 0.8.1

Status: Prepared on **2026-03-05**.

Current package version: **0.8.1**.

## Scope policy

This release note is based strictly on:

- `git log --no-merges 4141fd6..HEAD`
- `git diff --shortstat 4141fd6..HEAD`

Scope summary:

- Commit window: **11 non-merge commits** (`2026-03-04` to `2026-03-05`)
- Diff snapshot: **51 files changed, +5,454 / -2,420**

## Highlights

- Team runtime moved fully to CLI-first interop (`omx team api`) with stronger dispatch reliability.
- Notification setup unified under `configure-notifications`.
- OpenClaw safety + operations guidance expanded, with timeout safety controls.

## Added

- `feat(team): add CLI interop API and hard-deprecate team_* MCP tools`
- `feat(team): finalize CLI-first team interop and dispatch reliability`

## Changed

- Unified notification setup flow via `configure-notifications`.
- Team protocol docs migrated to CLI-first interop contract.
- README setup docs now include configure-notifications guidance.

## Fixed

- Removed dead state-server helpers and enforced CLI-first dispatch policy.
- OpenClaw command timeout is now configurable with safe bounds.

## Verification for release readiness

- [x] `npm run build` passes
- [x] `npm test` passes
- [x] `npm run check:no-unused` passes
- [x] CLI smoke checks pass (`--help`, `version`, `status`, `doctor`, `setup --dry-run`, `cancel`)

## Smoke verification evidence (2026-03-05)

| Command | Exit | Evidence |
|---|---:|---|
| `npm run build` | 0 | `tsc` completed |
| `npm test` | 0 | `1908` pass, `0` fail, catalog check ok |
| `npm run check:no-unused` | 0 | `tsc -p tsconfig.no-unused.json` succeeded |
| `node bin/omx.js --help` | 0 | CLI usage rendered |
| `node bin/omx.js version` | 0 | `oh-my-codex v0.8.1` |
| `node bin/omx.js status` | 0 | mode status rendered |
| `node bin/omx.js doctor` | 0 | `Results: 9 passed, 0 warnings, 0 failed` |
| `node bin/omx.js setup --dry-run` | 0 | dry-run setup completed |
| `node bin/omx.js cancel` | 0 | `No active modes to cancel.` |

## Commit ledger (`4141fd6..HEAD`, history order)

- `2026-03-04 6a318b2 feat(team): add CLI interop API and hard-deprecate team_* MCP tools`
- `2026-03-04 bf39364 docs(team): migrate worker/team protocol and interop contract to CLI-first`
- `2026-03-04 85ab1cf fix(ci,team): remove dead state-server helpers and enforce CLI-first dispatch policy`
- `2026-03-04 c6b7780 test(team): add comprehensive api-interop coverage for coverage gate (#556)`
- `2026-03-04 c0c5d82 feat(team): finalize CLI-first team interop and dispatch reliability`
- `2026-03-05 2d3b14f refactor notifications setup into unified configure-notifications flow`
- `2026-03-05 6b7528d docs(notifications): add OpenClaw clawdbot agent workflow for dev (#563)`
- `2026-03-05 2afb54c docs(readme): add configure-notifications setup guidance (#565)`
- `2026-03-05 c42c264 docs(openclaw): harden token and command safety guidance (#566)`
- `2026-03-05 0ccea70 fix(openclaw): make command timeout configurable with safe bounds (#567)`
- `2026-03-05 a7c9e59 docs: add OpenClaw dev runbook for Korean tmux follow-up (#568)`
