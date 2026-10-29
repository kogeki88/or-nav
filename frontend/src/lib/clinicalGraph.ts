/**
 * Layer 1: Auto-Compiled Clinical Vocabulary & Entity Graph (Client-Side / Offline Engine).
 *
 * Automatically compiles an in-memory Clinical Entity Graph per hospital department tenant
 * from:
 *   1. Installed or Seed `preference_cards.json` (Surgeons Index, Procedures Index, Preference Card Facets)
 *   2. Dexie `inventoryItems` (Inventory Catalog & Aliases Index)
 *   3. Installed or Seed `orientation.md` / `facility_handbook.md` (Protocol & Policy Topics Index)
 *
 * Also recognizes the structural surgeon pattern (`dr.? <name>`, `doctor <name>`, `<name>'s preference/card/...`)
 * so even an unindexed/new surgeon is 100% recognized as a SURGEON entity and never treated as an inventory item name.
 */

import type { CoordinateCardData } from "./api";
import { getSeedPreferenceCards, getSeedInventoryItems, getSeedOrientationMd } from "./seedData";

export type CardFacetType =
  | "sutures"
  | "instruments"
  | "positioning"
  | "prep"
  | "gloves"
  | "pearls"
  | "all";

export const PREFERENCE_CARD_FACETS: Record<Exclude<CardFacetType, "all">, string[]> = {
  sutures: [
    "suture", "sutures", "closure", "closures", "ties", "tie",
    "stitch", "stitches", "sewing", "needle", "needles",
  ],
  instruments: [
    "instrument", "instruments", "instrumentation", "tray", "trays",
    "set", "sets", "pickups", "clamps", "scissors", "retractor", "retractors",
  ],
  positioning: [
    "position", "positioning", "table", "bed", "armboards", "armboard",
    "padding", "stirrups", "rolls", "roll",
  ],
  prep: [
    "prep", "prepping", "chloraprep", "chlorhexidine", "chg",
    "betadine", "duraprep", "drape", "draping", "scrub",
  ],
  gloves: [
    "glove", "gloves", "biogel", "underglove", "overglove",
  ],
  pearls: [
    "pearl", "pearls", "note", "notes", "preference", "preferences",
    "card", "cards", "hold", "special", "setup", "like", "likes",
    "use", "uses", "want", "wants", "prefer", "prefers",
  ],
};

export const BUILTIN_PROCEDURE_ALIASES: Record<string, string[]> = {
  lap_chole: ["lap chole", "laparoscopic cholecystectomy", "cholecystectomy", "gallbladder"],
  tka: ["tka", "total knee", "total knee arthroplasty", "knee arthroplasty", "knee replacement"],
  cabg: ["cabg", "coronary artery bypass", "coronary bypass", "open heart", "sternotomy", "bypass graft"],
  patel_cvor: ["carotid", "carotid endarterectomy", "cea", "peripheral vascular", "vascular bypass"],
  robotic_prostatectomy: ["ralp", "robotic prostatectomy", "prostatectomy", "da vinci prostate"],
  lumbar_microdiscectomy: ["microdiscectomy", "lumbar microdiscectomy", "laminectomy", "discectomy"],
  trauma_ex_lap: ["ex lap", "ex-lap", "exploratory laparotomy", "trauma lap", "trauma laparotomy"],
  evar: ["evar", "endovascular aneurysm", "endovascular aneurysm repair", "aaa repair"],
  craniotomy: ["craniotomy", "crani", "burr hole", "stealth craniotomy"],
  appendectomy: ["lap appy", "appendectomy", "appy", "laparoscopic appendectomy"],
  icu_crrt_setup: ["crrt", "continuous renal replacement", "prismaflex setup"],
  icu_art_line: ["art line setup", "arterial line setup", "radial art line setup"],
  icu_cvc_kit: ["cvc insertion", "central line insertion", "triple lumen setup"],
  icu_icp_monitor: ["icp monitor setup", "intracranial pressure setup", "codman setup"],
  er_rsi_kit: ["rsi protocol", "rapid sequence intubation"],
  er_chest_tube: ["chest tube setup", "tube thoracostomy"],
  er_mtp_cooler: ["mtp protocol", "massive transfusion protocol", "massive transfusion"],
  er_pelvic_binder: ["pelvic binder application", "pelvic fracture protocol"],
  pacu_aldrete_recovery: ["aldrete score", "aldrete scoring", "phase 1 discharge"],
  pacu_laryngospasm_rescue: ["laryngospasm", "laryngospasm protocol", "larson notch"],
  pacu_pca_pump_setup: ["pca setup", "pca protocol", "alaris pca protocol"],
  pacu_ponv_shivering_rescue: ["ponv protocol", "post op shivering", "shivering rescue"],
};

