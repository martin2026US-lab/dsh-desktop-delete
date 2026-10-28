import test from 'node:test';
import assert from 'node:assert/strict';
import { baselines, selectVersions } from '../scripts/prepare-runtime.mjs';

test('compatibility discovery adds the newest eligible prerelease and excludes the next release family', () => {
  const versions = selectVersions(['0.2.1-rc.1', ...baselines, '0.2.3-alpha.1', '0.3.0-alpha.1', '1.0.0']);
  assert.deepEqual(versions, [...baselines, '0.2.3-alpha.1']);
  assert.deepEqual(selectVersions(baselines), baselines);
  assert.throws(() => selectVersions(['0.1.9', '0.3.0-alpha.1', 'invalid']), /No published Harness version/);
});
