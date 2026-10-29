/**
 * Layer 2 & Layer 3: Unified Clinical Query Planner & Relational Execution Engine (Client-Side).
 *
 * Replaces ad-hoc regex routing with a deterministic 3-Layer Clinical Query Planner:
 * - Decomposes every clinical utterance into structured entities:
 *   - `surgeon`: matched or unindexed surgeon entity (`Dr. Patel`, `Dr. Chen`, `Dr. Unknown`)
 *   - `procedure`: matched surgical procedure (`CABG`, `Lap Chole`, `TKA`, `EVAR`, etc.)
 *   - `cardFacet`: requested preference card section (`sutures`, `instruments`, `positioning`, `prep`, `gloves`, `pearls`, `all`)
 *   - `inventoryCandidateTerms`: clean physical item terms stripped of surgeon/procedure/locative framing
 *   - `hasExplicitLocative`: whether the clinician explicitly asked `where is / locate / find`
 * - Deterministically classifies `intent` into:
 *   - `PREFERENCE_CARD_LOOKUP`
 *   - `PREFERENCE_INVENTORY_JOIN`
 *   - `PROTOCOL_GUIDELINE_LOOKUP`
 *   - `INVENTORY_LOOKUP`
 * - Executes relational joins between Preference Cards (`preference_cards.json`) and live department
 *   inventory (`inventoryItems`) so surgeon suture/instrument preferences automatically surface
 *   exact `Room • Cabinet/Rack • Shelf • Bin` coordinates inline!
 */

import type { CoordinateCardData } from "./api";
import {
  type CardFacetType,
  type ClinicalEntityGraph,
  type ProcedureMatch,
  type SurgeonMatch,
  PREFERENCE_CARD_FACETS,
  compileClinicalGraph,
} from "./clinicalGraph";

export type ClinicalIntentType =
  | "PREFERENCE_CARD_LOOKUP"
  | "PREFERENCE_INVENTORY_JOIN"
  | "INVENTORY_LOOKUP"
  | "PROTOCOL_GUIDELINE_LOOKUP";

export interface ClinicalQueryPlan {
  rawQuery: string;
  intent: ClinicalIntentType;
  surgeon: SurgeonMatch | null;
  procedure: ProcedureMatch | null;
  cardFacet: CardFacetType | null;
  inventoryCandidateTerms: string[];
  hasExplicitLocative: boolean;
}

