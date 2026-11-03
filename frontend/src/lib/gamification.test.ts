import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import Dexie from "dexie";

import {
  awardClinicalXP,
  getClinicianRewards,
  saveClinicianRewards,
  getDefaultRewards,
  XP_EVENT_NAME,
  type XpGainedDetail,
  type ClinicianRewards,
} from "./gamification";

const mockStorage = new Map<string, string>();
const originalWindow = (global as { window?: unknown }).window;
const originalLocalStorage = (global as { localStorage?: unknown }).localStorage;

let dispatchedEvents: CustomEvent[] = [];

(global as { window?: unknown }).window = {
  dispatchEvent: (e: CustomEvent) => {
    dispatchedEvents.push(e);
    return true;
  },
};

(global as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

test("Gamification Engine", async (t) => {
  t.afterEach(() => {
    mockStorage.clear();
    dispatchedEvents = [];
  });

  t.after(() => {
    (global as { window?: unknown }).window = originalWindow;
    (global as { localStorage?: unknown }).localStorage = originalLocalStorage;
  });

  await t.test("awards points on item verification and unlocks badge", () => {
    // 2 verifications unlock consensus_guardian
    const res1 = awardClinicalXP("peer_verify");
    assert.equal(res1.stats.peerVerificationsCount, 1);
    // 1st verify: 10 XP + 10 XP (quest completion) = 20 XP
    assert.equal(res1.xp, 20);
    assert.equal(res1.unlockedBadges.length, 0);

    const res2 = awardClinicalXP("peer_verify");
    assert.equal(res2.stats.peerVerificationsCount, 2);
    // XP calculation:
    // 1st verify: 10 XP + 10 XP (quest) = 20 XP
    // 2nd verify: 10 XP + 10 XP bonus (consensus_guardian unlock) = 20 XP
    // Total XP: 40
    assert.equal(res2.xp, 40);
    assert.ok(res2.unlockedBadges.includes("consensus_guardian"));

    // Check event
    const lastEvent = dispatchedEvents[dispatchedEvents.length - 1];
    assert.equal(lastEvent.type, XP_EVENT_NAME);
    const detail = lastEvent.detail as XpGainedDetail;
    assert.equal(detail.badgeUnlocked?.id, "consensus_guardian");
  });

  await t.test("streak increments on subsequent days and resets if missed", () => {
    // Setup initial state for yesterday
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const initialRewards = getDefaultRewards();
    initialRewards.lastActiveDate = yesterdayStr;
    initialRewards.shiftStreakDays = 1;
    saveClinicianRewards(initialRewards);

    // Call getClinicianRewards today, should increment streak
    const rewardsToday = getClinicianRewards();
    assert.equal(rewardsToday.shiftStreakDays, 2);
    assert.equal(rewardsToday.lastActiveDate, today.toISOString().split("T")[0]);

    // Save with a date 2 days ago
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = twoDaysAgo.toISOString().split("T")[0];

    const brokenStreakRewards = getDefaultRewards();
    brokenStreakRewards.lastActiveDate = twoDaysAgoStr;
    brokenStreakRewards.shiftStreakDays = 5;
    saveClinicianRewards(brokenStreakRewards);

    // Call getClinicianRewards today, should reset streak
    const rewardsBroken = getClinicianRewards();
    assert.equal(rewardsBroken.shiftStreakDays, 1);
  });

  await t.test("verifies serialization to Dexie storage", async () => {
    const rewards = getDefaultRewards();
    rewards.xp = 50;

    // Although the application currently uses localStorage,
    // we verify the ClinicianRewards object can be serialized to Dexie
    // (using the structured clone algorithm) to ensure future compatibility.
    class TestDB extends Dexie {
      rewardsTable!: Dexie.Table<ClinicianRewards, string>;
      constructor() {
        super("GamificationTestDB");
        this.version(1).stores({ rewardsTable: "rankTitle" });
      }
    }
    const db = new TestDB();

    await db.rewardsTable.put(rewards);
    const loadedFromDexie = await db.rewardsTable.get("Novice Scout");

    assert.ok(loadedFromDexie);
    assert.equal(loadedFromDexie.xp, 50);
    assert.deepEqual(loadedFromDexie.stats, rewards.stats);

    await db.close();

    // Verify localStorage behavior as well
    saveClinicianRewards(rewards, "test_user_123");
    const raw = mockStorage.get("ornav_gamification_test_user_123");
    assert.ok(raw !== undefined && raw !== null);
    const parsed = JSON.parse(raw!) as ClinicianRewards;
    assert.equal(parsed.xp, 50);

    const loadedRewards = getClinicianRewards("test_user_123");
    assert.equal(loadedRewards.xp, 50);
  });
  await t.test("enforces multi-tenant isolation by user ID", () => {
    const user1 = "tenant_A_user_1";
    const user2 = "tenant_B_user_2";

    awardClinicalXP("lookup", undefined, user1);
    awardClinicalXP("peer_answer", undefined, user2);

    const rewards1 = getClinicianRewards(user1);
    const rewards2 = getClinicianRewards(user2);

    assert.equal(rewards1.stats.lookupsCount, 1);
    assert.equal(rewards1.stats.peerAnswersCount, 0);

    assert.equal(rewards2.stats.lookupsCount, 0);
    assert.equal(rewards2.stats.peerAnswersCount, 1);

    // Check that storage keys are separate
    const raw1 = mockStorage.get("ornav_gamification_" + user1);
    const raw2 = mockStorage.get("ornav_gamification_" + user2);
    assert.ok(raw1 !== raw2);
  });

  await t.test("enforces offline-first invariants and gracefully handles storage errors", () => {
    const tempWindow = (global as any).window;

    // 1. window is undefined (e.g. SSR or completely offline worker without window)
    (global as any).window = undefined;

    const offlineRewards = getClinicianRewards("offline_user");
    assert.equal(offlineRewards.xp, 0);

    // saveClinicianRewards should not throw when window is undefined
    assert.doesNotThrow(() => {
      saveClinicianRewards(offlineRewards, "offline_user");
    });

    // 2. window exists but localStorage throws (e.g. quota exceeded or privacy blockers)
    (global as any).window = tempWindow;
    const tempLocalStorage = (global as any).localStorage;

    (global as any).localStorage = {
      getItem: () => { throw new Error("Storage disabled"); },
      setItem: () => { throw new Error("Storage disabled"); }
    };

    const errorRewards = getClinicianRewards("error_user");
    assert.equal(errorRewards.xp, 0);

    // Should not throw on save
    assert.doesNotThrow(() => {
      saveClinicianRewards(errorRewards, "error_user");
    });

    (global as any).localStorage = tempLocalStorage;
  });
});

test("resilient to malformed payloads and fuzzing", () => {
  const user = "fuzz_user";
  (global as any).window = {
    dispatchEvent: () => true
  }; // Ensure logic triggers window-based localstorage
  (global as any).localStorage = {
    getItem: (key: string) => mockStorage.get(key) || null,
    setItem: (key: string, value: string) => mockStorage.set(key, value)
  };

  // Test 1: Invalid JSON (e.g. primitive number instead of object)
  mockStorage.set("ornav_gamification_" + user, "123");
  const r1 = getClinicianRewards(user);
  assert.equal(r1.xp, 0); // should default to 0
  assert.equal(r1.stats.lookupsCount, 0);

  // Test 2: Missing nested objects (stats is missing)
  mockStorage.set("ornav_gamification_" + user, JSON.stringify({ xp: 10, shiftStreakDays: 2 }));
  const r2 = getClinicianRewards(user);
  assert.equal(r2.xp, 10);
  assert.equal(r2.shiftStreakDays, 2);
  assert.equal(r2.stats.lookupsCount, 0); // missing stats correctly populated by default

  // Ensure awards doesn't crash when state is missing
  assert.doesNotThrow(() => {
    awardClinicalXP("lookup", undefined, user);
  });
  const r3 = getClinicianRewards(user);
  assert.equal(r3.stats.lookupsCount, 1);

  // Test 3: Invalid JSON string entirely
  mockStorage.set("ornav_gamification_" + user, "{ invalid json");
  const r4 = getClinicianRewards(user);
  assert.equal(r4.xp, 0); // fallback to default
});

test("concurrent burst execution, race condition resistance, and latency benchmarks", async () => {
  const userA = "benchmark_user_latency_A";
  const userB = "benchmark_user_latency_B";

  const NUM_AWARDS = 1000;

  // Enforce offline-first invariant by testing under rapid local state mutations
  // and ensuring no network boundary blocks execution.

  const startTime = performance.now();
  await Promise.all(
    Array.from({ length: NUM_AWARDS * 2 }, (_, i) => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Interleave updates to enforce multi-tenant isolation
          const targetUser = i % 2 === 0 ? userA : userB;
          awardClinicalXP("lookup", undefined, targetUser);
          resolve();
        }, Math.random() * 5);
      });
    })
  );
  const endTime = performance.now();

  const latency = endTime - startTime;
  // Latency check to ensure high-concurrency does not severely block event loop
  assert.ok(latency < 3000, `Latency too high: ${latency}ms`);

  const rewardsA = getClinicianRewards(userA);
  const rewardsB = getClinicianRewards(userB);

  // Ensure exactly NUM_AWARDS per tenant, meaning no race condition drops and no multi-tenant cross-talk
  assert.equal(rewardsA.stats.lookupsCount, NUM_AWARDS);
  assert.equal(rewardsB.stats.lookupsCount, NUM_AWARDS);

  const expectedBaseXp = NUM_AWARDS * 2;
  const questXp = 10;
  const badgeFirstScrubXp = 10;
  const badgeCoreScoutXp = 10;
  const expectedTotalXp = expectedBaseXp + questXp + badgeFirstScrubXp + badgeCoreScoutXp;

  assert.equal(rewardsA.xp, expectedTotalXp);
  assert.equal(rewardsB.xp, expectedTotalXp);
});

