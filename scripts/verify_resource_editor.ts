/**
 * Verification Gauntlet: Installed Resources Explorer, Inline Editor & Organizer
 *
 * Verifies:
 * 1. Inventory CRUD operations in Dexie (create, read, update, delete).
 * 2. Edit-Protection Invariant: hydrateOrUpgradeOfflineInventory never overwrites custom edited items.
 * 3. Tombstone Deletion Invariant: hydrateOrUpgradeOfflineInventory never resurrects deleted items.
 * 4. Preference Cards CRUD in Dexie (hydration, save, delete, relational inventory lookup).
 * 5. Slang & Lexicon Aliases CRUD in Dexie.
 * 6. Department Guidelines & JSON Backup Export/Import round-trip.
 * 7. Live Standalone Engine & 3-Layer Clinical Query Planner instant cache reflection with zero reload.
 */

import "../frontend/node_modules/fake-indexeddb/auto/index.js";
import {
  offlineDb,
  getOfflineInventory,
  createOfflineInventoryItem,
  updateOfflineInventoryItem,
  deleteOfflineInventoryItem,
  hydrateOrUpgradeOfflineInventory,
  getOfflinePreferenceCards,
  saveOfflinePreferenceCard,
  deleteOfflinePreferenceCard,
  getOfflineLexiconAliases,
  saveOfflineLexiconAlias,
  deleteOfflineLexiconAlias,
  getOfflineDepartmentGuideline,
  saveOfflineDepartmentGuideline,
  exportTenantResourcesJson,
  importTenantResourcesJson,
  type OfflineInventoryRecord,
  type OfflinePreferenceCard,
  type OfflineLexiconEntry,
} from "../frontend/src/lib/offlineDb";
import { executeStandaloneSearch } from "../frontend/src/lib/standaloneEngine";

const TENANT = "sacred_heart::or";

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details: string) {
  results.push({ name, passed, details });
  const mark = passed ? "[PASS]" : "[FAIL]";
  console.log(`${mark} ${name}: ${details}`);
}

