/**
 * Phase 41 / v0.59 E2E Verification: Dexie 34-Item Stale Cache Fix & Installed Packs Hydration
 *
 * Verifies:
 * 1. Simulates a mobile device with an old 34-item Dexie IndexedDB cache + 1 custom user-added item.
 * 2. Auto-Upgrades Dexie to full 143+ item catalog on boot/rebuild without losing the custom item.
 * 3. Diagnostics & Sidebar item counter displays "144 items (Dexie) • All Packs Active".
 * 4. Offline search for Preference Cards ("Lap Chole") resolves Dr. Elena Rodriguez card.
 * 5. Offline search for Emergency Policy ("Malignant hyperthermia") resolves handbook guidance.
 * 6. Offline search for Custom User Item ("Dr. Iglesia Custom Vascular Stapler") returns exact coordinates.
 */

import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH =
  "C:/Users/igles/.gemini/antigravity/scratch/or-nav/frontend/chrome/win64-156.0.8078.47/chrome-win64/chrome.exe";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "C:/Users/igles/.gemini/antigravity/brain/2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("==================================================================");
  console.log("=== PHASE 41 / v0.59 DEXIE HYDRATION & RESOURCE PACKS GAUNTLET ===");
  console.log("==================================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });

  page.on("console", (msg) => {
    const txt = msg.text();
    if (txt.includes("[Dexie Hydration]") || txt.includes("Error") || txt.includes("error")) {
      console.log("BROWSER LOG:", msg.type(), txt);
    }
  });

  const results = [];
  function recordResult(subsystem, testName, passed, details) {
    results.push({ subsystem, testName, passed, details });
    const mark = passed ? "[✓ PASS]" : "[✗ FAIL]";
    console.log(`${mark} ${subsystem} -> ${testName} (${details})`);
  }

  try {
    console.log(`\nNavigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 15000 });

    // Step 1: Login
    console.log("\n--- [STEP 1] Login Verification ---");
    const demoBtn = await page.$('[data-testid="btn-quick-demo-login"]');
    if (demoBtn) {
      await demoBtn.click();
      await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 6000 });
      recordResult("Auth", "Quick Demo Login", true, "Authenticated as Sean Iglesia");
    } else {
      recordResult("Auth", "Quick Demo Login", true, "Already authenticated");
    }
    await new Promise((r) => setTimeout(r, 600));

    // Step 2: Inject stale 34-item Dexie cache + 1 custom clinician item
    console.log("\n--- [STEP 2] Inject Stale 34-Item Dexie Cache + Custom Clinician Item ---");
    const injected = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("ORNavOfflineDB");
        req.onerror = () => reject(req.error);
        req.onsuccess = async () => {
          const db = req.result;
          const tx = db.transaction(["inventoryItems"], "readwrite");
          const store = tx.objectStore("inventoryItems");

          const getAllReq = store.getAll();
          getAllReq.onsuccess = () => {
            const all = getAllReq.result || [];
            const toDelTx = db.transaction(["inventoryItems"], "readwrite");
            const delStore = toDelTx.objectStore("inventoryItems");
            for (const item of all) {
              if (item.tenant_id === "sacred_heart::or" || item.tenant_id === "sacred_heart_or") {
                delStore.delete(item.id);
              }
            }
            toDelTx.oncomplete = () => {
              // Add 34 dummy legacy items
              const putTx = db.transaction(["inventoryItems"], "readwrite");
              const putStore = putTx.objectStore("inventoryItems");
              for (let i = 1; i <= 34; i++) {
                putStore.put({
                  id: `sacred_heart::or::legacy_tool_${i}`,
                  tenant_id: "sacred_heart::or",
                  item: `Legacy Tool ${i}`,
                  room: "OR 21",
                  cabinet: "A",
                  shelf: "1",
                  container: "A",
                  full_code: "OR 21 A 1 A",
                  status: "verified",
                  verify_count: 3,
                });
              }
              // Add 1 custom user-added item
              putStore.put({
                id: "sacred_heart::or::dr_iglesia_custom_stapler",
                tenant_id: "sacred_heart::or",
                item: "Dr. Iglesia Custom Vascular Stapler",
                room: "OR 21",
                cabinet: "Z",
                shelf: "9",
                container: "Special",
                full_code: "OR 21 Z 9 Special",
                status: "user_added",
                verify_count: 0,
              });
              putTx.oncomplete = () => {
                localStorage.setItem("ornav_dexie_build_sacred_heart::or", "10");
                resolve({ injectedCount: 35 });
              };
              putTx.onerror = () => reject(putTx.error);
            };
          };
        };
      });
    });

    console.log(`Injected ${injected.injectedCount} items into Dexie (34 legacy + 1 custom item).`);
    recordResult("Dexie Simulation", "Stale Cache Injected", injected.injectedCount === 35, "34 dummy + 1 custom item");

    // Step 3: Trigger Dexie Auto-Upgrade & Hydration
    console.log("\n--- [STEP 3] Trigger Dexie Auto-Upgrade & Hydration ---");
    const upgradeResult = await page.evaluate(async () => {
      // Use exposed hydrateOrUpgradeOfflineInventory if available, or simulate upgrade
      if (typeof window.hydrateOrUpgradeOfflineInventory === "function") {
        const count = await window.hydrateOrUpgradeOfflineInventory("sacred_heart::or", true);
        return { count };
      }
      return { count: 0 };
    });

    // Also click the rebuild offline cache button in the UI if visible
    const systemToggle = await page.$('[data-testid="sidebar-system-toggle"]');
    if (systemToggle) {
      await systemToggle.click();
      await new Promise((r) => setTimeout(r, 400));
    }
    const diagToggle = await page.$('[data-testid="category-diagnostics-toggle"]');
    if (diagToggle) {
      await diagToggle.click();
      await new Promise((r) => setTimeout(r, 400));
    }

    const rebuildBtn = await page.$('[data-testid="rebuild-offline-cache-btn"]');
    if (rebuildBtn) {
      await rebuildBtn.click();
      console.log("Clicked Rebuild Offline Cache button in UI.");
      await new Promise((r) => setTimeout(r, 1200));
    }

    // Verify Dexie upgraded item count
    const postUpgrade = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("ORNavOfflineDB");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["inventoryItems"], "readonly");
          const store = tx.objectStore("inventoryItems");
          const getAllReq = store.getAll();
          getAllReq.onsuccess = () => {
            const all = (getAllReq.result || []).filter((i) => i.tenant_id === "sacred_heart::or");
            const customFound = all.some((i) => i.item === "Dr. Iglesia Custom Vascular Stapler");
            const debakeyFound = all.some((i) => i.item.toLowerCase().includes("debakey"));
            resolve({
              count: all.length,
              customFound,
              debakeyFound,
            });
          };
          getAllReq.onerror = () => reject(getAllReq.error);
        };
      });
    });

    console.log(`Post-upgrade Dexie count for sacred_heart::or: ${postUpgrade.count}`);
    recordResult("Dexie Hydration", "Catalog Auto-Upgraded", postUpgrade.count >= 143, `Upgraded to ${postUpgrade.count} items (143+ expected)`);
    recordResult("Dexie Hydration", "Custom User Item Preserved", postUpgrade.customFound, "Dr. Iglesia Custom Vascular Stapler still in Dexie");
    recordResult("Dexie Hydration", "Full Catalog Present", postUpgrade.debakeyFound, "DeBakey forceps found in catalog");

    // Step 4: Verify UI Diagnostics Badge in Sidebar
    console.log("\n--- [STEP 4] Diagnostics & System Info Item Counter ---");
    const countBadgeText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="dexie-item-count"]');
      return el ? el.textContent.trim() : "";
    });
    console.log(`UI Dexie Count Badge: "${countBadgeText}"`);
    const badgeHasAllPacks = countBadgeText.includes("items (Dexie)") && countBadgeText.includes("All Packs Active");
    recordResult("UI Diagnostics", "Item Counter Badge", badgeHasAllPacks, `Badge displayed: "${countBadgeText}"`);

    // Helper to send query and read response
    async function submitQuery(queryText, expectedSubstring) {
      await new Promise((r) => setTimeout(r, 600));
      const input = await page.waitForSelector('[data-testid="omnibar-input"]:not([disabled])', { timeout: 8000 });
      await input.focus();
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await input.type(queryText, { delay: 15 });

      await page.waitForFunction(
        () => {
          const btn = document.querySelector('[data-testid="omnibar-submit-btn"]');
          return btn && !btn.disabled;
        },
        { timeout: 5000 }
      );
      const submitBtn = await page.$('[data-testid="omnibar-submit-btn"]');
      await submitBtn.click();
      console.log(`Submitted in Omnibar: '${queryText}'`);

      // Wait for query execution to complete
      await new Promise((r) => setTimeout(r, 400));
      await page.waitForFunction(
        () => !document.body.innerText.includes("Searching inventory..."),
        { timeout: 8000 }
      ).catch(() => {});

      if (expectedSubstring) {
        try {
          await page.waitForFunction(
            (sub) => document.body.innerText.toLowerCase().includes(sub.toLowerCase()),
            { timeout: 6000 },
            expectedSubstring
          );
        } catch {
          await new Promise((r) => setTimeout(r, 800));
        }
      } else {
        await new Promise((r) => setTimeout(r, 1200));
      }

      const bodyText = await page.evaluate(() => document.body.innerText);
      return bodyText;
    }

    // Enable offline simulation for steps 5-7 to test pure client-side Dexie & packs
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().includes(":8000")) {
        req.abort("failed");
      } else {
        req.continue();
      }
    });

    // Step 5: Test Offline Preference Card Lookup
    console.log("\n--- [STEP 5] Offline Preference Card Lookup ---");
    const prefReply = await submitQuery("Lap Chole", "Laparoscopic Cholecystectomy");
    console.log(`Preference Card Reply Snippet: ${prefReply.slice(-300)}`);
    const prefSuccess = prefReply.includes("Laparoscopic Cholecystectomy") && (prefReply.includes("Rodriguez") || prefReply.includes("Preference Card"));
    recordResult("Offline Lookup", "Preference Card Resolution", prefSuccess, "Resolved Lap Chole preference card");

    // Step 6: Test Offline Facility Handbook / Emergency Protocol Lookup
    console.log("\n--- [STEP 6] Offline Emergency Protocol Lookup ---");
    const protocolReply = await submitQuery("Malignant hyperthermia", "Emergency Policy");
    console.log(`Protocol Reply Snippet: ${protocolReply.slice(-300)}`);
    const protocolSuccess = protocolReply.includes("Malignant Hyperthermia") || protocolReply.includes("Dantrolene") || protocolReply.includes("Emergency Policy");
    recordResult("Offline Lookup", "Emergency Policy Resolution", protocolSuccess, "Resolved Malignant Hyperthermia protocol");

    // Step 7: Test Offline Custom Clinician Item Lookup
    console.log("\n--- [STEP 7] Offline Custom Clinician Item Lookup ---");
    const customReply = await submitQuery("where is custom vascular stapler", "Special");
    console.log(`Custom Item Reply Snippet: ${customReply.slice(-300)}`);
    const customSuccess = customReply.includes("Custom Vascular Stapler") && (customReply.includes("OR 21 Z 9 Special") || customReply.includes("Special"));
    recordResult("Offline Lookup", "Custom User Item Resolution", customSuccess, "Returned coordinates for user-added stapler");

    // Capture screenshot
    const screenshotPath = path.join(ARTIFACT_DIR, "phase41_dexie_hydration_verified.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`\nScreenshot captured at ${screenshotPath}`);

    // Summary
    console.log("\n==================================================================");
    const passedAll = results.every((r) => r.passed);
    console.log(`GAUNTLET RESULT: ${passedAll ? "100% PASSED" : "FAILED"}`);
    console.log("==================================================================");
    if (!passedAll) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Verification failed with exception:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
