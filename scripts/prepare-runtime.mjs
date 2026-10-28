import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import semver from 'semver';

const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
export const baselines = ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.2-alpha.2'];
export function selectVersions(published) {
  const eligible = published.filter(version => semver.valid(version) && semver.satisfies(version, metadata.engines.dsh, { includePrerelease: true }));
  const latest = eligible.sort(semver.rcompare)[0];
  if (!latest) throw new Error('No published Harness version matches the compatibility range.');
  return [...new Set([...baselines, latest])];
}

const [version, directory] = process.argv.slice(2);
if (version === '--matrix') {
  const response = await fetch('https://registry.npmjs.org/@deepseek-ai%2fdsh-session-persistence-jsonl', {
    headers: { accept: 'application/vnd.npm.install-v1+json' }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Runtime discovery failed: HTTP ${response.status}`);
  console.log(JSON.stringify(selectVersions(Object.keys((await response.json()).versions))));
} else if (version) {
  if (!directory || !semver.valid(version) || !semver.satisfies(version, metadata.engines.dsh, { includePrerelease: true })) {
    throw new Error('Usage: node scripts/prepare-runtime.mjs <supported-version> <isolated-runtime-directory>');
  }
  const manifest = JSON.parse(await readFile(new URL('../test/integration/runtime/package.json', import.meta.url), 'utf8'));
  const response = await fetch(`https://registry.npmjs.org/@deepseek-ai%2fdsh-session/${version}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Runtime metadata failed: HTTP ${response.status}`);
  const cordisRange = (await response.json()).peerDependencies?.['@deepseek-ai/cordis'];
  if (!semver.validRange(cordisRange)) throw new Error('Official runtime has no valid Cordis peer range.');
  manifest.dependencies['@deepseek-ai/cordis'] = cordisRange;
  for (const name of Object.keys(manifest.dependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) manifest.dependencies[name] = version;
  }
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
}