test("enforces offline mutation replay idempotency", () => {
  const user = "idempotency_user";
  const mutationId = "mut_12345";

  const res1 = awardClinicalXP("peer_answer", undefined, user, mutationId);
  const initialXp = res1.xp;

  const res2 = awardClinicalXP("peer_answer", undefined, user, mutationId);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const assert = require("node:assert/strict");
  assert.equal(res2.stats.peerAnswersCount, 1);
  assert.equal(res2.xp, initialXp);

  const res3 = awardClinicalXP("peer_answer", undefined, user, "mut_67890");
  assert.equal(res3.stats.peerAnswersCount, 2);
  assert.ok(res3.xp > initialXp);
});

test("enforces multi-tenant boundary isolation (facility_id::dept_id)", () => {
  const tenant1 = "fac_ny::dept_er";
  const tenant2 = "fac_ny::dept_icu";

  awardClinicalXP("lookup", undefined, tenant1);
  awardClinicalXP("peer_answer", undefined, tenant2);
  awardClinicalXP("lookup", undefined, tenant2);

  const rewards1 = getClinicianRewards(tenant1);
  const rewards2 = getClinicianRewards(tenant2);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const assert = require("node:assert/strict");
  assert.equal(rewards1.stats.lookupsCount, 1);
  assert.equal(rewards1.stats.peerAnswersCount, 0);

  assert.equal(rewards2.stats.lookupsCount, 1);
  assert.equal(rewards2.stats.peerAnswersCount, 1);
});
