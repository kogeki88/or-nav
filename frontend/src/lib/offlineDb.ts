/**
 * OR-Nav Layer 1 Local-First PWA Offline Cache (Dexie.js / IndexedDB)
 *
 * Syncs the hospital tenant's inventory from `/api/inventory/sync` into IndexedDB
 * on load and provides a <5ms Tier-0 deterministic fallback when the device is
 * in a basement OR dead-zone (`!navigator.onLine` or network fetch failure).
 */

import Dexie, { type Table } from "dexie";
import type { CoordinateCardData } from "./api";

export interface OfflineInventoryRecord extends CoordinateCardData {
  id?: string;
  tenant_id: string;
  aliases?: string;
  normalized_name?: string;
}

export interface OutboxMutation {
  id?: number;
  type: "verify_move" | "flag_wrong";
  tenant_id: string;
  item: string;
  expected_location?: string;
  reason?: string;
  timestamp: string;
}

class ORNavOfflineDatabase extends Dexie {
  inventoryItems!: Table<OfflineInventoryRecord, string>;
  offlineOutbox!: Table<OutboxMutation, number>;

  constructor() {
    super("ORNavOfflineDB");
    this.version(2).stores({
      inventoryItems: "id, tenant_id, item, full_code, phonetic_code",
      offlineOutbox: "++id, tenant_id, type, timestamp",
    });
  }
}

let activeDb: ORNavOfflineDatabase | null =
  typeof window !== "undefined" ? new ORNavOfflineDatabase() : null;

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
 * Replay all queued offline mutations to the backend when reconnected to hospital network.
 */
export async function flushOfflineOutbox(): Promise<number> {
  if (!activeDb || typeof window === "undefined" || !navigator.onLine) return 0;
  let count = 0;
  try {
    const pending = await activeDb.offlineOutbox.toArray();
    for (const mut of pending) {
      try {
        if (mut.type === "verify_move") {
          const resp = await fetch("/api/inventory/verify-move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenant_id: mut.tenant_id,
              item: mut.item,
              expected_location: mut.expected_location,
            }),
          });
          if (resp.ok) {
            if (mut.id) await activeDb.offlineOutbox.delete(mut.id);
            count++;
          }
        } else if (mut.type === "flag_wrong") {
          const resp = await fetch("/api/inventory/flag-wrong", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenant_id: mut.tenant_id,
              item: mut.item,
              reason: mut.reason || "Location empty or item moved",
            }),
          });
          if (resp.ok) {
            if (mut.id) await activeDb.offlineOutbox.delete(mut.id);
            count++;
          }
        }
      } catch (e) {
        console.debug("Replay of mutation failed, keeping in outbox:", e);
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
  if (typeof window === "undefined") return null;
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

    const records: OfflineInventoryRecord[] = items.map((item) => ({
      ...item,
      id: `${tenantId}::${item.item.toLowerCase()}`,
      tenant_id: tenantId,
      normalized_name: normalizeClientQuery(item.item),
    }));

    const db = activeDb || (await selfHealOfflineDatabase());
    if (!db) return 0;

    try {
      await db.inventoryItems.where("tenant_id").equals(tenantId).delete();
      await db.inventoryItems.bulkPut(records);
      return records.length;
    } catch {
      // Self-heal and retry once on corruption / version conflict (Vector 7)
      const healedDb = await selfHealOfflineDatabase();
      if (healedDb) {
        await healedDb.inventoryItems.bulkPut(records);
        return records.length;
      }
    }
    return 0;
  } catch {
    return 0;
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
  if (typeof window === "undefined") return null;
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
