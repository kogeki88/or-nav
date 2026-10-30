/**
 * Phase 36: Passive Chat Complaint Interceptor & Feedback Engine.
 *
 * Hybrid offline-first store (localStorage + IndexedDB mirror + FastAPI sync)
 * with deterministic client-side NLP for instant complaint capture,
 * AI dev recommendation synthesis, and ready-to-copy Antigravity fix prompts.
 */

import { getCurrentSession } from "./auth";

export interface FeedbackItem {
  id: string;
  tenantId: string;           // e.g. "sacred_heart::or"
  userName: string;
  userRole: string;
  source: "chat_auto_detected" | "manual_submission";
  category: "bug_friction" | "feature_request" | "data_inventory" | "ui_ux";
  severity: "low" | "medium" | "high";
  sentimentScore?: number;    // -1 to 1 based on text
  rawText: string;            // The user's chat complaint or submitted feedback
  aiRecommendation: string;   // Synthesized dev recommendation (e.g. "Add dark-mode contrast toggle to CoordinateCard")
  suggestedFixPrompt: string; // Ready-to-copy prompt for Antigravity to implement the fix!
  upvotes: number;            // Increments when multiple users make similar complaints
  status: "open" | "planned" | "resolved";
  createdAt: string;
}

export const FEEDBACK_STORAGE_KEY = "ornav_feedback_store";
export const FEEDBACK_EVENT_NAME = "ornav-feedback-updated";
export const FEEDBACK_OFFLINE_QUEUE_KEY = "ornav_feedback_sync_queue";

export function getFeedbackApiUrl(path: string): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "localhost";
    const port = window.location.port;
    if (port === "3000" || port === "") {
      return `http://${host}:8000${path}`;
    }
  }
  return path;
}

// Pre-seeded clinical feedback items
export const SEED_FEEDBACK_ITEMS: FeedbackItem[] = [
  {
    id: "fb-seed-001",
    tenantId: "sacred_heart::or",
    userName: "Dr. Christopher Turk",
    userRole: "Attending Surgeon",
    source: "chat_auto_detected",
    category: "ui_ux",
    severity: "high",
    sentimentScore: -0.8,
    rawText: "The screen is way too bright during laparoscopic cholecystectomy in OR 4. We dim the room lights and the white background causes glare on the monitor.",
    aiRecommendation: "Add surgical dark-mode toggle and low-glare high-contrast theme for dimmed laparoscopic suites.",
    suggestedFixPrompt: "ANTIGRAVITY DIRECTIVE: Implement a high-contrast Surgical Night Mode toggle in the header and system drawer. In low light, invert bright backgrounds and enhance bin coordinate legibility without glare.",
    upvotes: 5,
    status: "open",
    createdAt: "2026-10-27T18:30:00Z",
  },
  {
    id: "fb-seed-002",
    tenantId: "sacred_heart::or",
    userName: "Carla Espinosa, RN",
    userRole: "Circulating RN",
    source: "manual_submission",
    category: "data_inventory",
    severity: "medium",
    sentimentScore: -0.2,
    rawText: "We moved the pediatric vascular bulldog clamps from Cart V to Cart P Shelf 2, but the app still says Cart V.",
    aiRecommendation: "Trigger instant discrepancy audit in department inventory catalog and prompt senior circulator verification.",
    suggestedFixPrompt: "ANTIGRAVITY DIRECTIVE: Update vascular clamp bin coordinates in Sacred Heart OR inventory and prompt preceptors to verify.",
    upvotes: 3,
    status: "planned",
    createdAt: "2026-10-27T19:15:00Z",
  },
  {
    id: "fb-seed-003",
    tenantId: "princeton_plainsboro::or",
    userName: "Dr. Robert Chase",
    userRole: "Surgeon",
    source: "manual_submission",
    category: "feature_request",
    severity: "medium",
    sentimentScore: 0.5,
    rawText: "Would love a quick timer on screen for bone cement curing (Simplex P) during total knees so we don't have to look at the wall clock.",
    aiRecommendation: "Add a sterile OR countdown timer utility (e.g. Bone Cement / Ischemia timer) accessible directly from omnibar quick actions.",
    suggestedFixPrompt: "ANTIGRAVITY DIRECTIVE: Build a quick OR countdown timer tool in the omnibar for bone cement curing and tourniquet times.",
    upvotes: 7,
    status: "open",
    createdAt: "2026-10-27T20:00:00Z",
  },
  {
    id: "fb-seed-004",
    tenantId: "county_general::er",
    userName: "Dr. John Carter",
    userRole: "ER Resident",
    source: "chat_auto_detected",
    category: "bug_friction",
    severity: "low",
    sentimentScore: -0.4,
    rawText: "Voice input sometimes cuts off early if monitor alarms are beeping loudly in Trauma Bay 1.",
    aiRecommendation: "Adjust Web Speech recognition silence debounce threshold and add speech volume/rate sliders in Audio drawer.",
    suggestedFixPrompt: "ANTIGRAVITY DIRECTIVE: Optimize voice recognition noise filter for loud OR environments and increase debounce timeout from 800ms to 1500ms.",
    upvotes: 2,
    status: "resolved",
    createdAt: "2026-10-27T21:10:00Z",
  },
];

