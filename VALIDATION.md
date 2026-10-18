# Validation

## 0.1.2 — 2026-10-18 (Asia/Singapore)

Target: official Harness **0.2.1-rc.2**, release source commit `687f282e8625c6b8d11ff58211a90524be2e4317`. Reviewed the desktop bundled launcher, session menu/overlay slots, workspace row `workspaceId`, retention/navigation APIs, registry archive operations, exact Session/Agent detach entries, JSONL tracker/writer and historical locator/migration paths against that tag.

Executed on Windows with Node.js 24.19.0 and PowerShell 7:

- `pnpm run verify`: **19 passed**, including three client navigation/catalog tests and four installer checks. The installer accepts 0.2.0-rc.2 and 0.2.1-rc.2, rejects unvalidated 0.2.1-rc.1 and 0.2.2, and does not install during `-CheckOnly`.
- `node --test test/integration/*.test.mjs` with `DSH_RUNTIME_ROOT` set to an isolated install of official 0.2.1-rc.2 packages: **8 passed**. Covers live/cold removal, another conversation surviving, restart persistence, foreign writer locks, rollback with subsequent durable writes, plain/Zstandard v3 migration, and invalid migration preserving source bytes.

Total: **27 passed, 0 failed**. Filesystem tests required execution outside the desktop sandbox because it refused realpath/atomic rename in disposable test directories. No existing user profiles, conversations, credentials or model calls were used.

The runtime packages are public npm releases, not extracted desktop resources. The JSONL plugin now uses named exports, so the fixture accepts both named and default plugin shapes. The runtime package manifest and CI job reproduce this validation without an installed desktop application. CI is configured for Windows/Linux; local results above are Windows only.

Installed-app UI and plugin installation were **not** repeated for 0.2.1-rc.2 on this machine. The screenshots below belong to the previous release. This update changes the version gates and current-conversation navigation; the deletion backend's algorithm is unchanged. Exact support for 0.2.0-rc.2 is retained based on the prior evidence below.

Official reference: [Harness 0.2.1-rc.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2).

## Previous release evidence (0.1.1)

Validated on **2026-10-01 (Asia/Singapore)**, plugin **0.1.1**.

Target: official Harness desktop **0.2.0-rc.2**, build commit `04f392c9ddd144fa426da2045178797da6db6c11`. Runtime services were obtained from a read-only copy of the official installed resources; they are not distributed in this repository.

## Standalone tests: 12 passed

Run `npm run verify` from this repository. Coverage includes cold/live deletion, preservation of another conversation, exact lifecycle release, data/metadata/writer rollback, original archive/pin state, unsupported lifecycle refusal, busy timeout, flush failure, root bounds, identity/subagent/backend checks, historical locator fallback, request admission, explicit confirmation, method restrictions and concurrent request deduplication.

## Actual Harness services: 8 passed

Run the [optional integration suite](test/integration/README.md) with an independently obtained matching runtime. It exercises real Cordis, Sessions, Agents, AgentLoop, projections, SystemPrompt, JSONL persistence, JSON storage and Workspace registry. LLM and tools services are empty placeholders: no inference or model calls are made.

1. Live conversation: durable history and exact Agent/Session registrations are removed; another conversation survives; restart cannot restore the deleted history or membership.
2. Cold archived conversation: the directory and archived membership are removed; restart still shows no history.
3. A second Host's native JSONL writer lease prevents deletion and preserves the source.
4. An injected metadata failure restores the directory and writer; subsequent title events remain durable.
5. Plain v3 history migrates and deletes without opening the conversation manually; another conversation survives and restart confirms absence.
6. Zstandard v3 history passes the same migration, deletion and restart checks.
7. A foreign lease on a v3 record prevents both migration and deletion, leaving original bytes untouched.
8. An invalid v3 migration preserves source bytes and workspace state.

Both suites were rerun for publication: **20 tests passed, 0 failed**. CI runs only the standalone suite, because it does not contain the proprietary installation/runtime fixture.

## Historical-format regression

In 0.1.0, `resolveCurrentLog()` could return undefined for v0–v3 JSONL history, causing an early refusal before Harness could migrate it. Version 0.1.1 uses `locate(validatedHeader)` to validate the same managed session directory, then obtains the native write lease; Harness performs migration before removal. The fallback keeps identity, JSONL-format and realpath/depth checks.

In addition to synthetic fixtures, an isolated copy of the user-reported v3 Zstandard conversation passed deletion and Host restart checks. Original user histories were not deleted during testing; copied histories were subsequently cleaned. No session records, credentials, user profile or extracted third-party runtime is included in the release.

## UI evidence

The four images under `docs/images` were provided from the installed application after the update. They show Chinese/English menu and confirmation text, a red delete action, a separating line, Cancel/confirm controls, and permanent-deletion wording for a test conversation titled “Hello”. Screenshots alone do not prove successful deletion or persistence after restart.

Earlier fixture-based UI verification used React, snapshot store, MenuItemButton, Modal and Button from the installed desktop resources, driven in Edge through Playwright. The fixture simulated the slot binding and sent deletion requests to actual Harness services. It checked menu rendering, Cancel retaining history, confirm removing history and membership, another conversation surviving, refresh persistence and no browser script errors. This was an isolated test page, not automation of the installed desktop window.

## Installation

The 0.1.1 package was installed with the desktop-bundled CLI into the desktop profile after Harness fully exited. Listing installed plugins reported 0.1.1, and the installed backend matched the tested source. The Windows install script checks the target Harness version and refuses to install while the desktop process is running. For public distribution it accepts PowerShell 7 rather than requiring a specific local patch version.

## Limits

Validated native runtime platform: Windows. Standalone tests are portable and configured for Windows/Linux CI. Native macOS/Linux desktop integration was not tested. Exact writer and registry lifecycle cleanup relies on checked internals from Harness 0.2.0-rc.2. Rollback is best effort under filesystem failure; stopped activity is not automatically restarted. Deletion removes conversation history, not workspace content, shared attachments, backups or general caches.

Reference project: [dsh-session-organizer](https://github.com/martin2026US-lab/dsh-session-organizer), main tree `2c8b4ae191c8160ea1c803e4ca80264dde0159c4`. Its MIT attribution is retained in LICENSE.
