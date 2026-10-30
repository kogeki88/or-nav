/**
 * Phase 38: Master Surgical Ontology Engine & Strict Eponym Guard (Client-Side).
 *
 * Eliminates dangerous false positives between surgical instruments:
 * - Maps OR lingo/slang to canonical instruments (pickups -> forceps, metz -> metzenbaum scissors, snaps -> hemostat, etc.).
 * - Eponym Registry: Distinguishes eponymous specifiers (Adson, DeBakey, Gerald, Russian, Metzenbaum, Mayo, etc.).
 * - Generic Class Words: Generic words (forceps, scissors, clamp, retractor) alone cannot trigger matches.
 * - Strict Eponym Guard: If query specifies an eponym, any candidate with a different (or missing) eponym is vetoed (score = 0).
 * - Acoustic/STT Map: Fixes common speech-to-text mishearings ("add son" -> "adson", "the bakey" -> "debakey", etc.).
 */

export const OR_LINGO_EQUIVALENCE: Record<string, string> = {
  pickups: "forceps",
  pickup: "forceps",
  metz: "metzenbaum scissors",
  snaps: "crile hemostat clamp",
  snap: "crile hemostat clamp",
  hemostat: "hemostat clamp",
  peanut: "kittner dissector sponge",
  peanuts: "kittner dissector sponge",
  cherry: "kittner dissector sponge",
  cherries: "kittner dissector sponge",
  raytec: "ray-tec sponge",
  "ray-tec": "ray-tec sponge",
  "ray tec": "ray-tec sponge",
  raytech: "ray-tec sponge",
  ratec: "ray-tec sponge",
  lap: "laparotomy sponge",
  laps: "laparotomy sponge",
  "lap sponge": "laparotomy sponge",
  "lap sponges": "laparotomy sponge",
  cottonoid: "neurosurgical cottonoid patties",
  cottonoids: "neurosurgical cottonoid patties",
  patties: "neurosurgical cottonoid patties",
  patty: "neurosurgical cottonoid patties",
  bovie: "electrosurgical bovie pencil",
  castro: "castroviejo needle holder",
  "right angle": "mixter right-angle clamp",
  "right-angle": "mixter right-angle clamp",
  rightangle: "mixter right-angle clamp",
  tonsil: "schnidt tonsil clamp",
  "tonsil snap": "schnidt tonsil clamp",
  "army navy": "army-navy retractor",
  "army-navy": "army-navy retractor",
  "us army": "army-navy retractor",
  rich: "richardson retractor",
  richardson: "richardson retractor",
  malleable: "malleable ribbon retractor",
  ribbon: "malleable ribbon retractor",
  "cat paw": "senn retractor",
  "cats paw": "senn retractor",
  "cat's paw": "senn retractor",
  bookwalter: "bookwalter retractor",
  omni: "omni-tract retractor",
  "omni tract": "omni-tract retractor",
  omnitract: "omni-tract retractor",
  balfour: "balfour retractor",
  finochietto: "finochietto rib spreader",
  sweetheart: "harrington sweetheart retractor",
  kerrison: "kerrison rongeur",
  leksell: "leksell rongeur",
  pituitary: "pituitary rongeur",
  cobb: "cobb elevator",
  freer: "freer elevator",
  penfield: "penfield dissector",
  yankauer: "yankauer suction",
  frazier: "frazier suction",
  poole: "poole suction",
  "vein retractor": "weitlaner retractor",
  "saphenous retractor": "weitlaner retractor",
};

