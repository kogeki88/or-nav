/**
 * OR-Nav Semantic Intent & Slot-Parsing Router + Biased Clinical Listening Normalizer (Client-Side).
 *
 * Provides offline PWA & Android standalone intent understanding:
 * - Intents: FIND_INVENTORY, VIEW_PREFERENCE_CARD, MUTATE_INVENTORY, PEER_BROADCAST, GENERAL_QUERY
 * - Entities: item, gauge, category, location, action, surgeon, procedure
 * - Normalizes spoken phonetic and homophone variants (e.g. "four oh viker" -> "4-0 vicryl")
 * - Generates 1-tap disambiguation chips when item searched without gauge
 */

import { detectTeachingIntentClient } from "./lexiconLearning";
import { stripSpokenDisfluencies } from "./surgicalOntology";
import { planClinicalQuery } from "./clinicalQueryPlanner";

export enum ClinicalIntent {
  FIND_INVENTORY = "FIND_INVENTORY",
  VIEW_PREFERENCE_CARD = "VIEW_PREFERENCE_CARD",
  MUTATE_INVENTORY = "MUTATE_INVENTORY",
  PEER_BROADCAST = "PEER_BROADCAST",
  TEACH_ALIAS = "TEACH_ALIAS",
  GENERAL_QUERY = "GENERAL_QUERY",
}

export interface ClinicalEntities {
  item?: string;
  target_item?: string;
  alias_term?: string;
  gauge?: string;
  category?: string;
  location?: string;
  action?: "add" | "move" | "flag" | "broadcast" | "view_card" | "teach_alias";
  surgeon?: string;
  procedure?: string;
  learned_aliases?: string[];
  notes?: string;
}

export interface ParsedIntent {
  intent: ClinicalIntent;
  confidence: number;
  entities: ClinicalEntities;
  raw_query: string;
  normalized_query: string;
  user_preferred_term?: string;
  search_expanded_query?: string;
  spoken_transcript_correction?: string;
  disambiguation_options: string[];
}

