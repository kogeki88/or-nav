import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_USER_PROFILE,
  getUserProfile,
  saveUserProfile,
  isNursingRole,
  isAnesthesiaRole,
  isScrubRole,
  getRoleScope,
  evaluateRbacQuery,
  filterSurgeonNoteForRole,
} from "./userProfile";

// Mocking localStorage and window
const mockStorage = new Map<string, string>();
const originalWindow = (global as { window?: unknown }).window;
const originalLocalStorage = (global as { localStorage?: unknown }).localStorage;

(global as { window?: unknown }).window = {
  dispatchEvent: () => true,
};

(global as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

import { afterEach, after } from "node:test";

afterEach(() => {
  mockStorage.clear();
});

after(() => {
  (global as { window?: unknown }).window = originalWindow;
  (global as { localStorage?: unknown }).localStorage = originalLocalStorage;
});

test("getUserProfile returns default if empty", () => {
    const profile = getUserProfile();
    assert.deepEqual(profile, DEFAULT_USER_PROFILE);
});

test("saveUserProfile and getUserProfile - switching clinical roles", () => {
    const roles = ["Circulating RN", "Scrub Tech", "CRNA", "Perfusionist"];

    for (const role of roles) {
      const newProfile = { ...DEFAULT_USER_PROFILE, clinicalRole: role };
      saveUserProfile(newProfile);

      const profile = getUserProfile();
      assert.equal(profile.clinicalRole, role);
      assert.deepEqual(profile, newProfile);
    }
});

test("badge display categorization (isNursingRole, isAnesthesiaRole, isScrubRole)", () => {
    // Circulating RN
    assert.equal(isNursingRole("Circulating RN"), true);
    assert.equal(isAnesthesiaRole("Circulating RN"), false);
    assert.equal(isScrubRole("Circulating RN"), false);

    // Scrub Tech
    assert.equal(isNursingRole("Scrub Tech"), false);
    assert.equal(isAnesthesiaRole("Scrub Tech"), false);
    assert.equal(isScrubRole("Scrub Tech"), true);

    // CRNA
    assert.equal(isNursingRole("CRNA"), false);
    assert.equal(isAnesthesiaRole("CRNA"), true);
    assert.equal(isScrubRole("CRNA"), false);

    // Perfusionist
    // "rn" is in "Perfusionist". Let's verify how it behaves with `isNursingRole`.
    // Wait, the lowercase string "perfusionist" doesn't have "rn" or "nurse" or "circulat" or "charge".
    assert.equal(isNursingRole("Perfusionist"), false);
    assert.equal(isAnesthesiaRole("Perfusionist"), false);
    assert.equal(isScrubRole("Perfusionist"), false);

    // Fallback cases
    assert.equal(isNursingRole(undefined), true); // Default is nursing
    assert.equal(isAnesthesiaRole(undefined), false);
    assert.equal(isScrubRole(undefined), false);
});

test("getRoleScope - role-specific voice prompt generation", () => {
    const deptId = "or_main";

    // Scrub Tech
    const scrubScope = getRoleScope(deptId, "Scrub Tech");
    assert.equal(scrubScope.id, "scrub_tech");
    assert.equal(scrubScope.departmentId, deptId);
    assert.ok(scrubScope.focusSummary.includes("Sterile field"));

    // CRNA
    const crnaScope = getRoleScope(deptId, "CRNA");
    assert.equal(crnaScope.id, "crna");
    assert.equal(crnaScope.departmentId, deptId);
    assert.ok(crnaScope.focusSummary.includes("Airway"));

    // Circulating RN
    const circScope = getRoleScope(deptId, "Circulating RN");
    assert.equal(circScope.id, "circulating_rn");
    assert.equal(circScope.departmentId, deptId);
    assert.ok(circScope.focusSummary.includes("CNOR checklists"));

    // Perfusionist (defaults to Circulating RN)
    const perfScope = getRoleScope(deptId, "Perfusionist");
    assert.equal(perfScope.id, "circulating_rn");
    assert.equal(perfScope.departmentId, deptId);
    assert.ok(perfScope.focusSummary.includes("CNOR checklists"));
});

test("evaluateRbacQuery", () => {
    // Med Dosing
    assert.equal(evaluateRbacQuery("dosing for heparin", "Scrub Tech").allowed, false);
    assert.equal(evaluateRbacQuery("dosing for heparin", "Circulating RN").allowed, true);
    assert.equal(evaluateRbacQuery("dosing for heparin", "CRNA").allowed, true);

    // Instrument Tray Setup
    assert.equal(evaluateRbacQuery("tray breakdown", "CRNA").allowed, false);
    assert.equal(evaluateRbacQuery("tray breakdown", "Circulating RN").allowed, true);
    assert.equal(evaluateRbacQuery("tray breakdown", "Scrub Tech").allowed, true);
});

test("filterSurgeonNoteForRole", () => {
    const note = "Surgeon prefers hand-tied sutures; Administer heparin bolus.";

    // Anesthesia role filters out suture loading
    const anesthesiaNote = filterSurgeonNoteForRole(note, "CRNA");
    // Original text splitting removes the period/semicolon and just returns the trimmed text.
    assert.equal(anesthesiaNote, "Administer heparin bolus");

    // Scrub role filters out drug dosing
    const scrubNote = filterSurgeonNoteForRole(note, "Scrub Tech");
    assert.equal(scrubNote, "Surgeon prefers hand-tied sutures");

    // RN sees everything
    const rnNote = filterSurgeonNoteForRole(note, "Circulating RN");
    assert.equal(rnNote, note);
});