// --- NLP Classification & Prompt Generation ---

const BUG_REGEX = /\b(broken|broke|bug|bugs|glitch|glitches|error|errors|crash|crashed|crashing|crashes|fail|failed|fails|failing|stuck|freeze|freezes|freezing|froze|not working|won't work|doesn't work|annoying|frustrating|painful|slow|lag|laggy|keeps crashing|timeout)\b/i;
const INVENTORY_REGEX = /\b(wrong bin|missing item|missing|not in cart|moved to|wrong shelf|can't find the|cannot find the|inventory is wrong|out of stock|expired|sterile pack opened|bin is wrong|cart is wrong|not in here|outdated|wrong card|never updated|where the heck)\b/i;
const UI_REGEX = /\b(too bright|dark mode|glare|too small|tiny|can't read|hard to read|contrast|font size|screen timeout|audio too quiet|volume|can't hear|speak louder|speaking too fast|voice cut off|cut off|cutting off|keeps cutting|too slow|confusing|hate how|takes too long|cluttered|wrong location|keep having to)\b/i;
const FEATURE_REGEX = /\b(wish we had|i wish|would be nice|should have|can we add|can you add|why doesn't it|need a feature|needs to show|it would help if|please add|feature request|need a way to|is there a way to|we should have|can you implement|timer for|why can't the app)\b/i;

const HIGH_SEVERITY_REGEX = /\b(patient|safety|crash|emergency|vital|sterile field contaminated|code blue|bleeding|hemostasis|completely broken|cannot document|cannot open|locked out)\b/i;
const MEDIUM_SEVERITY_REGEX = /\b(missing|wrong bin|wrong location|can't find|slow|annoying|frustrating|voice cut off)\b/i;

export function isComplaintOrFeatureWish(text: string): boolean {
  if (!text || text.trim().length < 8) return false;
  return (
    BUG_REGEX.test(text) ||
    INVENTORY_REGEX.test(text) ||
    UI_REGEX.test(text) ||
    FEATURE_REGEX.test(text)
  );
}

export function classifyText(text: string): {
  category: "bug_friction" | "feature_request" | "data_inventory" | "ui_ux";
  severity: "low" | "medium" | "high";
  sentimentScore: number;
} {
  let category: "bug_friction" | "feature_request" | "data_inventory" | "ui_ux" = "feature_request";
  if (BUG_REGEX.test(text)) category = "bug_friction";
  else if (INVENTORY_REGEX.test(text)) category = "data_inventory";
  else if (UI_REGEX.test(text)) category = "ui_ux";
  else if (FEATURE_REGEX.test(text)) category = "feature_request";

  let severity: "low" | "medium" | "high" = "low";
  if (HIGH_SEVERITY_REGEX.test(text)) severity = "high";
  else if (MEDIUM_SEVERITY_REGEX.test(text)) severity = "medium";
  else if (category === "bug_friction" || category === "data_inventory") severity = "medium";

  let sentimentScore = 0;
  const lower = text.toLowerCase();

  const negativeWords = [
    "broken", "hate", "frustrating", "annoying", "painful", "awful",
    "terrible", "worst", "crash", "crashed", "slow", "lag", "glitch"
  ];
  const positiveWords = [
    "love", "great", "awesome", "perfect", "good", "nice", "helpful", "thanks"
  ];

  for (const word of negativeWords) {
    if (lower.includes(word)) sentimentScore -= 0.3;
  }
  for (const word of positiveWords) {
    if (lower.includes(word)) sentimentScore += 0.3;
  }
  // Clamp between -1 and 1
  sentimentScore = Math.max(-1, Math.min(1, sentimentScore));

  return { category, severity, sentimentScore };
}

export function synthesizeDevPrompt(
  rawText: string,
  category: "bug_friction" | "feature_request" | "data_inventory" | "ui_ux",
  severity: "low" | "medium" | "high"
): { aiRecommendation: string; suggestedFixPrompt: string } {
  const lower = rawText.toLowerCase();

  if (lower.includes("dark mode") || lower.includes("too bright") || lower.includes("glare")) {
    return {
      aiRecommendation: "Add surgical dark-mode toggle and low-glare high-contrast theme for dimmed laparoscopic suites.",
      suggestedFixPrompt: `ANTIGRAVITY DIRECTIVE: Implement a high-contrast Surgical Night Mode toggle in the header and system drawer. In low light, invert bright backgrounds and enhance bin coordinate legibility without glare. Context: Clinician reported: '${rawText}'.`,
    };
  }
  if (lower.includes("timer") || lower.includes("cement")) {
    return {
      aiRecommendation: "Add a sterile OR countdown timer utility (e.g. Bone Cement / Ischemia timer) accessible directly from omnibar quick actions.",
      suggestedFixPrompt: `ANTIGRAVITY DIRECTIVE: Build a quick OR countdown timer tool in the omnibar for bone cement curing and tourniquet times. Context: Clinician reported: '${rawText}'.`,
    };
  }
  if (lower.includes("wrong bin") || lower.includes("cart") || lower.includes("moved") || lower.includes("shelf")) {
    return {
      aiRecommendation: "Trigger instant discrepancy audit in department inventory catalog and prompt senior circulator verification.",
      suggestedFixPrompt: `ANTIGRAVITY DIRECTIVE: Verify and correct supply coordinates in inventory catalog. Enhance the out-of-date notification on the CoordinateCard. Context: Clinician reported: '${rawText}'.`,
    };
  }
  if (lower.includes("voice") || lower.includes("quiet") || lower.includes("cut off") || lower.includes("speech")) {
    return {
      aiRecommendation: "Adjust Web Speech recognition silence debounce threshold and add speech volume/rate sliders in Audio drawer.",
      suggestedFixPrompt: `ANTIGRAVITY DIRECTIVE: Optimize voice recognition noise filter for loud OR environments and increase debounce timeout from 800ms to 1500ms. Context: Clinician reported: '${rawText}'.`,
    };
  }

  if (category === "bug_friction") {
    return {
      aiRecommendation: "Address workflow friction in active module: handle edge case gracefully and provide retry option.",
      suggestedFixPrompt: `ANTIGRAVITY DIRECTIVE: Fix bug/friction in perioperative assistant: '${rawText}'. Add defensive error boundary, local retry fallback, and clear offline recovery message.`,
    };
  }
  if (category === "data_inventory") {
    return {
      aiRecommendation: "Audit and reconcile catalog metadata for item described in complaint.",
      suggestedFixPrompt: `ANTIGRAVITY DIRECTIVE: Reconcile inventory data discrepancy: '${rawText}'. Ensure cross-tenant isolation and accurate shelf/cart mapping.`,
    };
  }
  if (category === "ui_ux") {
    return {
      aiRecommendation: "Improve UI ergonomics and touch target accessibility for gloved clinicians.",
      suggestedFixPrompt: `ANTIGRAVITY DIRECTIVE: Refactor UI component ergonomics: '${rawText}'. Increase minimum touch target to 48px, enhance typography contrast, and streamline mobile layout.`,
    };
  }
  return {
    aiRecommendation: "Evaluate proposed clinical feature enhancement and design modular component architecture.",
    suggestedFixPrompt: `ANTIGRAVITY DIRECTIVE: Implement requested clinical workflow feature: '${rawText}'. Integrate cleanly into current perioperative navigation tabs.`,
  };
}

export function generateTopRecommendations(items?: FeedbackItem[]): string[] {
  const list = items || getLocalFeedback();
  const openItems = list.filter((it) => it.status === "open");
  openItems.sort((a, b) => {
    const sevA = a.severity === "high" ? 300 : a.severity === "medium" ? 200 : 100;
    const sevB = b.severity === "high" ? 300 : b.severity === "medium" ? 200 : 100;
    return sevB + b.upvotes * 5 - (sevA + a.upvotes * 5);
  });
  return openItems.slice(0, 3).map((it) => {
    const catBadge =
      it.category === "ui_ux"
        ? "UI/UX"
        : it.category === "bug_friction"
        ? "Bug Fix"
        : it.category === "data_inventory"
        ? "Data"
        : "Feature";
    return `🔥 [${catBadge}] ${it.aiRecommendation} (${it.upvotes} upvotes)`;
  });
}

function wordsOverlap(s1: string, s2: string): boolean {
  const getWords = (str: string) =>
    new Set(
      str
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4)
    );
  const w1 = getWords(s1);
  const w2 = getWords(s2);
  if (!w1.size || !w2.size) return false;
  let match = 0;
  for (const w of w1) {
    if (w2.has(w)) match++;
  }
  return match >= 3 || (match >= 2 && w1.size <= 4);
}

// --- Offline Queueing ---

export interface OfflineSyncTask {
  id: string;
  type: "CREATE" | "UPVOTE" | "UPDATE_STATUS";
  endpoint: string;
  method: string;
  payload?: any;
  retryCount: number;
  lastAttempt?: number;
}

export function getOfflineQueue(): OfflineSyncTask[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FEEDBACK_OFFLINE_QUEUE_KEY);
    if (raw) return JSON.parse(raw) as OfflineSyncTask[];
  } catch (e) {
    console.warn("Could not read feedback offline queue:", e);
  }
  return [];
}

