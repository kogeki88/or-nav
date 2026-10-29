import test from 'node:test';
import assert from 'node:assert';
import { isNewerVersion } from './version.ts';

test('isNewerVersion', async (t) => {
  await t.test('higher major version is true', () => {
    assert.strictEqual(isNewerVersion('2.0.0', undefined, '1.9.9', undefined), true);
  });

  await t.test('higher minor version is true', () => {
    assert.strictEqual(isNewerVersion('1.10.0', undefined, '1.9.9', undefined), true);
  });

  await t.test('higher patch version is true', () => {
    assert.strictEqual(isNewerVersion('1.9.10', undefined, '1.9.9', undefined), true);
  });

  await t.test('lower major version is false', () => {
    assert.strictEqual(isNewerVersion('0.9.9', undefined, '1.0.0', undefined), false);
  });

  await t.test('lower minor version is false', () => {
    assert.strictEqual(isNewerVersion('1.8.9', undefined, '1.9.0', undefined), false);
  });

  await t.test('lower patch version is false', () => {
    assert.strictEqual(isNewerVersion('1.9.8', undefined, '1.9.9', undefined), false);
  });

  await t.test('equal versions is false', () => {
    assert.strictEqual(isNewerVersion('1.9.9', undefined, '1.9.9', undefined), false);
  });

  await t.test('build number precedence when present and > 0', () => {
    // Same version, higher remote build number
    assert.strictEqual(isNewerVersion('1.0.0', 2, '1.0.0', 1), true);
    // Lower version, higher remote build number
    assert.strictEqual(isNewerVersion('0.9.9', 2, '1.0.0', 1), true);
    // Same version, lower remote build number
    assert.strictEqual(isNewerVersion('1.0.0', 1, '1.0.0', 2), false);
    // Higher version, lower remote build number
    assert.strictEqual(isNewerVersion('2.0.0', 1, '1.0.0', 2), false);
  });

  await t.test('formatting tolerance - whitespace and v prefix', () => {
    assert.strictEqual(isNewerVersion(' v2.0.0', undefined, '1.0.0', undefined), true);
    assert.strictEqual(isNewerVersion('2.0.0', undefined, ' v1.0.0', undefined), true);
    assert.strictEqual(isNewerVersion('  2.0.0  ', undefined, '1.0.0', undefined), true);
    assert.strictEqual(isNewerVersion('v2.0.0', undefined, 'v1.0.0', undefined), true);
    assert.strictEqual(isNewerVersion('V2.0.0', undefined, 'v1.0.0', undefined), true);
  });

  await t.test('edge cases - undefined or 0 build numbers', () => {
    // If local build is 0, fall back to semver
    assert.strictEqual(isNewerVersion('0.9.9', 2, '1.0.0', 0), false);
    assert.strictEqual(isNewerVersion('2.0.0', 2, '1.0.0', 0), true);

    // If remote build is 0, fall back to semver
    assert.strictEqual(isNewerVersion('0.9.9', 0, '1.0.0', 2), false);
    assert.strictEqual(isNewerVersion('2.0.0', 0, '1.0.0', 2), true);

    // If both builds are 0, fall back to semver
    assert.strictEqual(isNewerVersion('0.9.9', 0, '1.0.0', 0), false);
    assert.strictEqual(isNewerVersion('2.0.0', 0, '1.0.0', 0), true);

    // If remote build is undefined, fall back to semver
    assert.strictEqual(isNewerVersion('0.9.9', undefined, '1.0.0', 2), false);
    assert.strictEqual(isNewerVersion('2.0.0', undefined, '1.0.0', 2), true);
  });

  await t.test('edge cases - non-numeric parts', () => {
    // Falls back to 0 for unparseable parts
    assert.strictEqual(isNewerVersion('1.beta.0', undefined, '1.0.0', undefined), false);
    assert.strictEqual(isNewerVersion('1.1.0', undefined, '1.beta.0', undefined), true);
  });
});
