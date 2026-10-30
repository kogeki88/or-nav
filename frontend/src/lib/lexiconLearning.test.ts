import 'jsdom-global/register.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  learnAliasClient,
  loadFacilityLexicon,
  resolveSpokenAliasClient,
  getAllAliasesForItemClient,
  detectTeachingIntentClient,
  titleCaseTerm,
  getFacilityIdFromTenant
} from './lexiconLearning';

// Mock localStorage
const localStorageMock = (function() {
  let store: Record<string, string> = {};
  return {
    getItem(key: string) {
      return store[key] || null;
    },
    setItem(key: string, value: string) {
      store[key] = value.toString();
    },
    clear() {
      store = {};
    }
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

test('lexiconLearning - strict TypeScript narrowing on clinician corrections', async (t) => {
  await t.test('learnAliasClient records phonetic corrections and verifies storage format', () => {
    localStorage.clear();
    const facilityId = 'sacred_heart';
    const deptId = 'or';

    // Unseeded term
    const spokenTerm = 'mosquito clamp';
    const canonItem = 'Halsted Mosquito Forceps';

    // Initial learning
    const entry1 = learnAliasClient(facilityId, deptId, spokenTerm, canonItem, 'dr_cox');

    // Assert strictly typed and formatted
    assert.equal(entry1.spokenTerm, 'mosquito clamp');
    assert.equal(entry1.canonicalItemName, 'Halsted Mosquito Forceps');
    assert.equal(entry1.displayPreferredName, 'Mosquito Clamp'); // titleCaseTerm
    assert.equal(entry1.facilityId, 'sacred_heart');
    assert.equal(entry1.usageCount, 1);
    assert.deepEqual(entry1.usedByUsers, ['dr_cox']);
    assert.equal(entry1.confidence, 'personal');

    // Learn again by another user to test consensus upgrade
    const entry2 = learnAliasClient(facilityId, deptId, spokenTerm, canonItem, 'turk');
    assert.equal(entry2.usageCount, 2);
    assert.deepEqual(entry2.usedByUsers, ['dr_cox', 'turk']);
    assert.equal(entry2.confidence, 'facility_consensus');

    // Verify storage format
    const stored = JSON.parse(localStorage.getItem(`ornav_learned_lexicon_${facilityId}`) || '[]');
    assert.ok(stored.length > 0);
    const found = stored.find((e: { spokenTerm: string; confidence: string }) => e.spokenTerm === 'mosquito clamp');
    assert.ok(found);
    assert.equal(found.confidence, 'facility_consensus');
  });

  await t.test('resolveSpokenAliasClient enforces zero null pointer errors on unseeded terms', () => {
    localStorage.clear();
    const resolved = resolveSpokenAliasClient('unknown_facility', 'random unseeded term');
    assert.equal(resolved, null);

    const aliases = getAllAliasesForItemClient('unknown_facility', 'Random Unseeded Item');
    assert.deepEqual(aliases, []);
  });

  await t.test('detectTeachingIntentClient detects correctly', () => {
    const intent1 = detectTeachingIntentClient('Here we call the 1x2 forceps toothed adson.');
    assert.deepEqual(intent1, { target: '1x2 forceps', alias: 'toothed adson' });

    const intent2 = detectTeachingIntentClient('Alias 1x2 forceps to toothed adson');
    assert.deepEqual(intent2, { target: '1x2 forceps', alias: 'toothed adson' });

    const intent3 = detectTeachingIntentClient('What is an adson pickup?');
    assert.equal(intent3, null); // Question, not teaching
  });
});