export const SURGICAL_EPONYMS: Set<string> = new Set([
  // Tissue Forceps / Pickups
  "adson",
  "brown-adson",
  "debakey",
  "gerald",
  "russian",
  "ferris-smith",
  "bonney",
  "potts-smith",
  "cushing",
  "singley",
  // Scissors
  "metzenbaum",
  "mayo",
  "iris",
  "tenotomy",
  "stevens",
  "jorgenson",
  "lister",
  "potts",
  // Clamps & Hemostats
  "mosquito",
  "halsted",
  "crile",
  "kelly",
  "pean",
  "rochester-pean",
  "kocher",
  "ochsner",
  "allis",
  "babcock",
  "mixter",
  "schnidt",
  "heaney",
  "satinsky",
  "cooley",
  "fogarty",
  "bulldog",
  "glover",
  "crafoord",
  "dandy",
  // Needle Holders / Drivers
  "mayo-hegar",
  "crile-wood",
  "ryder",
  "castroviejo",
  "webster",
  "baumgartner",
  "olsen-hegar",
  // Retractors
  "army-navy",
  "senn",
  "richardson",
  "richardson-eastman",
  "deaver",
  "weitlaner",
  "gelpi",
  "bookwalter",
  "omni-tract",
  "balfour",
  "finochietto",
  "harrington",
  "green",
  "beckman",
  "beckman-weitlaner",
  "jansen",
  "mastoid",
  "langenbeck",
  "volkmann",
  "ragnell",
  // Rongeurs, Bone, & Elevators
  "kerrison",
  "leksell",
  "ruskin",
  "stille-luer",
  "pituitary",
  "love-gruenwald",
  "spurling",
  "cobb",
  "freer",
  "penfield",
  "lambotte",
  "brun",
  "key",
  // Sponges, Suctions & Dissectors
  "kittner",
  "ray-tec",
  "yankauer",
  "frazier",
  "poole",
  "barron",
  "andrews-pynchon",
]);

export const GENERIC_INSTRUMENT_CLASSES: Set<string> = new Set([
  "forceps",
  "pickup",
  "pickups",
  "scissor",
  "scissors",
  "clamp",
  "clamps",
  "hemostat",
  "hemostats",
  "snap",
  "snaps",
  "retractor",
  "retractors",
  "needle holder",
  "needle driver",
  "needle-holder",
  "needle-driver",
  "driver",
  "drivers",
  "holder",
  "holders",
  "sponge",
  "sponges",
  "suction",
  "suctions",
  "tube",
  "tubes",
  "tip",
  "tips",
  "wand",
  "wands",
  "rongeur",
  "rongeurs",
  "elevator",
  "elevators",
  "dissector",
  "dissectors",
  "spreader",
  "spreaders",
  "curette",
  "curettes",
  "osteotome",
  "osteotomes",
  "chisel",
  "chisels",
  "punch",
  "punches",
  "hook",
  "hooks",
  "probe",
  "probes",
  "speculum",
  "speculums",
  "cannula",
  "cannulas",
  "wire",
  "wires",
  "knife",
  "blade",
  "blades",
  "saw",
  "saws",
  "drill",
  "drills",
  "instrument",
  "instruments",
  "tray",
  "trays",
]);

export const EPONYM_PHONETIC_STT_MAP: Record<string, string> = {
  "add son": "adson",
  "ad son": "adson",
  "at son": "adson",
  atson: "adson",
  "ad son's": "adson",
  adsons: "adson",
  "the bakey": "debakey",
  "the bake": "debakey",
  "the bake e": "debakey",
  "de bacey": "debakey",
  "dee bakey": "debakey",
  "dee bake e": "debakey",
  debakeys: "debakey",
  bakery: "debakey",
  geralt: "gerald",
  gerold: "gerald",
  "metz in bomb": "metzenbaum",
  "metzen bomb": "metzenbaum",
  "metzen baum": "metzenbaum",
  mets: "metz",
  casting: "castroviejo",
  "castro viejo": "castroviejo",
  "castro vie ho": "castroviejo",
  "carry son": "kerrison",
  "kerr ison": "kerrison",
  lexel: "leksell",
  "lex ell": "leksell",
  "white laner": "weitlaner",
  "white liner": "weitlaner",
  "white lainer": "weitlaner",
  "gel py": "gelpi",
  "gel pee": "gelpi",
  "book walter": "bookwalter",
  "fino ketto": "finochietto",
  "fino chetto": "finochietto",
  "kit ner": "kittner",
  kitner: "kittner",
  kitners: "kittner",
  "ray tec": "ray-tec",
  raytech: "ray-tec",
  ratec: "ray-tec",
  "yank our": "yankauer",
  "yank hour": "yankauer",
  "yank tower": "yankauer",
  frasier: "frazier",
  frazer: "frazier",
  "pool suction": "poole suction",
  "cool ey": "cooley",
  "sat in ski": "satinsky",
  satinski: "satinsky",
  "richard son": "richardson",
  "koch er": "kocher",
  coker: "kocher",
  "cry le": "crile",
  cryle: "crile",
  alliss: "allis",
  "bab cock": "babcock",
  babcok: "babcock",
  bovey: "bovie",
  "bo vie": "bovie",
  heprin: "heparin",
  proline: "prolene",
  "pro lean": "prolene",
  "mono cryl": "monocryl",
  "vye cril": "vicryl",
  "tie cron": "ti-cron",
  ticron: "ti-cron",
};

