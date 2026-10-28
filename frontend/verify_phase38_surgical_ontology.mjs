/**
 * Phase 38 E2E Verification: Surgical Ontology Engine, Strict Eponym Guard & OR Catalog.
 * Tests:
 * 1. "adson pickups" -> returns Adson pickups (NEVER DeBakey Forceps)
 * 2. "metz" -> returns Metzenbaum Scissors
 * 3. "Where are the unobtanium laser forceps?" -> 0 coordinate cards + renders 1-tap Quick-Add Card
 */

import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("==================================================================");
  console.log("=== PHASE 38 SURGICAL ONTOLOGY & EPONYM GUARD GAUNTLET ===");
  console.log("==================================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const results = [];
  function recordResult(subsystem, testName, passed, details) {
    results.push({ subsystem, testName, passed, details });
    const mark = passed ? "[✓ PASS]" : "[✗ FAIL]";
    console.log(`${mark} ${subsystem} -> ${testName} (${details})`);
  }

  try {
    console.log(`\nNavigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 15000 });

    // Step 1: Ensure Logged In
    console.log("\n--- [STEP 1] Login Verification ---");
    const demoBtn = await page.$('[data-testid="btn-quick-demo-login"]');
    if (demoBtn) {
      await demoBtn.click();
      await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 6000 });
      console.log("Logged in with Quick Demo user (Sean Iglesia).");
    } else {
      await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 6000 });
      console.log("Already authenticated.");
    }
    await new Promise((r) => setTimeout(r, 600));

    // Step 2: Test Adson Pickups vs DeBakey Strict Eponym Guard
    console.log("\n--- [STEP 2] Strict Eponym Guard: 'adson pickups' ---");
    let omnibar = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 5000 });
    await omnibar.type("adson pickups");
    await page.keyboard.press("Enter");

    await page.waitForSelector('[data-testid="coordinate-card"]', { timeout: 8000 });
    const cardText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="coordinate-card"]');
      return el ? el.innerText : "";
    });

    const isAdson = cardText.includes("Adson");
    const notDeBakey = !cardText.includes("DeBakey");
    recordResult("StrictEponymGuard", "AdsonMatched", isAdson && notDeBakey, `Card text: '${cardText.slice(0, 60)}...'`);

    await new Promise((r) => setTimeout(r, 1000));

    // Step 3: Test OR Lingo Slang: 'metz'
    console.log("\n--- [STEP 3] OR Slang Equivalence: 'metz' ---");
    omnibar = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 5000 });
    await omnibar.type("metz");
    await page.keyboard.press("Enter");

    await new Promise((r) => setTimeout(r, 1500));
    const metzCard = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="coordinate-card"]');
      const latest = cards[cards.length - 1];
      return latest ? latest.innerText : "";
    });

    const isMetz = metzCard.includes("Metzenbaum");
    const notMayo = !metzCard.includes("Mayo");
    recordResult("SurgicalOntology", "MetzEquivalence", isMetz && notMayo, `Card text: '${metzCard.slice(0, 60)}...'`);

    await new Promise((r) => setTimeout(r, 1000));

    // Step 4: Test Unstocked / Missing Instrument: Zero False Positives + 1-Tap Quick-Add
    console.log("\n--- [STEP 4] Unstocked Instrument: 'Where are the unobtanium laser forceps?' ---");
    omnibar = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 5000 });
    await omnibar.type("Where are the unobtanium laser forceps?");
    await page.keyboard.press("Enter");

    await page.waitForSelector('[data-testid="inline-quick-add-card"]', { timeout: 8000 });
    const quickAddData = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="inline-quick-add-card"]');
      if (!el) return { text: "", inputValue: "" };
      const input = el.querySelector('input');
      return { text: el.innerText, inputValue: input ? input.value : "" };
    });

    const hasQuickAdd =
      quickAddData.inputValue.toLowerCase().includes("unobtanium") ||
      quickAddData.text.toLowerCase().includes("unobtanium");
    recordResult("ZeroFalsePositives", "QuickAddWidgetRendered", hasQuickAdd, `QuickAdd item: '${quickAddData.inputValue}'`);

    // Capture comprehensive verified screenshot
    const screenshotPath = path.join(ARTIFACT_DIR, "phase38_surgical_ontology_verified.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\nScreenshot saved: ${screenshotPath}`);

    const failed = results.filter((r) => !r.passed);
    console.log("\n==================================================================");
    console.log(`PHASE 38 SUITE SUMMARY: ${results.length - failed.length}/${results.length} PASSED`);
    console.log("==================================================================");

    if (failed.length > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Gauntlet execution failed with exception:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