async function runGauntlet() {
  console.log("==========================================================================");
  console.log("=== PHASE 45: INSTALLED RESOURCES EXPLORER & STUDIO VERIFICATION GAUNTLET ===");
  console.log("==========================================================================\n");

  // Step 1: Baseline Hydration
  console.log("--- [STEP 1] Baseline Dexie Hydration ---");
  const initialCount = await hydrateOrUpgradeOfflineInventory(TENANT, true);
  record(
    "Baseline Hydration",
    initialCount >= 143,
    `Hydrated ${initialCount} master catalog items for ${TENANT}`
  );

  // Step 2: Inventory Creation
  console.log("\n--- [STEP 2] Inventory Item Creation ---");
  const testItemName = "Dr. Church Custom Titanium Clip";
  const createdItem = await createOfflineInventoryItem(TENANT, {
    item: testItemName,
    room: "Main OR",
    cabinet: "T",
    shelf: "4",
    container: "B",
    category: "Vascular Supplies",
    surgeon_notes: "Dr. Church vascular clips - keep 2 boxes on field",
    aliases: "titanium clip|church clip",
  });

  record(
    "Create Inventory Item",
    createdItem.item === testItemName &&
      createdItem.isCustomEdited === true &&
      createdItem.status === "user_added" &&
      createdItem.full_code === "Main OR T 4 B",
    `Created "${createdItem.item}" at ${createdItem.full_code} with isCustomEdited=true`
  );

  const inventoryAfterCreate = await getOfflineInventory(TENANT);
  const foundCreated = inventoryAfterCreate.find((i) => i.item === testItemName);
  record(
    "Read Created Item in Inventory",
    !!foundCreated,
    `Retrieved created item from Dexie. Total inventory: ${inventoryAfterCreate.length}`
  );

  // Step 3: Inventory Update
  console.log("\n--- [STEP 3] Inventory Item Update ---");
  const updatedItem = await updateOfflineInventoryItem(TENANT, createdItem.id || createdItem.item, {
    shelf: "5",
    container: "C",
    surgeon_notes: "Updated: Dr. Church prefers size Large clips",
  });

  record(
    "Update Inventory Item",
    updatedItem !== null &&
      updatedItem.shelf === "5" &&
      updatedItem.container === "C" &&
      updatedItem.full_code === "Main OR T 5 C" &&
      updatedItem.surgeon_notes.includes("size Large"),
    `Updated location to ${updatedItem?.full_code} and notes: "${updatedItem?.surgeon_notes}"`
  );

  // Step 4: Edit-Protection Invariant (Simulated APK update or forced re-sync)
  console.log("\n--- [STEP 4] Edit-Protection Invariant Under Seed Hydration ---");
  await hydrateOrUpgradeOfflineInventory(TENANT, true);
  const inventoryAfterRebuild = await getOfflineInventory(TENANT);
  const protectedItem = inventoryAfterRebuild.find((i) => i.item === testItemName);

  record(
    "Edit-Protection Invariant",
    !!protectedItem &&
      protectedItem.shelf === "5" &&
      protectedItem.container === "C" &&
      protectedItem.full_code === "Main OR T 5 C",
    `Item survived forced seed rebuild! Shelf: ${protectedItem?.shelf}, Full Code: ${protectedItem?.full_code}`
  );

  // Step 5: Deletion & Tombstone Resurrection Guard
  console.log("\n--- [STEP 5] Deletion & Tombstone Resurrection Guard ---");
  const deleteOk = await deleteOfflineInventoryItem(TENANT, createdItem.id || createdItem.item);
  record("Delete Inventory Item", deleteOk, `Deleted item from active inventory`);

  const inventoryAfterDelete = await getOfflineInventory(TENANT);
  const foundAfterDelete = inventoryAfterDelete.find((i) => i.item === testItemName);
  record(
    "Item Excluded From Query",
    !foundAfterDelete,
    `Item successfully filtered out of active inventory`
  );

  // Force seed re-sync and assert item is NOT resurrected by seed catalog!
  await hydrateOrUpgradeOfflineInventory(TENANT, true);
  const inventoryAfterSecondRebuild = await getOfflineInventory(TENANT);
  const resurrected = inventoryAfterSecondRebuild.find((i) => i.item === testItemName);
  record(
    "Tombstone Invariant (Zero Resurrection)",
    !resurrected,
    `Tombstone prevented deleted item from being resurrected during seed rebuild!`
  );

  // Step 6: Preference Cards CRUD
  console.log("\n--- [STEP 6] Preference Cards CRUD & Relational Linking ---");
  const initialCards = await getOfflinePreferenceCards(TENANT);
  record(
    "Hydrate Preference Cards",
    initialCards.length > 0,
    `Loaded ${initialCards.length} baseline preference cards for ${TENANT}`
  );

  const turkCard: Partial<OfflinePreferenceCard> & { surgeon: string; procedure: string } = {
    surgeon: "Dr. Christopher Turk",
    procedure: "Laparoscopic Appendectomy",
    specialty: "General Surgery",
    gloves: "Size 8.0 Biogel Under / 8.0 Over",
    positioning: "Supine with left arm tucked",
    prep: "ChloraPrep abdominal scrub x2",
    instruments: ["5mm optical trocar", "Maryland dissector", "Endo Catch bag"],
    sutures: ["3-0 Vicryl CT-1", "4-0 Monocryl PS-2"],
    pearls: ["Scrub must have 5mm clip applier loaded before mesoappendix dissection"],
    notes: "Music: 90s hip-hop only",
  };

  const savedTurkCard = await saveOfflinePreferenceCard(TENANT, turkCard);
  record(
    "Create Preference Card",
    savedTurkCard.surgeon === "Dr. Christopher Turk" &&
      savedTurkCard.isCustomEdited === true &&
      savedTurkCard.sutures?.length === 2,
    `Saved preference card for ${savedTurkCard.surgeon} (${savedTurkCard.procedure})`
  );

  const cardsAfterSave = await getOfflinePreferenceCards(TENANT);
  const retrievedTurk = cardsAfterSave.find((c) => c.surgeon === "Dr. Christopher Turk");
  record(
    "Retrieve Custom Preference Card",
    Boolean(retrievedTurk && retrievedTurk.pearls?.[0]?.includes("5mm clip applier")),
    `Found Dr. Turk card in Dexie with pearls intact`
  );

  // Step 7: Slang & Aliases CRUD
  console.log("\n--- [STEP 7] Slang & Spoken Aliases CRUD ---");
  const initialAliases = await getOfflineLexiconAliases(TENANT);
  record(
    "Hydrate Slang Aliases",
    initialAliases.length > 0,
    `Loaded ${initialAliases.length} spoken term aliases for ${TENANT}`
  );

  const savedAlias = await saveOfflineLexiconAlias(TENANT, {
    spokenTerm: "purple gun",
    canonicalItem: "Covidien Tri-Staple 60mm Purple",
    category: "Staplers",
  });

  record(
    "Create Slang Alias",
    savedAlias.spokenTerm === "purple gun" &&
      savedAlias.canonicalItem === "Covidien Tri-Staple 60mm Purple",
    `Registered alias: "${savedAlias.spokenTerm}" → "${savedAlias.canonicalItem}"`
  );

  const aliasesAfterSave = await getOfflineLexiconAliases(TENANT);
  const retrievedAlias = aliasesAfterSave.find((a) => a.spokenTerm === "purple gun");
  record(
    "Retrieve Slang Alias",
    !!retrievedAlias,
    `Found alias in Dexie: "${retrievedAlias?.spokenTerm}"`
  );

  const delAliasOk = await deleteOfflineLexiconAlias(TENANT, savedAlias.id);
  const aliasesAfterDel = await getOfflineLexiconAliases(TENANT);
  record(
    "Delete Slang Alias",
    Boolean(delAliasOk && !aliasesAfterDel.some((a) => a.spokenTerm === "purple gun")),
    `Successfully deleted alias`
  );

  // Step 8: Department Guidelines & Backup Export/Import
  console.log("\n--- [STEP 8] Guidelines & JSON Backup Export/Import ---");
  const testGuideline = "# Sacred Heart Custom Guidelines\n## MTP Protocol\nCall x4-25663 STAT.";
  saveOfflineDepartmentGuideline(TENANT, testGuideline);
  const retrievedGuide = getOfflineDepartmentGuideline(TENANT);
  record(
    "Save & Retrieve Department Guidelines",
    retrievedGuide.includes("Sacred Heart Custom Guidelines"),
    `Stored and retrieved custom guidelines markdown`
  );

  const exportedJson = await exportTenantResourcesJson(TENANT);
  const parsedBundle = JSON.parse(exportedJson);
  record(
    "Export Tenant Resources JSON",
    parsedBundle.exportVersion === 1 &&
      parsedBundle.tenantId === TENANT &&
      parsedBundle.inventory.length >= 143 &&
      parsedBundle.preferenceCards.length > 0 &&
      parsedBundle.guideline.includes("Sacred Heart Custom Guidelines"),
    `Exported valid bundle with ${parsedBundle.inventory.length} items, ${parsedBundle.preferenceCards.length} cards, ${parsedBundle.lexiconAliases.length} aliases`
  );

  // Test Import
  const importResult = await importTenantResourcesJson(TENANT, exportedJson);
  record(
    "Import Tenant Resources JSON",
    importResult.success &&
      importResult.importedItems >= 143 &&
      importResult.importedCards >= 1,
    `Successfully imported: ${importResult.importedItems} items, ${importResult.importedCards} cards`
  );

  // Step 9: Live Standalone Engine & 3-Layer Clinical Query Planner Integration
  console.log("\n--- [STEP 9] Instant Engine Cache Reflection (Live Query Test) ---");

  // Re-save Dr. Turk card to ensure it's in Dexie
  await saveOfflinePreferenceCard(TENANT, turkCard);

  // Query Dr. Turk suture preferences via executeStandaloneSearch
  const turkQueryResponse = await executeStandaloneSearch(
    "what sutures does dr turk use",
    TENANT
  );

  const turkReply = turkQueryResponse.reply_text.toLowerCase();
  const matchedTurk =
    turkReply.includes("turk") &&
    (turkReply.includes("vicryl") || turkReply.includes("monocryl"));

  record(
    "Live Query: Dr. Turk Preference Card Lookup",
    matchedTurk,
    `Standalone Engine dynamically recognized custom card! Reply snippet: "${turkQueryResponse.reply_text.slice(0, 120)}..."`
  );

  // Add a brand-new custom inventory item and query it immediately in chat
  const quickItem = await createOfflineInventoryItem(TENANT, {
    item: "Dr. Turk Custom Appendiceal Snare",
    room: "Main OR",
    cabinet: "K",
    shelf: "3",
    container: "A",
    category: "Laparoscopic",
  });

  const itemQueryResponse = await executeStandaloneSearch(
    "where is Dr. Turk's custom appendiceal snare",
    TENANT
  );

  const matchedItem =
    itemQueryResponse.reply_text.includes("Main OR K 3 A") ||
    itemQueryResponse.reply_text.includes("Cart K") ||
    (itemQueryResponse.coordinate_card !== null && itemQueryResponse.coordinate_card.cabinet === "K");

  record(
    "Live Query: Instant Custom Inventory Reflection",
    matchedItem,
    `Standalone Engine dynamically located custom item without reload! Reply: "${itemQueryResponse.reply_text.slice(0, 100)}..."`
  );

  // Summary
  console.log("\n==========================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`=== GAUNTLET SUMMARY: ${passed}/${total} PASSED (${failed} FAILED) ===`);
  console.log("==========================================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("\nALL VERIFICATIONS PASSED! System is 100% verified.");
  }
}

runGauntlet().catch((err) => {
  console.error("Gauntlet execution error:", err);
  process.exit(1);
});