export function saveOfflineQueue(queue: OfflineSyncTask[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FEEDBACK_OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error("Could not save feedback offline queue:", e);
  }
}

export function enqueueOfflineSync(task: Omit<OfflineSyncTask, "id" | "retryCount">): void {
  const queue = getOfflineQueue();
  queue.push({
    ...task,
    id: `sync-${Math.random().toString(36).substring(2, 10)}`,
    retryCount: 0,
  });
  saveOfflineQueue(queue);
  if (typeof window !== "undefined" && navigator.onLine) {
    // Attempt to drain immediately if online
    setTimeout(() => drainFeedbackQueue(), 500);
  }
}

export async function drainFeedbackQueue(): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) return;
  const queue = getOfflineQueue();
  if (queue.length === 0) return;

  const now = Date.now();
  const nextQueue: OfflineSyncTask[] = [];

  for (const task of queue) {
    // Exponential backoff logic: 2^retryCount * 1000ms
    const backoffMs = Math.min(Math.pow(2, task.retryCount) * 1000, 60000); // max 1min backoff
    if (task.lastAttempt && now - task.lastAttempt < backoffMs) {
      nextQueue.push(task); // wait for backoff
      continue;
    }

    try {
      const res = await fetch(task.endpoint, {
        method: task.method,
        headers: task.payload ? { "Content-Type": "application/json" } : undefined,
        body: task.payload ? JSON.stringify(task.payload) : undefined,
        signal: AbortSignal.timeout(2000),
      });

      if (!res.ok && res.status >= 500) {
        // Retryable error
        throw new Error(`Server error ${res.status}`);
      }
      // If success or 4xx error (client error, not retryable), drop from queue
    } catch (e) {
      // Retry
      nextQueue.push({
        ...task,
        retryCount: task.retryCount + 1,
        lastAttempt: now,
      });
    }
  }

  saveOfflineQueue(nextQueue);
}

