/**
 * OR-Nav On-Demand GitHub Knowledge Pack & Resource Manager
 *
 * Downloads facility handbooks, department inventories/preference cards, and
 * role-specific case guides directly from GitHub (raw.githubusercontent.com/kogeki88/or-nav)
 * with zero-server standalone fallback, stores them in IndexedDB, and exposes
 * controls for clinicians to reinstall, inspect, and purge packs.
 */

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { offlineDb, type InstalledResourcePack, type OfflineInventoryRecord } from "./offlineDb";
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from "./version";

export interface PackManifestEntry {
  packId: string;
  facilityId: string;
  departmentId?: string;
  roleId?: string;
  title: string;
  category: "hospital" | "department" | "role";
  filePath: string;
  sizeBytes: number;
  versionHash: string;
  updatedAt: string;
}

export interface HospitalPacksManifest {
  version: string;
  updatedAt: string;
  repository: string;
  rawBaseUrl: string;
  packsCount: number;
  packs: PackManifestEntry[];
}

export interface ResourceStorageSummary {
  totalPacksCount: number;
  totalSizeBytes: number;
  formattedSize: string;
}

const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/main`;

/**
 * Map clinician profile role string to pack role key
 */
export function mapRoleToKey(clinicalRole?: string): string {
  if (!clinicalRole) return "circulator";
  const lower = clinicalRole.toLowerCase();
  if (lower.includes("scrub") || lower.includes("cst") || lower.includes("surgical tech")) {
    return "scrub";
  }
  if (lower.includes("crna") || lower.includes("anesthesia")) {
    return "crna";
  }
  if (lower.includes("icu")) {
    return "icu_rn";
  }
  if (lower.includes("er") || lower.includes("trauma")) {
    return "er_rn";
  }
  return "circulator";
}

/**
 * Fetch raw string content from URL with Native CapacitorHttp or Web fetch.
 */
async function fetchRawContent(url: string, timeoutMs: number = 8000): Promise<string> {
  const sep = url.includes("?") ? "&" : "?";
  const cacheBusted = `${url}${sep}t=${Date.now()}`;

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.get({
        url: cacheBusted,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      if (res.status === 200) {
        return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (nativeErr) {
      console.warn("CapacitorHttp failed for:", url, nativeErr);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(cacheBusted, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch Master Manifest from GitHub Cloud or local LAN fallback
 */
export async function fetchPacksManifest(): Promise<HospitalPacksManifest> {
  const candidateUrls: string[] = [
    `${GITHUB_RAW_BASE}/hospitals/manifest.json`,
  ];

  if (typeof window !== "undefined") {
    const configured = localStorage.getItem("ornav_server_url") || localStorage.getItem("ornav_paired_server");
    if (configured) {
      const clean = configured.replace(/\/+$/, "");
      candidateUrls.push(`${clean}/api/packs/manifest`);
    }
    candidateUrls.push("http://192.168.1.217:8000/api/packs/manifest");
    candidateUrls.push("/api/packs/manifest");
  }

  for (const url of candidateUrls) {
    try {
      const raw = await fetchRawContent(url, 4000);
      const parsed = JSON.parse(raw) as HospitalPacksManifest;
      if (parsed && Array.isArray(parsed.packs)) {
        return parsed;
      }
    } catch {}
  }

  throw new Error("Unable to fetch hospital knowledge packs manifest.");
}

/**
 * Fetch a single pack's content from GitHub Cloud or local fallback
 */
export async function downloadPackContent(filePath: string): Promise<string> {
  const cleanPath = filePath.replace(/^[/\\]+/, "");
  const candidateUrls: string[] = [
    `${GITHUB_RAW_BASE}/${cleanPath}`,
  ];

  if (typeof window !== "undefined") {
    const configured = localStorage.getItem("ornav_server_url") || localStorage.getItem("ornav_paired_server");
    if (configured) {
      const clean = configured.replace(/\/+$/, "");
      candidateUrls.push(`${clean}/api/packs/file?path=${encodeURIComponent(cleanPath)}`);
    }
    candidateUrls.push(`http://192.168.1.217:8000/api/packs/file?path=${encodeURIComponent(cleanPath)}`);
    candidateUrls.push(`/api/packs/file?path=${encodeURIComponent(cleanPath)}`);
  }

  for (const url of candidateUrls) {
    try {
      const content = await fetchRawContent(url, 6000);
      if (content && content.trim().length > 0) {
        return content;
      }
    } catch {}
  }

  throw new Error(`Failed to download pack file: ${cleanPath}`);
}

/**
 * Install or update a pack into IndexedDB
 */
export async function installPack(packMeta: PackManifestEntry): Promise<InstalledResourcePack> {
  if (!offlineDb) {
    throw new Error("Offline database not available.");
  }

  const rawContent = await downloadPackContent(packMeta.filePath);
  const now = new Date().toISOString();

  const record: InstalledResourcePack = {
    packId: packMeta.packId,
    facilityId: packMeta.facilityId,
    departmentId: packMeta.departmentId,
    roleId: packMeta.roleId,
    title: packMeta.title,
    category: packMeta.category,
    filePath: packMeta.filePath,
    sizeBytes: new TextEncoder().encode(rawContent).length,
    versionHash: packMeta.versionHash,
    installedAt: now,
    content: rawContent,
  };

  await offlineDb.installedPacks.put(record);

  // If this pack is a department inventory CSV, populate inventory items
  if (packMeta.filePath.endsWith("inventory.csv") && packMeta.departmentId) {
    await hydrateInventoryFromCsv(rawContent, packMeta.facilityId, packMeta.departmentId);
  }

  return record;
}

/**
 * Parse CSV and store inventory rows in IndexedDB
 */