export const PROTOCOL_TOPIC_PATTERNS: string[] = [
  "malignant hyperthermia", "mh crisis", "code blue", "code red", "fire protocol",
  "surgical fire", "needle stick", "sharps injury", "blood exposure", "massive transfusion",
  "mtp", "time out", "timeout", "surgical count", "lost sponge", "incorrect count",
  "wet tray", "strikethrough", "flash sterilization", "iuus", "specimen handling",
  "frozen section", "formalin", "aldrete", "laryngospasm", "extubation criteria",
  "emergency release", "hipaa", "latex allergy", "airborne precautions",
  "turnover", "room turnover", "terminal clean", "attire", "scrub policy",
];

export interface SurgeonMatch {
  rawName: string;
  normalizedLastName: string;
  displayName: string;
  matchedCardIds: string[];
  isIndexed: boolean;
}

export interface ProcedureMatch {
  name: string;
  matchedCardIds: string[];
}

export interface ClinicalEntityGraph {
  tenantId: string;
  departmentName: string;
  preferenceCards: any[];
  surgeonsByToken: Record<string, any[]>;
  indexedSurgeonNames: string[];
  proceduresByPhrase: Record<string, string[]>;
  inventoryRows: CoordinateCardData[];
  inventoryTerms: Set<string>;
  protocolTopics: Set<string>;
}