const DR_PREFIX_RE = /\b(?:dr\.?|doctor)\s+([a-z][a-z'\-]+?)(?:'s)?(?:\s+([a-z][a-z'\-]+?)(?:'s)?)?\b/i;
const POSSESSIVE_SURGEON_RE = /\b([a-z][a-z'\-]+)'s\s+(?:preference|preferences|card|cards|suture|sutures|glove|gloves|position|positioning|prep|setup|tray|instruments?)\b/i;

const NON_SURGEON_NEXT_WORDS = new Set([
  "suture", "sutures", "preference", "preferences", "card", "cards",
  "glove", "gloves", "size", "position", "positioning", "prep", "setup",
  "tray", "trays", "instrument", "instruments", "custom", "vascular",
  "stapler", "prolene", "vicryl", "silk", "monocryl", "ethibond", "pds",
  "ti-cron", "ticron", "debakey", "castroviejo", "weitlaner", "adson",
  "like", "likes", "use", "uses", "want", "wants", "prefer", "prefers",
  "for", "in", "on", "with", "and", "or", "the", "a", "an",
  "lap", "chole", "cabg", "tka", "ralp", "evar", "trauma", "ex",
]);

const EXPLICIT_LOCATIVE_RE = /^\s*(?:where\s+(?:is|are|can\s+i\s+find|do\s+we\s+keep)|locate\b|location\s+of\b|find\b|which\s+(?:room|cart|cabinet|shelf|bin)\b)/i;

const QUESTION_FRAMING_NOISE_RE = /\b(?:what|which|where|how|who|when|is|are|was|were|do|does|did|can|could|should|would|we|you|they|he|she|i|me|my|our|the|a|an|for|in|on|at|to|of|with|by|from|like|likes|use|uses|using|want|wants|prefer|prefers|preferred|need|needs|take|takes|keep|kept|stored|stocked|located|find|locate|show|tell|give|get|pull|grab|size|kind|type|routine|standard|typical|usual)\b/gi;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalizeWord(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function detectSurgeonInQuery(
  query: string,
  graph: ClinicalEntityGraph
): { surgeon: SurgeonMatch | null; remaining: string } {
  const m = query.match(DR_PREFIX_RE);
  if (m) {
    const firstTok = m[1];
    let secondTok: string | undefined = m[2];

    if (secondTok) {
      const secLow = secondTok.toLowerCase();
      const isFacetWord = Object.values(PREFERENCE_CARD_FACETS).some((arr) => arr.includes(secLow));
      if (
        NON_SURGEON_NEXT_WORDS.has(secLow) ||
        Boolean(graph.proceduresByPhrase[secLow]) ||
        isFacetWord
      ) {
        secondTok = undefined;
      }
    }

    let candLast = (secondTok || firstTok).toLowerCase().replace(/'/g, "");
    const firstLow = firstTok.toLowerCase().replace(/'/g, "");

    const matchedCards =
      graph.surgeonsByToken[candLast] ||
      graph.surgeonsByToken[firstLow] ||
      [];

    if (!graph.surgeonsByToken[candLast] && graph.surgeonsByToken[firstLow]) {
      secondTok = undefined;
      candLast = firstLow;
    }

    const rawSurgeonName = `Dr. ${capitalizeWord(firstTok)}${secondTok ? ` ${capitalizeWord(secondTok)}` : ""}`;
    let displayName = rawSurgeonName;
    if (matchedCards.length > 0) {
      const cardSurg = String(matchedCards[0].surgeon || "");
      if (cardSurg) {
        displayName = cardSurg.split("(")[0].replace(/,\s*(?:MD|DO).*$/i, "").trim();
      }
    }

    const stripPat = new RegExp(
      `\\b(?:dr\\.?|doctor)\\s+${escapeRegExp(firstTok)}${secondTok ? `\\s+${escapeRegExp(secondTok)}` : ""}(?:'s|\\b)`,
      "i"
    );
    const remaining = query.replace(stripPat, " ");
    return {
      surgeon: {
        rawName: rawSurgeonName,
        normalizedLastName: candLast,
        displayName,
        matchedCardIds: matchedCards.map((c) => String(c.id)).filter(Boolean),
        isIndexed: matchedCards.length > 0,
      },
      remaining,
    };
  }

  const mPoss = query.match(POSSESSIVE_SURGEON_RE);
  if (mPoss) {
    const nameTok = mPoss[1];
    const lastLow = nameTok.toLowerCase().replace(/'/g, "");
    if (!NON_SURGEON_NEXT_WORDS.has(lastLow)) {
      const matchedCards = graph.surgeonsByToken[lastLow] || [];
      const rawSurgeonName = `Dr. ${capitalizeWord(nameTok)}`;
      let displayName = rawSurgeonName;
      if (matchedCards.length > 0) {
        const cardSurg = String(matchedCards[0].surgeon || "");
        if (cardSurg) {
          displayName = cardSurg.split("(")[0].replace(/,\s*(?:MD|DO).*$/i, "").trim();
        }
      }
      const remaining = query.replace(new RegExp(`\\b${escapeRegExp(nameTok)}'s\\b`, "i"), " ");
      return {
        surgeon: {
          rawName: rawSurgeonName,
          normalizedLastName: lastLow,
          displayName,
          matchedCardIds: matchedCards.map((c) => String(c.id)).filter(Boolean),
          isIndexed: matchedCards.length > 0,
        },
        remaining,
      };
    }
  }

  // Check bare indexed last name when query also mentions card/preference/facet
  const qLow = query.toLowerCase();
  const hasFacetOrCardWord = Object.values(PREFERENCE_CARD_FACETS).some((words) =>
    words.some((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`, "i").test(qLow))
  );
  if (hasFacetOrCardWord) {
    for (const [tok, cards] of Object.entries(graph.surgeonsByToken)) {
      if (tok.length >= 4 && new RegExp(`\\b${escapeRegExp(tok)}(?:'s)?\\b`, "i").test(qLow)) {
        const cardSurg = String(cards[0]?.surgeon || "");
        const displayName =
          cardSurg.split("(")[0].replace(/,\s*(?:MD|DO).*$/i, "").trim() || `Dr. ${capitalizeWord(tok)}`;
        const remaining = query.replace(new RegExp(`\\b${escapeRegExp(tok)}(?:'s)?\\b`, "i"), " ");
        return {
          surgeon: {
            rawName: displayName,
            normalizedLastName: tok,
            displayName,
            matchedCardIds: cards.map((c) => String(c.id)).filter(Boolean),
            isIndexed: true,
          },
          remaining,
        };
      }
    }
  }

  return { surgeon: null, remaining: query };
}

function detectProcedureInQuery(
  query: string,
  graph: ClinicalEntityGraph
): { procedure: ProcedureMatch | null; remaining: string } {
  const qNorm = query
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const sortedPhrases = Object.keys(graph.proceduresByPhrase).sort((a, b) => b.length - a.length);
  for (const phrase of sortedPhrases) {
    if (phrase.length < 3) continue;
    const pat = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i");
    if (pat.test(qNorm)) {
      const cardIds = graph.proceduresByPhrase[phrase] || [];
      const remaining = query.replace(pat, " ");
      const displayProc =
        phrase.length <= 4
          ? phrase.toUpperCase()
          : phrase.replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        procedure: {
          name: displayProc,
          matchedCardIds: cardIds,
        },
        remaining,
      };
    }
  }

  return { procedure: null, remaining: query };
}

function detectCardFacet(query: string): { cardFacet: CardFacetType | null; remaining: string } {
  const qLow = query.toLowerCase();
  let remaining = query;
  let detectedSpecific: CardFacetType | null = null;

  const priorityOrder: Array<Exclude<CardFacetType, "all" | "pearls">> = [
    "gloves",
    "positioning",
    "prep",
    "sutures",
    "instruments",
  ];

  for (const facetKey of priorityOrder) {
    const keywords = PREFERENCE_CARD_FACETS[facetKey];
    for (const kw of keywords) {
      const pat = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "gi");
      if (pat.test(qLow)) {
        if (!detectedSpecific) detectedSpecific = facetKey;
        remaining = remaining.replace(pat, " ");
      }
    }
  }

  let hasGeneralCardWord = false;
  for (const kw of PREFERENCE_CARD_FACETS.pearls) {
    const pat = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "gi");
    if (pat.test(qLow)) {
      hasGeneralCardWord = true;
      remaining = remaining.replace(pat, " ");
    }
  }

  if (detectedSpecific === "gloves") {
    remaining = remaining.replace(/\bsize\b/gi, " ");
  }

  if (detectedSpecific) {
    return { cardFacet: detectedSpecific, remaining };
  }
  if (hasGeneralCardWord) {
    return { cardFacet: "all", remaining };
  }
  return { cardFacet: null, remaining };
}

function extractInventoryCandidateTerms(remainingQuery: string): string[] {
  let cleaned = remainingQuery.replace(
    /^\s*(?:where\s+(?:is|are|can\s+i\s+find|do\s+we\s+keep)|locate|location\s+of|find)\b/i,
    " "
  );
  cleaned = cleaned.replace(QUESTION_FRAMING_NOISE_RE, " ");
  cleaned = cleaned.replace(/[^a-zA-Z0-9\s\-#/\.]/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length < 2) return [];
  return [cleaned];
}

export function planClinicalQuery(
  query: string,
  graph?: ClinicalEntityGraph,
  tenantId: string = "or_main"
): ClinicalQueryPlan {
  const activeGraph = graph || compileClinicalGraph(tenantId);
  const rawQuery = (query || "").trim();
  if (!rawQuery) {
    return {
      rawQuery: "",
      intent: "INVENTORY_LOOKUP",
      surgeon: null,
      procedure: null,
      cardFacet: null,
      inventoryCandidateTerms: [],
      hasExplicitLocative: false,
    };
  }

  const hasExplicitLocative = EXPLICIT_LOCATIVE_RE.test(rawQuery);
  const { surgeon, remaining: remAfterSurgeon } = detectSurgeonInQuery(rawQuery, activeGraph);
  const { procedure, remaining: remAfterProc } = detectProcedureInQuery(remAfterSurgeon, activeGraph);
  const { cardFacet, remaining: remAfterFacet } = detectCardFacet(remAfterProc);
  const candidateTerms = extractInventoryCandidateTerms(remAfterFacet);

  const qNorm = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const cleanedForCatalog = qNorm
    .replace(
      /^\s*(?:where\s+(?:is|are|can\s+i\s+find|do\s+we\s+keep)|locate|location\s+of|find)\s+(?:the\s+|a\s+|an\s+)?/i,
      ""
    )
    .trim();

  if (
    !surgeon &&
    (activeGraph.inventoryTerms.has(qNorm) || activeGraph.inventoryTerms.has(cleanedForCatalog))
  ) {
    return {
      rawQuery,
      intent: "INVENTORY_LOOKUP",
      surgeon: null,
      procedure: null,
      cardFacet: null,
      inventoryCandidateTerms: [rawQuery],
      hasExplicitLocative,
    };
  }

  if (!surgeon && !procedure) {
    let isProtocol = false;
    if (!hasExplicitLocative) {
      for (const topic of activeGraph.protocolTopics) {
        if (qNorm.includes(topic)) {
          isProtocol = true;
          break;
        }
      }
      if (
        /\b(?:protocol|policy|guideline|criteria|aldrete|code blue|code red|malignant hyperthermia|needle stick|time out|fire|wet tray|count policy)\b/i.test(
          qNorm
        )
      ) {
        isProtocol = true;
      }
    }

    if (isProtocol) {
      return {
        rawQuery,
        intent: "PROTOCOL_GUIDELINE_LOOKUP",
        surgeon: null,
        procedure: null,
        cardFacet: null,
        inventoryCandidateTerms: [],
        hasExplicitLocative,
      };
    }

    return {
      rawQuery,
      intent: "INVENTORY_LOOKUP",
      surgeon: null,
      procedure: null,
      cardFacet: null,
      inventoryCandidateTerms: [rawQuery],
      hasExplicitLocative,
    };
  }

  // Rule 2: Surgeon + Specific Physical Item + Locative ("where is Dr. Patel's custom vascular stapler")
  if (hasExplicitLocative && candidateTerms.length > 0) {
    return {
      rawQuery,
      intent: "PREFERENCE_INVENTORY_JOIN",
      surgeon,
      procedure,
      cardFacet,
      inventoryCandidateTerms: candidateTerms,
      hasExplicitLocative: true,
    };
  }

  // Rule 3: Surgeon/Procedure + Specific Item ("what size prolene does dr chen use for cabg")
  if (candidateTerms.length > 0) {
    return {
      rawQuery,
      intent: "PREFERENCE_INVENTORY_JOIN",
      surgeon,
      procedure,
      cardFacet: cardFacet || "all",
      inventoryCandidateTerms: candidateTerms,
      hasExplicitLocative: false,
    };
  }

  // Rule 1: Surgeon/Procedure + Facet / Preference Query
  return {
    rawQuery,
    intent: "PREFERENCE_CARD_LOOKUP",
    surgeon,
    procedure,
    cardFacet: cardFacet || "all",
    inventoryCandidateTerms: [],
    hasExplicitLocative,
  };
}

function matchCardItemToInventory(
  entryText: string,
  invRows: CoordinateCardData[]
): CoordinateCardData | null {
  const entryLow = entryText.toLowerCase();
  let bestRow: CoordinateCardData | null = null;
  let bestScore = 0;

  for (const row of invRows) {
    const itemName = row.item || "";
    const itemLow = itemName.toLowerCase();
    if (!itemLow) continue;

    if (entryLow.includes(itemLow) || itemLow.includes(entryLow)) {
      const score = 100 + itemLow.length;
      if (score > bestScore) {
        bestScore = score;
        bestRow = row;
      }
      continue;
    }

    const aliases = (row.aliases || "")
      .split("|")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
    for (const al of aliases) {
      if (al.length >= 4 && new RegExp(`\\b${escapeRegExp(al)}\\b`, "i").test(entryLow)) {
        const score = 80 + al.length;
        if (score > bestScore) {
          bestScore = score;
          bestRow = row;
        }
      }
    }

    const itemTokens = itemLow
      .split(/[^a-z0-9\-]+/)
      .filter((t) => t.length >= 2 && !["on", "for", "with", "and", "suture", "forceps"].includes(t));
    if (itemTokens.length > 0) {
      const matchedToks = itemTokens.filter((t) =>
        new RegExp(`\\b${escapeRegExp(t)}\\b`, "i").test(entryLow)
      );
      if (matchedToks.length >= 2 && matchedToks.length >= itemTokens.length - 1) {
        const score = 50 + matchedToks.length * 10;
        if (score > bestScore) {
          bestScore = score;
          bestRow = row;
        }
      }
    }
  }

  return bestRow;
}

export function executeClinicalQueryPlan(
  plan: ClinicalQueryPlan,
  graph: ClinicalEntityGraph,
  findInventoryItemFn: (candidateQuery: string) => CoordinateCardData | null
): {
  replyText: string;
  routingTier: "TIER_1_LOCAL_CSV";
  coordinateCard: CoordinateCardData | null;
  coordinateCards: CoordinateCardData[];
} | null {
  if (plan.intent !== "PREFERENCE_CARD_LOOKUP" && plan.intent !== "PREFERENCE_INVENTORY_JOIN") {
    return null;
  }

  // Case A: PREFERENCE_INVENTORY_JOIN with explicit locative ("where is Dr. Patel's custom vascular stapler")
  if (
    plan.intent === "PREFERENCE_INVENTORY_JOIN" &&
    plan.hasExplicitLocative &&
    plan.inventoryCandidateTerms.length > 0
  ) {
    const candidate = plan.inventoryCandidateTerms[0];
    const invMatch = findInventoryItemFn(candidate);
    if (invMatch && invMatch.item) {
      const humanLoc = invMatch.human_alias || invMatch.full_code || "";
      const fullCode = invMatch.full_code || "";
      const notes = invMatch.surgeon_notes || "";
      const surgeonPrefix = plan.surgeon ? `For **${plan.surgeon.displayName}**, ` : "";
      const replyText =
        `${surgeonPrefix}**${invMatch.item}** is located at **${humanLoc}** (\`${fullCode}\`).` +
        (notes ? `\n\n*Clinical Note*: ${notes}` : "");
      return {
        replyText,
        routingTier: "TIER_1_LOCAL_CSV",
        coordinateCard: invMatch,
        coordinateCards: [invMatch],
      };
    }
  }

  const getCardsByIds = (ids: string[]) => {
    const idSet = new Set(ids);
    return graph.preferenceCards.filter((c) => idSet.has(String(c.id)));
  };

  let matchedCards: any[] = [];
  if (plan.surgeon && plan.procedure) {
    const procIds = new Set(plan.procedure.matchedCardIds);
    const bothIds = plan.surgeon.matchedCardIds.filter((id) => procIds.has(id));
    if (bothIds.length > 0) {
      matchedCards = getCardsByIds(bothIds);
    } else if (plan.procedure.matchedCardIds.length > 0) {
      matchedCards = getCardsByIds(plan.procedure.matchedCardIds);
    } else if (plan.surgeon.matchedCardIds.length > 0) {
      matchedCards = getCardsByIds(plan.surgeon.matchedCardIds);
    }
  } else if (plan.surgeon) {
    matchedCards = getCardsByIds(plan.surgeon.matchedCardIds);
  } else if (plan.procedure) {
    matchedCards = getCardsByIds(plan.procedure.matchedCardIds);
  }

  // Case B: Surgeon has NO preference card on file in this department
  if (plan.surgeon && matchedCards.length === 0) {
    const surgLast = plan.surgeon.normalizedLastName;
    const noteRows = graph.inventoryRows.filter(
      (r) =>
        surgLast &&
        new RegExp(`\\b${escapeRegExp(surgLast)}\\b`, "i").test((r.surgeon_notes || "").toLowerCase())
    );

    let fallbackCards: CoordinateCardData[] = [];
    if (noteRows.length > 0) {
      fallbackCards = noteRows.slice(0, 4);
    } else if (plan.cardFacet === "sutures") {
      fallbackCards = graph.inventoryRows
        .filter((r) => (r.category || "").toLowerCase().includes("suture"))
        .slice(0, 4);
    } else if (plan.cardFacet === "instruments") {
      fallbackCards = graph.inventoryRows
        .filter((r) => (r.category || "").toLowerCase().includes("instrument"))
        .slice(0, 4);
    }

    const indexedList =
      graph.indexedSurgeonNames.length > 0
        ? graph.indexedSurgeonNames.join(", ")
        : "Dr. Elena Rodriguez, Dr. Marcus Chen, Dr. Sarah Chen, Dr. Raj Patel, Dr. Marcus Vance";
    const facetLabel = capitalizeWord(plan.cardFacet || "Preference");

    const lines: string[] = [
      `**No preference card on file for ${plan.surgeon.displayName} in ${graph.departmentName}.**`,
      `*Indexed Surgeons in this department: ${indexedList}.*`,
    ];

    if (fallbackCards.length > 0) {
      lines.push(
        `*(If looking for standard department ${facetLabel}, showing top locations below — or use **+ Quick Add** to add ${plan.surgeon.displayName}'s card.)*`
      );
      for (const r of fallbackCards) {
        const loc = r.human_alias || r.full_code;
        lines.push(`- **${r.item}** → \`${loc}\``);
      }
    } else {
      lines.push(
        `*(Use **+ Quick Add** to register ${plan.surgeon.displayName}'s preference card in ${graph.departmentName}.)*`
      );
    }

    const replyText =
      lines.slice(0, 3).join("\n\n") + (lines.length > 3 ? "\n" + lines.slice(3).join("\n") : "");

    return {
      replyText,
      routingTier: "TIER_1_LOCAL_CSV",
      coordinateCard: fallbackCards[0] || null,
      coordinateCards: fallbackCards,
    };
  }

  // Case C: PREFERENCE_INVENTORY_JOIN without explicit locative ("what size prolene does dr chen use for cabg")
  if (
    plan.intent === "PREFERENCE_INVENTORY_JOIN" &&
    plan.inventoryCandidateTerms.length > 0 &&
    matchedCards.length > 0
  ) {
    const candTerm = plan.inventoryCandidateTerms[0].toLowerCase();
    const candTokens = candTerm.split(/[^a-z0-9\-]+/).filter((t) => t.length >= 2);

    const joinedItems: Array<{ entry: string; invRow: CoordinateCardData | null; card: any }> = [];
    for (const card of matchedCards) {
      const allEntries: string[] = [
        ...(card.sutures || []),
        ...(card.instrumentation || []),
        ...(card.supplies || []),
      ];
      for (const entry of allEntries) {
        const entryLow = entry.toLowerCase();
        if (candTokens.some((tok) => entryLow.includes(tok))) {
          const invRow = matchCardItemToInventory(entry, graph.inventoryRows);
          joinedItems.push({ entry, invRow, card });
        }
      }
    }

    if (joinedItems.length > 0) {
      const primaryCard = joinedItems[0].card;
      const surgTitle =
        primaryCard.surgeon || primaryCard.clinician || (plan.surgeon ? plan.surgeon.displayName : "");
      const procTitle = primaryCard.procedure || "";
      let header = `### 📋 ${procTitle} — ${surgTitle}\n`;
      header += `**Matched Preference & Inventory Coordinates for \`${plan.inventoryCandidateTerms[0]}\`:**\n`;

      const coordCards: CoordinateCardData[] = [];
      const bulletLines: string[] = [];
      for (const { entry, invRow } of joinedItems) {
        if (invRow) {
          const locStr = invRow.human_alias || invRow.full_code;
          bulletLines.push(`- **${entry}** → 📍 **${locStr}** (\`${invRow.full_code}\`)`);
          if (!coordCards.some((c) => c.item === invRow.item)) {
            coordCards.push(invRow);
          }
        } else {
          bulletLines.push(`- **${entry}**`);
        }
      }

      const notes = primaryCard.notes || "";
      const footer = notes ? `\n\n**Clinical Pearls / Notes**: ${notes}` : "";
      return {
        replyText: header + bulletLines.join("\n") + footer,
        routingTier: "TIER_1_LOCAL_CSV",
        coordinateCard: coordCards[0] || null,
        coordinateCards: coordCards,
      };
    }

    const invMatch = findInventoryItemFn(plan.inventoryCandidateTerms[0]);
    if (invMatch && invMatch.item) {
      const locStr = invMatch.human_alias || invMatch.full_code;
      return {
        replyText: `**${invMatch.item}** is stocked at **${locStr}** (\`${invMatch.full_code}\`).`,
        routingTier: "TIER_1_LOCAL_CSV",
        coordinateCard: invMatch,
        coordinateCards: [invMatch],
      };
    }
  }

  // Case D: PREFERENCE_CARD_LOOKUP with matched preference card(s)
  if (matchedCards.length > 0) {
    const card = matchedCards[0];
    const procTitle = card.procedure || "Procedure";
    const surgTitle = card.surgeon || card.clinician || "Department Standard";
    const roomTitle = card.room || card.unit || graph.departmentName;
    const glovesStr = card.gloves || "Standard department sterile gloves";
    const posStr = card.position || "Standard positioning";
    const prepStr = card.prep || "Standard prep";
    const notesStr = card.notes || "";

    const suturesList: string[] = card.sutures || [];
    const instList: string[] = card.instrumentation || card.supplies || [];
    const coordCards: CoordinateCardData[] = [];

    const formatEntriesWithCoords = (entries: string[]) => {
      if (!entries || entries.length === 0) return "- None specified";
      return entries
        .map((e) => {
          const invRow = matchCardItemToInventory(e, graph.inventoryRows);
          if (invRow) {
            const loc = invRow.human_alias || invRow.full_code;
            if (!coordCards.some((c) => c.item === invRow.item)) {
              coordCards.push(invRow);
            }
            return `- **${e}** → 📍 \`${loc}\``;
          }
          return `- ${e}`;
        })
        .join("\n");
    };

    const suturesFormatted = formatEntriesWithCoords(suturesList);
    const instFormatted = formatEntriesWithCoords(instList);
    const facet = plan.cardFacet || "all";

    const header =
      `### 📋 Preference Card: ${procTitle}\n` +
      `**Surgeon / Lead**: ${surgTitle} | **Room / Unit**: ${roomTitle}\n`;

    const sections: string[] = [];
    if (facet === "sutures") {
      sections.push(`#### 🧵 Sutures & Closure (With Live Inventory Coordinates)\n${suturesFormatted}`);
      sections.push(`**Gloves**: ${glovesStr}`);
      sections.push(`**Instrumentation**:\n${instFormatted}`);
      if (notesStr) sections.push(`**Clinical Pearls**: ${notesStr}`);
    } else if (facet === "gloves") {
      sections.push(`#### 🧤 Surgeon Glove Preference\n- **${surgTitle}**: **${glovesStr}**`);
      if (notesStr) sections.push(`**Clinical Pearls**: ${notesStr}`);
    } else if (facet === "positioning") {
      sections.push(`#### 🛏️ Patient Positioning & Table Setup\n- **${posStr}**`);
      sections.push(`**Prep**: ${prepStr}`);
      if (notesStr) sections.push(`**Clinical Pearls**: ${notesStr}`);
    } else if (facet === "prep") {
      sections.push(`#### 🧪 Surgical Prep & Draping\n- **${prepStr}**`);
      sections.push(`**Positioning**: ${posStr}`);
      if (notesStr) sections.push(`**Clinical Pearls**: ${notesStr}`);
    } else if (facet === "instruments") {
      sections.push(`#### 🛠️ Instrumentation & Trays (With Live Inventory Coordinates)\n${instFormatted}`);
      sections.push(`**Sutures & Closure**:\n${suturesFormatted}`);
      if (notesStr) sections.push(`**Clinical Pearls**: ${notesStr}`);
    } else {
      sections.push(`**Positioning**: ${posStr}`);
      sections.push(`**Surgical Prep**: ${prepStr}`);
      sections.push(`**Gloves**: ${glovesStr}`);
      if (instList.length > 0) {
        sections.push(`#### 🛠️ Instrumentation & Supplies\n${instFormatted}`);
      }
      if (suturesList.length > 0) {
        sections.push(`#### 🧵 Sutures & Closure\n${suturesFormatted}`);
      }
      if (notesStr) {
        sections.push(`**Clinical Pearls & Hold Notes**: ${notesStr}`);
      }
    }

    return {
      replyText: header + "\n" + sections.join("\n\n"),
      routingTier: "TIER_1_LOCAL_CSV",
      coordinateCard: coordCards[0] || null,
      coordinateCards: coordCards,
    };
  }

  return null;
}
