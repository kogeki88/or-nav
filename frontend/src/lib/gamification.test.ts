import {
  awardClinicalXP,
  getClinicianRewards,
  saveClinicianRewards,
  getDefaultDailyQuests,
  CLINICAL_BADGES,
  XP_EVENT_NAME,
  ClinicianRewards
} from "./gamification";
import { getCurrentSession } from "./auth";

jest.mock("./auth", () => ({
  getCurrentSession: jest.fn(),
}));

describe("Gamification Engine", () => {
  beforeEach(() => {
    localStorage.clear();
    (getCurrentSession as jest.Mock).mockReturnValue({ userId: "test_user_1" });
  });

  afterEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe("XP Calculation and Leveling", () => {
    it("awards correct XP based on action type", () => {
      // For this test, let's bypass the 'first_scrub' badge bonus (10 XP)
      // by setting the lookupsCount initially to 1.
      let initRewards = getClinicianRewards();
      initRewards.stats.lookupsCount = 1;
      initRewards.unlockedBadges = ["first_scrub"];
      saveClinicianRewards(initRewards);

      const rewards = awardClinicalXP("lookup");
      // Initially 0 + 2 = 2
      expect(rewards.xp).toBe(2);
      expect(rewards.stats.lookupsCount).toBe(2);
    });

    it("calculates level ups based on thresholds", () => {
      // Manually set user state to 98 XP
      let rewards = getClinicianRewards();
      rewards.xp = 98;
      // Provide an empty array for unlocked badges, to avoid hitting logic that awards 10 XP
      // for newly unlocked badges like 'first_scrub'.
      rewards.unlockedBadges = ["first_scrub"];
      saveClinicianRewards(rewards);

      // Trigger lookup (gives 2 XP) to hit 100 XP
      rewards = awardClinicalXP("lookup");
      expect(rewards.xp).toBe(100);
      expect(rewards.level).toBe(2);
      expect(rewards.rankTitle).toBe("Supply Ranger");
    });
  });

  describe("Daily Quests", () => {
    it("advances and completes lookup quest", () => {
      // Reset user state to 0 XP
      let initRewards = getClinicianRewards();
      initRewards.xp = 0;
      initRewards.stats.lookupsCount = 0;
      initRewards.unlockedBadges = [];
      initRewards.dailyQuests = getDefaultDailyQuests();
      saveClinicianRewards(initRewards);

      // First 3 lookups
      awardClinicalXP("lookup");
      awardClinicalXP("lookup");
      const rewards = awardClinicalXP("lookup");

      const quest = rewards.dailyQuests.find(q => q.id === "quest_lookups");
      expect(quest?.progress).toBe(3);
      expect(quest?.completed).toBe(true);
      // Base XP is (2 * 3) = 6. Plus 'first_scrub' badge (10). Plus quest complete (10). Total = 26.
      expect(rewards.xp).toBe(26);
    });

    it("advances and completes peer doubt quest", () => {
      // Reset user state to 0 XP
      let initRewards = getClinicianRewards();
      initRewards.xp = 0;
      initRewards.stats.peerAnswersCount = 0;
      initRewards.unlockedBadges = ["unit_preceptor", "first_scrub", "pack_collector", "shift_veteran"];
      initRewards.dailyQuests = getDefaultDailyQuests();
      saveClinicianRewards(initRewards);

      const rewards = awardClinicalXP("peer_answer");

      const quest = rewards.dailyQuests.find(q => q.id === "quest_peer");
      expect(quest?.progress).toBe(1);
      expect(quest?.completed).toBe(true);

      // Base XP (8) + quest complete (10) = 18
      expect(rewards.xp).toBe(18);
    });

    it("advances and completes pack sync quest", () => {
      // Reset user state to 0 XP
      let initRewards = getClinicianRewards();
      initRewards.xp = 0;
      initRewards.stats.packsSyncedCount = 0;
      initRewards.unlockedBadges = ["pack_collector", "first_scrub", "unit_preceptor", "shift_veteran"];
      initRewards.dailyQuests = getDefaultDailyQuests();
      saveClinicianRewards(initRewards);

      const rewards = awardClinicalXP("pack_sync");

      const quest = rewards.dailyQuests.find(q => q.id === "quest_pack");
      expect(quest?.progress).toBe(1);
      expect(quest?.completed).toBe(true);

      // Base XP (3) + quest complete (10) = 13
      expect(rewards.xp).toBe(13);
    });
  });

  describe("Badge Unlocks", () => {
    it("unlocks first_scrub on the 1st lookup and awards 10 XP", () => {
      let initRewards = getClinicianRewards();
      initRewards.xp = 0;
      initRewards.stats = {
        lookupsCount: 0,
        peerAnswersCount: 0,
        peerVerificationsCount: 0,
        inventoryFixesCount: 0,
        packsSyncedCount: 0,
      };
      // Note: By default getClinicianRewards has shiftStreakDays = 1. If we set it to 1,
      // shift_veteran check will fail and not grant an extra 10 XP.
      initRewards.shiftStreakDays = 1;
      // We also must ensure other counters don't trigger badges.
      initRewards.unlockedBadges = [];
      // Prevent quest completion from muddying the XP
      // We set target artificially high so it doesn't complete and grant 10 XP
      initRewards.dailyQuests = [{
        id: "quest_lookups",
        title: "Run 3 Supply Searches",
        target: 100,
        progress: 0,
        xpReward: 10,
        completed: false,
      }];
      saveClinicianRewards(initRewards);

      const rewards = awardClinicalXP("lookup");
      expect(rewards.unlockedBadges).toContain("first_scrub");
      // Base XP (2) + Badge (10) = 12
      expect(rewards.xp).toBe(12);
    });

    it("unlocks core_scout upon reaching 10 lookups", () => {
      let initRewards = getClinicianRewards();
      initRewards.stats.lookupsCount = 9;
      initRewards.unlockedBadges = ["first_scrub"];
      initRewards.dailyQuests = [];
      saveClinicianRewards(initRewards);

      const rewards = awardClinicalXP("lookup");
      expect(rewards.unlockedBadges).toContain("core_scout");
    });

    it("unlocks unit_preceptor on 1 peer_answer", () => {
      let initRewards = getClinicianRewards();
      initRewards.stats.peerAnswersCount = 0;
      initRewards.unlockedBadges = [];
      initRewards.dailyQuests = [];
      saveClinicianRewards(initRewards);

      const rewards = awardClinicalXP("peer_answer");
      expect(rewards.unlockedBadges).toContain("unit_preceptor");
    });

    it("unlocks consensus_guardian upon reaching 2 total of peer_verify and inventory_fix", () => {
      let initRewards = getClinicianRewards();
      initRewards.stats.peerVerificationsCount = 1;
      initRewards.stats.inventoryFixesCount = 0;
      initRewards.unlockedBadges = [];
      initRewards.dailyQuests = [];
      saveClinicianRewards(initRewards);

      const rewards = awardClinicalXP("inventory_fix");
      expect(rewards.unlockedBadges).toContain("consensus_guardian");
    });

    it("unlocks pack_collector on 1 pack_sync", () => {
      let initRewards = getClinicianRewards();
      initRewards.stats.packsSyncedCount = 0;
      initRewards.unlockedBadges = [];
      initRewards.dailyQuests = [];
      saveClinicianRewards(initRewards);

      const rewards = awardClinicalXP("pack_sync");
      expect(rewards.unlockedBadges).toContain("pack_collector");
    });

    it("unlocks shift_veteran by having shiftStreakDays >= 2", () => {
      let initRewards = getClinicianRewards();
      initRewards.shiftStreakDays = 2;
      initRewards.unlockedBadges = [];
      initRewards.dailyQuests = [];
      saveClinicianRewards(initRewards);

      // Trigger an action to run the unlock check
      const rewards = awardClinicalXP("lookup");
      expect(rewards.unlockedBadges).toContain("shift_veteran");
    });
  });

  describe("Persistence and Unauthenticated Fallback", () => {
    it("utilizes default_user string as a fallback when unauthenticated", () => {
      // Setup mock to simulate unauthenticated
      (getCurrentSession as jest.Mock).mockReturnValue(null);

      // Verify that storing rewards uses default_user
      let rewards = getClinicianRewards();
      rewards.xp = 10101;
      saveClinicianRewards(rewards);

      // We didn't pass a userId, so it should use default_user
      const storedItem = localStorage.getItem("ornav_gamification_default_user");
      expect(storedItem).not.toBeNull();
      expect(JSON.parse(storedItem!).xp).toBe(10101);
    });

    it("maintains shiftStreakDays when lastActiveDate is today", () => {
      const today = new Date().toISOString().split("T")[0];
      let rewards = getClinicianRewards();
      rewards.shiftStreakDays = 5;
      rewards.lastActiveDate = today;
      saveClinicianRewards(rewards);

      const loadedRewards = getClinicianRewards();
      expect(loadedRewards.shiftStreakDays).toBe(5);
    });

    it("increments shiftStreakDays when lastActiveDate is yesterday", () => {
      const todayStr = new Date().toISOString().split("T")[0];
      const todayObj = new Date(todayStr);
      const yesterdayDate = new Date(todayObj);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = yesterdayDate.toISOString().split("T")[0];

      let rewards = getClinicianRewards();
      rewards.shiftStreakDays = 5;
      rewards.lastActiveDate = yesterday;
      // We manually put this in storage since saveClinicianRewards doesn't override the date calculation
      localStorage.setItem("ornav_gamification_test_user_1", JSON.stringify(rewards));

      // loading should auto-calculate the diff and increment
      const loadedRewards = getClinicianRewards();
      expect(loadedRewards.shiftStreakDays).toBe(6);
      expect(loadedRewards.lastActiveDate).toBe(todayStr);
    });

    it("resets shiftStreakDays when lastActiveDate is more than 1 day ago", () => {
      const todayStr = new Date().toISOString().split("T")[0];
      const todayObj = new Date(todayStr);
      const longAgoDate = new Date(todayObj);
      longAgoDate.setDate(longAgoDate.getDate() - 3);
      const longAgo = longAgoDate.toISOString().split("T")[0];

      let rewards = getClinicianRewards();
      rewards.shiftStreakDays = 5;
      rewards.lastActiveDate = longAgo;
      localStorage.setItem("ornav_gamification_test_user_1", JSON.stringify(rewards));

      const loadedRewards = getClinicianRewards();
      expect(loadedRewards.shiftStreakDays).toBe(1);
    });
  });
});