export function normalizeGraphText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-#/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSurgeonNames(surgeonField: string): Array<{ displayName: string; lastLower: string }> {
  if (!surgeonField) return [];
  const parts = surgeonField
    .split(/[\(\)\/]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const results: Array<{ displayName: string; lastLower: string }> = [];

  for (const part of parts) {
    const cleanDisplay = part.replace(/,\s*(?:MD|DO|RN|FACS|PhD).*$/i, "").trim();
    if (!cleanDisplay) continue;
    const tokens = cleanDisplay
      .split(/[^a-zA-Z'\-]+/)
      .filter((t) => t && !["dr", "doctor", "md", "do", "rn", "facs"].includes(t.toLowerCase()));
    if (tokens.length > 0) {
      const lastRaw = tokens[tokens.length - 1].toLowerCase();
      const lastClean = lastRaw.replace(/'/g, "");
      results.push({ displayName: cleanDisplay, lastLower: lastClean });
      if (lastRaw !== lastClean) {
        results.push({ displayName: cleanDisplay, lastLower: lastRaw });
      }
    }
  }
  return results;
}

function resolveDepartmentName(tenantId: string): string {
  const low = (tenantId || "or_main").toLowerCase();
  if (low.includes("icu")) return "ICU / Critical Care";
  if (low.includes("er") || low.includes("trauma")) return "Emergency Dept (ER)";
  if (low.includes("pacu")) return "PACU / Pre-Op";
  return "Operating Room (OR)";
}

export function compileClinicalGraph(
  tenantId: string = "or_main",
  customCards?: any[],
  customInventory?: CoordinateCardData[],
  customOrientationMd?: string
): ClinicalEntityGraph {
  const cards = customCards && customCards.length > 0 ? customCards : getSeedPreferenceCards(tenantId);
  const invRows = customInventory && customInventory.length > 0 ? customInventory : getSeedInventoryItems(tenantId);

  const surgeonsByToken: Record<string, any[]> = {};
  const indexedSurgeonNames: string[] = [];
  const proceduresByPhrase: Record<string, string[]> = {};

  for (const card of cards) {
    const cardId = String(card.id || "");
    const surgeonStr = String(card.surgeon || card.clinician || "");
    const extracted = extractSurgeonNames(surgeonStr);
    for (const { displayName, lastLower } of extracted) {
      if (displayName.startsWith("Dr.") && !indexedSurgeonNames.includes(displayName)) {
        indexedSurgeonNames.push(displayName);
      }
      if (!surgeonsByToken[lastLower]) surgeonsByToken[lastLower] = [];
      if (!surgeonsByToken[lastLower].includes(card)) {
        surgeonsByToken[lastLower].push(card);
      }
      const fullClean = normalizeGraphText(displayName.replace(/^(?:dr\.?|doctor)\s+/i, ""));
      if (fullClean) {
        if (!surgeonsByToken[fullClean]) surgeonsByToken[fullClean] = [];
        if (!surgeonsByToken[fullClean].includes(card)) {
          surgeonsByToken[fullClean].push(card);
        }
      }
    }

    const procTitle = String(card.procedure || "");
    if (procTitle && cardId) {
      const normProc = normalizeGraphText(procTitle);
      if (normProc) {
        if (!proceduresByPhrase[normProc]) proceduresByPhrase[normProc] = [];
        if (!proceduresByPhrase[normProc].includes(cardId)) {
          proceduresByPhrase[normProc].push(cardId);
        }
      }
      const parenRegex = /\(([A-Za-z0-9\-\s]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = parenRegex.exec(procTitle)) !== null) {
        const abbr = normalizeGraphText(m[1]);
        if (abbr) {
          if (!proceduresByPhrase[abbr]) proceduresByPhrase[abbr] = [];
          if (!proceduresByPhrase[abbr].includes(cardId)) proceduresByPhrase[abbr].push(cardId);
          const firstTok = abbr.split(" ")[0];
          if (firstTok && firstTok.length >= 3) {
            if (!proceduresByPhrase[firstTok]) proceduresByPhrase[firstTok] = [];
            if (!proceduresByPhrase[firstTok].includes(cardId)) proceduresByPhrase[firstTok].push(cardId);
          }
        }
      }
    }

    if (cardId && BUILTIN_PROCEDURE_ALIASES[cardId]) {
      for (const alias of BUILTIN_PROCEDURE_ALIASES[cardId]) {
        const normA = normalizeGraphText(alias);
        if (normA) {
          if (!proceduresByPhrase[normA]) proceduresByPhrase[normA] = [];
          if (!proceduresByPhrase[normA].includes(cardId)) {
            proceduresByPhrase[normA].push(cardId);
          }
        }
      }
    }
  }

  for (const [canonicalId, aliases] of Object.entries(BUILTIN_PROCEDURE_ALIASES)) {
    for (const alias of aliases) {
      const normA = normalizeGraphText(alias);
      if (normA && !proceduresByPhrase[normA]) {
        const matchedIds = cards
          .filter(
            (c) =>
              String(c.id || "").toLowerCase().includes(canonicalId) ||
              normalizeGraphText(String(c.procedure || "")).includes(normA)
          )
          .map((c) => String(c.id));
        proceduresByPhrase[normA] = matchedIds;
      }
    }
  }

  const inventoryTerms = new Set<string>();
  for (const r of invRows) {
    const itemNorm = normalizeGraphText(r.item);
    if (itemNorm) inventoryTerms.add(itemNorm);
    for (const al of (r.aliases || "").split("|")) {
      const alNorm = normalizeGraphText(al);
      if (alNorm) inventoryTerms.add(alNorm);
    }
  }

  const protocolTopics = new Set<string>(PROTOCOL_TOPIC_PATTERNS);
  const mdText = customOrientationMd || getSeedOrientationMd(tenantId);
  if (mdText) {
    const headingRegex = /^#{1,3}\s+(.+)$/gm;
    let hm: RegExpExecArray | null;
    while ((hm = headingRegex.exec(mdText)) !== null) {
      const hNorm = normalizeGraphText(hm[1]);
      if (hNorm && hNorm.length >= 4) {
        protocolTopics.add(hNorm);
      }
    }
  }

  return {
    tenantId,
    departmentName: resolveDepartmentName(tenantId),
    preferenceCards: cards,
    surgeonsByToken,
    indexedSurgeonNames,
    proceduresByPhrase,
    inventoryRows: invRows,
    inventoryTerms,
    protocolTopics,
  };
}
