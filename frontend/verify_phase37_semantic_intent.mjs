/**
 * Phase 37 E2E Verification: Semantic Intent Parser & Biased Clinical Listening Engine.
 * Tests:
 * 1. Spoken voice normalization pill (🎙️ Recognized: "4-0 vicryl")
 * 2. 1-tap suture gauge disambiguation chips ([0] [2-0] [3-0] [4-0] [5-0])
 * 3. Conversational Quick-Add Inventory Card with inline confirmation (+5 XP)
 */

import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("==================================================================");
  console.log("=== PHASE 37 SEMANTIC INTENT & CLINICAL LISTENING GAUNTLET ===");
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

    // Step 2: Test Spoken Voice Normalization Pill: "four oh viker"
    console.log("\n--- [STEP 2] Spoken Voice Speech Biasing: 'four oh viker' ---");
    const omnibar = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 5000 });
    await omnibar.type("four oh viker");
    await page.keyboard.press("Enter");

    await page.waitForSelector('[data-testid="speech-normalized-pill"]', { timeout: 8000 });
    const normText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="speech-normalized-pill"]');
      return el ? el.innerText : "";
    });
    const hasNorm = normText.toLowerCase().includes("4-0 vicryl");
    recordResult("ClinicalSpeechBiasing", "VoicePillRendered", hasNorm, `Found '${normText}'`);

    await new Promise((r) => setTimeout(r, 1000));

    // Step 3: Test Suture Gauge Disambiguation Chips: "where is vicryl"
    console.log("\n--- [STEP 3] Suture Gauge Disambiguation Chips: 'where is vicryl' ---");
    await omnibar.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await omnibar.type("where is vicryl");
    await page.keyboard.press("Enter");

    await page.waitForSelector('[data-testid="disambiguation-chips"]', { timeout: 8000 });
    const chipsText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="disambiguation-chips"]');
      return el ? el.innerText : "";
    });
    const hasGauges = chipsText.includes("3-0") && chipsText.includes("4-0");
    recordResult("DisambiguationChips", "GaugeChipsRendered", hasGauges, `Chips: '${chipsText}'`);

    await new Promise((r) => setTimeout(r, 1000));

    // Step 4: Test Conversational Quick-Add Inventory Card: "can you add open heart tray to the list"
    console.log("\n--- [STEP 4] Conversational Inventory Addition (Quick-Add Card) ---");
    await omnibar.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await omnibar.type("can you add open heart tray to the list");
    await page.keyboard.press("Enter");

    await page.waitForSelector('[data-testid="inline-quick-add-card"]', { timeout: 8000 });
    recordResult("ConversationalMutation", "QuickAddCardRendered", true, "Rendered inline quick-add card");

    // Click [✓ Save Item to Inventory (+5 XP)]
    const saveBtn = await page.waitForSelector('[data-testid="save-quick-add-btn"]', { timeout: 5000 });
    await saveBtn.click();

    await page.waitForSelector('[data-testid="inline-quick-add-saved"]', { timeout: 8000 });
    const savedText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="inline-quick-add-saved"]');
      return el ? el.innerText : "";
    });
    const hasSaved = savedText.includes("saved to inventory") || savedText.includes("+5 XP");
    recordResult("ConversationalMutation", "ItemSavedToInventory", hasSaved, `Saved confirm: '${savedText}'`);

    // Capture Proof Screenshot
    const screenshotPath = path.join(ARTIFACT_DIR, "phase37_semantic_intent_verified.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\n📸 Captured gauntlet proof screenshot -> ${screenshotPath}`);

    console.log("\n==================================================================");
    console.log("=== GAUNTLET SUMMARY ===");
    console.log("==================================================================");
    const passedCount = results.filter((r) => r.passed).length;
    console.log(`Passed: ${passedCount}/${results.length}`);
    if (passedCount === results.length) {
      console.log("🎉 ALL PHASE 37 E2E GAUNTLET TESTS PASSED!");
    } else {
      console.log("❌ SOME TESTS FAILED!");
      process.exit(1);
    }
  } catch (err) {
    console.error("Gauntlet fatal error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