// Ensure the queue drains when coming back online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => drainFeedbackQueue());
}

// --- Local Storage Management ---

export function getLocalFeedback(): FeedbackItem[] {
  if (typeof window === "undefined") return SEED_FEEDBACK_ITEMS;
  try {
    const raw = localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Could not read local feedback store:", e);
  }
  saveLocalFeedback(SEED_FEEDBACK_ITEMS);
  return SEED_FEEDBACK_ITEMS;
}

export function saveLocalFeedback(items: FeedbackItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT_NAME, { detail: items }));
  } catch (e) {
    console.error("Could not save local feedback store:", e);
  }
}

// --- Hybrid Operations ---

export async function fetchFeedbackItems(options?: {
  tenantId?: string;
  category?: string;
  status?: string;
  sortBy?: "priority" | "upvotes" | "newest";
}): Promise<FeedbackItem[]> {
  // Always load from local store first for instant zero-lag offline display
  let localItems = getLocalFeedback();

  // Try background sync with FastAPI
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams();
      if (options?.tenantId) params.set("tenantId", options.tenantId);
      if (options?.category && options.category !== "all") params.set("category", options.category);
      if (options?.status && options.status !== "all") params.set("status", options.status);
      if (options?.sortBy) params.set("sortBy", options.sortBy);

      const res = await fetch(getFeedbackApiUrl(`/api/feedback?${params.toString()}`), {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        const remoteItems: FeedbackItem[] = Array.isArray(data) ? data : data.items || [];
        // Merge remote items into local
        const mergedMap = new Map<string, FeedbackItem>();
        for (const it of remoteItems) mergedMap.set(it.id, it);
        for (const it of localItems) {
          if (!mergedMap.has(it.id)) mergedMap.set(it.id, it);
        }
        const mergedList = Array.from(mergedMap.values());
        saveLocalFeedback(mergedList);
        localItems = mergedList;
      }
    } catch {
      // Offline fallback: continue with localItems
    }
  }

  // Filter & sort localItems according to options
  let result = [...localItems];
  if (options?.tenantId) {
    const clean = options.tenantId.trim();
    const fac = clean.split("::")[0].split("/")[0];
    result = result.filter(
      (it) => it.tenantId === clean || it.tenantId.startsWith(`${fac}::`) || it.tenantId.startsWith(`${fac}/`)
    );
  }
  if (options?.category && options.category !== "all") {
    result = result.filter((it) => it.category === options.category);
  }
  if (options?.status && options.status !== "all") {
    result = result.filter((it) => it.status === options.status);
  }

  if (options?.sortBy === "upvotes") {
    result.sort((a, b) => b.upvotes - a.upvotes);
  } else if (options?.sortBy === "newest") {
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else {
    // Default: Priority sort
    const calcScore = (it: FeedbackItem) => {
      const sevW = it.severity === "high" ? 300 : it.severity === "medium" ? 200 : 100;
      const statW = it.status === "open" ? 50 : it.status === "planned" ? 20 : 0;
      return sevW + statW + it.upvotes * 5;
    };
    result.sort((a, b) => calcScore(b) - calcScore(a));
  }

  return result;
}

