/**
 * OR-Nav Layer 1 Local-First PWA Offline Cache (Dexie.js / IndexedDB)
 *
 * Syncs the hospital tenant's inventory from `/api/inventory/sync` into IndexedDB
 * on load and provides a <5ms Tier-0 deterministic fallback when the device is
 * in a basement OR dead-zone (`!navigator.onLine` or network fetch failure).
 */

import Dexie, { type Table } from "dexie";
import type { CoordinateCardData, DepartmentQuestion } from "./api";
import {
  SEED_UNANSWERED_QUESTIONS,
  getSeedQuestions,
  getSeedInventoryItems,
  getSeedPreferenceCards,
  getSeedOrientationMd,
  DEFAULT_TENANT,
} from "./seedData";
import { CURRENT_BUILD_NUMBER } from "./version";
import type { MessageItem } from "@/components/ChatCanvas";
import {
  loadFacilityLexicon,
  learnAliasClient,
  titleCaseTerm,
} from "./lexiconLearning";

export interface OfflineInventoryRecord extends CoordinateCardData {
  id?: string;
  tenant_id: string;
  aliases?: string;
  normalized_name?: string;
  isCustomEdited?: boolean;
  deleted?: boolean;
  updatedAt?: number;
}

export interface OfflinePreferenceCard {
  id: string;
  tenant_id: string;
  surgeon: string;
  procedure: string;
  specialty?: string;
  gloves?: string;
  positioning?: string;
  prep?: string;
  instruments?: string[];
  sutures?: string[];
  pearls?: string[];
  notes?: string;
  isCustomEdited?: boolean;
  deleted?: boolean;
  updatedAt?: number;
}

export interface OfflineLexiconEntry {
  id: string;
  tenant_id: string;
  spokenTerm: string;
  canonicalItem: string;
  displayPreferredName?: string;
  category?: string;
  confidence?: "personal" | "facility_learned" | "facility_consensus";
  usageCount?: number;
  usedByUsers?: string[];
  notes?: string;
  isCustomEdited?: boolean;
  deleted?: boolean;
  updatedAt?: number;
}

export interface OutboxMutation {
  id?: number;
  type: "verify_move" | "flag_wrong" | "create_question" | "answer_question";
  tenant_id: string;
  item?: string;
  expected_location?: string;
  reason?: string;
  question_id?: string;
  question_text?: string;
  asked_by_role?: string;
  answer_text?: string;
  confidence?: "confident" | "tentative_unsure" | "verified";
  responder_role?: string;
  promote_to_verified?: boolean;
  timestamp: string;
}

export interface InstalledResourcePack {
  packId: string;          // e.g. "general_memorial::handbook", "general_memorial::or::inventory", "general_memorial::or::role_scrub"
  facilityId: string;
  departmentId?: string;   // null for hospital-wide handbook
  roleId?: string;         // null for dept-wide inventory/preference cards
  title: string;           // e.g. "General Memorial — Employee Handbook", "OR — Master Inventory & Carts", "OR — Scrub Tech Case Preferences"
  category: "hospital" | "department" | "role";
  filePath: string;        // relative path in repo
  sizeBytes: number;
  versionHash: string;
  installedAt: string;
  content: string;         // raw CSV/MD/JSON content cached on-device
}

export interface ChatSession {
  sessionId: string;
  tenantId: string;
  title: string;
  updatedAt: string;
  messages: MessageItem[];
}

export interface PeerAnswer {
  answerId: string;
  answeredBy: string;     // e.g. "Dr. Dorian / Senior Circulator"
  answerText: string;
  verifiedBy: string[];   // list of clinician names who tapped verify
  isVerifiedConsensus: boolean;
}

export interface PeerQuestion {
  id: string;
  tenantId: string;       // e.g. "sacred_heart::or"
  questionText: string;
  askedBy: string;        // e.g. "Sean Iglesia, RN (Orientee)"
  role: string;
  createdAt: string;
  answers: PeerAnswer[];
  status: "unverified" | "verified";
  verificationsCount: number;
}

class ORNavOfflineDatabase extends Dexie {
  inventoryItems!: Table<OfflineInventoryRecord, string>;
  offlineOutbox!: Table<OutboxMutation, number>;
  unansweredQuestions!: Table<DepartmentQuestion, string>;
  installedPacks!: Table<InstalledResourcePack, string>;
  chatSessions!: Table<ChatSession, string>;
  peerQuestions!: Table<PeerQuestion, string>;
  preferenceCards!: Table<OfflinePreferenceCard, string>;
  lexiconAliases!: Table<OfflineLexiconEntry, string>;

  constructor() {
    super("ORNavOfflineDB");
    this.version(3).stores({
      inventoryItems: "id, tenant_id, item, full_code, phonetic_code",
      offlineOutbox: "++id, tenant_id, type, timestamp",
      unansweredQuestions: "id, hospital_id, status",
    });
    this.version(4).stores({
      inventoryItems: "id, tenant_id, item, full_code, phonetic_code",
      offlineOutbox: "++id, tenant_id, type, timestamp",
      unansweredQuestions: "id, hospital_id, status",
      installedPacks: "packId, facilityId, departmentId, roleId, category, versionHash, installedAt",
    });
    this.version(5).stores({
      inventoryItems: "id, tenant_id, item, full_code, phonetic_code",
      offlineOutbox: "++id, tenant_id, type, timestamp",
      unansweredQuestions: "id, hospital_id, status",
      installedPacks: "packId, facilityId, departmentId, roleId, category, versionHash, installedAt",
      chatSessions: "sessionId, tenantId, title, updatedAt",
    });
    this.version(6).stores({
      inventoryItems: "id, tenant_id, item, full_code, phonetic_code",
      offlineOutbox: "++id, tenant_id, type, timestamp",
      unansweredQuestions: "id, hospital_id, status",
      installedPacks: "packId, facilityId, departmentId, roleId, category, versionHash, installedAt",
      chatSessions: "sessionId, tenantId, title, updatedAt",
      peerQuestions: "id, tenantId, status, createdAt",
    });
    this.version(7).stores({
      inventoryItems: "id, tenant_id, item, full_code, phonetic_code, [tenant_id+status]",
      offlineOutbox: "++id, tenant_id, type, timestamp",
      unansweredQuestions: "id, hospital_id, status",
      installedPacks: "packId, facilityId, departmentId, roleId, category, versionHash, installedAt",
      chatSessions: "sessionId, tenantId, title, updatedAt",
      peerQuestions: "id, tenantId, status, createdAt",
    });
    this.version(8).stores({
      inventoryItems: "id, tenant_id, item, full_code, phonetic_code, [tenant_id+status]",
      offlineOutbox: "++id, tenant_id, type, timestamp",
      unansweredQuestions: "id, hospital_id, status",
      installedPacks: "packId, facilityId, departmentId, roleId, category, versionHash, installedAt",
      chatSessions: "sessionId, tenantId, title, updatedAt",
      peerQuestions: "id, tenantId, status, createdAt",
      preferenceCards: "id, tenant_id, surgeon, procedure, [tenant_id+surgeon]",
      lexiconAliases: "id, tenant_id, spokenTerm, canonicalItem",
    });
  }
}

const isStorageSupported = typeof window !== "undefined" || typeof indexedDB !== "undefined";
const memoryFallbackStorage = new Map<string, string>();

export function safeGetStorage(key: string): string | null {
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    try {
      return localStorage.getItem(key);
    } catch {}
  }
  return memoryFallbackStorage.get(key) || null;
}

export function safeSetStorage(key: string, val: string): void {
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(key, val);
      return;
    } catch {}
  }
  memoryFallbackStorage.set(key, val);
}

let activeDb: ORNavOfflineDatabase | null =
  isStorageSupported ? new ORNavOfflineDatabase() : null;

export const offlineDb = activeDb;

/**
 * Queue a mutation into local IndexedDB when offline in a lead-lined OR.
 */
export async function queueOfflineMutation(mutation: Omit<OutboxMutation, "id">): Promise<void> {
  if (!activeDb) return;
  try {
    await activeDb.offlineOutbox.add(mutation as OutboxMutation);
  } catch (err) {
    console.warn("Failed to queue offline mutation:", err);
  }
}

