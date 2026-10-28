/**
 * Phase 35: Clinical Mastery & Gamification Engine.
 *
 * Tracks clinical XP, levels, daily shift quests, shift streaks,
 * and unlockable achievement badges. Offline-first, reactive,
 * and persisted in localStorage per active user.
 */

import { getCurrentSession } from "./auth";

export interface DailyQuest {
  id: string;
  title: string;
  target: number;
  progress: number;
  xpReward: number;
  completed: boolean;
}

export interface BadgeDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: "mastery" | "community" | "resilience";
}

export interface ClinicianRewards {
  xp: number;
  level: number;
  rankTitle: string;
  shiftStreakDays: number;
  lastActiveDate: string; // YYYY-MM-DD
  stats: {
    lookupsCount: number;
    peerAnswersCount: number;
    peerVerificationsCount: number;
    inventoryFixesCount: number;
    packsSyncedCount: number;
  };
  unlockedBadges: string[];
  dailyQuests: DailyQuest[];
}

export interface XpGainedDetail {
  amount: number;
  actionType: string;
  label: string;
  totalXp: number;
  level: number;
  rankTitle: string;
  levelUp: boolean;
  badgeUnlocked?: BadgeDefinition;
  questCompleted?: DailyQuest;
}

export const XP_EVENT_NAME = "ornav-xp-gained";

export const CLINICAL_BADGES: Record<string, BadgeDefinition> = {
  first_scrub: {
    id: "first_scrub",
    title: "First Quest",
    description: "Complete 1st search",
    icon: "🌱",
    category: "mastery",
  },
  core_scout: {
    id: "core_scout",
    title: "Loot Hunter",
    description: "10+ supply searches",
    icon: "🧭",
    category: "mastery",
  },
  unit_preceptor: {
    id: "unit_preceptor",
    title: "Guild Helper",
    description: "Answer a peer question",
    icon: "⭐",
    category: "community",
  },
  consensus_guardian: {
    id: "consensus_guardian",
    title: "Truth Seeker",
    description: "Verify 2+ answers/bins",
    icon: "🛡️",
    category: "community",
  },
  pack_collector: {
    id: "pack_collector",
    title: "Map Collector",
    description: "Sync offline pack",
    icon: "📦",
    category: "resilience",
  },
  shift_veteran: {
    id: "shift_veteran",
    title: "Daily Grinder",
    description: "Active streak",
    icon: "🔥",
    category: "resilience",
  },
};

export const LEVEL_THRESHOLDS = [
  { level: 1, minXp: 0, nextXp: 100, rankTitle: "Novice Scout", icon: "🌱" },
  { level: 2, minXp: 100, nextXp: 300, rankTitle: "Supply Ranger", icon: "🧭" },
  { level: 3, minXp: 300, nextXp: 600, rankTitle: "Vault Pathfinder", icon: "🛡️" },
  { level: 4, minXp: 600, nextXp: 1000, rankTitle: "Lore Seeker", icon: "⚡" },
  { level: 5, minXp: 1000, nextXp: 2000, rankTitle: "Grandmaster Navigator", icon: "👑" },
];

export function getLevelInfo(xp: number) {
  let currentTier = LEVEL_THRESHOLDS[0];
  for (const tier of LEVEL_THRESHOLDS) {
    if (xp >= tier.minXp) {
      currentTier = tier;
    }
  }

  const range = currentTier.nextXp - currentTier.minXp;
  const progressInTier = Math.max(0, xp - currentTier.minXp);
  const progressPercent = Math.min(100, Math.round((progressInTier / range) * 100));

  return {
    level: currentTier.level,
    rankTitle: currentTier.rankTitle,
    icon: currentTier.icon,
    minXp: currentTier.minXp,
    nextLevelXp: currentTier.nextXp,
    progressPercent,
  };
}

export function getDefaultDailyQuests(): DailyQuest[] {
  return [
    {
      id: "quest_lookups",
      title: "Run 3 Supply Searches",
      target: 3,
      progress: 0,
      xpReward: 10,
      completed: false,
    },
    {
      id: "quest_peer",
      title: "Verify or Answer 1 Peer Doubt",
      target: 1,
      progress: 0,
      xpReward: 10,
      completed: false,
    },
    {
      id: "quest_pack",
      title: "Sync or Reinstall Knowledge Pack",
      target: 1,
      progress: 0,
      xpReward: 10,
      completed: false,
    },
  ];
}

export function getDefaultRewards(): ClinicianRewards {
  const today = new Date().toISOString().split("T")[0];
  const info = getLevelInfo(0);
  return {
    xp: 0,
    level: info.level,
    rankTitle: info.rankTitle,
    shiftStreakDays: 1,
    lastActiveDate: today,
    stats: {
      lookupsCount: 0,
      peerAnswersCount: 0,
      peerVerificationsCount: 0,
      inventoryFixesCount: 0,
      packsSyncedCount: 0,
    },
    unlockedBadges: [],
    dailyQuests: getDefaultDailyQuests(),
  };
}

function getStorageKey(userId?: string): string {
  const uid =
    userId ||
    (typeof window !== "undefined" ? getCurrentSession()?.userId : null) ||
    "default_user";
  return `ornav_gamification_${uid}`;
}

