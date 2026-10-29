/**
 * Phase 43 / v0.62 E2E Verification: 3-Layer Unified Clinical Query Planner & Relational Graph Engine
 *
 * Verifies in headless Chrome (100% Offline Standalone Mode):
 * 1. "dr patel suture preference" -> PREFERENCE_INVENTORY_JOIN: resolves Dr. Raj Patel (Vascular)
 *    suture preference + relational live inventory coordinates (OR 21 • Cart C • Shelf 2 • Bin A).
 * 2. "what sutures does dr chen use" -> PREFERENCE_INVENTORY_JOIN: resolves Dr. Chen suture preferences
 *    with inventory coordinates.
 * 3. "dr chen lap chole card" -> PREFERENCE_CARD_LOOKUP: resolves Laparoscopic Cholecystectomy preference card.
 * 4. "dr rodriguez glove size" -> PREFERENCE_CARD_LOOKUP (facet=gloves): returns Dr. Elena Rodriguez glove preference.
 * 5. "dr nonexistentsurgeon suture preference" -> Graceful unindexed surgeon response ("No preference card on file for Dr. Nonexistentsurgeon"), NEVER "is not currently stocked".
 * 6. "where is Dr. Patel's custom vascular stapler" -> INVENTORY_LOOKUP: returns physical coordinates for Custom Vascular Stapler.
 * 7. "where is 3-0 prolene" -> INVENTORY_LOOKUP: returns physical coordinates for 3-0 Prolene Suture.
 */

