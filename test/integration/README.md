# Native-runtime integration tests

These eight tests exercise actual Harness services with disposable histories under the operating system's temporary directory. They never use an existing user profile, credentials, or model calls.

## Public 0.2.1-rc.2 runtime (recommended)

Requirements: Node.js 24 and npm. From the repository root:

```sh
npm ci --ignore-scripts --prefix test/integration/runtime
```

The private test manifest pins the official Harness packages to **0.2.1-rc.2**. This installs service packages and their platform dependencies, not the desktop application. It does not install this plugin into any user profile.

PowerShell:

```powershell
$env:DSH_RUNTIME_ROOT = (Resolve-Path test/integration/runtime).Path
npm run test:integration
```

POSIX shell:

```sh
DSH_RUNTIME_ROOT="$PWD/test/integration/runtime" npm run test:integration
```

GitHub Actions runs this setup on Windows and Linux. The standalone suite runs separately; its four PowerShell/Windows launcher checks skip on Linux.

## Extracted desktop runtime (alternative)

Set `DSH_RUNTIME_ROOT` to an independently obtained, matching desktop runtime's `dsh` directory containing `node_modules/@deepseek-ai`. For **0.2.0-rc.2**, extract `resources/app.asar` and merge `resources/app.asar.unpacked`, preserving native files and relative paths. Use native dependencies for the test OS. The fixture accepts both the 0.2.0-rc.2 default and 0.2.1-rc.2 named JSONL plugin exports.

This repository distributes no Harness runtime code or binaries. `DSH_RUNTIME_ROOT` always names a test runtime, never a user data directory.

Coverage: live Session/Agent and durable history removal; another conversation survives; cold archived deletion; restart persistence; a foreign native writer prevents deletion; rollback restores a usable writer; v3 plain and Zstandard migration; refusal leaves a locked or invalid historical log untouched. Service integration does not establish installed-desktop UI behavior; see [VALIDATION.md](../../VALIDATION.md).
