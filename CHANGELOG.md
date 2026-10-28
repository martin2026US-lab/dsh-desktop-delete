# Changelog

## 0.1.3 — 2026-10-28

- Replace the exact-version list with `0.2.0-rc.2 || >=0.2.1-rc.2 <0.3.0-0`, including prereleases through Harness’s normal range evaluation.
- Read installer compatibility and archive version from the bundled package.json, using the desktop runtime’s semver implementation.
- Refuse changed service/lifecycle capabilities before stopping activity or changing archive state.
- Prefer the newer public stat().location API over private storage locators.
- Add daily automatic discovery and Windows/Linux integration testing of the newest eligible published runtime alongside rc.2, rc.3, rc.4 and 0.2.2-alpha.2 baselines.
- Validate 29 standalone tests and 32 real-service test executions locally on Windows. Permanent compatibility is not guaranteed while upstream lifecycle cleanup remains private.

## 0.1.2 — 2026-10-18

- Support Harness desktop 0.2.1-rc.2 alongside 0.2.0-rc.2 in the plugin engine declaration and Windows installer; keep other releases gated for revalidation.
- Use the workspace row's `workspaceId` when leaving the current conversation before deletion.
- Adapt the integration fixture to the JSONL backend's named plugin exports in 0.2.1-rc.2.
- Add client navigation/refusal and Windows installer compatibility regressions.
- Run the real 0.2.1-rc.2 service integration suite in CI using pinned public runtime packages. Local Windows validation: 19 standalone plus 8 integration tests passed.

## 0.1.1 — 2026-10-01

- Delete historical v0–v3 JSONL conversations without requiring users to open them first. Harness performs migration while holding its native exclusive write lease.
- Preserve strict session identity, storage format and managed-directory checks when locating historical logs.
- Add coverage for plain and Zstandard v3 migration, foreign write leases and migration failures.
- Publish Chinese and English screenshots, Windows installation instructions, standalone tests and optional native-runtime integration tests.

## 0.1.0 — 2026-10-01

- Add a red Delete conversation item to the desktop session menu with a native confirmation dialog and Chinese/English labels.
- Stop the selected conversation's activity, flush and close its writer, remove its history and sidebar metadata, then detach its Session and Agent.
- Check request admission, merge concurrent requests and attempt rollback after failures.