export async function interceptChatComplaint(
  rawText: string,
  userProfile?: { fullName?: string; clinicalRole?: string; facilityId?: string; departmentId?: string }
): Promise<FeedbackItem | null> {
  if (!isComplaintOrFeatureWish(rawText)) {
    return null;
  }

  const session = getCurrentSession();
  const userName = session?.fullName || userProfile?.fullName || "Staff Clinician";
  const userRole = session?.profile?.clinicalRole || userProfile?.clinicalRole || "Circulating RN";
  const fac = session?.profile?.facilityId || userProfile?.facilityId || "sacred_heart";
  const dept = session?.profile?.departmentId || userProfile?.departmentId || "or";
  const tenantId = `${fac}::${dept}`;

  const { category, severity, sentimentScore } = classifyText(rawText);
  const { aiRecommendation, suggestedFixPrompt } = synthesizeDevPrompt(rawText, category, severity);

  const localItems = getLocalFeedback();

  // Check if similar open complaint exists -> auto-upvote
  for (const item of localItems) {
    if (item.status !== "resolved" && wordsOverlap(item.rawText, rawText)) {
      item.upvotes += 1;
      saveLocalFeedback(localItems);
      // Sync to backend asynchronously
      if (typeof window !== "undefined") {
        const endpoint = getFeedbackApiUrl(`/api/feedback/${item.id}/upvote`);
        fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(1500),
        }).catch(() => {
          enqueueOfflineSync({
            type: "UPVOTE",
            endpoint,
            method: "POST",
          });
        });
      }
      return item;
    }
  }

  // Create new feedback item
  const newItem: FeedbackItem = {
    id: `fb-${Math.random().toString(36).substring(2, 10)}`,
    tenantId,
    userName,
    userRole,
    source: "chat_auto_detected",
    category,
    severity,
    sentimentScore,
    rawText: rawText.trim(),
    aiRecommendation,
    suggestedFixPrompt,
    upvotes: 1,
    status: "open",
    createdAt: new Date().toISOString(),
  };

  localItems.unshift(newItem);
  saveLocalFeedback(localItems);

  // Sync to backend asynchronously
  if (typeof window !== "undefined") {
    const endpoint = getFeedbackApiUrl("/api/feedback");
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newItem),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {
      enqueueOfflineSync({
        type: "CREATE",
        endpoint,
        method: "POST",
        payload: newItem,
      });
    });
  }

  return newItem;
}