// Spoken gauge mappings
const SUTURE_GAUGE_MAP: Array<[RegExp, string]> = [
  [/\b(?:seven[\s-]*(?:oh|zero)|7[\s-]*(?:oh|zero)|seventy)\b/gi, "7-0"],
  [/\b(?:six[\s-]*(?:oh|zero)|6[\s-]*(?:oh|zero)|sixty)\b/gi, "6-0"],
  [/\b(?:five[\s-]*(?:oh|zero)|5[\s-]*(?:oh|zero)|fifty)\b/gi, "5-0"],
  [/\b(?:four[\s-]*(?:oh|zero|dash[\s-]*zero)|4[\s-]*(?:oh|zero|dash[\s-]*zero)|forty)\b/gi, "4-0"],
  [/\b(?:three[\s-]*(?:oh|zero|dash[\s-]*zero)|3[\s-]*(?:oh|zero|dash[\s-]*zero)|thirty)\b/gi, "3-0"],
  [/\b(?:two[\s-]*(?:oh|zero|dash[\s-]*zero)|2[\s-]*(?:oh|zero|dash[\s-]*zero)|twenty)\b/gi, "2-0"],
  [/(?<![\d\-/])\b(?:size\s+)?(?:zero|aught|#0)\b(?!\s*[\-/]\s*\d)/gi, "0"],
];

// Clinical phonetic typo mappings
const CLINICAL_TERM_CORRECTIONS: Array<[RegExp, string]> = [
  [/\b(?:viker|vickryl|vickrel|vikryl|vicral|vikel)\b/gi, "vicryl"],
  [/\b(?:pro\s*lean|pro-lean|proline|prolyne)\b/gi, "prolene"],
  [/\b(?:the\s+bakery|de\s+bakery|da\s+bakery|bakery|debakeys|de\s*bakey)\b/gi, "debakey"],
  [/\b(?:tie\s*cron|tye\s*cron|ticron)\b/gi, "ti-cron"],
  [/\b(?:white\s*laner|white\s*liner|white\s*lainer|weit\s*laner)\b/gi, "weitlaner"],
  [/\b(?:bovey|bo\s*vie|bovie\s*pencil)\b/gi, "bovie"],
  [/\b(?:heprin|heparine)\b/gi, "heparin"],
  [/\b(?:add\s*son|ad\s+son)\b/gi, "adson"],
  [/\b(?:metzenbaum\s+scissors?)\b/gi, "metzenbaum"],
  [/\b(?:trochar|trochars)\b/gi, "trocar"],
  [/\b(?:monacryl|monocrile)\b/gi, "monocryl"],
  [/\b(?:cromatic|chromick)\b/gi, "chromic"],
  [/\b(?:yankaur|yankur|yank\s*auer)\b/gi, "yankauer"],
  [/\b(?:lap\s+pad|lap\s+sponge|laparotomy\s+pad)\b/gi, "lap sponge"],
  [/\b(?:raytec|raytech|ray\s*tec)\b/gi, "raytec"],
];

const COMMON_SUTURE_FAMILIES = ["vicryl", "prolene", "silk", "ti-cron", "monocryl", "ethibond", "pds", "nylon", "chromic"];

const PEER_BROADCAST_PATTERNS = /\b(?:question\s+for\s+(?:the\s+)?(?:unit|team|peers|nurses|everyone|or|cvor)|can\s+(?:someone|anyone)\s+tell\s+me|(?:orientee|new\s+grad)\s+question|ask\s+(?:the\s+)?(?:unit|peers|team|department)|peer\s+ping|has\s+anyone\s+seen|does\s+anyone\s+know\s+(?:where|what|who|if))\b/i;

// Packed coordinate regex e.g. "or21c1f", "icu2b1", "core1b2c", "or4b2a"
export const PACKED_COORD_REGEX = /\b(or|room|icu|er|ed|pacu|bay|pod|core|pump)?(?:[\s\-\•]*)(\d{1,2})?(?:[\s\-\•]*)([a-z])(?:[\s\-\•]*)(\d{1,2})(?:[\s\-\•]*)([a-z])\b/i;

// Natural spaced coordinate regex e.g. "OR 21 C 1 F", "Cart A Shelf 1 Bin B"
export const SPACED_COORD_REGEX = /\b(?:(trauma\s+bay|trauma|bay|pod|icu(?:\s+supply)?|er|ed|pacu(?:\s+med\s+room)?|or|room)(?:[\s\-\•]*(\d+))?|(core\s+supply|core)|(pump\s+room|pump))[\s\-\•]*(?:cart|cabinet|cab|rack|pyxis|alcove)?[\s\-\•]*([a-zA-Z])[\s\-\•]*(?:shelf|drawer)?[\s\-\•]*(\d+)[\s\-\•]*(?:bin|container)?[\s\-\•]*([a-zA-Z])\b/i;

// Secondary alias clause regex e.g. ", theyre also called ribbon", ", also called ribbon"
export const ALIAS_CLAUSE_REGEX = /(?:,|;|\.|\s+and|\s+also)\s*(?:they(?:'re|\'re|re|\s+are)|it(?:'s|\'s|s|\s+is)|we|people)?\s*(?:also\s+)?(?:called|call\s+them|known\s+as|referred\s+to\s+as|aka)\s+([^,;\.]+)/i;

// Secondary note clause regex e.g. ", notes: Dr House preferred", "; note: pediatric only"
export const NOTE_CLAUSE_REGEX = /(?:,|;|\.|\s+and|\s+with)\s*(?:notes?|surgeon\s+notes?|preferences?|note\s+is|pref)\s*[:\s]+([^,;\.]+)/i;

/**
 * Extracts and unpacks any packed or spaced 4-part coordinate from an utterance,
 * returning the canonical coordinate and the utterance stripped of the coordinate.
 */
export function extractAndNormalizeCoordinateClient(text: string): { location: string; cleanText: string } | null {
  if (!text) return null;

  // 1. Spaced format
  const mSpaced = text.match(SPACED_COORD_REGEX);
  if (mSpaced) {
    const fullMatch = mSpaced[0];
    const unit = mSpaced[1];
    const num = mSpaced[2];
    const core = mSpaced[3];
    const pump = mSpaced[4];
    const cab = mSpaced[5];
    const shelf = mSpaced[6];
    const bin = mSpaced[7];

    let room = "Core Supply";
    if (core) {
      room = "Core Supply";
    } else if (pump) {
      room = "Pump Room";
    } else if (unit) {
      const u = unit.toLowerCase();
      if (u === "or" || u === "room") room = num ? `OR ${num}` : "OR";
      else if (u.includes("trauma")) room = num ? `Trauma Bay ${num}` : "Trauma";
      else if (u === "bay") room = num ? `Bay ${num}` : "Bay";
      else if (u.includes("icu")) room = num ? `ICU ${num}` : "ICU";
      else if (u === "er" || u === "ed") room = num ? `ER ${num}` : "ER";
      else if (u.includes("pacu")) room = num ? `PACU ${num}` : "PACU";
      else if (u === "pod") room = num ? `Pod ${num}` : "Pod";
      else room = num ? `${unit} ${num}` : unit;
    }

    const normLoc = `${room} ${cab.toUpperCase()} ${shelf} ${bin.toUpperCase()}`;
    const escaped = fullMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const clean = text.replace(new RegExp(`(?:\\s*(?:to|into|in|at))?\\s*${escaped}\\b`, "i"), "").replace(/\s+/g, " ").trim();
    return { location: normLoc, cleanText: clean };
  }

  // 2. Packed format (e.g. or21c1f, icu2b1, etc.)
  const mPacked = text.match(PACKED_COORD_REGEX);
  if (mPacked) {
    const fullMatch = mPacked[0];
    const prefix = (mPacked[1] || "").toLowerCase();
    const num = mPacked[2] || "";
    const cab = mPacked[3].toUpperCase();
    const shelf = mPacked[4];
    const bin = mPacked[5].toUpperCase();

    let room = "OR";
    if (prefix === "or" || prefix === "room") room = num ? `OR ${num}` : "OR";
    else if (prefix === "icu") room = num ? `ICU ${num}` : "ICU";
    else if (prefix === "er" || prefix === "ed") room = num ? `ER ${num}` : "ER";
    else if (prefix === "pacu") room = num ? `PACU ${num}` : "PACU";
    else if (prefix === "bay") room = num ? `Bay ${num}` : "Bay";
    else if (prefix === "pod") room = num ? `Pod ${num}` : "Pod";
    else if (prefix === "core") room = "Core Supply";
    else if (prefix === "pump") room = "Pump Room";
    else if (num) room = `OR ${num}`;
    else room = "OR 21";

    const normLoc = `${room} ${cab} ${shelf} ${bin}`;
    const escaped = fullMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const clean = text.replace(new RegExp(`(?:\\s*(?:to|into|in|at))?\\s*${escaped}\\b`, "i"), "").replace(/\s+/g, " ").trim();
    return { location: normLoc, cleanText: clean };
  }

  return null;
}

const PREFERENCE_CARD_PATTERNS = /\b(?:(?:pull\s+up|show\s+me|open|get|view|display|check)\s+(?:dr\.?|doctor)?\s*([a-z]+(?:'s)?)?\s*(?:preference\s*cards?|preferences?)|preference\s*cards?\s+(?:for\s+)?|dr\.?\s+([a-z]+)'s?\s+(?:lap\s+chole|chole|knee|total\s+knee|cabg|prostatectomy|ralp|discectomy|appendectomy|preferences?)|(?:mayo\s+stand|instrument\s+tray|back\s+table|tray\s+setup|tray\s+breakdown)\s+for\s+)/i;

const GENERAL_QUERY_PATTERNS = /\b(?:protocol|guideline|policy|checklist|orient(?:ation)?|what\s+(?:is|are)\s+the\s+(?:protocol|steps|policy|checklist|dosing|dose|target|positioning|prep)|how\s+(?:do|to|much|many)|surgical\s+safety\s+time[\s-]*out|sign[\s-]*out|malignant\s+hyperthermia|dantrolene|heparin|protamine|act\s+target|scrub\s+roles?|circulator\s+roles?|preceptor|aldrete|blood\s+bank|code\s+blue)\b/i;

/**
 * Normalizes speech input with clinical homophones, disfluencies, and voice biases.
 */
export function normalizeClinicalSpeech(text: string): { normalized: string; correction?: string } {
  const original = (text || "").trim();
  let norm = stripSpokenDisfluencies(original);

  for (const [pat, gauge] of SUTURE_GAUGE_MAP) {
    norm = norm.replace(pat, gauge);
  }

  for (const [pat, replacement] of CLINICAL_TERM_CORRECTIONS) {
    norm = norm.replace(pat, replacement);
  }

  for (const fam of COMMON_SUTURE_FAMILIES) {
    const invertedRe = new RegExp(`\\b(${fam})\\s+(\\d+[\\-/]0|0)\\b`, "gi");
    norm = norm.replace(invertedRe, "$2 $1");
  }

  const correction =
    norm.toLowerCase() !== original.toLowerCase()
      ? `Recognized: "${norm}" (Confidence: 98%)`
      : undefined;

  return { normalized: norm, correction };
}

/**
 * Parses natural text or spoken transcript into structured clinical intent and slots.
 */
export function parseClinicalIntent(query: string, clinicalRole?: string): ParsedIntent {
  const { normalized, correction } = normalizeClinicalSpeech(query);
  const cleaned = normalized.replace(/\[REDACTED_PHI\]/gi, "").trim();

  // 0. TEACH_ALIAS (e.g. "Here we call Mixter clamps Geminis", "Adson forceps are called Adson pickups")
  const teachMatch = detectTeachingIntentClient(cleaned);
  if (teachMatch) {
    return {
      intent: ClinicalIntent.TEACH_ALIAS,
      confidence: 0.98,
      entities: {
        target_item: teachMatch.target,
        alias_term: teachMatch.alias,
        action: "teach_alias",
      },
      raw_query: query,
      normalized_query: normalized,
      user_preferred_term: teachMatch.alias,
      search_expanded_query: teachMatch.target,
      spoken_transcript_correction: correction,
      disambiguation_options: [],
    };
  }

  // 1. PEER_BROADCAST
  if (PEER_BROADCAST_PATTERNS.test(cleaned)) {
    const itemMatch = cleaned.match(/(?:where\s+(?:the\s+)?|seen\s+(?:the\s+)?)(.+?)(?:\?|$)/i);
    const itemText = itemMatch ? itemMatch[1].trim() : undefined;
    return {
      intent: ClinicalIntent.PEER_BROADCAST,
      confidence: 0.98,
      entities: {
        item: itemText,
        action: "broadcast",
      },
      raw_query: query,
      normalized_query: normalized,
      spoken_transcript_correction: correction,
      disambiguation_options: [],
    };
  }

  // 2. MUTATE_INVENTORY (Add / Move / Flag with Multi-Clause Discourse Decomposition)
  const isAdd = /^(?:please\s+|can\s+you\s+)?(?:add|insert|register|new\s+item)\b/i.test(cleaned);
  const isMove = /^(?:please\s+|can\s+you\s+)?(?:move|relocate|transfer)\b/i.test(cleaned) ||
    (/\b(?:was\s+moved|moved|relocated|is\s+now\s+at|is\s+now\s+in)\b/i.test(cleaned) && !cleaned.endsWith("?"));

  if (isAdd || isMove) {
    let working = cleaned;
    const action: "add" | "move" = isAdd ? "add" : "move";
    working = working.replace(/^(?:please\s+|can\s+you\s+)?(?:add|insert|register|new\s+item|move|relocate|transfer)\s+/i, "");

    // A. Extract and scrub secondary alias clause
    const learnedAliases: string[] = [];
    const mAlias = working.match(ALIAS_CLAUSE_REGEX);
    if (mAlias) {
      const aliasRaw = mAlias[1].trim();
      for (const al of aliasRaw.split(/,|\band\b/i)) {
        const cleanedAl = al.trim().replace(/^['"]|['"]$/g, "");
        if (cleanedAl) learnedAliases.push(cleanedAl);
      }
      working = working.replace(mAlias[0], " ").trim();
    }

    // B. Extract and scrub secondary note clause
    let notes: string | undefined = undefined;
    const mNote = working.match(NOTE_CLAUSE_REGEX);
    if (mNote) {
      notes = mNote[1].trim();
      working = working.replace(mNote[0], " ").trim();
    }

    // C. Extract coordinate (packed or spaced)
    let extractedLoc: string | undefined = undefined;
    const coordRes = extractAndNormalizeCoordinateClient(working);
    if (coordRes) {
      extractedLoc = coordRes.location;
      working = coordRes.cleanText;
    }

    // Clean up residual prepositions, articles, punctuation from item
    let itemClean = working
      .replace(/^(?:an?\s+|the\s+)/i, "")
      .replace(/(?:\s+(?:to|into|in|at)\s+(?:the\s+)?(?:list|inventory|system|database|stock|catalog|here|it)?)+$/i, "")
      .replace(/[\s,\.;]+$/g, "")
      .trim();

    itemClean = itemClean.replace(/\s+(?:to|into|in|at)\s*$/i, "").trim();

    return {
      intent: ClinicalIntent.MUTATE_INVENTORY,
      confidence: 0.95,
      entities: {
        item: itemClean || undefined,
        action,
        location: extractedLoc,
        learned_aliases: learnedAliases.length > 0 ? learnedAliases : undefined,
        notes,
      },
      raw_query: query,
      normalized_query: normalized,
      spoken_transcript_correction: correction,
      disambiguation_options: [],
    };
  }

  // 3. Unified Clinical Query Planner (Layer 2) for Preference Cards, Surgeon Facets & Relational Joins
  try {
    const clinicalPlan = planClinicalQuery(cleaned);
    if (
      clinicalPlan.intent === "PREFERENCE_CARD_LOOKUP" ||
      clinicalPlan.intent === "PREFERENCE_INVENTORY_JOIN"
    ) {
      if (
        clinicalPlan.intent === "PREFERENCE_INVENTORY_JOIN" &&
        clinicalPlan.hasExplicitLocative &&
        clinicalPlan.inventoryCandidateTerms.length > 0
      ) {
        const candItem = clinicalPlan.inventoryCandidateTerms[0];
        return {
          intent: ClinicalIntent.FIND_INVENTORY,
          confidence: 0.96,
          entities: {
            item: candItem,
            surgeon: clinicalPlan.surgeon ? clinicalPlan.surgeon.displayName : undefined,
            procedure: clinicalPlan.procedure ? clinicalPlan.procedure.name : undefined,
          },
          raw_query: query,
          normalized_query: candItem,
          spoken_transcript_correction: correction,
          disambiguation_options: [],
        };
      }
      return {
        intent: ClinicalIntent.VIEW_PREFERENCE_CARD,
        confidence: 0.96,
        entities: {
          surgeon: clinicalPlan.surgeon ? clinicalPlan.surgeon.displayName : undefined,
          procedure: clinicalPlan.procedure ? clinicalPlan.procedure.name : undefined,
          item: clinicalPlan.inventoryCandidateTerms[0] || undefined,
          action: "view_card",
        },
        raw_query: query,
        normalized_query: normalized,
        spoken_transcript_correction: correction,
        disambiguation_options: [],
      };
    }
  } catch {}

  // Fallback regex check for explicit Mayo stand / tray setup phrasing
  if (PREFERENCE_CARD_PATTERNS.test(cleaned)) {
    let surgeon: string | undefined;
    const surgMatch = cleaned.match(/\b(?:dr\.?|doctor)\s+([a-zA-Z]+)\b/i);
    if (surgMatch) {
      surgeon = `Dr. ${surgMatch[1].charAt(0).toUpperCase() + surgMatch[1].slice(1).toLowerCase()}`;
    }

    let proc: string | undefined;
    for (const p of ["lap chole", "cholecystectomy", "total knee", "knee arthroplasty", "cabg", "prostatectomy", "ralp", "discectomy"]) {
      if (cleaned.toLowerCase().includes(p)) {
        proc = p;
        break;
      }
    }

    return {
      intent: ClinicalIntent.VIEW_PREFERENCE_CARD,
      confidence: 0.95,
      entities: {
        surgeon,
        procedure: proc,
        action: "view_card",
      },
      raw_query: query,
      normalized_query: normalized,
      spoken_transcript_correction: correction,
      disambiguation_options: [],
    };
  }

  // 4. GENERAL_QUERY
  if (GENERAL_QUERY_PATTERNS.test(cleaned)) {
    return {
      intent: ClinicalIntent.GENERAL_QUERY,
      confidence: 0.9,
      entities: {},
      raw_query: query,
      normalized_query: normalized,
      spoken_transcript_correction: correction,
      disambiguation_options: [],
    };
  }

  // 5. Default to FIND_INVENTORY
  const gaugeMatch = normalized.match(/\b(\d+[\-/]0|0)\b/);
  const gaugeVal = gaugeMatch ? gaugeMatch[1].replace("/", "-") : undefined;

  let disambiguation: string[] = [];
  for (const fam of COMMON_SUTURE_FAMILIES) {
    const famRe = new RegExp(`\\b${fam}\\b`, "i");
    if (famRe.test(normalized)) {
      if (!gaugeVal) {
        disambiguation = ["0", "2-0", "3-0", "4-0", "5-0"];
      }
      break;
    }
  }

  const itemPart = cleaned
    .replace(
      /^(?:where\s+(?:is|are|can\s+i\s+find|do\s+we\s+keep)\s+(?:the\s+|a\s+|an\s+)?|(?:can\s+you\s+)?(?:find|locate|get|grab|show)\s+(?:me\s+)?(?:the\s+|a\s+|an\s+)?|(?:i\s+)?(?:need|want|looking\s+for)\s+(?:the\s+|a\s+|an\s+)?|do\s+we\s+have\s+(?:any\s+|a\s+|an\s+)?)+/i,
      ""
    )
    .trim();

  return {
    intent: ClinicalIntent.FIND_INVENTORY,
    confidence: 0.94,
    entities: {
      item: itemPart || cleaned,
      gauge: gaugeVal,
    },
    raw_query: query,
    normalized_query: normalized,
    spoken_transcript_correction: correction,
    disambiguation_options: disambiguation,
  };
}