async function hydrateInventoryFromCsv(csvText: string, facilityId: string, departmentId: string): Promise<void> {
  if (!offlineDb) return;
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return;

  const tenantId = `${facilityId}_${departmentId}`;
  const rows: OfflineInventoryRecord[] = [];

  // Parse header
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
    const parts = parseCsvLine(lines[i]);
    if (!parts || parts.length < 5) continue;

    const itemName = parts[itemIdx] || parts[0];
    const room = parts[roomIdx] || "Main OR";
    const cabinet = parts[cabIdx] || "A";
    const shelf = parts[shelfIdx] || "1";
    const bin = parts[binIdx] || "A";
    const fullCode = parts[codeIdx] || `${room} ${cabinet} ${shelf} ${bin}`;
    const phoneticCode = parts[phoneticIdx] || fullCode;
    const surgeonNotes = notesIdx >= 0 ? parts[notesIdx] : "";
    const category = catIdx >= 0 ? parts[catIdx] : "";

    rows.push({
      id: `${tenantId}__${itemName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      tenant_id: tenantId,
      item: itemName,
      room,
      cabinet,
      shelf,
      container: bin,
      full_code: fullCode,
      phonetic_code: phoneticCode,
      surgeon_notes: surgeonNotes || "",
      category: category || "",
      pending_location: "",
      verify_count: 3,
    });
  }

  if (rows.length > 0) {
    await offlineDb.inventoryItems.bulkPut(rows);
  }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Delete a single installed pack from IndexedDB
 */
export async function deletePack(packId: string): Promise<void> {
  if (!offlineDb) return;
  const existing = await offlineDb.installedPacks.get(packId);
  if (!existing) return;

  await offlineDb.installedPacks.delete(packId);

  // If it was an inventory pack, remove associated items from offlineDb
  if (existing.filePath.endsWith("inventory.csv") && existing.departmentId) {
    const tenantId = `${existing.facilityId}_${existing.departmentId}`;
    await offlineDb.inventoryItems.where("tenant_id").equals(tenantId).delete();
  }
}

/**
 * Get all installed packs
 */
export async function getInstalledPacks(): Promise<InstalledResourcePack[]> {
  if (!offlineDb) return [];
  return await offlineDb.installedPacks.toArray();
}

/**
 * Format bytes to readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compute total installed resource storage
 */
export async function getResourceStorageSummary(): Promise<ResourceStorageSummary> {
  const packs = await getInstalledPacks();
  const totalSizeBytes = packs.reduce((acc, p) => acc + (p.sizeBytes || 0), 0);
  return {
    totalPacksCount: packs.length,
    totalSizeBytes,
    formattedSize: formatBytes(totalSizeBytes),
  };
}

/**
 * Identify the 3 required packs for a user's selection:
 * 1. Facility Handbook (Tier 1)
 * 2. Department Inventory & Preference Cards (Tier 2)
 * 3. Role-Specific Guide (Tier 3)
 */
export function getRequiredPacksForProfile(
  manifest: HospitalPacksManifest,
  facilityId: string,
  departmentId: string,
  clinicalRole: string
): PackManifestEntry[] {
  const roleKey = mapRoleToKey(clinicalRole);
  const normDept = (departmentId || "").split("_")[0] || "or";

  const handbook = manifest.packs.find(
    (p) => p.category === "hospital" && p.facilityId === facilityId
  );

  const deptPacks = manifest.packs.filter(
    (p) =>
      p.category === "department" &&
      p.facilityId === facilityId &&
      (p.departmentId === departmentId || p.departmentId === normDept)
  );

  const rolePack = manifest.packs.find(
    (p) =>
      p.category === "role" &&
      p.facilityId === facilityId &&
      (p.departmentId === departmentId || p.departmentId === normDept) &&
      p.roleId === roleKey
  );

  const required: PackManifestEntry[] = [];
  if (handbook) required.push(handbook);
  required.push(...deptPacks);
  if (rolePack) required.push(rolePack);

  return required;
}

/**
 * Automatic Scoped Provisioning on Profile Save
 * Ensures required packs are installed and up-to-date.
 */
export async function ensureProfilePacksInstalled(
  facilityId: string,
  departmentId: string,
  clinicalRole: string
): Promise<{ installedCount: number; updatedCount: number; errors: string[] }> {
  const errors: string[] = [];
  let installedCount = 0;
  let updatedCount = 0;

  try {
    const manifest = await fetchPacksManifest();
    const required = getRequiredPacksForProfile(manifest, facilityId, departmentId, clinicalRole);
    const existing = await getInstalledPacks();
    const existingMap = new Map(existing.map((p) => [p.packId, p]));

    for (const pack of required) {
      const match = existingMap.get(pack.packId);
      if (!match) {
        try {
          await installPack(pack);
          installedCount++;
        } catch (e: any) {
          errors.push(`Failed to install ${pack.title}: ${e.message}`);
        }
      } else if (match.versionHash !== pack.versionHash) {
        try {
          await installPack(pack);
          updatedCount++;
        } catch (e: any) {
          errors.push(`Failed to update ${pack.title}: ${e.message}`);
        }
      }
    }
  } catch (err: any) {
    errors.push(`Manifest check failed: ${err.message}`);
  }

  return { installedCount, updatedCount, errors };
}

/**
 * Purge unassigned hospital packs (keeps active facility)
 */
export async function purgeUnassignedHospitalPacks(activeFacilityId: string): Promise<number> {
  const packs = await getInstalledPacks();
  let purgedCount = 0;
  for (const pack of packs) {
    if (pack.facilityId !== activeFacilityId) {
      await deletePack(pack.packId);
      purgedCount++;
    }
  }
  return purgedCount;
}
