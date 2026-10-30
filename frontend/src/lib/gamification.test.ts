import test from "node:test";
import assert from "node:assert/strict";

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

  await t.test("verifies serialization to storage", () => {
    const rewards = getDefaultRewards();
    rewards.xp = 50;
    saveClinicianRewards(rewards, "test_user_123");

    const raw = mockStorage.get("ornav_gamification_test_user_123");
    assert.ok(raw !== undefined && raw !== null);

    const parsed = JSON.parse(raw!) as ClinicianRewards;
    assert.equal(parsed.xp, 50);

    // Loading from storage should return the exact saved state (if date hasn't changed)
    const loadedRewards = getClinicianRewards("test_user_123");
    assert.equal(loadedRewards.xp, 50);
  });
});
