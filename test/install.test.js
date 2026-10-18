import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

for (const version of ["0.2.0-rc.2", "0.2.1-rc.2", "0.2.1-rc.1", "0.2.2"]) {
  test(`Windows installer compatibility check: ${version}`, { skip: process.platform !== "win32" }, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "dsdd-install-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, "resources", "runtime", "cli", "bin");
    await mkdir(bin, { recursive: true });
    await copyFile(new URL("../Install.ps1", import.meta.url), join(root, "Install.ps1"));
    await writeFile(join(root, "DeepSeek Harness.exe"), "fixture only");
    await writeFile(join(root, `dsh-desktop-delete-${metadata.version}.tgz`), "fixture only");
    // Any command beyond --version is an error: -CheckOnly must never install.
    await writeFile(join(bin, "dsh.cmd"), `@echo off\r\nif "%~1"=="--version" (\r\n echo ${version}\r\n exit /b 0\r\n)\r\nexit /b 99\r\n`);
    const result = spawnSync("pwsh.exe", ["-NoLogo", "-NoProfile", "-File", join(root, "Install.ps1"),
      "-ApplicationPath", join(root, "DeepSeek Harness.exe"), "-CheckOnly"], { encoding: "utf8" });
    assert.ifError(result.error);
    const supported = metadata.engines.dsh.split(" || ").includes(version);
    assert.equal(result.status === 0, supported, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, new RegExp(version.replaceAll(".", "\\.")));
  });
}
