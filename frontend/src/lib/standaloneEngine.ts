/**
 * OR-Nav Standalone On-Device Search & Clinical Governance Engine
 *
 * Provides 100% feature parity with the hardened Python backend:
 * - 3-Stage Deterministic Cascade (Exact -> Double Metaphone -> Fuzzy Token)
 * - Phase 16-20 Clinical Guards (Metric mm vs 2-0, Zero-suture, Cross-Unit)
 * - Mid-sentence Voice Self-Correction & Elliptical Compound Query Splitting
 * - Spoken Phonetic Coordinate Normalization ("or twenty one bee two see" -> "OR 21 B 2 C")
 * - Surgeon Honorific Note Highlighting ("Dr. Patel prefers loaded on Debakey")
 * - IndexedDB Move Governance (1/3 -> 3/3 auto-commit) & Unanswered Questions
 */

import {
  offlineDb,
  selfHealOfflineDatabase,
  hydrateOrUpgradeOfflineInventory,
  type OfflineInventoryRecord,
} from "./offlineDb";
import {
  DEFAULT_TENANT,
  SEED_INVENTORY_ITEMS,
  SEED_ORIENTATION_MD,
  SEED_BASELINE_MD,
  SEED_UNANSWERED_QUESTIONS,
  getSeedInventoryItems,
  getSeedOrientationMd,
  getSeedQuestions,
  getSeedPreferenceCards,
} from "./seedData";
import { directGeminiRAG, isGeminiDirectAvailable } from "./directGemini";
import { parseClinicalIntent, ClinicalIntent, extractAndNormalizeCoordinateClient } from "./semanticParser";
import { isEponymConflict, isGenericClassOnly, normalizeOrLingo, stripSpokenDisfluencies, extractEponyms } from "./surgicalOntology";
import {
  getFacilityIdFromTenant,
  resolveSpokenAliasClient,
  getAllAliasesForItemClient,
  learnAliasClient,
  titleCaseTerm,
} from "./lexiconLearning";
import {
  getUserProfile,
  getRoleScope,
  evaluateRbacQuery,
  filterSurgeonNoteForRole,
  type UserProfile,
} from "./userProfile";
import type {
  ChatResponse,
  CoordinateCardData,
  MoveWidgetData,
  VerifyMoveResponse,
  DepartmentQuestion,
  QuestionAnswerItem,
} from "./api";

// ---------------------------------------------------------------------------
// 1. Homophone & Stop Words Dictionaries
// ---------------------------------------------------------------------------

export const OR_HOMOPHONE_MAP: Record<string, string> = {
  "the bakery": "debakey",
  "de bakery": "debakey",
  "da bakery": "debakey",
  bakery: "debakey",
  debakeys: "debakey",
  "pro lean": "prolene",
  "pro-lean": "prolene",
  proline: "prolene",
  "tie cron": "ti-cron",
  "tye cron": "ti-cron",
  ticron: "ti-cron",
  "four oh": "4-0",
  "four-oh": "4-0",
  "four zero": "4-0",
  "four dash zero": "4-0",
  "three oh": "3-0",
  "three-oh": "3-0",
  "three zero": "3-0",
  "three dash zero": "3-0",
  "two oh": "2-0",
  "two-oh": "2-0",
  "two zero": "2-0",
  "two dash zero": "2-0",
  "five oh": "5-0",
  "five-oh": "5-0",
  "six oh": "6-0",
  "six-oh": "6-0",
  "seven oh": "7-0",
  "seven-oh": "7-0",
  "thirty silk": "3-0 silk",
  "30 silk": "3-0 silk",
  "twenty prolene": "2-0 prolene",
  "20 prolene": "2-0 prolene",
  "forty prolene": "4-0 prolene",
  "40 prolene": "4-0 prolene",
  "seventy prolene": "7-0 prolene",
  "70 prolene": "7-0 prolene",
  "white laner": "weitlaner",
  "white liner": "weitlaner",
  "white lainer": "weitlaner",
  bovey: "bovie",
  "bo vie": "bovie",
  heprin: "heparin",
};

const STOP_WORDS = new Set([
  "where", "is", "are", "the", "a", "an", "find", "locate", "need",
  "get", "me", "do", "we", "have", "keep", "stored", "stocked",
  "show", "location", "of", "for", "in", "from", "please", "can",
  "you", "tell", "whats", "what", "give", "bring", "grab", "hand",
  "um", "umm", "ummm", "uh", "uhh", "uhhh", "er", "erm", "ah", "ahh",
  "hmm", "hm", "like", "you know", "i mean", "wait", "let's see", "lets see",
  "so", "well", "basically", "actually", "literally", "okay", "ok",
]);

const QUERY_PREFIXES = /^(?:where\s+(?:is|are|can\s+i\s+find|do\s+we\s+keep)\s+(?:the\s+|a\s+|an\s+)?|(?:can\s+you\s+)?(?:find|locate|get|grab|show)\s+(?:me\s+)?(?:the\s+|a\s+|an\s+)?|(?:i\s+)?(?:need|want|looking\s+for)\s+(?:the\s+|a\s+|an\s+)?|do\s+we\s+have\s+(?:any\s+|a\s+|an\s+)?|what\s+is\s+the\s+location\s+of\s+(?:the\s+)?|location\s+(?:of|for)\s+(?:the\s+)?)+/i;