export function getClinicianRewards(userId?: string): ClinicianRewards {
  if (typeof window === "undefined") {
    return getDefaultRewards();
  }

  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (raw) {
      const parsed: ClinicianRewards = JSON.parse(raw);
      // Validate streak
      const today = new Date().toISOString().split("T")[0];
      if (parsed.lastActiveDate !== today) {
        const last = new Date(parsed.lastActiveDate);
        const curr = new Date(today);
        const diffDays = Math.round((curr.getTime() - last.getTime()) / (1000 * 3600 * 24));
        if (diffDays === 1) {
          parsed.shiftStreakDays = (parsed.shiftStreakDays || 0) + 1;
        } else if (diffDays > 1) {
          parsed.shiftStreakDays = 1;
        }
        parsed.lastActiveDate = today;
        // Reset daily quests if new day
        parsed.dailyQuests = getDefaultDailyQuests();
        localStorage.setItem(getStorageKey(userId), JSON.stringify(parsed));
      }
      return parsed;
    }
  } catch (e) {
    console.warn("Could not load clinician rewards from storage:", e);
  }

  const def = getDefaultRewards();
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(getStorageKey(userId), JSON.stringify(def));
    } catch {}
  }
  return def;
}

export function saveClinicianRewards(rewards: ClinicianRewards, userId?: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(rewards));
  } catch (e) {
    console.warn("Could not save clinician rewards:", e);
  }
}

export type ActionType =
  | "lookup"
  | "pack_sync"
  | "ask_question"
  | "inventory_fix"
  | "peer_answer"
  | "peer_verify"
  | "feedback_logged"
  | "feedback_manual";

const ACTION_CONFIG: Record<
  ActionType,
  { xp: number; label: string }
> = {
  lookup: { xp: 2, label: "Search Completed" },
  pack_sync: { xp: 3, label: "Knowledge Pack Synced" },
  ask_question: { xp: 3, label: "Peer Doubt Broadcast" },
  inventory_fix: { xp: 5, label: "Bin Move / Location Verified" },
  peer_answer: { xp: 8, label: "Peer Answer Submitted" },
  peer_verify: { xp: 10, label: "Consensus Verification Vote" },
  feedback_logged: { xp: 3, label: "Feedback Captured for Roadmap" },
  feedback_manual: { xp: 5, label: "Feedback Contributed" },
};

export function awardClinicalXP(
  actionType: ActionType,
  customLabel?: string,
  userId?: string
): ClinicianRewards {
  const current = getClinicianRewards(userId);
  const cfg = ACTION_CONFIG[actionType] || { xp: 2, label: "Action" };
  const baseAmount = cfg.xp;
  let totalAwarded = baseAmount;

  // 1. Update stats
  if (actionType === "lookup") current.stats.lookupsCount += 1;
  else if (actionType === "pack_sync") current.stats.packsSyncedCount += 1;
  else if (actionType === "inventory_fix") current.stats.inventoryFixesCount += 1;
  else if (actionType === "peer_answer") current.stats.peerAnswersCount += 1;
  else if (actionType === "peer_verify") current.stats.peerVerificationsCount += 1;

  // 2. Advance Daily Quests
  let completedQuest: DailyQuest | undefined;
  current.dailyQuests = current.dailyQuests.map((q) => {
    if (q.completed) return q;

    let advanced = false;
    if (q.id === "quest_lookups" && actionType === "lookup") {
      q.progress = Math.min(q.target, q.progress + 1);
      advanced = true;
    } else if (q.id === "quest_peer" && (actionType === "peer_answer" || actionType === "peer_verify")) {
      q.progress = Math.min(q.target, q.progress + 1);
      advanced = true;
    } else if (q.id === "quest_pack" && actionType === "pack_sync") {
      q.progress = Math.min(q.target, q.progress + 1);
      advanced = true;
    }

    if (advanced && q.progress >= q.target) {
      q.completed = true;
      totalAwarded += q.xpReward;
      completedQuest = q;
    }
    return q;
  });

  // 3. Check Badge Unlocks
  let unlockedBadge: BadgeDefinition | undefined;
  const tryUnlock = (badgeId: string) => {
    if (!current.unlockedBadges.includes(badgeId)) {
      current.unlockedBadges.push(badgeId);
      unlockedBadge = CLINICAL_BADGES[badgeId];
      totalAwarded += 10; // Bonus XP for unlocking any badge
    }
  };

  if (current.stats.lookupsCount >= 1) tryUnlock("first_scrub");
  if (current.stats.lookupsCount >= 10) tryUnlock("core_scout");
  if (current.stats.peerAnswersCount >= 1) tryUnlock("unit_preceptor");
  if (current.stats.peerVerificationsCount + current.stats.inventoryFixesCount >= 2) {
    tryUnlock("consensus_guardian");
  }
  if (current.stats.packsSyncedCount >= 1) tryUnlock("pack_collector");
  if (current.shiftStreakDays >= 2) tryUnlock("shift_veteran");

  // 4. Calculate Level Up
  const prevLevel = current.level;
  current.xp += totalAwarded;
  const newLevelInfo = getLevelInfo(current.xp);
  current.level = newLevelInfo.level;
  current.rankTitle = newLevelInfo.rankTitle;
  const levelUp = current.level > prevLevel;

  // 5. Persist
  saveClinicianRewards(current, userId);

  // 6. Broadcast Event for Toast Pill
  if (typeof window !== "undefined") {
    const detail: XpGainedDetail = {
      amount: totalAwarded,
      actionType,
      label: customLabel || cfg.label,
      totalXp: current.xp,
      level: current.level,
      rankTitle: current.rankTitle,
      levelUp,
      badgeUnlocked: unlockedBadge,
      questCompleted: completedQuest,
    };
    window.dispatchEvent(new CustomEvent(XP_EVENT_NAME, { detail }));
  }

  return current;
}
