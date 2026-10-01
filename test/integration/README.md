# Optional native-runtime integration tests

These eight tests use the actual Harness services, not the standalone mock fixture. They run only on disposable histories created under the operating system's temporary directory. No model calls or existing user profiles are used.

Requirements: Node.js 24 and an independently obtained **Harness desktop 0.2.0-rc.2** runtime. Extract the desktop `resources/app.asar` and merge its `resources/app.asar.unpacked` native files into the extraction, preserving relative paths. The runtime directory is the extracted `dsh` directory containing `node_modules/@deepseek-ai`. Keep native dependencies such as `koffi` intact; use binaries for the test operating system.

This repository does not include Harness runtime code or native binaries. It does not provide an extraction tool. `DSH_RUNTIME_ROOT` points to that separate runtime, not a user data directory.

From the repository root, run:

```powershell
$env:DSH_RUNTIME_ROOT = '<extracted-runtime>/dsh'
node --test test/integration/*.test.mjs
```

Or on a POSIX shell:

```sh
DSH_RUNTIME_ROOT=/path/to/extracted-runtime/dsh node --test test/integration/*.test.mjs
```

Coverage: live Session/Agent and durable history removal; another conversation survives; cold archived deletion; restart persistence; a foreign native writer prevents deletion; rollback restores a usable writer; v3 plain and Zstandard migration; refusal leaves a locked or invalid historical log untouched.

The default `npm test` runs the twelve standalone tests without requiring Harness. GitHub Actions runs those standalone tests on Linux and Windows; it does not run these integration tests.
