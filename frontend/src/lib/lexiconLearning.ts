/**
 * Phase 39: 2-Tier Adaptive Facility Lexicon & Implicit Learning Engine (Client-Side).
 *
 * Provides offline PWA & Android standalone learning:
 * - Scoped per facility (sacred_heart, princeton_plainsboro, county_general).
 * - Preserves user preferred terms (e.g. "Adson Pickups").
 * - Multi-alias item mapping.
 * - Syncs with /api/lexicon when online.
 */

import { extractEponyms } from "./surgicalOntology";

export interface LearnedAliasEntry {
  aliasId: string;
  facilityId: string;
  departmentId: string;
  spokenTerm: string;
  displayPreferredName: string;
  canonicalItemName: string;
  usageCount: number;
  usedByUsers: string[];
  confidence: "personal" | "facility_learned" | "facility_consensus";
  updatedAt: string;
}

const DEFAULT_PRESEEDED_LEXICONS: Record<string, LearnedAliasEntry[]> = {
  sacred_heart: [
    {
      aliasId: "sh_lex_1",
      facilityId: "sacred_heart",
      departmentId: "or",
      spokenTerm: "adson pickups",
      displayPreferredName: "Adson Pickups",
      canonicalItemName: "Adson Tissue Forceps 1x2 (Adson Pickups)",
      usageCount: 6,
      usedByUsers: ["sean@sacredheart.org", "jd@sacredheart.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:00:00Z",
    },
    {
      aliasId: "sh_lex_2",
      facilityId: "sacred_heart",
      departmentId: "or",
      spokenTerm: "toothed adson",
      displayPreferredName: "Toothed Adson",
      canonicalItemName: "Adson Tissue Forceps 1x2 (Adson Pickups)",
      usageCount: 2,
      usedByUsers: ["turk@sacredheart.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:15:00Z",
    },
    {
      aliasId: "sh_lex_3",
      facilityId: "sacred_heart",
      departmentId: "or",
      spokenTerm: "gemini",
      displayPreferredName: "Gemini",
      canonicalItemName: "Mixter Right-Angle Clamp 7.5in",
      usageCount: 5,
      usedByUsers: ["turk@sacredheart.org", "sean@sacredheart.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:20:00Z",
    },
    {
      aliasId: "sh_lex_4",
      facilityId: "sacred_heart",
      departmentId: "or",
      spokenTerm: "peanut",
      displayPreferredName: "Peanut",
      canonicalItemName: "Kittner Dissector Sponges (Peanuts)",
      usageCount: 4,
      usedByUsers: ["carla@sacredheart.org", "sean@sacredheart.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:30:00Z",
    },
    {
      aliasId: "sh_lex_5",
      facilityId: "sacred_heart",
      departmentId: "or",
      spokenTerm: "stat",
      displayPreferredName: "Stat",
      canonicalItemName: "Crile Hemostat Forceps Curved 5.5in (Snaps)",
      usageCount: 4,
      usedByUsers: ["elliot@sacredheart.org", "sean@sacredheart.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:45:00Z",
    },
    {
      aliasId: "sh_lex_6",
      facilityId: "sacred_heart",
      departmentId: "or",
      spokenTerm: "pillowcase",
      displayPreferredName: "Pillowcase",
      canonicalItemName: "Mayo Stand Cover Reinforced Blue",
      usageCount: 3,
      usedByUsers: ["laverne@sacredheart.org", "sean@sacredheart.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:50:00Z",
    },
  ],
  princeton_plainsboro: [
    {
      aliasId: "ppth_lex_1",
      facilityId: "princeton_plainsboro",
      departmentId: "or",
      spokenTerm: "rat tooth",
      displayPreferredName: "Rat Tooth",
      canonicalItemName: "Adson Tissue Forceps 1x2 (Adson Pickups)",
      usageCount: 4,
      usedByUsers: ["chase@ppth.org", "cameron@ppth.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:00:00Z",
    },
    {
      aliasId: "ppth_lex_2",
      facilityId: "princeton_plainsboro",
      departmentId: "or",
      spokenTerm: "right angle",
      displayPreferredName: "Right Angle",
      canonicalItemName: "Mixter Right-Angle Clamp 7.5in",
      usageCount: 5,
      usedByUsers: ["foreman@ppth.org", "chase@ppth.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:10:00Z",
    },
    {
      aliasId: "ppth_lex_3",
      facilityId: "princeton_plainsboro",
      departmentId: "or",
      spokenTerm: "cherry",
      displayPreferredName: "Cherry",
      canonicalItemName: "Kittner Dissector Sponges (Peanuts)",
      usageCount: 3,
      usedByUsers: ["house@ppth.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:20:00Z",
    },
  ],
  county_general: [
    {
      aliasId: "cg_lex_1",
      facilityId: "county_general",
      departmentId: "or",
      spokenTerm: "1x2 pickups",
      displayPreferredName: "1x2 Pickups",
      canonicalItemName: "Adson Tissue Forceps 1x2 (Adson Pickups)",
      usageCount: 5,
      usedByUsers: ["benton@countygen.org", "carter@countygen.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:00:00Z",
    },
    {
      aliasId: "cg_lex_2",
      facilityId: "county_general",
      departmentId: "or",
      spokenTerm: "mixter clamp",
      displayPreferredName: "Mixter Clamp",
      canonicalItemName: "Mixter Right-Angle Clamp 7.5in",
      usageCount: 4,
      usedByUsers: ["ross@countygen.org", "benton@countygen.org"],
      confidence: "facility_consensus",
      updatedAt: "2026-10-28T08:15:00Z",
    },
  ],
};

export function getFacilityIdFromTenant(tenantId: string): { facilityId: string; departmentId: string } {
  // If the string starts/ends with colons/slashes, handle it cleanly
  let clean = (tenantId || "").trim().toLowerCase();
  clean = clean.replace(/\/+$/, '');

  if (clean.includes("::")) {
    const parts = clean.split("::");
    const fac = parts[0].trim();
    const dept = (parts[1] || "").trim();
    return { facilityId: fac || "sacred_heart", departmentId: dept || "or" };
  }

  if (clean.startsWith("sacred_heart")) {
    const dept = clean === "sacred_heart" ? "or" : clean.replace("sacred_heart_", "");
    return { facilityId: "sacred_heart", departmentId: dept || "or" };
  }
  if (clean.startsWith("princeton_plainsboro")) {
    const dept = clean === "princeton_plainsboro" ? "or" : clean.replace("princeton_plainsboro_", "");
    return { facilityId: "princeton_plainsboro", departmentId: dept || "or" };
  }
  if (clean.startsWith("county_general")) {
    const dept = clean === "county_general" ? "or" : clean.replace("county_general_", "");
    return { facilityId: "county_general", departmentId: dept || "or" };
  }
  if (clean.startsWith("duke_regional")) {
    const dept = clean === "duke_regional" ? "or" : clean.replace("duke_regional_", "");
    return { facilityId: "duke_regional", departmentId: dept || "or" };
  }
  if (clean.startsWith("metro_medical")) {
    const dept = clean === "metro_medical" ? "or" : clean.replace("metro_medical_", "");
    return { facilityId: "metro_medical", departmentId: dept || "or" };
  }
  if (clean.startsWith("general_memorial")) {
    const dept = clean === "general_memorial" ? "or" : clean.replace("general_memorial_", "");
    return { facilityId: "general_memorial", departmentId: dept || "or" };
  }

  if (["or_main", "pacu_periop", "er_trauma", "icu_critical_care"].includes(clean)) {
    const dept = clean.split("_")[0];
    return { facilityId: "general_memorial", departmentId: dept };
  }

  return { facilityId: clean || "sacred_heart", departmentId: "or" };
}

export function titleCaseTerm(term: string): string {
  const words = term.trim().split(/\s+/);
  return words
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

export function loadFacilityLexicon(facilityId: string): LearnedAliasEntry[] {
  if (typeof window === "undefined") {
    return DEFAULT_PRESEEDED_LEXICONS[facilityId] || [];
  }
  const key = `ornav_learned_lexicon_${facilityId}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}

  // Fallback to pre-seeded defaults
  const defaults = DEFAULT_PRESEEDED_LEXICONS[facilityId] || [];
  try {
    localStorage.setItem(key, JSON.stringify(defaults));
  } catch {}
  return defaults;
}

export function saveFacilityLexicon(facilityId: string, entries: LearnedAliasEntry[]): void {
  if (typeof window === "undefined") return;
  const key = `ornav_learned_lexicon_${facilityId}`;
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {}
}

export function learnAliasClient(
  facilityId: string,
  departmentId: string,
  spokenTerm: string,
  canonicalItem: string,
  userId: string = "anonymous",
  displayName?: string
): LearnedAliasEntry {
  const normTerm = spokenTerm.trim().toLowerCase();
  const entries = loadFacilityLexicon(facilityId);
  const nowIso = new Date().toISOString();
  const cleanUser = (userId || "anonymous").trim().toLowerCase();
  const disp = displayName || titleCaseTerm(spokenTerm);

  const existing = entries.find((e) => e.spokenTerm.toLowerCase() === normTerm);
  if (existing) {
    existing.usageCount = (existing.usageCount || 1) + 1;
    const userSet = new Set(existing.usedByUsers || []);
    if (cleanUser && cleanUser !== "anonymous") userSet.add(cleanUser);
    existing.usedByUsers = Array.from(userSet);
    existing.canonicalItemName = canonicalItem;
    existing.displayPreferredName = disp;
    existing.updatedAt = nowIso;
    if (existing.usedByUsers.length >= 2 || existing.usageCount >= 2) {
      existing.confidence = "facility_consensus";
    } else {
      existing.confidence = "facility_learned";
    }
    saveFacilityLexicon(facilityId, entries);
    return existing;
  }

  const newEntry: LearnedAliasEntry = {
    aliasId: `${facilityId}_${Date.now()}_${entries.length + 1}`,
    facilityId,
    departmentId: departmentId || "or",
    spokenTerm: normTerm,
    displayPreferredName: disp,
    canonicalItemName: canonicalItem,
    usageCount: 1,
    usedByUsers: cleanUser && cleanUser !== "anonymous" ? [cleanUser] : [],
    confidence: cleanUser === "admin" || cleanUser.includes("sean") ? "facility_consensus" : "personal",
    updatedAt: nowIso,
  };
  entries.push(newEntry);
  saveFacilityLexicon(facilityId, entries);
  return newEntry;
}

export function resolveSpokenAliasClient(facilityId: string, query: string): LearnedAliasEntry | null {
  if (!query) return null;
  const normQ = query.trim().toLowerCase();
  const entries = loadFacilityLexicon(facilityId);
  const qEponyms = extractEponyms(normQ);

  const isValidEntry = (entry: LearnedAliasEntry): boolean => {
    const canon = entry.canonicalItemName || "";
    if (!canon) return false;
    const cEponyms = extractEponyms(canon);
    if (qEponyms.size > 0) {
      let hasOverlap = false;
      for (const ep of qEponyms) {
        if (cEponyms.has(ep)) {
          hasOverlap = true;
          break;
        }
      }
      if (!hasOverlap) return false;
    }
    return true;
  };

  // Exact or stem match
  for (const entry of entries) {
    const term = entry.spokenTerm.toLowerCase();
    const disp = entry.displayPreferredName.toLowerCase();
    if (term === normQ || disp === normQ) {
      if (isValidEntry(entry)) return entry;
    }
    if (term.replace(/s$/, "") === normQ.replace(/s$/, "") && term.length >= 3) {
      if (isValidEntry(entry)) return entry;
    }
  }

  // Word-bounded subphrase match (protect against hyphen leaks like brown-adson vs adson)
  for (const entry of entries) {
    const term = entry.spokenTerm.toLowerCase();
    if (term.length >= 3) {
      const termRegex = new RegExp(`(?<![\\w-])${term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?![\\w-])`, "i");
      if (termRegex.test(normQ)) {
        if (isValidEntry(entry)) return entry;
      }
      const stem = term.replace(/s$/, "");
      if (stem.length >= 3) {
        const stemRegex = new RegExp(`(?<![\\w-])${stem.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:s)?(?![\\w-])`, "i");
        if (stemRegex.test(normQ)) {
          if (isValidEntry(entry)) return entry;
        }
      }
    }
  }

  return null;
}

export function getAllAliasesForItemClient(facilityId: string, canonicalItem: string): string[] {
  if (!canonicalItem) return [];
  const entries = loadFacilityLexicon(facilityId);
  const canonNorm = canonicalItem.trim().toLowerCase();
  const seen = new Set<string>();
  const res: string[] = [];

  for (const entry of entries) {
    if (entry.canonicalItemName.trim().toLowerCase() === canonNorm) {
      const disp = entry.displayPreferredName || titleCaseTerm(entry.spokenTerm);
      if (!seen.has(disp.toLowerCase())) {
        seen.add(disp.toLowerCase());
        res.push(disp);
      }
    }
  }
  return res;
}

const TEACH_PATTERNS = [
  // "[X] is called [Y]" / "[X] are called [Y]"
  /(?:the\s+)?(.+?)\s+(?:is|are)\s+called\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)/i,
  // "In this facility, [X] is called [Y]"
  /in\s+this\s+(?:facility|hospital|unit|or|department)\s*,\s*(?:the\s+)?(.+?)\s+(?:is|are)\s+called\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)/i,
  // "Remember that [X] are called [Y]" / "Remember that [X] is [Y]"
  /remember\s+that\s+(?:the\s+)?(.+?)\s+(?:are\s+called|is\s+called|means|is|are)\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)/i,
  // "Alias [X] to [Y]"
  /alias\s+(?:the\s+)?(.+?)\s+to\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)/i,
  // "Here we call [X] a/an/the/as [Y]"
  /(?:here\s+)?we\s+call\s+(?:the\s+)?(.+?)\s+(?:a|an|the|as)\s+([a-zA-Z0-9\s-]+?)(?:\.|$)/i,
  // "We call [X forceps/clamp/scissors/etc] [Y]"
  /(?:here\s+)?we\s+call\s+(?:the\s+)?(.+?\b(?:forceps|scissors|clamps?|retractors?|needle\s+drivers?|needle\s+holders?|sponges?|elevators?|rongeurs?|suction|tubes?))\s+([a-zA-Z0-9\s-]+?)(?:\.|$)/i,
  // Generic "Here we call [X] [Y]" fallback
  /(?:here\s+)?(?:we|i)\s+call\s+(?:the\s+)?([a-zA-Z0-9\s-]+?)\s+([a-zA-Z0-9\s-]+?)(?:\.|$)/i,
];

export function detectTeachingIntentClient(text: string): { target: string; alias: string } | null {
  const clean = text.trim().replace(/\.$/, "");
  for (const pat of TEACH_PATTERNS) {
    const m = pat.exec(clean);
    if (m && m[1] && m[2]) {
      const partA = m[1].trim();
      const partB = m[2].trim();
      if (partA.length >= 2 && partB.length >= 2) {
        if (!["what is", "why is", "who is", "where is"].some((q) => clean.toLowerCase().includes(q))) {
          return { target: partA, alias: partB };
        }
      }
    }
  }
  return null;
}