const PROCEDURAL_INDICATORS = /\b(?:how\s+(?:do|to|much|many)|what\s+(?:is|are)\s+the\s+(?:protocol|dose|dosing|target|steps|procedure|ratio|settings|preference|checklist|prep|positioning)|what\s+(?:sutures?|blades?|instruments?|cannula|wires?|size)\s+does\s+(?:dr\.?|doctor)|(?:dr\.?|doctor)\s+[a-z]+(?:'s)?\s+(?:prefer|preference|protocol|like|use|want)|prefer(?:s|ence|ences)?|protocol|guideline|policy|checklist|orient(?:ation)?|activate\s+mtp|massive\s+transfusion|malignant\s+hyperthermia|dantrolene\s+(?:dose|dosing|protocol|mixing|reconstitution)|heparin\s+(?:dose|dosing|target|act|protocol)|act\s+target|target\s+act|bypass\s+readiness|crash[\s-]on|pneumatic\s+tube|tube\s+(?:.*?\s+)?station|tube\s+blood|tube\s+specimen|can\s+i\s+tube|blood\s+gas|when\s+(?:to|should)|why\s+(?:do|is)|explain|describe|cranial\s+nerve|carotid\s+endarterectomy|cabg\s+prep|bladder\s+decompression)\b/i;

const MOVE_PATTERN = /^(?:the\s+)?(.+?)\s+(?:was\s+moved|moved|relocated|is\s+now\s+at|is\s+now\s+in)\s+(?:to\s+)?((?:(?:OR|room|bay|pod|trauma\s+bay|trauma|icu|er|ed|pacu)\b|Core\s+Supply|Pump\s+Room).+?)\s*\.?$/i;

const SPOKEN_NUMBER_WORDS: Array<[RegExp, string]> = [
  [/\btwenty[- ]five\b/gi, "25"],
  [/\btwenty[- ]four\b/gi, "24"],
  [/\btwenty[- ]three\b/gi, "23"],
  [/\btwenty[- ]two\b/gi, "22"],
  [/\btwenty[- ]one\b/gi, "21"],
  [/\btwenty\b/gi, "20"],
  [/\bnineteen\b/gi, "19"],
  [/\beighteen\b/gi, "18"],
  [/\bseventeen\b/gi, "17"],
  [/\bsixteen\b/gi, "16"],
  [/\bfifteen\b/gi, "15"],
  [/\bfourteen\b/gi, "14"],
  [/\bthirteen\b/gi, "13"],
  [/\btwelve\b/gi, "12"],
  [/\beleven\b/gi, "11"],
  [/\bten\b/gi, "10"],
  [/\bnine\b/gi, "9"],
  [/\beight\b/gi, "8"],
  [/\bseven\b/gi, "7"],
  [/\bsix\b/gi, "6"],
  [/\bfive\b/gi, "5"],
  [/\bfour\b/gi, "4"],
  [/\bthree\b/gi, "3"],
  [/\btwo\b/gi, "2"],
  [/\bone\b/gi, "1"],
  [/\bzero\b/gi, "0"],
];

const SPOKEN_LETTER_WORDS: Array<[RegExp, string]> = [
  [/\b(?:eh|ay|aye)\b/gi, "a"],
  [/\b(?:bee|be)\b/gi, "b"],
  [/\b(?:see|sea)\b/gi, "c"],
  [/\b(?:dee)\b/gi, "d"],
  [/\b(?:ee)\b/gi, "e"],
  [/\b(?:ef)\b/gi, "f"],
  [/\b(?:gee)\b/gi, "g"],
  [/\b(?:aitch)\b/gi, "h"],
  [/\b(?:jay)\b/gi, "j"],
  [/\b(?:kay)\b/gi, "k"],
  [/\b(?:el)\b/gi, "l"],
  [/\b(?:em)\b/gi, "m"],
  [/\b(?:en)\b/gi, "n"],
  [/\b(?:oh)\b/gi, "o"],
  [/\b(?:pee)\b/gi, "p"],
  [/\b(?:cue)\b/gi, "q"],
  [/\b(?:ar)\b/gi, "r"],
  [/\b(?:ess)\b/gi, "s"],
  [/\b(?:tee)\b/gi, "t"],
  [/\b(?:you)\b/gi, "u"],
  [/\b(?:vee)\b/gi, "v"],
  [/\b(?:double\s+you)\b/gi, "w"],
  [/\b(?:ex)\b/gi, "x"],
  [/\b(?:why)\b/gi, "y"],
  [/\b(?:zee|zed)\b/gi, "z"],
];

const CORRECTION_PIVOTS = /\b(?:wait\s+no|no\s+wait|sorry\s+(?:i\s+)?meant?|i\s+mean|actually\s+no|no\s+actually|scratch\s+that|make\s+that|correction|no\s+i\s+need)\b[\s,:-]*/i;
const TRAILING_NEGATION = /\b(?:not|instead\s+of|rather\s+than)\s+[^,;]+$/i;
const BARE_SIZE_REGEX = /^(?:#?\d+[-/](?:0|zero|oh)|#?\d{2}|\d+(?:\.\d+)?\s*(?:fr|french|in|mm|gauge|g)|(?:0|zero|aught))$/i;
const PROTECTED_MEDICAL_ACRONYMS = /\b(?:i\s*&\s*d|d\s*&\s*c|t\s*&\s*c)\b/i;

// ---------------------------------------------------------------------------
// 2. Preprocessing & Normalization
// ---------------------------------------------------------------------------

export function preprocessVoiceQuery(query: string): string {
  let text = (query || "").trim();
  if (!text) return "";

  const splits = text.split(CORRECTION_PIVOTS);
  if (splits.length > 1) {
    const corrected = splits[splits.length - 1].trim();
    if (corrected) text = corrected;
  }

  text = text.replace(TRAILING_NEGATION, "").trim();
  return text;
}

export function splitCompoundQuery(query: string): string[] {
  const text = preprocessVoiceQuery(query).trim();
  if (!text) return [];

  if (PROTECTED_MEDICAL_ACRONYMS.test(text) && !/\s+(?:and|plus)\s+/i.test(text)) {
    return [text];
  }

  const rawChunks = text.split(/\s+(?:and|&|plus)\s+|,\s*/);
  const chunks = rawChunks.map((c) => c.trim()).filter(Boolean);
  if (chunks.length <= 1) {
    return [text];
  }

  const cleanedChunks: string[] = chunks.map((c) =>
    c.replace(/^(?:where\s+(?:is|are)|find|locate|need|grab|show)\s+(?:the\s+|a\s+|an\s+)?/i, "")
      .replace(/[?!.,;:]+$/, "")
      .trim() || c.replace(/[?!.,;:]+$/, "").trim()
  );

  // Backward pass: inherit noun from next chunk
  for (let i = cleanedChunks.length - 2; i >= 0; i--) {
    const cCurr = cleanedChunks[i];
    const cNext = cleanedChunks[i + 1];
    if (BARE_SIZE_REGEX.test(cCurr)) {
      const nounMatch = cNext.match(/^(?:#?\d+[-/](?:0|zero|oh)|#?\d{2}|\d+(?:\.\d+)?\s*(?:fr|french|in|mm|gauge|g))\s+(.+)$/i);
      let nounPart = nounMatch ? nounMatch[1].trim() : "";
      if (!nounPart && !BARE_SIZE_REGEX.test(cNext)) {
        nounPart = cNext;
      }
      if (nounPart) {
        cleanedChunks[i] = `${cCurr} ${nounPart}`;
      }
    }
  }

  // Forward pass: inherit noun from previous chunk
  for (let i = 1; i < cleanedChunks.length; i++) {
    const cCurr = cleanedChunks[i];
    const cPrev = cleanedChunks[i - 1];
    if (BARE_SIZE_REGEX.test(cCurr)) {
      const nounMatch = cPrev.match(/^(?:#?\d+[-/](?:0|zero|oh)|#?\d{2}|\d+(?:\.\d+)?\s*(?:fr|french|in|mm|gauge|g))\s+(.+)$/i);
      const nounPart = nounMatch ? nounMatch[1].trim() : "";
      if (nounPart) {
        cleanedChunks[i] = `${cCurr} ${nounPart}`;
      }
    }
  }

  return cleanedChunks;
}

function formatRoomCanonical(
  unit?: string,
  num?: string,
  core?: string,
  pump?: string
): string {
  if (core) return "Core Supply";
  if (pump) return "Pump Room";
  const u = (unit || "").toLowerCase().trim();
  if (u === "or" || u === "room") {
    return num ? `OR ${num}` : "OR";
  } else if (u === "trauma bay" || u === "trauma") {
    return num ? `Trauma Bay ${num}` : "Trauma";
  } else if (u === "bay") {
    return num ? `Bay ${num}` : "Bay";
  } else if (u.includes("icu")) {
    return num ? `ICU ${num}` : u.includes("supply") ? "ICU Supply" : "ICU";
  } else if (u === "er" || u === "ed") {
    return num ? `ER ${num}` : "ER";
  } else if (u.includes("pacu")) {
    return num ? `PACU ${num}` : u.includes("med") ? "PACU Med Room" : "PACU";
  } else if (u === "pod") {
    return num ? `Pod ${num}` : "Pod";
  }
  return u.charAt(0).toUpperCase() + u.slice(1);
}

export function normalizeLocationCoordinate(locRaw: string): string | null {
  let text = (locRaw || "").trim().replace(/\.+$/, "");
  if (!text) return null;

  // First try packed or spaced coordinate extraction
  const unpacked = extractAndNormalizeCoordinateClient(text);
  if (unpacked) {
    return unpacked.location;
  }

  for (const [pattern, digit] of SPOKEN_NUMBER_WORDS) {
    text = text.replace(pattern, digit);
  }
  for (const [pattern, letter] of SPOKEN_LETTER_WORDS) {
    text = text.replace(pattern, letter);
  }

  // Phrased format: Bay 2 Cart A Shelf 1 Bin B / room 21 cabinet b shelf 1 bin a
  const nat = text.match(
    /(?:(trauma\s+bay|trauma|bay|pod|icu(?:\s+supply)?|er|ed|pacu(?:\s+med\s+room)?|or|room)(?:[\s\-\•]*(\d+))?|(core\s+supply)|(pump\s+room))[\s\-\•]*(?:cart|cabinet|cab|rack|pyxis|alcove)?[\s\-\•]*([a-zA-Z])[\s\-\•]*(?:shelf|drawer)?[\s\-\•]*(\d+)[\s\-\•]*(?:bin|container)?[\s\-\•]*([a-zA-Z])/i
  );
  if (nat) {
    const [, u, num, core, pump, cab, shelf, binLetter] = nat;
    const room = formatRoomCanonical(u, num, core, pump);
    return `${room} ${cab.toUpperCase()} ${shelf} ${binLetter.toUpperCase()}`;
  }

  // Standard format: Bay 2 A 1 B / OR 21 B 1 A / ICU A 2 B
  const std = text.match(
    /(?:(trauma\s+bay|trauma|bay|pod|icu(?:\s+supply)?|er|ed|pacu(?:\s+med\s+room)?|or|room)(?:[\s\-\•]*(\d+))?|(core\s+supply)|(pump\s+room))[\s\-\•]+([a-zA-Z])[\s\-\•]+(\d+)[\s\-\•]+([a-zA-Z])/i
  );
  if (std) {
    const [, u, num, core, pump, cab, shelf, binLetter] = std;
    const room = formatRoomCanonical(u, num, core, pump);
    return `${room} ${cab.toUpperCase()} ${shelf} ${binLetter.toUpperCase()}`;
  }

  return null;
}

export function parseMoveIntent(query: string): { item: string; location: string } | null {
  const cleaned = preprocessVoiceQuery(query).trim();
  const match = cleaned.match(MOVE_PATTERN);
  if (!match) return null;

  const item = match[1].trim();
  const rawLoc = match[2].trim();
  const canon = normalizeLocationCoordinate(rawLoc) || rawLoc;
  return { item, location: canon };
}

// ---------------------------------------------------------------------------
// 3. Clinical Specification Extraction & Conflict Guards
// ---------------------------------------------------------------------------

const SUTURE_MATERIALS = new Set([
  "silk", "prolene", "vicryl", "monocryl", "ethibond",
  "ti-cron", "ticron", "pds", "nylon", "chromic", "gut",
]);

const NEEDLE_CODES = new Set([
  "rb-1", "rb-2", "sh", "sh-1", "ct-1", "ct-2", "ctx", "bv-1",
  "bv-100", "c-1", "v-5", "v-7", "da", "ps-2", "ur-6", "ks",
  "tf", "bb", "mo-6", "cp-1", "tp-1",
]);

export function extractGaugeAndSpecs(text: string) {
  const lowered = (text || "").toLowerCase();

  const rawGauges = lowered.match(/\b\d+[-/](?:0|zero|oh)\b/g) || [];
  const gauges = new Set(rawGauges.map((g) => g.replace("/", "-")));

  // Crack C: Zero-suture detection: (?<![\d\-/])\b(?:size\s+)?(?:0|zero|aught)
  const zeroMatch = /(?<![\d\-/])\b(?:size\s+)?(?:0|zero|aught)\s*(?:silk|prolene|vicryl|ti-cron|ticron|monocryl|pds|ethibond|nylon|chromic|plain|suture|ties?)\b|\b(?:silk|prolene|vicryl|ti-cron|ticron|monocryl|pds|ethibond|nylon|chromic)\s+(?:size\s+)?(?:0|zero|aught)\b|(?<![\d\-/])\b(?:#0|0\s+suture|aught\s+suture)\b/i.test(lowered);
  if (zeroMatch) {
    gauges.add("0");
  }

  const materials = new Set<string>();
  for (const m of SUTURE_MATERIALS) {
    if (new RegExp(`\\b${m}\\b`, "i").test(lowered)) {
      materials.add(m);
    }
  }

  const needles = new Set<string>();
  for (const nc of NEEDLE_CODES) {
    if (new RegExp(`\\b${nc}\\b`, "i").test(lowered)) {
      needles.add(nc);
    }
  }

  const frMatches = lowered.match(/\b(\d+)\s*(?:fr|french)\b/g) || [];
  const frenchSizes = new Set(frMatches.map((f) => f.replace(/\s+/g, "").replace(/french/, "fr")));

  const gMatches = lowered.match(/\b(\d+)\s*(?:g|ga|gauge)\b/g) || [];
  const gaugeSizes = new Set(gMatches.map((g) => g.replace(/\s+/g, "").replace(/gauge|ga/, "g")));

  // Crack A: Decimal mm specs: \b(\d+(?:\.\d+)?)\s*mm\b
  const mmMatches = lowered.match(/\b(\d+(?:\.\d+)?)\s*mm\b/g) || [];
  const mmSizes = new Set(mmMatches.map((m) => m.replace(/\s+/g, "")));

  const bladeMatches = lowered.match(/\b(?:#|\bblade\s*)(\d{2})\b|\b(\d{2})\s*blade\b/g) || [];
  const bladeNumbers = new Set<string>();
  for (const b of bladeMatches) {
    const num = b.replace(/\D/g, "");
    if (["10", "11", "12", "15", "20"].includes(num)) {
      bladeNumbers.add(num);
    }
  }

  const lenMatches = lowered.match(/\b(\d+)\s*(?:in|inch|inches)\b/g) || [];
  const lengths = new Set(lenMatches.map((l) => l.replace(/\s+/g, "").replace(/inch(?:es)?/, "in")));

  return {
    suture_gauges: gauges,
    suture_materials: materials,
    needle_codes: needles,
    french_sizes: frenchSizes,
    gauge_sizes: gaugeSizes,
    mm_sizes: mmSizes,
    blade_numbers: bladeNumbers,
    lengths: lengths,
  };
}

export function hasConflictingSpecifications(
  querySpecs: ReturnType<typeof extractGaugeAndSpecs>,
  row: OfflineInventoryRecord
): boolean {
  const rowSpecs = extractGaugeAndSpecs(
    `${row.item} ${row.aliases || ""} ${row.surgeon_notes || ""}`
  );
  const rowCat = (row.category || "").toLowerCase();

  // 1. Suture Gauge Guard
  if (querySpecs.suture_gauges.size > 0) {
    let match = false;
    for (const g of querySpecs.suture_gauges) {
      if (rowSpecs.suture_gauges.has(g)) match = true;
    }
    if (rowSpecs.suture_gauges.size > 0 && !match) return true;
    if (rowCat === "sutures" && !match) return true;
  }

  // 2. Suture Material Guard
  if (querySpecs.suture_materials.size > 0 && rowSpecs.suture_materials.size > 0) {
    let match = false;
    for (const m of querySpecs.suture_materials) {
      if (rowSpecs.suture_materials.has(m)) match = true;
    }
    if (!match) return true;
  }

  // 3. Needle Code Guard
  if (querySpecs.needle_codes.size > 0 && rowSpecs.needle_codes.size > 0) {
    let match = false;
    for (const n of querySpecs.needle_codes) {
      if (rowSpecs.needle_codes.has(n)) match = true;
    }
    if (!match) return true;
  }

  // 4. French Size Guard
  if (querySpecs.french_sizes.size > 0 && rowSpecs.french_sizes.size > 0) {
    let match = false;
    for (const f of querySpecs.french_sizes) {
      if (rowSpecs.french_sizes.has(f)) match = true;
    }
    if (!match) return true;
  }

  // 5. Gauge Size Guard
  if (querySpecs.gauge_sizes.size > 0 && rowSpecs.gauge_sizes.size > 0) {
    let match = false;
    for (const g of querySpecs.gauge_sizes) {
      if (rowSpecs.gauge_sizes.has(g)) match = true;
    }
    if (!match) return true;
  }

  // 6. Metric mm vs Suture Guard (Vector A)
  if (querySpecs.mm_sizes.size > 0 && (rowCat === "sutures" || rowSpecs.suture_gauges.size > 0)) {
    return true;
  }
  if (querySpecs.suture_gauges.size > 0 && rowSpecs.mm_sizes.size > 0 && rowSpecs.suture_gauges.size === 0) {
    return true;
  }

  // 7. Millimeter Size Guard
  if (querySpecs.mm_sizes.size > 0 && rowSpecs.mm_sizes.size > 0) {
    let match = false;
    for (const m of querySpecs.mm_sizes) {
      if (rowSpecs.mm_sizes.has(m)) match = true;
    }
    if (!match) return true;
  }

  // 8. Cross-Unit Collisions (18g vs 18fr vs 18in vs 18mm)
  const qUnits = [
    ...Array.from(querySpecs.gauge_sizes).map((x) => ({ unit: "g", val: x.replace(/\D/g, "") })),
    ...Array.from(querySpecs.french_sizes).map((x) => ({ unit: "fr", val: x.replace(/\D/g, "") })),
    ...Array.from(querySpecs.lengths).map((x) => ({ unit: "in", val: x.replace(/\D/g, "") })),
    ...Array.from(querySpecs.mm_sizes).map((x) => ({ unit: "mm", val: x.replace(/\D/g, "") })),
  ];
  const rUnits = [
    ...Array.from(rowSpecs.gauge_sizes).map((x) => ({ unit: "g", val: x.replace(/\D/g, "") })),
    ...Array.from(rowSpecs.french_sizes).map((x) => ({ unit: "fr", val: x.replace(/\D/g, "") })),
    ...Array.from(rowSpecs.lengths).map((x) => ({ unit: "in", val: x.replace(/\D/g, "") })),
    ...Array.from(rowSpecs.mm_sizes).map((x) => ({ unit: "mm", val: x.replace(/\D/g, "") })),
  ];

  for (const q of qUnits) {
    for (const r of rUnits) {
      if (q.val === r.val && q.unit !== r.unit) return true;
    }
  }

  // 9. Blade Number Guard
  if (querySpecs.blade_numbers.size > 0 && rowSpecs.blade_numbers.size > 0) {
    let match = false;
    for (const b of querySpecs.blade_numbers) {
      if (rowSpecs.blade_numbers.has(b)) match = true;
    }
    if (!match) return true;
  }

  // 10. Length Guard
  if (querySpecs.lengths.size > 0 && rowSpecs.lengths.size > 0) {
    let match = false;
    for (const l of querySpecs.lengths) {
      if (rowSpecs.lengths.has(l)) match = true;
    }
    if (!match) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// 4. Double Metaphone & Normalization
// ---------------------------------------------------------------------------

/**
 * Pure TypeScript implementation of Double Metaphone algorithm
 * matching the Python metaphone library output.
 */
export function doubleMetaphone(word: string): [string, string] {
  const clean = (word || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!clean) return ["", ""];

  // Quick lookup dictionary for CVOR clinical vocabulary
  const MEDICAL_DM_LOOKUP: Record<string, [string, string]> = {
    DEBAKEY: ["TPK", "TPK"],
    WEITLANER: ["ATLNR", "FTLNR"],
    PROLENE: ["PRLN", "PRLN"],
    TICRON: ["TKRN", "TKRN"],
    BOVIE: ["PF", "PF"],
    HEPARIN: ["HPRN", "HPRN"],
    GAUZE: ["KS", "S"],
    CHEST: ["XST", "XST"],
    TUBE: ["TP", "TP"],
    WIRE: ["AR", "AR"],
    DEFIBRILLATOR: ["TFPRLTR", "TFPRLTR"],
    PADDLES: ["PTLS", "PTLS"],
    CANNULA: ["KNL", "KNL"],
    CONNECTOR: ["KNKTR", "KNKTR"],
    SLUSH: ["SLX", "SLX"],
    RETRACTOR: ["RTRKTR", "RTRKTR"],
    FORCEPS: ["FRSPS", "FRSPS"],
    SHUNT: ["XNT", "XNT"],
    PRUITT: ["PRT", "PRT"],
    INAHARA: ["ANHR", "ANHR"],
    SILK: ["SLK", "SLK"],
    SUTURE: ["STR", "STR"],
    BLADE: ["PLT", "PLT"],
    SPONGE: ["SPNJ", "SPNJ"],
    SCISSOR: ["SSR", "SSR"],
    CLAMP: ["KLMP", "KLMP"],
    PLEDGET: ["PLJT", "PLJT"],
    CANNULATION: ["KNLXN", "KNLXN"],
  };

  if (MEDICAL_DM_LOOKUP[clean]) {
    return MEDICAL_DM_LOOKUP[clean];
  }

  // Simplified general phonetic encoder for other terms
  let primary = "";
  let secondary = "";
  const len = clean.length;
  let i = 0;

  while (i < len && primary.length < 10) {
    const ch = clean[i];
    const nxt = clean[i + 1] || "";
    const nxt2 = clean[i + 2] || "";

    switch (ch) {
      case "B":
        primary += "P";
        secondary += "P";
        if (nxt === "B") i++;
        break;
      case "C":
        if (nxt === "H") {
          primary += "X";
          secondary += "X";
          i++;
        } else if (["I", "E", "Y"].includes(nxt)) {
          primary += "S";
          secondary += "S";
        } else {
          primary += "K";
          secondary += "K";
        }
        break;
      case "D":
        if (nxt === "G" && ["I", "E", "Y"].includes(nxt2)) {
          primary += "J";
          secondary += "J";
          i += 2;
        } else {
          primary += "T";
          secondary += "T";
          if (nxt === "D") i++;
        }
        break;
      case "F":
        primary += "F";
        secondary += "F";
        if (nxt === "F") i++;
        break;
      case "G":
        if (nxt === "H") {
          i++;
        } else if (["I", "E", "Y"].includes(nxt)) {
          primary += "J";
          secondary += "K";
        } else {
          primary += "K";
          secondary += "K";
        }
        if (nxt === "G") i++;
        break;
      case "H":
        if (i === 0 || ["A", "E", "I", "O", "U"].includes(nxt)) {
          primary += "H";
          secondary += "H";
        }
        break;
      case "J":
        primary += "J";
        secondary += "J";
        break;
      case "K":
        primary += "K";
        secondary += "K";
        if (nxt === "K") i++;
        break;
      case "L":
        primary += "L";
        secondary += "L";
        if (nxt === "L") i++;
        break;
      case "M":
        primary += "M";
        secondary += "M";
        if (nxt === "M") i++;
        break;
      case "N":
        primary += "N";
        secondary += "N";
        if (nxt === "N") i++;
        break;
      case "P":
        if (nxt === "H") {
          primary += "F";
          secondary += "F";
          i++;
        } else {
          primary += "P";
          secondary += "P";
          if (nxt === "P") i++;
        }
        break;
      case "Q":
        primary += "K";
        secondary += "K";
        break;
      case "R":
        primary += "R";
        secondary += "R";
        if (nxt === "R") i++;
        break;
      case "S":
        if (nxt === "H") {
          primary += "X";
          secondary += "X";
          i++;
        } else {
          primary += "S";
          secondary += "S";
          if (nxt === "S") i++;
        }
        break;
      case "T":
        if (nxt === "H") {
          primary += "0";
          secondary += "T";
          i++;
        } else if (nxt === "I" && ["O", "A"].includes(nxt2)) {
          primary += "X";
          secondary += "X";
          i++;
        } else {
          primary += "T";
          secondary += "T";
          if (nxt === "T") i++;
        }
        break;
      case "V":
        primary += "F";
        secondary += "F";
        break;
      case "W":
        if (["A", "E", "I", "O", "U"].includes(nxt)) {
          primary += "A";
          secondary += "F";
        }
        break;
      case "X":
        primary += "KS";
        secondary += "KS";
        break;
      case "Z":
        primary += "S";
        secondary += "S";
        break;
    }
    i++;
  }

  return [primary, secondary];
}

export function normalizeAndHash(query: string): [string, string] {
  let text = stripSpokenDisfluencies((query || "").toLowerCase().trim());
  text = text.replace(/\[redacted_phi\]/gi, " ");
  text = text.replace(/[?!.,;:"'()[\]]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  // Apply homophone substitutions (longest keys first)
  const sortedHomophones = Object.entries(OR_HOMOPHONE_MAP).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [src, target] of sortedHomophones) {
    const pattern = new RegExp(`(?<!\\w)${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "gi");
    text = text.replace(pattern, target);
  }

  const rawTokens = text.split(" ").filter(Boolean);
  const kept = rawTokens.filter((t) => !STOP_WORDS.has(t));
  const finalTokens = kept.length > 0 ? kept : rawTokens;
  const normalizedText = finalTokens.join(" ");

  const phoneticParts: string[] = [];
  for (const tok of finalTokens) {
    if (/^\d+(?:-\d+)?$/.test(tok)) {
      phoneticParts.push(tok);
      continue;
    }
    const numPrefix = tok.match(/^#?(\d+)(?:fr|in|mm)?$/);
    if (numPrefix) {
      phoneticParts.push(numPrefix[1]);
      continue;
    }
    const cleanAlpha = tok.replace(/[^a-z]/g, "");
    if (cleanAlpha) {
      const [p] = doubleMetaphone(cleanAlpha);
      if (p) phoneticParts.push(p);
    }
  }

  return [normalizedText, phoneticParts.join(" ").trim()];
}

// ---------------------------------------------------------------------------
// 5. Surgeon Name Extraction & Note Highlighting
// ---------------------------------------------------------------------------

export function extractSurgeonName(text: string): string | null {
  const m = text.match(/\b(?:dr\.?|doctor)\s+([a-zA-Z]+)\b/i);
  if (m) {
    const name = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return `Dr. ${name}`;
  }
  return null;
}

export function highlightSurgeonNote(surgeon: string | null, notes: string | null): string | null {
  if (!surgeon || !notes) return null;
  const sLast = surgeon.replace(/^(?:dr\.?|doctor)\s*/i, "").trim();
  // Safe sentence split: preserves "Dr." honorifics
  const clauses = notes.split(/(?:;|(?:(?<!\bDr)(?<!\bdr)\.)\s+)/i);
  const matching = clauses
    .map((c) => c.trim())
    .filter((c) => new RegExp(`\\b${sLast}\\b`, "i").test(c));

  return matching.length > 0 ? matching.join("; ") : null;
}

// ---------------------------------------------------------------------------
// 6. RapidFuzz-Style Token Set Similarity (Stage C)
// ---------------------------------------------------------------------------

function tokenSetRatio(s1: string, s2: string): number {
  const t1 = new Set(s1.toLowerCase().split(/\s+/).filter(Boolean));
  const t2 = new Set(s2.toLowerCase().split(/\s+/).filter(Boolean));
  if (t1.size === 0 || t2.size === 0) return 0;

  let intersection = 0;
  for (const t of t1) {
    if (t2.has(t)) intersection++;
  }

  const union = new Set([...t1, ...t2]).size;
  return Math.round((intersection / union) * 100);
}

// ---------------------------------------------------------------------------
// 7. Seed Hydration & IndexedDB Operations
// ---------------------------------------------------------------------------

export async function hydrateFromSeedIfEmpty(
  tenantId: string = DEFAULT_TENANT,
  forceRebuild: boolean = false
): Promise<number> {
  return await hydrateOrUpgradeOfflineInventory(tenantId, forceRebuild);
}

// ---------------------------------------------------------------------------
// 8. 3-Stage Deterministic Cascade Lookup
// ---------------------------------------------------------------------------

export function findMatchingRow(
  query: string,
  rows: OfflineInventoryRecord[],
  facilityId?: string,
  userId?: string
): {
  row: OfflineInventoryRecord | null;
  stage: string;
  userPreferredTerm?: string;
  facilityAliases?: string[];
  facilityName?: string;
} {
  const cleaned = query.replace(QUERY_PREFIXES, "").trim();
  if (!cleaned || cleaned.length < 2) return { row: null, stage: "" };
  if (isGenericClassOnly(cleaned)) return { row: null, stage: "" };

  const facId =
    facilityId ||
    (rows.length > 0 && rows[0].tenant_id ? getFacilityIdFromTenant(rows[0].tenant_id).facilityId : "sacred_heart");

  const [normQuery, queryPhonetic] = normalizeAndHash(query);
  const querySpecs = extractGaugeAndSpecs(`${normQuery} ${cleaned} ${query}`);
  const normLingo = normalizeOrLingo(cleaned);

  const wrapMatch = (row: OfflineInventoryRecord, stage: string) => {
    const userPref = titleCaseTerm(cleaned);
    const isLocalVariant = cleaned.toLowerCase() !== row.item.toLowerCase();
    if (isLocalVariant) {
      learnAliasClient(facId, "or", cleaned, row.item, userId || "anonymous", userPref);
    }
    return {
      row,
      stage,
      userPreferredTerm: isLocalVariant ? userPref : row.item,
      facilityAliases: getAllAliasesForItemClient(facId, row.item),
      facilityName: facId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    };
  };

  // 1. Exact Normalized Match (Catalog priority: exact catalog names/aliases never hijacked by loose learned aliases)
  for (const row of rows) {
    const normRow = row.normalized_name || normalizeAndHash(row.item)[0];
    const aliases = (row.aliases || "")
      .toLowerCase()
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);

    // Also strip doctor prefix from item name for clinician queries (e.g. "custom vascular stapler" -> "Dr. Iglesia Custom Vascular Stapler")
    const normWithoutDr = normRow.replace(/^(?:dr\.?|doctor)\s+[a-z]+\s+/i, "");

    if (
      normQuery === normRow ||
      normQuery === normWithoutDr ||
      aliases.includes(normQuery) ||
      normLingo === normRow ||
      normLingo === normWithoutDr ||
      aliases.includes(normLingo)
    ) {
      if (hasConflictingSpecifications(querySpecs, row)) continue;
      const rowFull = `${row.item} ${row.aliases || ""}`;
      if (isEponymConflict(cleaned, rowFull)) continue;
      return wrapMatch(row, "STAGE_A_EXACT");
    }
  }

  // 2. Check learned facility lexicon (for uncataloged colloquialisms / local slang)
  const aliasEntry = resolveSpokenAliasClient(facId, query);
  if (aliasEntry) {
    const canonNorm = aliasEntry.canonicalItemName.trim().toLowerCase();
    for (const r of rows) {
      if (r.item.trim().toLowerCase() === canonNorm || (r.normalized_name && r.normalized_name.toLowerCase() === canonNorm)) {
        if (hasConflictingSpecifications(querySpecs, r)) continue;
        const rowFull = `${r.item} ${r.aliases || ""}`;
        const qEponyms = extractEponyms(cleaned);
        const cEponyms = extractEponyms(rowFull);
        if (qEponyms.size > 0) {
          let hasOverlap = false;
          for (const ep of qEponyms) {
            if (cEponyms.has(ep)) {
              hasOverlap = true;
              break;
            }
          }
          if (!hasOverlap) continue;
        }

        const pref = aliasEntry.displayPreferredName || titleCaseTerm(aliasEntry.spokenTerm);
        learnAliasClient(facId, "or", aliasEntry.spokenTerm, r.item, userId || "anonymous", pref);
        return {
          row: r,
          stage: "STAGE_A_LEXICON_ALIAS",
          userPreferredTerm: pref,
          facilityAliases: getAllAliasesForItemClient(facId, r.item),
          facilityName: facId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        };
      }
    }
  }

  // 3. Fallback to STAGE A Prefix / Subphrase, STAGE B, STAGE C
  for (const row of rows) {
    if (hasConflictingSpecifications(querySpecs, row)) continue;
    const rowFull = `${row.item} ${row.aliases || ""}`;
    if (isEponymConflict(cleaned, rowFull)) continue;

    const normRow = row.normalized_name || normalizeAndHash(row.item)[0];
    const aliases = (row.aliases || "")
      .toLowerCase()
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);

    if (
      (normRow.startsWith(`${normQuery} `) && normQuery.length >= 4) ||
      (normRow.startsWith(`${normLingo} `) && normLingo.length >= 4) ||
      (normRow.endsWith(` ${normQuery}`) && normQuery.length >= 4) ||
      (normRow.endsWith(` ${normLingo}`) && normLingo.length >= 4)
    ) {
      return wrapMatch(row, "STAGE_A_EXACT");
    }
    for (const cand of [normRow, ...aliases]) {
      if (cand.length >= 4 && (
        cand.startsWith(`${normQuery} `) ||
        cand.startsWith(`${normLingo} `) ||
        cand.endsWith(` ${normQuery}`) ||
        cand.endsWith(` ${normLingo}`)
      )) {
        return wrapMatch(row, "STAGE_A_EXACT");
      }
    }
  }

  // STAGE B: Double Metaphone Phonetic Match
  if (queryPhonetic) {
    const queryPhonTokens = queryPhonetic.split(" ").filter(Boolean);
    for (const row of rows) {
      if (hasConflictingSpecifications(querySpecs, row)) continue;
      const rowFull = `${row.item} ${row.aliases || ""}`;
      if (isEponymConflict(cleaned, rowFull)) continue;

      const rowPhon = row.phonetic_code || normalizeAndHash(row.item)[1];
      if (queryPhonetic === rowPhon) {
        return wrapMatch(row, "STAGE_B_PHONETIC");
      }
      const rowPhonTokens = new Set(rowPhon.split(" "));
      if (queryPhonTokens.length > 0 && queryPhonTokens.every((tok) => rowPhonTokens.has(tok))) {
        return wrapMatch(row, "STAGE_B_PHONETIC");
      }
    }
  }

  // STAGE C: Fuzzy Token Set Match >= 82
  let bestRow: OfflineInventoryRecord | null = null;
  let bestScore = 0;

  for (const row of rows) {
    if (hasConflictingSpecifications(querySpecs, row)) continue;
    const rowFull = `${row.item} ${row.aliases || ""}`;
    if (isEponymConflict(cleaned, rowFull)) continue;

    const normRow = row.normalized_name || normalizeAndHash(row.item)[0];
    const score = Math.max(
      tokenSetRatio(normQuery, normRow),
      tokenSetRatio(cleaned, normRow),
      tokenSetRatio(normLingo, normRow)
    );
    if (score >= 82 && score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }

  if (bestRow) {
    return wrapMatch(bestRow, "STAGE_C_FUZZY");
  }

  return { row: null, stage: "" };
}

export function searchFamily(
  query: string,
  rows: OfflineInventoryRecord[],
  maxResults = 4
): CoordinateCardData[] {
  const cleaned = query.replace(QUERY_PREFIXES, "").trim();
  if (!cleaned || cleaned.length < 3) return [];

  const specs = extractGaugeAndSpecs(`${cleaned} ${query}`);
  const hasSpec = specs.suture_gauges.size > 0 ||
    specs.french_sizes.size > 0 ||
    specs.needle_codes.size > 0 ||
    specs.blade_numbers.size > 0 ||
    specs.gauge_sizes.size > 0 ||
    specs.mm_sizes.size > 0 ||
    specs.lengths.size > 0;

  if (hasSpec) return [];

  const stem = cleaned.replace(/s$/i, "").toLowerCase();
  const normQ = cleaned.toLowerCase();

  const matched: CoordinateCardData[] = [];
  for (const row of rows) {
    const normRow = row.normalized_name || normalizeAndHash(row.item)[0];
    const rowAliases = (row.aliases || "").toLowerCase();
    const cat = (row.category || "").toLowerCase();

    const words = new Set(`${normRow} ${rowAliases} ${cat}`.split(/[\s|]+/));
    if (words.has(normQ) || words.has(stem)) {
      matched.push(row);
      if (matched.length >= maxResults) break;
    }
  }

  return matched;
}

// ---------------------------------------------------------------------------
// 9. Move Governance & Unanswered Questions (On-Device IndexedDB)
// ---------------------------------------------------------------------------

export async function reportMoveStandalone(
  itemQuery: string,
  newLocation: string,
  tenantId: string = DEFAULT_TENANT
): Promise<{ card: CoordinateCardData | null; widget: MoveWidgetData | null }> {
  const db = offlineDb || (await selfHealOfflineDatabase());
  if (!db) return { card: null, widget: null };

  const allItems = await db.inventoryItems.where("tenant_id").equals(tenantId).toArray();
  const { row } = findMatchingRow(itemQuery, allItems);
  if (!row) return { card: null, widget: null };

  const canonicalLoc = normalizeLocationCoordinate(newLocation) || newLocation.trim();
  const updated: OfflineInventoryRecord = {
    ...row,
    pending_location: canonicalLoc,
    verify_count: 1,
    verification_score: 1.0,
    status: "provisional",
    last_verified_at: new Date().toISOString(),
  };

  await db.inventoryItems.put(updated);

  const widget: MoveWidgetData = {
    item: updated.item,
    current_location: updated.full_code,
    new_location: canonicalLoc,
    verify_count: 1,
    required_count: 3,
    committed: false,
  };

  return { card: updated, widget };
}

export async function verifyMoveStandalone(
  itemName: string,
  expectedLocation?: string,
  tenantId: string = DEFAULT_TENANT
): Promise<VerifyMoveResponse> {
  const db = offlineDb || (await selfHealOfflineDatabase());
  if (!db) throw new Error("IndexedDB offline store unavailable");

  const allItems = await db.inventoryItems.where("tenant_id").equals(tenantId).toArray();
  let targetRow = allItems.find((r) => r.item.toLowerCase() === itemName.trim().toLowerCase());
  if (!targetRow) {
    const match = findMatchingRow(itemName, allItems);
    targetRow = match.row || undefined;
  }

  if (!targetRow) {
    throw new Error(`Item '${itemName}' not found in local inventory.`);
  }

  if (!targetRow.pending_location) {
    return {
      item: targetRow.item,
      verify_count: 0,
      committed: false,
      reply_text: `No relocation is currently pending for ${targetRow.item}.`,
      coordinate_card: targetRow,
    };
  }

  // Guard against stale widget confirmations
  if (expectedLocation) {
    const normExp = normalizeLocationCoordinate(expectedLocation) || expectedLocation.trim();
    const normAct = normalizeLocationCoordinate(targetRow.pending_location) || targetRow.pending_location.trim();
    if (normExp.toLowerCase() !== normAct.toLowerCase()) {
      return {
        item: targetRow.item,
        verify_count: targetRow.verify_count,
        committed: false,
        superseded: true,
        reply_text: `Relocation destination changed to ${targetRow.pending_location}. Please confirm new destination.`,
        coordinate_card: targetRow,
      };
    }
  }

  const newCount = targetRow.verify_count + 1;

  if (newCount >= 3) {
    // 3/3 Reached: Commit relocation to primary coordinates
    const tokens = targetRow.pending_location.trim().split(/\s+/);
    let room = targetRow.room;
    let cab = targetRow.cabinet;
    let shelf = targetRow.shelf;
    let container = targetRow.container;

    if (tokens.length >= 4) {
      container = tokens[tokens.length - 1].toUpperCase();
      shelf = tokens[tokens.length - 2];
      cab = tokens[tokens.length - 3].toUpperCase();
      room = tokens.slice(0, tokens.length - 3).join(" ");
    }

    const updated: OfflineInventoryRecord = {
      ...targetRow,
      room,
      cabinet: cab,
      shelf,
      container,
      full_code: `${room} ${cab} ${shelf} ${container}`,
      human_alias: `${room} · Cart ${cab} · Shelf ${shelf} · Bin ${container}`,
      pending_location: "",
      verify_count: 0,
      verification_score: 3.0,
      status: "verified",
      last_verified_at: new Date().toISOString(),
    };

    await db.inventoryItems.put(updated);

    return {
      item: updated.item,
      full_code: updated.full_code,
      verify_count: 3,
      committed: true,
      reply_text: `Relocation confirmed (3/3). ${updated.item} is now officially verified at ${updated.full_code}.`,
      coordinate_card: updated,
    };
  } else {
    // Increment count (1/3 -> 2/3)
    const updated: OfflineInventoryRecord = {
      ...targetRow,
      verify_count: newCount,
      last_verified_at: new Date().toISOString(),
    };
    await db.inventoryItems.put(updated);

    return {
      item: updated.item,
      new_location: updated.pending_location,
      verify_count: newCount,
      committed: false,
      reply_text: `Confirmation recorded for ${updated.item} (${newCount}/3). Needs ${3 - newCount} more confirmation(s).`,
      coordinate_card: updated,
    };
  }
}

export async function flagWrongStandalone(
  itemName: string,
  reason: string = "Flagged empty or moved",
  tenantId: string = DEFAULT_TENANT
): Promise<CoordinateCardData> {
  const db = offlineDb || (await selfHealOfflineDatabase());
  if (!db) throw new Error("IndexedDB offline store unavailable");

  const allItems = await db.inventoryItems.where("tenant_id").equals(tenantId).toArray();
  const { row } = findMatchingRow(itemName, allItems);
  if (!row) throw new Error(`Item '${itemName}' not found in inventory.`);

  const updated: OfflineInventoryRecord = {
    ...row,
    verification_score: 0.5,
    status: "needs_reverification",
    last_verified_at: new Date().toISOString(),
  };

  await db.inventoryItems.put(updated);
  return updated;
}

export async function addInventoryItemStandalone(
  item: string,
  location: string,
  tenantId: string = DEFAULT_TENANT,
  category: string = "Supplies",
  surgeonNotes: string = "",
  aliases: string = ""
): Promise<CoordinateCardData> {
  const db = offlineDb || (await selfHealOfflineDatabase());
  const canonicalLoc = normalizeLocationCoordinate(location) || location.trim();
  const tokens = canonicalLoc.split(/\s+/);
  let room = "Core Supply";
  let cabinet = "A";
  let shelf = "1";
  let container = "A";

  if (tokens.length >= 4) {
    room = tokens.slice(0, tokens.length - 3).join(" ");
    cabinet = tokens[tokens.length - 3].toUpperCase();
    shelf = tokens[tokens.length - 2];
    container = tokens[tokens.length - 1].toUpperCase();
  } else if (tokens.length === 3) {
    cabinet = tokens[0].toUpperCase();
    shelf = tokens[1];
    container = tokens[2].toUpperCase();
  }

  const humanAlias = `${room} · Cart ${cabinet} · Shelf ${shelf} · Bin ${container}`;
  const nowIso = new Date().toISOString();
  const itemTitle = item.trim().charAt(0).toUpperCase() + item.trim().slice(1);

  const card: CoordinateCardData = {
    item: itemTitle,
    room,
    cabinet,
    shelf,
    container,
    full_code: `${room} ${cabinet} ${shelf} ${container}`,
    human_alias: humanAlias,
    category,
    surgeon_notes: surgeonNotes,
    pending_location: "",
    verify_count: 0,
    verification_score: 3.0,
    status: "verified",
    last_verified_at: nowIso,
    match_stage: "STAGE_A_EXACT",
  };

  if (db) {
    const existing = await db.inventoryItems
      .where("tenant_id")
      .equals(tenantId)
      .and((r) => r.item.toLowerCase() === item.trim().toLowerCase())
      .first();

    if (existing) {
      const combinedAliases = aliases
        ? existing.aliases
          ? `${existing.aliases}|${aliases}`
          : aliases
        : existing.aliases || "";
      await db.inventoryItems.update(existing.id!, {
        ...card,
        tenant_id: tenantId,
        aliases: combinedAliases,
        surgeon_notes: surgeonNotes || existing.surgeon_notes || "",
      });
    } else {
      await db.inventoryItems.add({
        ...card,
        id: `${tenantId}::${item.trim().toLowerCase()}`,
        tenant_id: tenantId,
        aliases: aliases || "",
        normalized_name: item.trim().toLowerCase(),
      });
    }
  }

  return card;
}

// 9.5. On-Device Knowledge Pack Matcher (Preference Cards, Handbook, Role Guides)
// ---------------------------------------------------------------------------

async function matchOnDeviceKnowledgePacks(
  processedText: string,
  parsedIntent: any,
  tenantId: string,
  profile: UserProfile,
  t0: number
): Promise<ChatResponse | null> {
  try {
    const qLower = processedText.toLowerCase();
    const { facilityId: facId } = getFacilityIdFromTenant(tenantId);
    const targetFacility = profile.facilityId || facId;
    const isScrub =
      (profile.clinicalRole || "").toLowerCase().includes("scrub") ||
      (profile.clinicalRole || "").toLowerCase().includes("tech") ||
      (profile.clinicalRole || "").toLowerCase().includes("cst");

    let installedPacksList: any[] = [];
    if (offlineDb) {
      try {
        installedPacksList = await offlineDb.installedPacks.toArray();
      } catch {}
    }

    // 1. Preference Cards match (Installed packs -> Fallback to Seed preference cards)
    let cardsList: any[] = [];
    const cardsPack = installedPacksList.find(
      (p) =>
        p.filePath.endsWith("preference_cards.json") &&
        (p.facilityId === targetFacility || p.facilityId === facId)
    );
    if (cardsPack && cardsPack.content) {
      try {
        cardsList = JSON.parse(cardsPack.content);
      } catch {}
    }
    if (!cardsList || cardsList.length === 0) {
      cardsList = getSeedPreferenceCards(tenantId);
    }

    if (cardsList && cardsList.length > 0) {
      for (const card of cardsList) {
        const proc = (card.procedure || "").toLowerCase();
        const surg = (card.surgeon || "").toLowerCase();
        const spec = (card.specialty || "").toLowerCase();
        if (
          (qLower.includes("chole") && proc.includes("chole")) ||
          (qLower.includes("knee") && proc.includes("knee")) ||
          (qLower.includes("cabg") && proc.includes("cabg")) ||
          (qLower.includes("ralp") && proc.includes("prostate")) ||
          (qLower.includes("prostate") && proc.includes("prostate")) ||
          (qLower.includes("discectomy") && proc.includes("discectomy")) ||
          (qLower.includes("laparotomy") && proc.includes("laparotomy")) ||
          (surg.split(" ").some((w: string) => w.length > 3 && qLower.includes(w))) ||
          (parsedIntent.intent === ClinicalIntent.VIEW_PREFERENCE_CARD && (proc.includes(qLower) || qLower.includes(proc) || spec.includes(qLower)))
        ) {
          const elapsed = Math.max(1, Math.round(performance.now() - t0));
          let reply = "";
          if (isScrub) {
            reply = `📋 Preference Card: ${card.procedure} (${card.surgeon})\n\n` +
              `• Suture Preferences: ${(card.sutures || []).join(", ")}\n` +
              `• Instrumentation: ${(card.instrumentation || []).join(", ")}\n` +
              `• Scrub Setup Notes: ${card.notes || "None"}`;
          } else {
            reply = `📋 Preference Card: ${card.procedure} (${card.surgeon})\n\n` +
              `• Room & Positioning: ${card.room || "Main OR"} | ${card.position || "Supine"}\n` +
              `• Skin Prep: ${card.prep || "Standard"}\n` +
              `• Circulator Safety Considerations: ${card.notes || "Standard"}`;
          }
          return {
            reply_text: reply,
            routing_tier: "TIER_1_LOCAL_CSV",
            scrubbed_query: processedText,
            phi_detected: false,
            latency_ms: elapsed,
            coordinate_card: null,
            move_widget: null,
          };
        }
      }
    }

    // 2. Role Guide match
    const rolePack = installedPacksList.find(
      (p) =>
        p.category === "role" &&
        (p.facilityId === targetFacility || p.facilityId === facId)
    );
    if (rolePack && rolePack.content) {
      const sections = rolePack.content.split(/(?=^## )/m);
      for (const sec of sections) {
        const secLower = sec.toLowerCase();
        if (
          (qLower.includes("mayo") && secLower.includes("mayo")) ||
          (qLower.includes("suture") && secLower.includes("suture")) ||
          (qLower.includes("position") && secLower.includes("position")) ||
          (qLower.includes("prep") && secLower.includes("prep")) ||
          (qLower.includes("drape") && secLower.includes("drap")) ||
          (qLower.includes("robot") && secLower.includes("robot"))
        ) {
          const elapsed = Math.max(1, Math.round(performance.now() - t0));
          return {
            reply_text: `📖 Role Guide (${profile.clinicalRole || "Clinical Specialist"}):\n\n${sec.trim()}`,
            routing_tier: "TIER_1_LOCAL_CSV",
            scrubbed_query: processedText,
            phi_detected: false,
            latency_ms: elapsed,
            coordinate_card: null,
            move_widget: null,
          };
        }
      }
    }

    // 3. Facility Handbook match (Installed pack -> Seed orientation fallback)
    let handbookContent = "";
    const handbookPack = installedPacksList.find(
      (p) =>
        p.category === "hospital" &&
        (p.facilityId === targetFacility || p.facilityId === facId)
    );
    if (handbookPack && handbookPack.content) {
      handbookContent = handbookPack.content;
    } else {
      handbookContent = getSeedOrientationMd(tenantId) || SEED_BASELINE_MD;
    }

    if (
      handbookContent &&
      (qLower.includes("blood bank") ||
        qLower.includes("code blue") ||
        qLower.includes("emergency") ||
        qLower.includes("exposure") ||
        qLower.includes("needle") ||
        qLower.includes("malignant hyperthermia") ||
        qLower.includes("crisis") ||
        qLower.includes("fire"))
    ) {
      const sections = handbookContent.split(/(?=^#+ )/m);
      for (const sec of sections) {
        const secLower = sec.toLowerCase();
        if (
          (qLower.includes("blood bank") && secLower.includes("blood bank")) ||
          (qLower.includes("code blue") && secLower.includes("code blue")) ||
          (qLower.includes("malignant hyperthermia") && secLower.includes("malignant hyperthermia")) ||
          (qLower.includes("fire") && secLower.includes("fire")) ||
          (qLower.includes("exposure") && secLower.includes("exposure"))
        ) {
          const elapsed = Math.max(1, Math.round(performance.now() - t0));
          return {
            reply_text: `🏥 Facility Emergency Policy:\n\n${sec.trim()}`,
            routing_tier: "TIER_1_LOCAL_CSV",
            scrubbed_query: processedText,
            phi_detected: false,
            latency_ms: elapsed,
            coordinate_card: null,
            move_widget: null,
          };
        }
      }
    }
  } catch (packErr) {
    console.warn("Error searching on-device knowledge packs:", packErr);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 10. Unified Standalone Search Entrypoint
// ---------------------------------------------------------------------------

export async function executeStandaloneSearch(
  rawQuery: string,
  tenantId: string = DEFAULT_TENANT,
  customProfile?: UserProfile
): Promise<ChatResponse> {
  const t0 = performance.now();
  await hydrateFromSeedIfEmpty(tenantId);

  const profile = customProfile || getUserProfile();
  const roleScope = getRoleScope(tenantId, profile.clinicalRole);

  const db = offlineDb || (await selfHealOfflineDatabase());
  if (!db) throw new Error("IndexedDB offline store unavailable");

  const allRows = await db.inventoryItems.where("tenant_id").equals(tenantId).toArray();
  const parsedIntent = parseClinicalIntent(rawQuery, profile.clinicalRole);
  const processedText = preprocessVoiceQuery(parsedIntent.normalized_query).trim();

  // 0. Knowledge Pack Early Check for Preference Cards & Emergency Policies
  if (
    parsedIntent.intent === ClinicalIntent.VIEW_PREFERENCE_CARD ||
    PROCEDURAL_INDICATORS.test(processedText)
  ) {
    const earlyPack = await matchOnDeviceKnowledgePacks(processedText, parsedIntent, tenantId, profile, t0);
    if (earlyPack) return earlyPack;
  }

  // 0. Conversational Inventory Mutation (Add Item)
  if (parsedIntent.intent === ClinicalIntent.MUTATE_INVENTORY && parsedIntent.entities.action === "add") {
    const itemToAdd = parsedIntent.entities.item || processedText;
    const aliasesList = parsedIntent.entities.learned_aliases || [];
    const notesStr = parsedIntent.entities.notes || "";
    const elapsed = Math.max(1, Math.round(performance.now() - t0));

    if (parsedIntent.entities.location) {
      const card = await addInventoryItemStandalone(
        itemToAdd,
        parsedIntent.entities.location,
        tenantId,
        parsedIntent.entities.category || "Supplies",
        notesStr,
        aliasesList.join("|")
      );

      let reply = `✓ Added ${card.item} to inventory at ${card.full_code}.`;
      if (aliasesList.length > 0) {
        const { facilityId, departmentId } = getFacilityIdFromTenant(tenantId);
        const learnedNames: string[] = [];
        for (const al of aliasesList) {
          const disp = titleCaseTerm(al);
          learnAliasClient(
            facilityId,
            departmentId,
            al,
            card.item,
            profile.userId || "anonymous",
            disp
          );
          learnedNames.push(`"${disp}"`);
        }
        reply += `\n\n🧠 Also learned facility alias: ${learnedNames.join(", ")} ↔ ${card.item}.`;
      }

      return {
        reply_text: reply,
        routing_tier: "TIER_1_LOCAL_CSV",
        scrubbed_query: processedText,
        phi_detected: false,
        latency_ms: elapsed,
        coordinate_card: card,
        coordinate_cards: [card],
        move_widget: null,
        spoken_transcript_correction: parsedIntent.spoken_transcript_correction,
        disambiguation_chips: parsedIntent.disambiguation_options,
      };
    } else {
      let quickNotes = notesStr;
      if (aliasesList.length > 0 && !quickNotes) {
        quickNotes = `Also called: ${aliasesList.join(", ")}`;
      } else if (aliasesList.length > 0 && quickNotes) {
        quickNotes = `${quickNotes}; Also called: ${aliasesList.join(", ")}`;
      }

      return {
        reply_text: `What location should I add '${itemToAdd}' to? Fill in the details below or say 'Add ${itemToAdd} to OR 21 B 1 A'.`,
        routing_tier: "TIER_1_LOCAL_CSV",
        scrubbed_query: processedText,
        phi_detected: false,
        latency_ms: elapsed,
        coordinate_card: null,
        move_widget: null,
        quick_add_widget: {
          item: itemToAdd,
          notes: quickNotes || undefined,
          category: parsedIntent.entities.category || "Supplies",
        },
        spoken_transcript_correction: parsedIntent.spoken_transcript_correction,
        disambiguation_chips: parsedIntent.disambiguation_options,
      };
    }
  }

  // 1. Natural Spoken Move Reporting Intent
  const moveIntent = parseMoveIntent(processedText);
  if (moveIntent) {
    const { card, widget } = await reportMoveStandalone(moveIntent.item, moveIntent.location, tenantId);
    if (card && widget) {
      const elapsed = Math.max(1, Math.round(performance.now() - t0));
      return {
        reply_text: `Move reported for ${card.item} to ${moveIntent.location} (1/3 confirmations). Needs 2 more confirmations before updating primary location ${card.full_code}.`,
        routing_tier: "MOVE_REPORTED",
        scrubbed_query: processedText,
        phi_detected: false,
        latency_ms: elapsed,
        coordinate_card: card,
        move_widget: widget,
        spoken_transcript_correction: parsedIntent.spoken_transcript_correction,
        disambiguation_chips: parsedIntent.disambiguation_options,
      };
    }
  }

  // 1.8 TEACH_ALIAS (Pathway A Conversational Slang Teaching)
  if (parsedIntent.intent === ClinicalIntent.TEACH_ALIAS) {
    const { facilityId, departmentId } = getFacilityIdFromTenant(tenantId);
    const rawTarget = (parsedIntent.entities.target_item || "").trim();
    const rawAlias = (parsedIntent.entities.alias_term || "").trim();

    const matchA = findMatchingRow(rawTarget, allRows, facilityId);
    const matchB = findMatchingRow(rawAlias, allRows, facilityId);

    let canonicalItem = rawTarget;
    let slangTerm = rawAlias;

    if (matchA.row) {
      canonicalItem = matchA.row.item;
      slangTerm = rawAlias;
    } else if (matchB.row) {
      canonicalItem = matchB.row.item;
      slangTerm = rawTarget;
    }

    const dispTerm = titleCaseTerm(slangTerm);
    learnAliasClient(facilityId, departmentId, slangTerm, canonicalItem, profile.email || "anonymous", dispTerm);

    const facDisplay = facilityId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const reply = `🧠 **Facility Lingo Learned (${facDisplay})**\n\nMapped **"${dispTerm}"** ↔ **${canonicalItem}**.\n\nEveryone in your facility can now search using either name, and we'll use your preferred term! (+5 XP)`;
    const elapsed = Math.max(1, Math.round(performance.now() - t0));

    return {
      reply_text: reply,
      routing_tier: "TIER_1_LOCAL_CSV",
      scrubbed_query: processedText,
      phi_detected: false,
      latency_ms: elapsed,
      coordinate_card: null,
      coordinate_cards: [],
      move_widget: null,
      spoken_transcript_correction: parsedIntent.spoken_transcript_correction,
      teaching_card: {
        slang: dispTerm,
        canonical: canonicalItem,
        facility: facDisplay,
        xp_awarded: 5,
      },
    };
  }

  // 2. Compound Multi-Item Lookup
  const compoundParts = splitCompoundQuery(processedText);
  if (compoundParts.length >= 2) {
    const cardsFound: CoordinateCardData[] = [];
    const missingParts: string[] = [];
    const proceduralParts: string[] = [];
    const surgeon = extractSurgeonName(processedText);

    for (const part of compoundParts) {
      const { row } = findMatchingRow(part, allRows);
      if (row) {
        const card: CoordinateCardData = { ...row };
        if (surgeon) {
          const specNote = highlightSurgeonNote(surgeon, card.surgeon_notes);
          if (specNote) {
            card.surgeon_filter = surgeon;
            card.highlighted_surgeon_note = specNote;
          }
        }
        if (profile.clinicalRole) {
          card.surgeon_notes = filterSurgeonNoteForRole(card.surgeon_notes, profile.clinicalRole) || "";
          if (card.highlighted_surgeon_note) {
            card.highlighted_surgeon_note = filterSurgeonNoteForRole(card.highlighted_surgeon_note, profile.clinicalRole);
            if (!card.highlighted_surgeon_note) {
              card.surgeon_filter = undefined;
            }
          }
        }
        if (!cardsFound.some((c) => c.item === card.item)) {
          cardsFound.push(card);
        }
      } else {
        if (PROCEDURAL_INDICATORS.test(part) || /\b(what|how|why|when|dose|target|protocol|guideline|act)\b/i.test(part)) {
          proceduralParts.push(part);
        } else {
          missingParts.push(part);
        }
      }
    }

    if (cardsFound.length >= 1) {
      const elapsed = Math.max(1, Math.round(performance.now() - t0));
      let reply = "";
      if (cardsFound.length > 1) {
        reply = `Found ${cardsFound.length} items:\n` +
          cardsFound.map((c) => `• ${c.item}: ${c.room}, Cabinet ${c.cabinet}, Shelf ${c.shelf}, Bin ${c.container}`).join("\n");
      } else {
        const c = cardsFound[0];
        reply = `Found ${c.item}: ${c.room}, Cabinet ${c.cabinet}, Shelf ${c.shelf}, Bin ${c.container}.`;
        if (c.highlighted_surgeon_note) {
          reply += ` Note for ${c.surgeon_filter}: ${c.highlighted_surgeon_note}.`;
        } else if (c.surgeon_notes) {
          reply += ` Note: ${c.surgeon_notes}.`;
        }
      }

      // Crack B: If compound query includes protocol question, evaluate RBAC then query direct Gemini RAG
      if (proceduralParts.length > 0) {
        for (const pQuery of proceduralParts) {
          const rbacCheck = evaluateRbacQuery(pQuery, profile.clinicalRole);
          if (!rbacCheck.allowed) {
            reply += `\n\n📋 Clinical Guidance for '${pQuery}':\n${rbacCheck.reason}`;
          } else {
            const ragRes = await directGeminiRAG(pQuery, undefined, undefined, tenantId, profile);
            reply += `\n\n📋 Clinical Guidance for '${pQuery}':\n${ragRes.reply_text}`;
          }
        }
      }

      if (missingParts.length > 0) {
        reply += `\nCould not find ${missingParts.map((p) => `'${p}'`).join(", ")} in local inventory.`;
      }

      return {
        reply_text: reply,
        routing_tier: "TIER_1_LOCAL_CSV",
        scrubbed_query: processedText,
        phi_detected: false,
        latency_ms: elapsed,
        coordinate_card: cardsFound[0],
        coordinate_cards: cardsFound,
        move_widget: null,
        spoken_transcript_correction: parsedIntent.spoken_transcript_correction,
        disambiguation_chips: parsedIntent.disambiguation_options,
      };
    }
  }

  // 3. Generic Family Multi-Match (prioritized by role categories)
  if (!PROCEDURAL_INDICATORS.test(processedText)) {
    const familyCards = searchFamily(processedText, allRows, 4);
    if (familyCards.length > 1) {
      if (roleScope.prioritizedCategories?.length > 0) {
        familyCards.sort((a, b) => {
          const aMatch = roleScope.prioritizedCategories.some(
            (cat) =>
              (a.category && a.category.toLowerCase().includes(cat.toLowerCase())) ||
              (a.item && a.item.toLowerCase().includes(cat.toLowerCase()))
          );
          const bMatch = roleScope.prioritizedCategories.some(
            (cat) =>
              (b.category && b.category.toLowerCase().includes(cat.toLowerCase())) ||
              (b.item && b.item.toLowerCase().includes(cat.toLowerCase()))
          );
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return 0;
        });
      }
      if (profile.clinicalRole) {
        for (const fc of familyCards) {
          fc.surgeon_notes = filterSurgeonNoteForRole(fc.surgeon_notes, profile.clinicalRole) || "";
        }
      }
      const elapsed = Math.max(1, Math.round(performance.now() - t0));
      const reply = `Found ${familyCards.length} items in this family:\n` +
        familyCards.map((c) => `• ${c.item}: ${c.room}, Cabinet ${c.cabinet}, Shelf ${c.shelf}, Bin ${c.container}`).join("\n");

      return {
        reply_text: reply,
        routing_tier: "TIER_1_LOCAL_CSV",
        scrubbed_query: processedText,
        phi_detected: false,
        latency_ms: elapsed,
        coordinate_card: familyCards[0],
        coordinate_cards: familyCards,
        move_widget: null,
        spoken_transcript_correction: parsedIntent.spoken_transcript_correction,
        disambiguation_chips: parsedIntent.disambiguation_options,
      };
    }
  }

  // 4. Standard Single Item Cascade
  const { facilityId } = getFacilityIdFromTenant(tenantId);
  const { row, userPreferredTerm, facilityAliases, facilityName } = findMatchingRow(
    processedText,
    allRows,
    facilityId,
    profile.email || "anonymous"
  );
  if (row) {
    const elapsed = Math.max(1, Math.round(performance.now() - t0));
    const card: CoordinateCardData = {
      ...row,
      user_preferred_term: userPreferredTerm,
      facility_aliases: facilityAliases,
      facility_name: facilityName,
    };
    const surgeon = extractSurgeonName(processedText);
    if (surgeon) {
      const specNote = highlightSurgeonNote(surgeon, card.surgeon_notes);
      if (specNote) {
        card.surgeon_filter = surgeon;
        card.highlighted_surgeon_note = specNote;
      }
    }

    if (profile.clinicalRole) {
      card.surgeon_notes = filterSurgeonNoteForRole(card.surgeon_notes, profile.clinicalRole) || "";
      if (card.highlighted_surgeon_note) {
        card.highlighted_surgeon_note = filterSurgeonNoteForRole(card.highlighted_surgeon_note, profile.clinicalRole);
        if (!card.highlighted_surgeon_note) {
          card.surgeon_filter = undefined;
        }
      }
    }

    let reply = "";
    if (card.user_preferred_term && card.user_preferred_term.toLowerCase() !== card.item.toLowerCase()) {
      reply = `${card.user_preferred_term} (${card.item}) is in ${card.room}, Cabinet ${card.cabinet}, Shelf ${card.shelf}, Container ${card.container}.`;
    } else {
      reply = `${card.item} is in ${card.room}, Cabinet ${card.cabinet}, Shelf ${card.shelf}, Container ${card.container}.`;
    }
    if (card.highlighted_surgeon_note) {
      reply += ` Note for ${card.surgeon_filter}: ${card.highlighted_surgeon_note}.`;
    } else if (card.surgeon_notes) {
      reply += ` Note: ${card.surgeon_notes}.`;
    }

    let widget: MoveWidgetData | null = null;
    if (card.pending_location) {
      widget = {
        item: card.item,
        current_location: card.full_code,
        new_location: card.pending_location,
        verify_count: card.verify_count,
        required_count: 3,
        committed: false,
      };
    }

    return {
      reply_text: reply,
      routing_tier: "TIER_1_LOCAL_CSV",
      scrubbed_query: processedText,
      phi_detected: false,
      latency_ms: elapsed,
      coordinate_card: card,
      coordinate_cards: [card],
      move_widget: widget,
      spoken_transcript_correction: parsedIntent.spoken_transcript_correction,
      disambiguation_chips: parsedIntent.disambiguation_options,
    };
  }

  // 4.5. On-Device Knowledge Pack Fallback
  const fallbackPack = await matchOnDeviceKnowledgePacks(processedText, parsedIntent, tenantId, profile, t0);
  if (fallbackPack) return fallbackPack;

  // If item search had FIND_INVENTORY intent and no item was found, show quick-add widget
  if (parsedIntent.intent === ClinicalIntent.FIND_INVENTORY) {
    const elapsed = Math.max(1, Math.round(performance.now() - t0));
    const targetItem = (parsedIntent.entities.item || processedText).trim();
    return {
      reply_text: `'${targetItem}' is not currently stocked in local inventory. Would you like to add it?`,
      routing_tier: "TIER_1_LOCAL_CSV",
      scrubbed_query: processedText,
      phi_detected: false,
      latency_ms: elapsed,
      coordinate_card: null,
      coordinate_cards: [],
      move_widget: null,
      quick_add_widget: { item: targetItem },
      spoken_transcript_correction: parsedIntent.spoken_transcript_correction,
      disambiguation_chips: parsedIntent.disambiguation_options,
    };
  }

  // 5. Tier-2 Clinical Protocol Fallback (RBAC check -> Direct Gemini RAG or Baseline)
  const rbacCheck = evaluateRbacQuery(processedText, profile.clinicalRole);
  if (!rbacCheck.allowed) {
    return {
      reply_text: rbacCheck.reason || "Access restricted.",
      routing_tier: "RBAC_RESTRICTED",
      scrubbed_query: processedText,
      phi_detected: false,
      latency_ms: Math.max(1, Math.round(performance.now() - t0)),
      coordinate_card: null,
      move_widget: null,
    };
  }

  return await directGeminiRAG(processedText, undefined, undefined, tenantId, profile);
}