export async function submitManualFeedback(data: {
  rawText: string;
  category?: "bug_friction" | "feature_request" | "data_inventory" | "ui_ux";
  severity?: "low" | "medium" | "high";
  userProfile?: { fullName?: string; clinicalRole?: string; facilityId?: string; departmentId?: string };
}): Promise<FeedbackItem> {
  const session = getCurrentSession();
  const userName = session?.fullName || data.userProfile?.fullName || "Staff Clinician";
  const userRole = session?.profile?.clinicalRole || data.userProfile?.clinicalRole || "Circulating RN";
  const fac = session?.profile?.facilityId || data.userProfile?.facilityId || "sacred_heart";
  const dept = session?.profile?.departmentId || data.userProfile?.departmentId || "or";
  const tenantId = `${fac}::${dept}`;

  const raw = data.rawText.trim();
  const auto = classifyText(raw);
  const category = data.category || auto.category;
  const severity = data.severity || auto.severity;
  const sentimentScore = auto.sentimentScore;
  const { aiRecommendation, suggestedFixPrompt } = synthesizeDevPrompt(raw, category, severity);

  const localItems = getLocalFeedback();

  // Create item
  const newItem: FeedbackItem = {
    id: `fb-${Math.random().toString(36).substring(2, 10)}`,
    tenantId,
    userName,
    userRole,
    source: "manual_submission",
    category,
    severity,
    sentimentScore,
    rawText: raw,
    aiRecommendation,
    suggestedFixPrompt,
    upvotes: 1,
    status: "open",
    createdAt: new Date().toISOString(),
  };

  localItems.unshift(newItem);
  saveLocalFeedback(localItems);

  // Sync to backend
  if (typeof window !== "undefined") {
    const endpoint = getFeedbackApiUrl("/api/feedback");
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newItem),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {
      enqueueOfflineSync({
        type: "CREATE",
        endpoint,
        method: "POST",
        payload: newItem,
      });
    });
  }

  return newItem;
}

export async function upvoteFeedback(id: string): Promise<FeedbackItem | null> {
  const localItems = getLocalFeedback();
  let updated: FeedbackItem | null = null;
  for (const item of localItems) {
    if (item.id === id) {
      item.upvotes += 1;
      updated = item;
      break;
    }
  }
  if (updated) {
    saveLocalFeedback(localItems);
    if (typeof window !== "undefined") {
      const endpoint = getFeedbackApiUrl(`/api/feedback/${id}/upvote`);
      fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(1500),
      }).catch(() => {
        enqueueOfflineSync({
          type: "UPVOTE",
          endpoint,
          method: "POST",
        });
      });
    }
  }
  return updated;
}

export async function updateFeedbackStatus(
  id: string,
  status: "open" | "planned" | "resolved"
): Promise<FeedbackItem | null> {
  const localItems = getLocalFeedback();
  let updated: FeedbackItem | null = null;
  for (const item of localItems) {
    if (item.id === id) {
      item.status = status;
      updated = item;
      break;
    }
  }
  if (updated) {
    saveLocalFeedback(localItems);
    if (typeof window !== "undefined") {
      const endpoint = getFeedbackApiUrl(`/api/feedback/${id}/status`);
      fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        signal: AbortSignal.timeout(1500),
      }).catch(() => {
        enqueueOfflineSync({
          type: "UPDATE_STATUS",
          endpoint,
          method: "PATCH",
          payload: { status },
        });
      });
    }
  }
  return updated;
}