export const SPOKEN_DISFLUENCIES = [
  "um",
  "umm",
  "ummm",
  "uh",
  "uhh",
  "uhhh",
  "er",
  "erm",
  "ah",
  "ahh",
  "hmm",
  "hm",
  "you know",
  "i mean",
  "let's see",
  "lets see",
  "basically",
  "actually",
  "literally",
];

const DISFLUENCY_REGEX = new RegExp(
  `\\b(?:${SPOKEN_DISFLUENCIES.map((d) => d.replace(/['.]/g, "\\$&")).join("|")})\\b`,
  "gi"
);

const LEADING_FILLERS = /^(?:wait|so|well|okay|ok)\b[\s,]*/i;
const INFIX_LIKE_FILLER = /\b(is|are|have|find|locate|get|grab|bring|see|the|a|an)\s+like\b\s*/gi;

export function stripSpokenDisfluencies(text: string): string {
  if (!text) return "";
  let res = text;
  res = res.replace(DISFLUENCY_REGEX, " ");
  res = res.replace(INFIX_LIKE_FILLER, "$1 ");
  res = res.replace(LEADING_FILLERS, "");
  res = res.replace(/([.?!,;]\s*)(?:wait|so|well|okay|ok)\b[\s,]*/gi, "$1");
  return res.replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set([
  "where", "is", "are", "the", "a", "an", "find", "locate", "need",
  "get", "me", "do", "we", "have", "keep", "stored", "stocked",
  "show", "location", "of", "for", "in", "from", "please", "can",
  "you", "tell", "whats", "what", "give", "bring", "grab", "hand",
  "um", "umm", "ummm", "uh", "uhh", "uhhh", "er", "erm", "ah", "ahh",
  "hmm", "hm", "like", "you know", "i mean", "wait", "let's see", "lets see",
  "so", "well", "basically", "actually", "literally", "okay", "ok",
]);

export function normalizeAcousticSpeech(text: string): string {
  if (!text) return "";
  let res = stripSpokenDisfluencies(text.trim());

  // Apply only acoustic STT phonetic fixes, leaving user lingo intact
  const sttKeys = Object.keys(EPONYM_PHONETIC_STT_MAP).sort((a, b) => b.length - a.length);
  for (const err of sttKeys) {
    const canonical = EPONYM_PHONETIC_STT_MAP[err];
    const regex = new RegExp(`(?<!\\w)${err.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?!\\w)`, "gi");
    res = res.replace(regex, canonical);
  }

  return res.replace(/\s+/g, " ").trim();
}

export const lingoCache = new Map<string, string>();
export const cacheStats = { hits: 0, misses: 0 };

const PRECOMPILED_STT_KEYS = Object.keys(EPONYM_PHONETIC_STT_MAP).sort((a, b) => b.length - a.length).map(err => ({
  canonical: EPONYM_PHONETIC_STT_MAP[err],
  regex: new RegExp(`(?<!\\w)${err.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?!\\w)`, "gi")
}));

const PRECOMPILED_LINGO_KEYS = Object.keys(OR_LINGO_EQUIVALENCE).sort((a, b) => b.length - a.length).map(slang => ({
  standard: OR_LINGO_EQUIVALENCE[slang],
  regex: new RegExp(`(?<!\\w)${slang.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?!\\w)`, "gi")
}));

export function normalizeOrLingo(text: string): string {
  if (!text) return "";
  const rawInput = text.toLowerCase().trim();

  if (lingoCache.has(rawInput)) {
    cacheStats.hits++;
    return lingoCache.get(rawInput)!;
  }
  cacheStats.misses++;

  let res = stripSpokenDisfluencies(rawInput);

  // 1. Phonetic STT Mishearings (longest keys first)
  for (const item of PRECOMPILED_STT_KEYS) {
    res = res.replace(item.regex, item.canonical);
  }

  // 2. OR Lingo / Slang Substitutions (longest keys first)
  for (const item of PRECOMPILED_LINGO_KEYS) {
    res = res.replace(item.regex, item.standard);
  }

  const finalRes = res.replace(/\s+/g, " ").trim();
  lingoCache.set(rawInput, finalRes);
  return finalRes;
}

export function extractEponyms(text: string): Set<string> {
  if (!text) return new Set();

  let lowered = text.toLowerCase();
  lowered = lowered.replace(/\bbrown\s+adson\b/g, "brown-adson");
  lowered = lowered.replace(/\barmy\s+navy\b/g, "army-navy");
  lowered = lowered.replace(/\bbeckman\s+weitlaner\b/g, "beckman-weitlaner");
  lowered = lowered.replace(/\bmayo\s+hegar\b/g, "mayo-hegar");
  lowered = lowered.replace(/\bcrile\s+wood\b/g, "crile-wood");
  lowered = lowered.replace(/\bferris\s+smith\b/g, "ferris-smith");
  lowered = lowered.replace(/\bpotts\s+smith\b/g, "potts-smith");
  lowered = lowered.replace(/\brochester\s+pean\b/g, "rochester-pean");
  lowered = lowered.replace(/\bomni\s+tract\b/g, "omni-tract");
  lowered = lowered.replace(/\brichardson\s+eastman\b/g, "richardson-eastman");
  lowered = lowered.replace(/\bray\s+tec\b/g, "ray-tec");

  const found = new Set<string>();
  const sortedEponyms = Array.from(SURGICAL_EPONYMS).sort((a, b) => b.length - a.length);

  for (const ep of sortedEponyms) {
    const regex = new RegExp(`(?<![\\w-])${ep.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?![\\w-])`, "i");
    if (regex.test(lowered)) {
      found.add(ep);
    }
  }

  for (const word of lowered.split(/\s+/)) {
    const cleanWord = word.replace(/[^a-z0-9-]/g, "");
    if (cleanWord === "metz") found.add("metzenbaum");
    else if (cleanWord === "castro") found.add("castroviejo");
    else if (cleanWord === "peanut" || cleanWord === "peanuts" || cleanWord === "cherry") found.add("kittner");
    else if (cleanWord === "snaps") found.add("crile");
    else if (cleanWord === "rich") found.add("richardson");
  }

  return found;
}

export function isGenericClassOnly(text: string): boolean {
  if (!text) return false;
  const norm = normalizeOrLingo(text).toLowerCase();
  const tokens = (norm.match(/[a-z0-9-]+/g) || []).filter((t) => !STOP_WORDS.has(t));
  if (tokens.length === 0) return false;
  return tokens.every((t) => GENERIC_INSTRUMENT_CLASSES.has(t));
}

export function isEponymConflict(query: string, candidateText: string): boolean {
  if (!query || !candidateText) return false;

  const qNorm = normalizeOrLingo(query);
  const cNorm = normalizeOrLingo(candidateText);

  const qEponyms = extractEponyms(qNorm);
  const cEponyms = extractEponyms(cNorm);

  // Rule 1 & 2: Query has an eponym
  if (qEponyms.size > 0) {
    let hasOverlap = false;
    for (const ep of qEponyms) {
      if (cEponyms.has(ep)) {
        hasOverlap = true;
        break;
      }
    }
    if (!hasOverlap) {
      return true; // Conflict! (different eponym or candidate lacks requested eponym)
    }
    return false;
  }

  // Rule 3: Query does NOT have an eponym, but contains non-generic words
  // e.g. "unobtanium laser forceps"
  const qTokens = (qNorm.match(/[a-z0-9-]+/g) || []).filter((t) => !STOP_WORDS.has(t));
  const nonGenericQTokens = qTokens.filter((t) => !GENERIC_INSTRUMENT_CLASSES.has(t));

  if (nonGenericQTokens.length > 0) {
    const cTokens = new Set(cNorm.match(/[a-z0-9-]+/g) || []);
    const hasMatch = nonGenericQTokens.some((t) => cTokens.has(t));
    if (!hasMatch) {
      return true; // Conflict! Candidate would match purely on generic class words
    }
  }

  return false;
}