/**
 * Return current count of unsynced mutations queued in IndexedDB.
 */
export async function getPendingOutboxCount(): Promise<number> {
  if (!activeDb || typeof window === "undefined") return 0;
  try {
    return await activeDb.offlineOutbox.count();
  } catch {
    return 0;
  }
}

/**
 * Replay all queued offline mutations to the backend when reconnected to hospital network.
 * Supports exponential backoff and retry.
 */
export async function flushOfflineOutbox(apiBase: string = ""): Promise<number> {
  if (!activeDb || typeof window === "undefined" || !navigator.onLine) return 0;
  let count = 0;
  try {
    const pending = await activeDb.offlineOutbox.toArray();

    // Deduplicate mutations to make replay idempotent
    const deduplicatedMutations = new Map<string, typeof pending[0]>();
    const mutationIdsByKey = new Map<string, number[]>();

    for (const mut of pending) {
      // Build a unique key based on mutation type and its primary subject
      let deduplicationKey = `${mut.type}::${mut.tenant_id}`;
      if (mut.item) deduplicationKey += `::${mut.item}`;
      if (mut.question_id) deduplicationKey += `::${mut.question_id}`;
      if (mut.question_text) deduplicationKey += `::${mut.question_text}`;

      deduplicatedMutations.set(deduplicationKey, mut);

      const ids = mutationIdsByKey.get(deduplicationKey) || [];
      if (mut.id) ids.push(mut.id);
      mutationIdsByKey.set(deduplicationKey, ids);
    }

    for (const [key, mut] of deduplicatedMutations.entries()) {
      let success = false;
      let delayMs = 150;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (mut.type === "verify_move" && mut.item) {
            const resp = await fetch(`${apiBase}/api/inventory/verify-move`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tenant_id: mut.tenant_id,
                item: mut.item,
                expected_location: mut.expected_location,
              }),
            });
            if (resp.ok) {
              success = true;
              break;
            }
          } else if (mut.type === "flag_wrong" && mut.item) {
            const resp = await fetch(`${apiBase}/api/inventory/flag-wrong`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tenant_id: mut.tenant_id,
                item: mut.item,
                reason: mut.reason || "Location empty or item moved",
              }),
            });
            if (resp.ok) {
              success = true;
              break;
            }
          } else if (mut.type === "create_question" && mut.question_text) {
            const resp = await fetch(`${apiBase}/api/questions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tenant_id: mut.tenant_id,
                question_text: mut.question_text,
                asked_by_role: mut.asked_by_role || "Clinical Orientee RN",
              }),
            });
            if (resp.ok) {
              success = true;
              break;
            }
          } else if (mut.type === "answer_question" && mut.question_id) {
            const resp = await fetch(
              `${apiBase}/api/questions/${encodeURIComponent(mut.question_id)}/answer`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  tenant_id: mut.tenant_id,
                  answer_text: mut.answer_text,
                  confidence: mut.confidence || "confident",
                  responder_role: mut.responder_role || "Clinical Peer RN",
                  promote_to_verified: mut.promote_to_verified || false,
                }),
              }
            );
            if (resp.ok) {
              success = true;
              break;
            }
          }
        } catch {
          await new Promise((r) => setTimeout(r, delayMs));
          delayMs *= 2;
        }
      }

      if (success) {
        const idsToDelete = mutationIdsByKey.get(key) || [];
        for (const id of idsToDelete) {
          await activeDb.offlineOutbox.delete(id);
          count++;
        }
      }
    }
  } catch (err) {
    console.warn("Flush offline outbox failed:", err);
  }
  return count;
}

/**
 * Self-healing helper: if IndexedDB hits version mismatches, closed states,
 * or storage corruption, wipes and re-initializes the database automatically.
 */
export async function selfHealOfflineDatabase(): Promise<ORNavOfflineDatabase | null> {
  if (!isStorageSupported) return null;
  try {
    if (activeDb) {
      try {
        activeDb.close();
      } catch {}
    }
    await Dexie.delete("ORNavOfflineDB");
    activeDb = new ORNavOfflineDatabase();
    await activeDb.open();
    return activeDb;
  } catch (err) {
    console.warn("Self-healing Dexie reset failed:", err);
    return null;
  }
}

/* =====================================================================
 * Multi-Session Case History & Persistence (IndexedDB + localStorage)
 * ===================================================================== */

const SESSIONS_STORAGE_KEY_PREFIX = "ornav_chat_sessions_index_";

function getLocalSessionsKey(tenantId: string): string {
  return `${SESSIONS_STORAGE_KEY_PREFIX}${tenantId}`;
}

function getLocalSessions(tenantId: string): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getLocalSessionsKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setLocalSessions(tenantId: string, sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getLocalSessionsKey(tenantId), JSON.stringify(sessions));
  } catch (e) {
    console.warn("Failed to write sessions to localStorage:", e);
  }
}

/**
 * Save or update a chat session in both IndexedDB and localStorage fallback.
 */
export async function saveChatSession(session: ChatSession): Promise<void> {
  // 1. Synchronous localStorage snapshot
  if (typeof window !== "undefined") {
    try {
      const existing = getLocalSessions(session.tenantId);
      const filtered = existing.filter((s) => s.sessionId !== session.sessionId);
      filtered.unshift(session);
      // Keep up to 50 sessions per tenant in local storage snapshot
      setLocalSessions(session.tenantId, filtered.slice(0, 50));
    } catch (e) {
      console.warn("Error updating local sessions in localStorage:", e);
    }
  }

  // 2. Put into Dexie / IndexedDB
  const db = activeDb || (await selfHealOfflineDatabase());
  if (db) {
    try {
      await db.chatSessions.put(session);
    } catch (e) {
      console.warn("Failed to save chat session to IndexedDB:", e);
    }
  }
}

/**
 * Get a specific chat session by sessionId from IndexedDB or localStorage.
 */
export async function getChatSession(sessionId: string): Promise<ChatSession | undefined> {
  const db = activeDb;
  if (db) {
    try {
      const match = await db.chatSessions.get(sessionId);
      if (match) return match;
    } catch (e) {
      console.warn("IndexedDB getChatSession failed, falling back to localStorage:", e);
    }
  }

  if (typeof window !== "undefined") {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(SESSIONS_STORAGE_KEY_PREFIX)) {
          const tenantId = key.replace(SESSIONS_STORAGE_KEY_PREFIX, "");
          const sessions = getLocalSessions(tenantId);
          const found = sessions.find((s) => s.sessionId === sessionId);
          if (found) return found;
        }
      }
    } catch {}
  }
  return undefined;
}

/**
 * List all chat sessions (optionally filtered by tenantId), sorted newest first.
 */
export async function listChatSessions(tenantId?: string): Promise<ChatSession[]> {
  const db = activeDb;
  let results: ChatSession[] = [];

  if (db) {
    try {
      if (tenantId) {
        results = await db.chatSessions.where("tenantId").equals(tenantId).toArray();
      } else {
        results = await db.chatSessions.toArray();
      }
      if (results && results.length > 0) {
        results.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        return results;
      }
    } catch (e) {
      console.warn("IndexedDB listChatSessions failed, falling back to localStorage:", e);
    }
  }

  // Fallback to localStorage
  if (typeof window !== "undefined") {
    try {
      if (tenantId) {
        results = getLocalSessions(tenantId);
      } else {
        const all: ChatSession[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(SESSIONS_STORAGE_KEY_PREFIX)) {
            const tId = key.replace(SESSIONS_STORAGE_KEY_PREFIX, "");
            all.push(...getLocalSessions(tId));
          }
        }
        results = all;
      }
      results.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch {}
  }

  return results;
}

/**
 * Delete a specific chat session by sessionId from IndexedDB and localStorage.
 */
export async function deleteChatSession(sessionId: string): Promise<void> {
  const db = activeDb;
  if (db) {
    try {
      await db.chatSessions.delete(sessionId);
    } catch (e) {
      console.warn("IndexedDB deleteChatSession failed:", e);
    }
  }

  if (typeof window !== "undefined") {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(SESSIONS_STORAGE_KEY_PREFIX)) {
          const tenantId = key.replace(SESSIONS_STORAGE_KEY_PREFIX, "");
          const sessions = getLocalSessions(tenantId);
          const filtered = sessions.filter((s) => s.sessionId !== sessionId);
          if (filtered.length !== sessions.length) {
            setLocalSessions(tenantId, filtered);
          }
        }
      }
    } catch {}
  }
}

/**
 * Clear all chat sessions (optionally for a specific tenant) from IndexedDB and localStorage.
 */
export async function clearChatSessions(tenantId?: string): Promise<void> {
  const db = activeDb;
  if (db) {
    try {
      if (tenantId) {
        await db.chatSessions.where("tenantId").equals(tenantId).delete();
      } else {
        await db.chatSessions.clear();
      }
    } catch (e) {
      console.warn("IndexedDB clearChatSessions failed:", e);
    }
  }

  if (typeof window !== "undefined") {
    try {
      if (tenantId) {
        localStorage.removeItem(getLocalSessionsKey(tenantId));
      } else {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(SESSIONS_STORAGE_KEY_PREFIX)) {
            keysToRemove.push(key);
          }
        }
        for (const k of keysToRemove) localStorage.removeItem(k);
      }
    } catch {}
  }
}

const CLIENT_HOMOPHONE_MAP: Record<string, string> = {
  "the bakery": "debakey",
  "de bakery": "debakey",
  bakery: "debakey",
  debakeys: "debakey",
  "pro lean": "prolene",
  "pro-lean": "prolene",
  "tie cron": "ti-cron",
  ticron: "ti-cron",
  "four oh": "4-0",
  "four-oh": "4-0",
  "three oh": "3-0",
  "three-oh": "3-0",
  "two oh": "2-0",
  "two-oh": "2-0",
  "white laner": "weitlaner",
  "white liner": "weitlaner",
  "30 silk": "3-0 silk",
  "20 prolene": "2-0 prolene",
  "40 prolene": "4-0 prolene",
};

const STOP_WORDS = new Set([
  "where",
  "is",
  "are",
  "the",
  "a",
  "an",
  "find",
  "locate",
  "need",
  "get",
  "me",
  "do",
  "we",
  "have",
  "in",
  "from",
  "for",
  "please",
]);

export function normalizeClientQuery(raw: string): string {
  let text = raw
    .toLowerCase()
    .replace(/\[redacted_phi\]/gi, " ")
    .replace(/[?!.,;:"'()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [src, target] of Object.entries(CLIENT_HOMOPHONE_MAP).sort(
    (a, b) => b[0].length - a[0].length
  )) {
    const regex = new RegExp(`\\b${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    text = text.replace(regex, target);
  }

  const tokens = text.split(" ").filter((t) => t && !STOP_WORDS.has(t));
  return (tokens.length > 0 ? tokens : text.split(" ")).join(" ").trim();
}

/**
 * Sync tenant inventory from backend into local IndexedDB.
 */
export async function syncTenantInventoryToOfflineDb(
  tenantId: string,
  apiBase: string = ""
): Promise<number> {
  if (typeof window === "undefined") return 0;
  try {
    const res = await fetch(
      `${apiBase}/api/inventory/sync?tenant_id=${encodeURIComponent(tenantId)}`
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const items: CoordinateCardData[] = data.items || [];
    if (!items || items.length === 0) return 0;

    const records: OfflineInventoryRecord[] = items.map((item) => ({
      ...item,
      id: `${tenantId}::${item.item.toLowerCase()}`,
      tenant_id: tenantId,
      normalized_name: normalizeClientQuery(item.item),
    }));

    const db = activeDb || (await selfHealOfflineDatabase());
    if (!db) return 0;

    try {
      // Preserve any user-added items
      const existing = await db.inventoryItems
        .where("tenant_id")
        .equals(tenantId)
        .toArray();
      const userAdded = existing.filter(
        (e) => e.status === "user_added" || (e.verify_count !== undefined && e.verify_count < 3)
      );

      await db.inventoryItems.where("tenant_id").equals(tenantId).delete();
      await db.inventoryItems.bulkPut([...records, ...userAdded]);
      localStorage.setItem(`ornav_dexie_build_${tenantId}`, String(CURRENT_BUILD_NUMBER));
      return records.length + userAdded.length;
    } catch {
      // Self-heal and retry once on corruption / version conflict (Vector 7)
      const healedDb = await selfHealOfflineDatabase();
      if (healedDb) {
        await healedDb.inventoryItems.bulkPut(records);
        localStorage.setItem(`ornav_dexie_build_${tenantId}`, String(CURRENT_BUILD_NUMBER));
        return records.length;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Hydrates or automatically upgrades Dexie inventory items for a tenant.
 *
 * Prevents the "stale cache trap" where devices with an older or partial cache
 * (e.g. 34 items) fail to receive the full 143+ item catalog.
 *
 * Upgrade triggers:
 * 1. forceRebuild === true
 * 2. Existing Dexie item count < seedItems.length (e.g. 34 < 143)
 * 3. Stored build number < CURRENT_BUILD_NUMBER
 *
 * Preserves user-added items and provisional moves during upgrade!
 */
export async function hydrateOrUpgradeOfflineInventory(
  tenantId: string = DEFAULT_TENANT,
  forceRebuild: boolean = false
): Promise<number> {
  if (!isStorageSupported) return 0;
  const db = activeDb || (await selfHealOfflineDatabase());
  if (!db) return 0;

  // Normalize tenantId (handle legacy underscores if passed)
  const normTenant = tenantId.includes("::") ? tenantId : tenantId.replace("_", "::");

  try {
    const seedItems = getSeedInventoryItems(normTenant);
    const existingItems = await db.inventoryItems
      .where("tenant_id")
      .equals(normTenant)
      .toArray();

    const storedBuildKey = `ornav_dexie_build_${normTenant}`;
    const storedBuild = parseInt(
      safeGetStorage(storedBuildKey) || "0",
      10
    );

    const isStale =
      existingItems.length === 0 ||
      existingItems.length < seedItems.length ||
      storedBuild < CURRENT_BUILD_NUMBER ||
      forceRebuild;

    if (!isStale) {
      return existingItems.length;
    }

    // 1. Identify user-added custom items or provisional moves to preserve
    const userItems = existingItems.filter(
      (item) =>
        item.status === "user_added" ||
        item.isCustomEdited === true ||
        item.deleted === true ||
        (item.verify_count !== undefined && item.verify_count < 3) ||
        !seedItems.some(
          (s) => s.item.toLowerCase() === item.item.toLowerCase()
        )
    );

    // 2. Build record map starting with seed items
    const recordMap = new Map<string, OfflineInventoryRecord>();
    for (const item of seedItems) {
      const lower = item.item.toLowerCase();
      recordMap.set(lower, {
        ...item,
        id: `${normTenant}::${lower}`,
        tenant_id: normTenant,
        normalized_name: normalizeClientQuery(item.item),
      });
    }

    // 3. Check if installed resource packs in Dexie have custom inventory CSV
    try {
      const installedPacks = await db.installedPacks.toArray();
      const [facId, deptId] = normTenant.split("::");
      const invPack = installedPacks.find(
        (p) =>
          p.filePath.endsWith("inventory.csv") &&
          p.facilityId === facId &&
          (!p.departmentId || p.departmentId === deptId)
      );
      if (invPack && invPack.content) {
        const lines = invPack.content.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length > 1) {
          const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
          const itemIdx = header.indexOf("item");
          const roomIdx = header.indexOf("room");
          const cabIdx = header.indexOf("cabinet");
          const shelfIdx = header.indexOf("shelf");
          const binIdx = header.indexOf("container");
          const codeIdx = header.indexOf("full_code");
          const phoneticIdx = header.indexOf("phonetic_code");
          const notesIdx = header.indexOf("surgeon_notes");
          const catIdx = header.indexOf("category");

          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(",").map((p) => p.trim());
            if (parts.length < 5) continue;
            const itemName = parts[itemIdx] || parts[0];
            const lower = itemName.toLowerCase();
            const rm = parts[roomIdx] || "Main OR";
            const cab = parts[cabIdx] || "A";
            const sh = parts[shelfIdx] || "1";
            const bin = parts[binIdx] || "A";
            const fullCode = parts[codeIdx] || `${rm} ${cab} ${sh} ${bin}`;
            recordMap.set(lower, {
              id: `${normTenant}::${lower}`,
              tenant_id: normTenant,
              item: itemName,
              room: rm,
              cabinet: cab,
              shelf: sh,
              container: bin,
              full_code: fullCode,
              phonetic_code: parts[phoneticIdx] || fullCode,
              surgeon_notes: notesIdx >= 0 ? parts[notesIdx] : "",
              category: catIdx >= 0 ? parts[catIdx] : "",
              pending_location: "",
              verify_count: 3,
              normalized_name: normalizeClientQuery(itemName),
            });
          }
        }
      }
    } catch (e) {
      console.warn("[Dexie Hydration] Failed to overlay installed inventory packs:", e);
    }

    // 4. Overlay user-added items so custom clinician modifications are never lost
    const tombstonesToPersist: OfflineInventoryRecord[] = [];
    for (const u of userItems) {
      if (u.deleted) {
        recordMap.delete(u.item.toLowerCase());
        tombstonesToPersist.push({
          ...u,
          id: `${normTenant}::${u.item.toLowerCase()}`,
          tenant_id: normTenant,
          deleted: true,
          isCustomEdited: true,
          updatedAt: u.updatedAt || Date.now(),
        });
      } else {
        recordMap.set(u.item.toLowerCase(), {
          ...u,
          id: `${normTenant}::${u.item.toLowerCase()}`,
          tenant_id: normTenant,
          normalized_name: normalizeClientQuery(u.item),
        });
      }
    }

    const mergedRecords = Array.from(recordMap.values());

    // 5. Clean up old tenant records and legacy underscore records
    await db.inventoryItems.where("tenant_id").equals(normTenant).delete();
    const legacyUnderscore = normTenant.replace("::", "_");
    if (legacyUnderscore !== normTenant) {
      await db.inventoryItems.where("tenant_id").equals(legacyUnderscore).delete();
    }

    // 6. Bulk put merged records into Dexie
    await db.inventoryItems.bulkPut([...mergedRecords, ...tombstonesToPersist]);
    safeSetStorage(storedBuildKey, String(CURRENT_BUILD_NUMBER));

    return mergedRecords.length;
  } catch (err) {
    console.warn("[Dexie Hydration] Error in hydrateOrUpgradeOfflineInventory:", err);
    return 0;
  }
}

if (typeof window !== "undefined") {
  (window as any).hydrateOrUpgradeOfflineInventory = hydrateOrUpgradeOfflineInventory;
  (window as any).offlineDb = activeDb;
}

/**
 * Retrieve offline inventory items for a tenant, filtering out deleted items.
 * Automatically runs hydrateOrUpgradeOfflineInventory if empty.
 */
export async function getOfflineInventory(
  tenantId: string = DEFAULT_TENANT
): Promise<OfflineInventoryRecord[]> {
  const normTenant = tenantId.includes("::") ? tenantId : tenantId.replace("_", "::");
  const db = activeDb || (await selfHealOfflineDatabase());
  if (!db) {
    return (getSeedInventoryItems(normTenant) as OfflineInventoryRecord[]).filter((i) => !i.deleted);
  }
  try {
    let items = await db.inventoryItems
      .where("tenant_id")
      .equals(normTenant)
      .toArray();

    if (!items || items.length === 0) {
      await hydrateOrUpgradeOfflineInventory(normTenant, true);
      items = await db.inventoryItems
        .where("tenant_id")
        .equals(normTenant)
        .toArray();
    }
    return items.filter((i) => !i.deleted);
  } catch (err) {
    console.warn("[offlineDb] getOfflineInventory error:", err);
    return (getSeedInventoryItems(normTenant) as OfflineInventoryRecord[]).filter((i) => !i.deleted);
  }
}

/**
 * Update an existing inventory item in Dexie.
 * Marks the item with isCustomEdited: true and status: 'user_added' so seed hydration
 * never overwrites the clinician's custom changes.
 */
export async function updateOfflineInventoryItem(
  tenantKey: string,
  itemId: string,
  updates: Partial<OfflineInventoryRecord>
): Promise<OfflineInventoryRecord | null> {
  const db = activeDb || (await selfHealOfflineDatabase());
  const normTenant = tenantKey.includes("::") ? tenantKey : tenantKey.replace("_", "::");
  if (!db) return null;

  try {
    let existing = await db.inventoryItems.get(itemId);
    if (!existing) {
      const all = await db.inventoryItems.where("tenant_id").equals(normTenant).toArray();
      existing = all.find(
        (i) => i.id === itemId || i.item.toLowerCase() === itemId.toLowerCase()
      );
    }
    if (!existing) return null;

    const updatedItemName = updates.item ? updates.item.trim() : existing.item;
    const room = updates.room ?? existing.room;
    const cabinet = updates.cabinet ?? existing.cabinet;
    const shelf = updates.shelf ?? existing.shelf;
    const container = updates.container ?? existing.container;
    const fullCode = updates.full_code ?? `${room} ${cabinet} ${shelf} ${container}`;
    const phoneticCode = updates.phonetic_code ?? fullCode;

    const merged: OfflineInventoryRecord = {
      ...existing,
      ...updates,
      item: updatedItemName,
      room,
      cabinet,
      shelf,
      container,
      full_code: fullCode,
      phonetic_code: phoneticCode,
      human_alias: `${room} · Cart ${cabinet} · Shelf ${shelf} · Bin ${container}`,
      normalized_name: normalizeClientQuery(updatedItemName),
      status: "user_added",
      isCustomEdited: true,
      deleted: false,
      updatedAt: Date.now(),
    };

    await db.inventoryItems.put(merged);

    try {
      await queueOfflineMutation({
        tenant_id: normTenant,
        type: "verify_move",
        item: merged.item,
        expected_location: merged.full_code,
        reason: "Clinician manual update in Resource Inspector",
        timestamp: new Date().toISOString(),
      });
    } catch {}

    return merged;
  } catch (err) {
    console.warn("[offlineDb] updateOfflineInventoryItem failed:", err);
    return null;
  }
}

/**
 * Delete an inventory item from Dexie.
 * Tombstones with deleted: true so seed hydration never resurrects the item.
 */
export async function deleteOfflineInventoryItem(
  tenantKey: string,
  itemId: string
): Promise<boolean> {
  const db = activeDb || (await selfHealOfflineDatabase());
  const normTenant = tenantKey.includes("::") ? tenantKey : tenantKey.replace("_", "::");
  if (!db) return false;

  try {
    let existing = await db.inventoryItems.get(itemId);
    if (!existing) {
      const all = await db.inventoryItems.where("tenant_id").equals(normTenant).toArray();
      existing = all.find(
        (i) => i.id === itemId || i.item.toLowerCase() === itemId.toLowerCase()
      );
    }
    if (!existing) return false;

    const tombstone: OfflineInventoryRecord = {
      ...existing,
      deleted: true,
      isCustomEdited: true,
      updatedAt: Date.now(),
    };
    await db.inventoryItems.put(tombstone);
    return true;
  } catch (err) {
    console.warn("[offlineDb] deleteOfflineInventoryItem failed:", err);
    return false;
  }
}

/**
 * Create a new inventory item in Dexie.
 * Automatically computes codes and protects item from seed overwrites.
 */
export async function createOfflineInventoryItem(
  tenantKey: string,
  newItem: Partial<OfflineInventoryRecord> & { item: string }
): Promise<OfflineInventoryRecord> {
  const db = activeDb || (await selfHealOfflineDatabase());
  const normTenant = tenantKey.includes("::") ? tenantKey : tenantKey.replace("_", "::");
  const itemName = newItem.item.trim();
  const id = newItem.id || `${normTenant}::${itemName.toLowerCase()}`;
  const room = newItem.room || "Main OR";
  const cabinet = newItem.cabinet || "A";
  const shelf = newItem.shelf || "1";
  const container = newItem.container || "A";
  const fullCode = newItem.full_code || `${room} ${cabinet} ${shelf} ${container}`;
  const phoneticCode = newItem.phonetic_code || fullCode;
  const humanAlias = `${room} · Cart ${cabinet} · Shelf ${shelf} · Bin ${container}`;

  const record: OfflineInventoryRecord = {
    ...newItem,
    id,
    tenant_id: normTenant,
    item: itemName,
    room,
    cabinet,
    shelf,
    container,
    full_code: fullCode,
    phonetic_code: phoneticCode,
    human_alias: humanAlias,
    category: newItem.category || "General Supplies",
    surgeon_notes: newItem.surgeon_notes || "",
    aliases: newItem.aliases || "",
    status: "user_added",
    verify_count: 3,
    verification_score: 3.0,
    pending_location: "",
    normalized_name: normalizeClientQuery(itemName),
    isCustomEdited: true,
    deleted: false,
    updatedAt: Date.now(),
  };

  if (db) {
    await db.inventoryItems.put(record);
    try {
      await queueOfflineMutation({
        tenant_id: normTenant,
        type: "verify_move",
        item: record.item,
        expected_location: record.full_code,
        reason: "Clinician manual creation in Resource Inspector",
        timestamp: new Date().toISOString(),
      });
    } catch {}
  }

  return record;
}

/**
 * Retrieve preference cards for a tenant from Dexie, hydrating from packs/seed if empty.
 */
export async function getOfflinePreferenceCards(
  tenantId: string = DEFAULT_TENANT
): Promise<OfflinePreferenceCard[]> {
  const db = activeDb || (await selfHealOfflineDatabase());
  const normTenant = tenantId.includes("::") ? tenantId : tenantId.replace("_", "::");
  if (!db) {
    return (getSeedPreferenceCards(normTenant) as OfflinePreferenceCard[]).filter((c) => !c.deleted);
  }

  try {
    const existing = await db.preferenceCards
      .where("tenant_id")
      .equals(normTenant)
      .toArray();

    if (existing && existing.length > 0) {
      return existing.filter((c) => !c.deleted);
    }

    // Hydrate from installed packs if available
    let packCards: OfflinePreferenceCard[] = [];
    try {
      const packs = await db.installedPacks.toArray();
      const [facId] = normTenant.split("::");
      const pack = packs.find(
        (p) => p.filePath.endsWith("preference_cards.json") && p.facilityId === facId
      );
      if (pack && pack.content) {
        packCards = JSON.parse(pack.content);
      }
    } catch {}

    const seedCards = packCards.length > 0 ? packCards : (getSeedPreferenceCards(normTenant) as OfflinePreferenceCard[]);
    const formatted: OfflinePreferenceCard[] = seedCards.map((c, idx) => ({
      ...c,
      id: c.id || `${normTenant}::card_${idx}_${(c.surgeon || "surgeon").toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      tenant_id: normTenant,
      isCustomEdited: false,
      deleted: false,
    }));

    if (formatted.length > 0) {
      await db.preferenceCards.bulkPut(formatted);
    }
    return formatted;
  } catch (err) {
    console.warn("[offlineDb] getOfflinePreferenceCards error:", err);
    return (getSeedPreferenceCards(normTenant) as OfflinePreferenceCard[]).filter((c) => !c.deleted);
  }
}

/**
 * Save or update a preference card in Dexie.
 */
export async function saveOfflinePreferenceCard(
  tenantId: string,
  card: Partial<OfflinePreferenceCard> & { surgeon: string; procedure: string }
): Promise<OfflinePreferenceCard> {
  const db = activeDb || (await selfHealOfflineDatabase());
  const normTenant = tenantId.includes("::") ? tenantId : tenantId.replace("_", "::");
  const cardId = card.id || `${normTenant}::card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const record: OfflinePreferenceCard = {
    ...card,
    id: cardId,
    tenant_id: normTenant,
    surgeon: card.surgeon.trim(),
    procedure: card.procedure.trim(),
    specialty: card.specialty || "Surgery",
    gloves: card.gloves || "",
    positioning: card.positioning || "",
    prep: card.prep || "",
    instruments: card.instruments || [],
    sutures: card.sutures || [],
    pearls: card.pearls || [],
    notes: card.notes || "",
    isCustomEdited: true,
    deleted: false,
    updatedAt: Date.now(),
  };

  if (db) {
    await db.preferenceCards.put(record);
  }
  return record;
}

/**
 * Delete a preference card from Dexie (tombstoning to prevent resurrection).
 */
export async function deleteOfflinePreferenceCard(
  tenantId: string,
  cardId: string
): Promise<boolean> {
  const db = activeDb || (await selfHealOfflineDatabase());
  if (!db) return false;
  try {
    const existing = await db.preferenceCards.get(cardId);
    if (existing) {
      await db.preferenceCards.put({
        ...existing,
        deleted: true,
        isCustomEdited: true,
        updatedAt: Date.now(),
      });
    } else {
      await db.preferenceCards.delete(cardId);
    }
    return true;
  } catch (err) {
    console.warn("[offlineDb] deleteOfflinePreferenceCard failed:", err);
    return false;
  }
}

/**
 * Retrieve facility slang and spoken aliases from Dexie, hydrating from pre-seeded lexicon if empty.
 */
export async function getOfflineLexiconAliases(
  tenantId: string = DEFAULT_TENANT
): Promise<OfflineLexiconEntry[]> {
  const db = activeDb || (await selfHealOfflineDatabase());
  const normTenant = tenantId.includes("::") ? tenantId : tenantId.replace("_", "::");
  const facId = normTenant.split("::")[0] || "sacred_heart";

  if (!db) {
    const seed = loadFacilityLexicon(facId);
    return seed.map((s) => ({
      id: `${normTenant}::lex_${s.aliasId}`,
      tenant_id: normTenant,
      spokenTerm: s.spokenTerm,
      canonicalItem: s.canonicalItemName,
      displayPreferredName: s.displayPreferredName,
      confidence: s.confidence,
      usageCount: s.usageCount,
      usedByUsers: s.usedByUsers,
    }));
  }

  try {
    const existing = await db.lexiconAliases
      .where("tenant_id")
      .equals(normTenant)
      .toArray();

    if (existing && existing.length > 0) {
      return existing.filter((a) => !a.deleted);
    }

    const seed = loadFacilityLexicon(facId);
    const formatted: OfflineLexiconEntry[] = seed.map((s) => ({
      id: `${normTenant}::lex_${s.aliasId}`,
      tenant_id: normTenant,
      spokenTerm: s.spokenTerm,
      canonicalItem: s.canonicalItemName,
      displayPreferredName: s.displayPreferredName,
      confidence: s.confidence,
      usageCount: s.usageCount,
      usedByUsers: s.usedByUsers,
      isCustomEdited: false,
      deleted: false,
      updatedAt: Date.now(),
    }));

    if (formatted.length > 0) {
      await db.lexiconAliases.bulkPut(formatted);
    }
    return formatted;
  } catch (err) {
    console.warn("[offlineDb] getOfflineLexiconAliases error:", err);
    return [];
  }
}

/**
 * Save or update a slang/alias entry in Dexie and sync with facility lexicon.
 */
export async function saveOfflineLexiconAlias(
  tenantId: string,
  alias: Partial<OfflineLexiconEntry> & { spokenTerm: string; canonicalItem: string }
): Promise<OfflineLexiconEntry> {
  const db = activeDb || (await selfHealOfflineDatabase());
  const normTenant = tenantId.includes("::") ? tenantId : tenantId.replace("_", "::");
  const facId = normTenant.split("::")[0] || "sacred_heart";
  const id = alias.id || `${normTenant}::lex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const record: OfflineLexiconEntry = {
    ...alias,
    id,
    tenant_id: normTenant,
    spokenTerm: alias.spokenTerm.trim().toLowerCase(),
    canonicalItem: alias.canonicalItem.trim(),
    displayPreferredName: alias.displayPreferredName || titleCaseTerm(alias.spokenTerm),
    category: alias.category || "General",
    confidence: alias.confidence || "facility_consensus",
    usageCount: alias.usageCount ?? 5,
    usedByUsers: alias.usedByUsers || ["clinician"],
    notes: alias.notes || "",
    isCustomEdited: true,
    deleted: false,
    updatedAt: Date.now(),
  };

  if (db) {
    await db.lexiconAliases.put(record);
  }

  try {
    learnAliasClient(facId, "or", record.spokenTerm, record.canonicalItem, "clinician", record.displayPreferredName);
  } catch {}

  return record;
}

/**
 * Delete a slang/alias entry from Dexie.
 */
export async function deleteOfflineLexiconAlias(
  tenantId: string,
  aliasId: string
): Promise<boolean> {
  const db = activeDb || (await selfHealOfflineDatabase());
  if (!db) return false;
  try {
    const existing = await db.lexiconAliases.get(aliasId);
    if (existing) {
      await db.lexiconAliases.put({
        ...existing,
        deleted: true,
        isCustomEdited: true,
        updatedAt: Date.now(),
      });
    } else {
      await db.lexiconAliases.delete(aliasId);
    }
    return true;
  } catch (err) {
    console.warn("[offlineDb] deleteOfflineLexiconAlias failed:", err);
    return false;
  }
}

/**
 * Retrieve offline department orientation guideline (custom or seed).
 */
export function getOfflineDepartmentGuideline(tenantId: string = DEFAULT_TENANT): string {
  const normTenant = tenantId.includes("::") ? tenantId : tenantId.replace("_", "::");
  const custom = safeGetStorage(`ornav_guideline_${normTenant}`);
  if (custom && custom.trim().length > 0) {
    return custom;
  }
  return getSeedOrientationMd(normTenant);
}

/**
 * Save custom offline department orientation guideline.
 */
export function saveOfflineDepartmentGuideline(tenantId: string, markdownContent: string): void {
  const normTenant = tenantId.includes("::") ? tenantId : tenantId.replace("_", "::");
  safeSetStorage(`ornav_guideline_${normTenant}`, markdownContent);
}

export interface TenantResourcesExportBundle {
  exportVersion: 1;
  tenantId: string;
  exportedAt: string;
  inventory: OfflineInventoryRecord[];
  preferenceCards: OfflinePreferenceCard[];
  lexiconAliases: OfflineLexiconEntry[];
  guideline: string;
}

/**
 * Export all tenant items, cards, lexicon aliases, and guidelines to a single portable JSON backup.
 */
export async function exportTenantResourcesJson(tenantId: string = DEFAULT_TENANT): Promise<string> {
  const normTenant = tenantId.includes("::") ? tenantId : tenantId.replace("_", "::");
  const [inventory, preferenceCards, lexiconAliases] = await Promise.all([
    getOfflineInventory(normTenant),
    getOfflinePreferenceCards(normTenant),
    getOfflineLexiconAliases(normTenant),
  ]);
  const guideline = getOfflineDepartmentGuideline(normTenant);

  const bundle: TenantResourcesExportBundle = {
    exportVersion: 1,
    tenantId: normTenant,
    exportedAt: new Date().toISOString(),
    inventory,
    preferenceCards,
    lexiconAliases,
    guideline,
  };

  return JSON.stringify(bundle, null, 2);
}

/**
 * Import and validate resources from a JSON backup.
 */
export async function importTenantResourcesJson(
  tenantId: string,
  jsonString: string
): Promise<{ success: boolean; importedItems: number; importedCards: number; importedAliases: number; message?: string }> {
  const db = activeDb || (await selfHealOfflineDatabase());
  const normTenant = tenantId.includes("::") ? tenantId : tenantId.replace("_", "::");
  if (!db) {
    return { success: false, importedItems: 0, importedCards: 0, importedAliases: 0, message: "Offline database unavailable." };
  }

  try {
    const bundle = JSON.parse(jsonString) as Partial<TenantResourcesExportBundle>;
    if (!bundle || (!bundle.inventory && !bundle.preferenceCards && !bundle.lexiconAliases)) {
      return { success: false, importedItems: 0, importedCards: 0, importedAliases: 0, message: "Invalid JSON backup format." };
    }

    let importedItems = 0;
    let importedCards = 0;
    let importedAliases = 0;

    if (Array.isArray(bundle.inventory) && bundle.inventory.length > 0) {
      const records: OfflineInventoryRecord[] = bundle.inventory.map((item) => ({
        ...item,
        id: item.id || `${normTenant}::${item.item.toLowerCase()}`,
        tenant_id: normTenant,
        status: "user_added",
        isCustomEdited: true,
        deleted: false,
        updatedAt: Date.now(),
      }));
      await db.inventoryItems.bulkPut(records);
      importedItems = records.length;
    }

    if (Array.isArray(bundle.preferenceCards) && bundle.preferenceCards.length > 0) {
      const cards: OfflinePreferenceCard[] = bundle.preferenceCards.map((c) => ({
        ...c,
        id: c.id || `${normTenant}::card_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tenant_id: normTenant,
        isCustomEdited: true,
        deleted: false,
        updatedAt: Date.now(),
      }));
      await db.preferenceCards.bulkPut(cards);
      importedCards = cards.length;
    }

    if (Array.isArray(bundle.lexiconAliases) && bundle.lexiconAliases.length > 0) {
      const aliases: OfflineLexiconEntry[] = bundle.lexiconAliases.map((a) => ({
        ...a,
        id: a.id || `${normTenant}::lex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tenant_id: normTenant,
        isCustomEdited: true,
        deleted: false,
        updatedAt: Date.now(),
      }));
      await db.lexiconAliases.bulkPut(aliases);
      importedAliases = aliases.length;
    }

    if (bundle.guideline && typeof bundle.guideline === "string") {
      saveOfflineDepartmentGuideline(normTenant, bundle.guideline);
    }

    return {
      success: true,
      importedItems,
      importedCards,
      importedAliases,
    };
  } catch (err: any) {
    return {
      success: false,
      importedItems: 0,
      importedCards: 0,
      importedAliases: 0,
      message: err?.message || "Failed to parse JSON file.",
    };
  }
}

const SUTURE_MATERIALS = [
  "silk",
  "prolene",
  "vicryl",
  "monocryl",
  "ti-cron",
  "ticron",
  "ethibond",
  "nylon",
  "chromic",
  "gut",
];

const NEEDLE_CODES = [
  "rb-1", "rb-2", "sh", "sh-1", "ct-1", "ct-2", "ctx", "bv-1",
  "bv-100", "c-1", "v-5", "v-7", "da", "ps-2", "ur-6", "ks",
  "tf", "bb", "mo-6", "cp-1", "tp-1",
];

function extractClientSpecs(text: string) {
  const norm = text.toLowerCase();
  const rawGauges = norm.match(/\b\d+[-/](?:0|zero|oh)\b/g) || [];
  const gauges = new Set(rawGauges.map((g) => g.replace("/", "-")));

  const materials = new Set<string>();
  for (const m of SUTURE_MATERIALS) {
    if (new RegExp(`\\b${m}\\b`).test(norm)) {
      materials.add(m);
    }
  }

  const needles = new Set<string>();
  for (const nc of NEEDLE_CODES) {
    if (new RegExp(`\\b${nc}\\b`).test(norm)) {
      needles.add(nc);
    }
  }

  const frMatches = norm.match(/\b(\d+)\s*(?:fr|french)\b/g) || [];
  const french = new Set(frMatches.map((f) => f.replace(/\s+/g, "")));

  const gMatches = norm.match(/\b(\d+)\s*(?:g|ga|gauge)\b/g) || [];
  const gaugeSizes = new Set(gMatches.map((g) => g.replace(/\s+/g, "").replace(/gauge|ga/, "g")));

  const mmMatches = norm.match(/\b(\d+)\s*mm\b/g) || [];
  const mmSizes = new Set(mmMatches.map((m) => m.replace(/\s+/g, "")));

  const lenMatches = norm.match(/\b(\d+)\s*(?:in|inch|inches)\b/g) || [];
  const lengths = new Set(lenMatches.map((l) => l.replace(/\s+/g, "").replace(/inch(?:es)?/, "in")));

  const bladeMatches = norm.match(/\b(?:#|\bblade\s*)(\d{2})\b|\b(\d{2})\s*blade\b/g) || [];
  const blades = new Set<string>();
  for (const bm of bladeMatches) {
    const num = bm.replace(/\D/g, "");
    if (["10", "11", "12", "15", "20"].includes(num)) {
      blades.add(num);
    }
  }

  return { gauges, materials, needles, french, gaugeSizes, mmSizes, lengths, blades };
}

function hasClientSpecConflict(
  querySpecs: ReturnType<typeof extractClientSpecs>,
  itemSpecs: ReturnType<typeof extractClientSpecs>,
  itemCategory: string
): boolean {
  if (querySpecs.gauges.size > 0) {
    let match = false;
    for (const g of querySpecs.gauges) {
      if (itemSpecs.gauges.has(g)) match = true;
    }
    if (!match && (itemSpecs.gauges.size > 0 || itemCategory.toLowerCase() === "sutures")) {
      return true;
    }
  }

  if (querySpecs.materials.size > 0 && itemSpecs.materials.size > 0) {
    let match = false;
    for (const m of querySpecs.materials) {
      if (itemSpecs.materials.has(m)) match = true;
    }
    if (!match) return true;
  }

  // Needle codes (e.g. RB-1 vs SH)
  if (querySpecs.needles.size > 0 && itemSpecs.needles.size > 0) {
    let match = false;
    for (const n of querySpecs.needles) {
      if (itemSpecs.needles.has(n)) match = true;
    }
    if (!match) return true;
  }

  if (querySpecs.french.size > 0 && itemSpecs.french.size > 0) {
    let match = false;
    for (const f of querySpecs.french) {
      if (itemSpecs.french.has(f)) match = true;
    }
    if (!match) return true;
  }

  if (querySpecs.gaugeSizes.size > 0 && itemSpecs.gaugeSizes.size > 0) {
    let match = false;
    for (const gs of querySpecs.gaugeSizes) {
      if (itemSpecs.gaugeSizes.has(gs)) match = true;
    }
    if (!match) return true;
  }

  // Cross-unit collision guard (e.g. 18g vs 18fr vs 18in vs 18mm)
  const qUnits: Array<{ unit: string; val: string }> = [
    ...Array.from(querySpecs.gaugeSizes).map((x) => ({ unit: "g", val: x.replace(/\D/g, "") })),
    ...Array.from(querySpecs.french).map((x) => ({ unit: "fr", val: x.replace(/\D/g, "") })),
    ...Array.from(querySpecs.lengths).map((x) => ({ unit: "in", val: x.replace(/\D/g, "") })),
    ...Array.from(querySpecs.mmSizes).map((x) => ({ unit: "mm", val: x.replace(/\D/g, "") })),
  ];
  const rUnits: Array<{ unit: string; val: string }> = [
    ...Array.from(itemSpecs.gaugeSizes).map((x) => ({ unit: "g", val: x.replace(/\D/g, "") })),
    ...Array.from(itemSpecs.french).map((x) => ({ unit: "fr", val: x.replace(/\D/g, "") })),
    ...Array.from(itemSpecs.lengths).map((x) => ({ unit: "in", val: x.replace(/\D/g, "") })),
    ...Array.from(itemSpecs.mmSizes).map((x) => ({ unit: "mm", val: x.replace(/\D/g, "") })),
  ];

  for (const q of qUnits) {
    for (const r of rUnits) {
      if (q.val === r.val && q.unit !== r.unit) {
        return true;
      }
    }
  }

  if (querySpecs.blades.size > 0 && itemSpecs.blades.size > 0) {
    let match = false;
    for (const b of querySpecs.blades) {
      if (itemSpecs.blades.has(b)) match = true;
    }
    if (!match) return true;
  }

  return false;
}

/**
 * Execute <5ms Tier-0 Browser IndexedDB lookup when offline.
 */
export async function searchOfflineTier0(
  query: string,
  tenantId: string
): Promise<CoordinateCardData | null> {
  if (!isStorageSupported) return null;
  const db = activeDb || (await selfHealOfflineDatabase());
  if (!db) return null;

  try {
    const t0 = performance.now();
    const norm = normalizeClientQuery(query);
    if (!norm) return null;

    const querySpecs = extractClientSpecs(`${norm} ${query}`);

    const allItems = await db.inventoryItems
      .where("tenant_id")
      .equals(tenantId)
      .toArray();

    for (const row of allItems) {
      if (row.deleted) continue;
      const rowSpecs = extractClientSpecs(
        `${row.item} ${row.aliases || ""} ${row.surgeon_notes || ""}`
      );
      if (hasClientSpecConflict(querySpecs, rowSpecs, row.category || "")) {
        continue;
      }

      const itemLower = row.item.toLowerCase();
      const aliases = (row.aliases || "")
        .toLowerCase()
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);

      if (
        itemLower === norm ||
        itemLower.startsWith(norm + " ") ||
        aliases.some((a) => a === norm || (a.length >= 4 && norm.includes(a)))
      ) {
        const elapsed = Math.max(1, Math.round(performance.now() - t0));
        return {
          ...row,
          match_stage: `TIER_0_OFFLINE_DEXIE (${elapsed}ms)`,
        };
      }
    }
  } catch (err) {
    // Vector 7: Self-heal database on error
    await selfHealOfflineDatabase();
  }

  return null;
}

/**
 * Fetch department questions from IndexedDB, seeding from bundled data if empty.
 */
export async function fetchQuestionsOffline(
  tenantId: string
): Promise<{ tenant_id: string; open_count: number; questions: DepartmentQuestion[] }> {
  if (typeof window === "undefined") {
    return { tenant_id: tenantId, open_count: 0, questions: [] };
  }
  const db = activeDb || (await selfHealOfflineDatabase());
  if (!db) {
    const qList = getSeedQuestions(tenantId);
    return {
      tenant_id: tenantId,
      open_count: qList.filter((q) => q.status === "open").length,
      questions: qList,
    };
  }

  try {
    const count = await db.unansweredQuestions.where("hospital_id").equals(tenantId).count();
    if (count === 0) {
      await db.unansweredQuestions.bulkPut(getSeedQuestions(tenantId));
    }
    const questions = await db.unansweredQuestions.where("hospital_id").equals(tenantId).toArray();
    return {
      tenant_id: tenantId,
      open_count: questions.filter((q) => q.status === "open").length,
      questions,
    };
  } catch {
    const qList = getSeedQuestions(tenantId);
    return {
      tenant_id: tenantId,
      open_count: qList.filter((q) => q.status === "open").length,
      questions: qList,
    };
  }
}

/**
 * Persist newly asked question offline into IndexedDB.
 */
export async function createQuestionOffline(
  tenantId: string,
  questionText: string,
  askedByRole: string
): Promise<DepartmentQuestion> {
  const db = activeDb || (await selfHealOfflineDatabase());
  const newQ: DepartmentQuestion = {
    id: `q_off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    hospital_id: tenantId,
    question_text: questionText,
    asked_by_role: askedByRole,
    status: "open",
    created_at: new Date().toISOString(),
    verified_at: null,
    answers: [],
  };

  if (db) {
    try {
      await db.unansweredQuestions.put(newQ);
    } catch (e) {
      console.warn("Failed to save question offline:", e);
    }
  }

  return newQ;
}

/**
 * Persist question answer offline into IndexedDB.
 */
export async function answerQuestionOffline(
  tenantId: string,
  questionId: string,
  options: {
    answerText?: string;
    confidence?: "confident" | "tentative_unsure" | "verified";
    responderRole?: string;
    promoteToVerified?: boolean;
  }
): Promise<DepartmentQuestion> {
  const db = activeDb || (await selfHealOfflineDatabase());
  let target: DepartmentQuestion | undefined;

  if (db) {
    try {
      target = await db.unansweredQuestions.get(questionId);
    } catch {}
  }

  if (!target) {
    target = SEED_UNANSWERED_QUESTIONS.find((q) => q.id === questionId);
  }

  if (!target) {
    throw new Error(`Question ${questionId} not found`);
  }

  const updated: DepartmentQuestion = { ...target };
  if (options.promoteToVerified) {
    updated.status = "verified";
  } else if (options.answerText) {
    updated.answers = updated.answers || [];
    updated.answers.push({
      id: `ans_${Date.now()}`,
      responder_role: options.responderRole || "CVOR Peer RN",
      answer_text: options.answerText,
      confidence: options.confidence === "tentative_unsure" ? "tentative_unsure" : "confident",
      created_at: new Date().toISOString(),
    });
    updated.status = options.confidence === "tentative_unsure" ? "answered_tentative" : "answered_confident";
  }

  if (db) {
    try {
      await db.unansweredQuestions.put(updated);
    } catch (e) {
      console.warn("Failed to update question offline:", e);
    }
  }

  return updated;
}

export const SEED_PEER_QUESTIONS: PeerQuestion[] = [
  // Sacred Heart Hospital (OR)
  {
    id: "pq-seed-sh-1",
    tenantId: "sacred_heart::or",
    questionText: "Where is the emergency vascular shunt stored during ruptured abdominal aneurysm?",
    askedBy: "Nurse Turk (Orientee RN)",
    role: "Circulating RN",
    createdAt: "2026-10-27T14:30:00Z",
    answers: [
      {
        answerId: "pa-sh-1a",
        answeredBy: "Dr. Christopher Turk (Attending Surgeon)",
        answerText: "Pruitt-Inahara carotid & vascular shunts are in Core Supply · Cart V · Shelf 1 · Bin A next to vascular clamp set.",
        verifiedBy: ["Carla Espinosa, RN", "Dr. John Dorian, MD"],
        isVerifiedConsensus: true,
      },
    ],
    status: "verified",
    verificationsCount: 2,
  },
  {
    id: "pq-seed-sh-2",
    tenantId: "sacred_heart::or",
    questionText: "What is the proper warm-up time for the Belmont rapid infuser before spiking emergency blood?",
    askedBy: "Sean Iglesia, RN (Orientee)",
    role: "Circulating RN",
    createdAt: "2026-10-27T12:00:00Z",
    answers: [
      {
        answerId: "pa-sh-2a",
        answeredBy: "Senior Periop Coordinator",
        answerText: "Belmont FMS 2000 electromagnetic warmer self-tests in under 45 seconds; prime dual-spike disposable circuit with warm saline before spiking uncrossmatched PRBCs.",
        verifiedBy: ["Dr. Dorian, MD", "Carla Espinosa, RN"],
        isVerifiedConsensus: true,
      },
    ],
    status: "verified",
    verificationsCount: 2,
  },

  // Princeton-Plainsboro Teaching Hospital (OR)
  {
    id: "pq-seed-pp-1",
    tenantId: "princeton_plainsboro::or",
    questionText: "Where are specialized pediatric rigid bronchoscopy sets located for emergency foreign body retrieval?",
    askedBy: "Dr. Allison Cameron (Orientee)",
    role: "Scrub Tech",
    createdAt: "2026-10-27T11:15:00Z",
    answers: [
      {
        answerId: "pa-pp-1a",
        answeredBy: "Dr. Robert Chase (Attending Surgeon)",
        answerText: "Pediatric rigid bronchoscope tray and Storz optical forceps are stored in Anesthesia Workroom A-12, locked cabinet drawer 3.",
        verifiedBy: ["Dr. Eric Foreman, MD", "Dr. Lisa Cuddy, MD"],
        isVerifiedConsensus: true,
      },
    ],
    status: "verified",
    verificationsCount: 2,
  },
  {
    id: "pq-seed-pp-2",
    tenantId: "princeton_plainsboro::or",
    questionText: "What is the anticoagulation reversal protocol for emergency mechanical thrombectomy in OR 4?",
    askedBy: "Dr. Remy Hadley (Orientee RN)",
    role: "Circulating RN",
    createdAt: "2026-10-27T13:45:00Z",
    answers: [
      {
        answerId: "pa-pp-2a",
        answeredBy: "Dr. James Wilson (Chief of Oncology)",
        answerText: "Protamine sulfate 1 mg per 100 units heparin administered slow IV over 10 minutes; verify ACT < 180 before femoral closure.",
        verifiedBy: ["Dr. Gregory House, MD", "Dr. Robert Chase, MD"],
        isVerifiedConsensus: true,
      },
    ],
    status: "verified",
    verificationsCount: 2,
  },

  // County General Hospital (OR)
  {
    id: "pq-seed-cg-1",
    tenantId: "county_general::or",
    questionText: "Where are the Level 1 Rapid Infuser heat exchanger cartridges kept during trauma resuscitations?",
    askedBy: "Dr. John Carter (Surgical Resident)",
    role: "Circulating RN",
    createdAt: "2026-10-27T15:20:00Z",
    answers: [
      {
        answerId: "pa-cg-1a",
        answeredBy: "Dr. Peter Benton (Trauma Attending)",
        answerText: "Level 1 H-1200 disposable high-flow tubing sets are hanging on the trauma crash cart in Trauma OR 1 and Trauma OR 2.",
        verifiedBy: ["Carol Hathaway, RN", "Dr. Mark Greene, MD"],
        isVerifiedConsensus: true,
      },
    ],
    status: "verified",
    verificationsCount: 2,
  },
  {
    id: "pq-seed-cg-2",
    tenantId: "county_general::or",
    questionText: "What is the emergency protocol for uncrossmatched blood release from the satellite blood bank?",
    askedBy: "Chuny Marquez, RN (Orientee)",
    role: "Circulating RN",
    createdAt: "2026-10-27T16:05:00Z",
    answers: [
      {
        answerId: "pa-cg-2a",
        answeredBy: "Carol Hathaway, RN (Charge Nurse)",
        answerText: "Emergency 4-unit uncrossmatched O-negative PRBC cooler is kept in Satellite Blood Refrigerator B-2; 2-nurse barcode scan verification required.",
        verifiedBy: ["Dr. Kerry Weaver, MD", "Dr. John Carter, MD"],
        isVerifiedConsensus: true,
      },
    ],
    status: "verified",
    verificationsCount: 2,
  },
];

/**
 * Retrieve peer questions from local IndexedDB.
 */
export async function getOfflinePeerQuestions(tenantId?: string): Promise<PeerQuestion[]> {
  const db = activeDb || (await selfHealOfflineDatabase());
  let all: PeerQuestion[] = [];
  if (db) {
    try {
      all = await db.peerQuestions.toArray();
      if (!all || all.length === 0) {
        await db.peerQuestions.bulkPut(SEED_PEER_QUESTIONS);
        all = [...SEED_PEER_QUESTIONS];
      }
    } catch (err) {
      console.warn("Failed to get offline peer questions from IDB, using seed:", err);
      all = [...SEED_PEER_QUESTIONS];
    }
  } else {
    all = [...SEED_PEER_QUESTIONS];
  }

  if (!tenantId) return all;
  const filtered = all.filter(
    (q) => q.tenantId === tenantId || q.tenantId.includes(tenantId) || tenantId.includes(q.tenantId.split("::")[0])
  );
  return filtered.length > 0 ? filtered : all.slice(0, 3);
}

/**
 * Save or update a peer question in local IndexedDB.
 */
export async function saveOfflinePeerQuestion(question: PeerQuestion): Promise<void> {
  const db = activeDb || (await selfHealOfflineDatabase());
  if (!db) return;
  try {
    await db.peerQuestions.put(question);
  } catch (err) {
    console.warn("Failed to save offline peer question:", err);
  }
}

/**
 * Bulk save peer questions into local IndexedDB.
 */
export async function saveOfflinePeerQuestions(questions: PeerQuestion[]): Promise<void> {
  const db = activeDb || (await selfHealOfflineDatabase());
  if (!db || !questions.length) return;
  try {
    await db.peerQuestions.bulkPut(questions);
  } catch (err) {
    console.warn("Failed to bulk save offline peer questions:", err);
  }
}