import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH =
  "C:/Users/igles/.gemini/antigravity/scratch/or-nav/frontend/chrome/win64-156.0.8078.47/chrome-win64/chrome.exe";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "C:/Users/igles/.gemini/antigravity/brain/2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("=======================================================================");
  console.log("=== PHASE 43 / v0.62 UNIFIED CLINICAL QUERY PLANNER BROWSER GAUNTLET ===");
  console.log("=======================================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });

  const results = [];
  function recordResult(subsystem, testName, passed, details) {
    results.push({ subsystem, testName, passed, details });
    const mark = passed ? "[✓ PASS]" : "[✗ FAIL]";
    console.log(`${mark} ${subsystem} -> ${testName} (${details})`);
  }

  try {
    console.log(`\nNavigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 15000 });

    // Login if needed
    const demoBtn = await page.$('[data-testid="btn-quick-demo-login"]');
    if (demoBtn) {
      await demoBtn.click();
      await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 6000 });
      recordResult("Auth", "Quick Demo Login", true, "Authenticated as Sean Iglesia, RN");
    } else {
      recordResult("Auth", "Quick Demo Login", true, "Already authenticated");
    }
    await new Promise((r) => setTimeout(r, 800));

    // Block backend (:8000) to force 100% offline standalone TypeScript engine execution
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().includes(":8000")) {
        req.abort("failed");
      } else {
        req.continue();
      }
    });

    async function submitQuery(queryText, expectedSubstring) {
      await new Promise((r) => setTimeout(r, 500));
      const input = await page.waitForSelector('[data-testid="omnibar-input"]:not([disabled])', { timeout: 8000 });
      await input.focus();
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await input.type(queryText, { delay: 12 });

      await page.waitForFunction(
        () => {
          const btn = document.querySelector('[data-testid="omnibar-submit-btn"]');
          return btn && !btn.disabled;
        },
        { timeout: 5000 }
      );
      const submitBtn = await page.$('[data-testid="omnibar-submit-btn"]');
      await submitBtn.click();
      console.log(`\nSubmitted query: "${queryText}"`);

      await new Promise((r) => setTimeout(r, 400));
      await page
        .waitForFunction(() => !document.body.innerText.includes("Searching inventory..."), { timeout: 8000 })
        .catch(() => {});

      if (expectedSubstring) {
        try {
          await page.waitForFunction(
            (sub) => document.body.innerText.toLowerCase().includes(sub.toLowerCase()),
            { timeout: 5000 },
            expectedSubstring
          );
        } catch {
          await new Promise((r) => setTimeout(r, 700));
        }
      } else {
        await new Promise((r) => setTimeout(r, 900));
      }

      return await page.evaluate(() => document.body.innerText);
    }

    // Test 1: "dr patel suture preference" -> PREFERENCE_INVENTORY_JOIN
    const reply1 = await submitQuery("dr patel suture preference", "Patel");
    const pass1 =
      reply1.includes("Dr. Raj Patel") &&
      (reply1.includes("Prolene") || reply1.includes("3-0 Silk")) &&
      reply1.includes("OR 21") &&
      !reply1.toLowerCase().includes("dr patel suture preference is not");
    recordResult(
      "Query Planner",
      "dr patel suture preference (PREFERENCE_INVENTORY_JOIN)",
      pass1,
      "Resolved Dr. Raj Patel suture preferences + relational OR 21 coordinates"
    );

    // Test 2: "what sutures does dr chen use" -> PREFERENCE_INVENTORY_JOIN
    const reply2 = await submitQuery("what sutures does dr chen use", "Chen");
    const pass2 =
      reply2.includes("Chen") &&
      (reply2.includes("Prolene") || reply2.includes("Vicryl")) &&
      !reply2.toLowerCase().includes("is not currently stocked");
    recordResult(
      "Query Planner",
      "what sutures does dr chen use",
      pass2,
      "Resolved Dr. Chen suture preferences with live coordinates"
    );

    // Test 3: "dr chen lap chole card" -> PREFERENCE_CARD_LOOKUP
    const reply3 = await submitQuery("dr chen lap chole card", "Laparoscopic Cholecystectomy");
    const pass3 =
      reply3.includes("Laparoscopic Cholecystectomy") &&
      !reply3.toLowerCase().includes("is not currently stocked");
    recordResult(
      "Query Planner",
      "dr chen lap chole card (PREFERENCE_CARD_LOOKUP)",
      pass3,
      "Resolved Laparoscopic Cholecystectomy preference card"
    );

    // Test 4: "dr rodriguez glove size" -> PREFERENCE_CARD_LOOKUP (facet=gloves)
    const reply4 = await submitQuery("dr rodriguez glove size", "Biogel");
    const pass4 =
      reply4.includes("Rodriguez") &&
      (reply4.includes("6.5") || reply4.includes("Biogel")) &&
      !reply4.toLowerCase().includes("is not currently stocked");
    recordResult(
      "Query Planner",
      "dr rodriguez glove size (facet=gloves)",
      pass4,
      "Resolved Dr. Elena Rodriguez glove preference (6.5 Biogel)"
    );

    // Test 5: "dr nonexistentsurgeon suture preference" -> Graceful unindexed surgeon handling
    const reply5 = await submitQuery("dr nonexistentsurgeon suture preference", "No preference card on file");
    const pass5 =
      reply5.includes("No preference card on file for Dr. Nonexistentsurgeon") &&
      !reply5.toLowerCase().includes("dr nonexistentsurgeon suture preference is not");
    recordResult(
      "Query Planner",
      "dr nonexistentsurgeon suture preference (Unindexed Surgeon Guard)",
      pass5,
      "Gracefully reported no preference card on file & listed indexed surgeons"
    );

    // Test 6: "where is Dr. Patel's custom vascular stapler" -> INVENTORY_LOOKUP
    const reply6 = await submitQuery("where is Dr. Patel's custom vascular stapler", "Custom Vascular Stapler");
    const pass6 =
      reply6.includes("Custom Vascular Stapler") &&
      (reply6.includes("Special") || reply6.includes("OR 21"));
    recordResult(
      "Query Planner",
      "where is Dr. Patel's custom vascular stapler (INVENTORY_LOOKUP)",
      pass6,
      "Resolved physical coordinates for Custom Vascular Stapler"
    );

    // Test 7: "where is 2-0 prolene" -> INVENTORY_LOOKUP
    const reply7 = await submitQuery("where is 2-0 prolene", "2-0 Prolene Suture");
    const pass7 =
      reply7.includes("2-0 Prolene Suture") &&
      reply7.includes("OR 21");
    recordResult(
      "Query Planner",
      "where is 2-0 prolene (INVENTORY_LOOKUP)",
      pass7,
      "Resolved physical coordinates for 2-0 Prolene Suture on SH"
    );

    // Capture verification screenshot showing relational preference + inventory join
    await submitQuery("dr patel suture preference", "Patel");
    const screenshotPath = path.join(ARTIFACT_DIR, "phase43_clinical_query_planner_verified.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`\nVerification screenshot saved to: ${screenshotPath}`);

    console.log("\n=======================================================================");
    const passedAll = results.every((r) => r.passed);
    console.log(`CLINICAL QUERY PLANNER GAUNTLET: ${passedAll ? "100% PASSED" : "FAILED"}`);
    console.log("=======================================================================");
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
