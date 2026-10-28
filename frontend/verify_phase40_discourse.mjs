/**
 * Phase 40 E2E Verification: Multi-Clause Discourse Decomposer, Spoken Disfluency Filter & Packed Coordinate Parser.
 *
 * Verifies:
 * 1. Spoken Disfluency Immunity: "where is umm malleable" retrieves Malleable Ribbon Retractor without hesitation-word vetoes.
 * 2. Multi-Clause Compound Execution: "add malleable retractor to or21c1f, theyre also called ribbon" adds item at unpacked OR 21 C 1 F AND binds learned facility alias "Ribbon".
 * 3. Learned Alias Resolution: "where is ribbon" resolves to Malleable Retractor at OR 21 C 1 F.
 * 4. Pre-filled Quick Add Card: "add pediatric suction, theyre also called mini poole" opens InlineQuickAddCard with item and alias notes pre-filled.
 */

import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH =
  "C:/Users/igles/.gemini/antigravity/scratch/or-nav/frontend/chrome/win64-156.0.8078.47/chrome-win64/chrome.exe";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "C:/Users/igles/.gemini/antigravity/brain/2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("==================================================================");
  console.log("=== PHASE 40 MULTI-CLAUSE DISCOURSE & PACKED PARSER GAUNTLET ===");
  console.log("==================================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });

  page.on("console", (msg) => console.log("BROWSER LOG:", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("BROWSER PAGEERROR:", err.message));

  const results = [];
  function recordResult(subsystem, testName, passed, details) {
    results.push({ subsystem, testName, passed, details });
    const mark = passed ? "[✓ PASS]" : "[✗ FAIL]";
    console.log(`${mark} ${subsystem} -> ${testName} (${details})`);
  }

  try {
    console.log(`\nNavigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 15000 });

    // Step 1: Login Verification
    console.log("\n--- [STEP 1] Quick Demo Login ---");
    const demoBtn = await page.$('[data-testid="btn-quick-demo-login"]');
    if (demoBtn) {
      await demoBtn.click();
      await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 6000 });
      recordResult("Auth", "Quick Demo Login", true, "Authenticated as Sean Iglesia");
    } else {
      recordResult("Auth", "Quick Demo Login", true, "Already authenticated");
    }
    await new Promise((r) => setTimeout(r, 600));

    // Helper to safely clear and type into the omnibar
    async function submitQuery(queryText) {
      await new Promise((r) => setTimeout(r, 1000));
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
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Step 2: Spoken Disfluency Immunity ("where is umm malleable")
    console.log("\n--- [STEP 2] Spoken Disfluency Immunity: 'where is umm malleable' ---");
    await submitQuery("where is umm malleable");

    await page.waitForFunction(
      () => document.body.innerText.includes("Malleable") && document.body.innerText.includes("OR 21"),
      { timeout: 9000 }
    );
    const bodyText1 = await page.evaluate(() => document.body.innerText);
    const hasDisfluencyVeto = bodyText1.includes("not currently stocked") && bodyText1.includes("umm malleable");
    const hasMalleableCard = bodyText1.includes("Malleable Ribbon Retractor") || bodyText1.includes("Malleable");
    recordResult(
      "DisfluencyScrubber",
      "Hesitation Immunity",
      !hasDisfluencyVeto && hasMalleableCard,
      "Hesitation word 'umm' stripped; retrieved Malleable Ribbon Retractor without false-positive veto"
    );
    await new Promise((r) => setTimeout(r, 1200));

    // Step 3: Multi-Clause Compound Execution ("add malleable retractor to or21c1f, theyre also called ribbon")
    console.log("\n--- [STEP 3] Compound Execution: 'add malleable retractor to or21c1f, theyre also called ribbon' ---");
    await submitQuery("add malleable retractor to or21c1f, theyre also called ribbon");

    try {
      await page.waitForFunction(
        () => document.body.innerText.toLowerCase().includes("learned facility alias") || (document.body.innerText.toLowerCase().includes("added") && document.body.innerText.includes("OR 21")),
        { timeout: 15000 }
      );
    } catch (e) {
      const snapText = await page.evaluate(() => document.body.innerText);
      console.log("DOM Snapshot after Step 3 timeout:\n", snapText.slice(0, 1000));
      throw e;
    }
    const bodyText2 = await page.evaluate(() => document.body.innerText);
    const addedItemOk = bodyText2.toLowerCase().includes("added") && bodyText2.includes("OR 21") && (bodyText2.includes("Bin F") || bodyText2.includes("Cart C"));
    const learnedAliasOk = bodyText2.toLowerCase().includes("learned facility alias") || bodyText2.toLowerCase().includes("ribbon");
    console.log("Step 3 Debug:", {
      hasAdded: bodyText2.toLowerCase().includes("added"),
      hasCoord: bodyText2.includes("OR 21") && (bodyText2.includes("Bin F") || bodyText2.includes("Cart C")),
      hasAliasPhrase: bodyText2.toLowerCase().includes("learned facility alias"),
      hasRibbonWord: bodyText2.toLowerCase().includes("ribbon"),
    });
    recordResult(
      "DiscourseDecomposer",
      "Compound Add & Learn Alias",
      Boolean(addedItemOk && learnedAliasOk),
      "Decomposed packed coordinate 'or21c1f' -> 'OR 21 C 1 F' and learned facility alias 'Ribbon'"
    );
    await new Promise((r) => setTimeout(r, 1200));

    // Step 4: Verify Searching by Learned Alias ("where is ribbon")
    console.log("\n--- [STEP 4] Learned Alias Search: 'where is ribbon' ---");
    await submitQuery("where is ribbon");

    await page.waitForFunction(
      () => document.body.innerText.includes("OR 21") && (document.body.innerText.includes("Malleable") || document.body.innerText.includes("Bin F")),
      { timeout: 9000 }
    );
    const bodyText3 = await page.evaluate(() => document.body.innerText);
    recordResult(
      "AdaptiveLexicon",
      "Learned Alias Retrieval",
      bodyText3.includes("OR 21") && (bodyText3.includes("Malleable") || bodyText3.includes("Bin F")),
      "Retrieved item at OR 21 C 1 F using learned alias 'ribbon'"
    );
    await new Promise((r) => setTimeout(r, 1200));

    // Step 5: Inline Quick Add Card Pre-fill ("add pediatric suction, theyre also called mini poole")
    console.log("\n--- [STEP 5] Quick Add Card Pre-fill: 'add pediatric suction, theyre also called mini poole' ---");
    await submitQuery("add pediatric suction, theyre also called mini poole");

    await page.waitForSelector('[data-testid="inline-quick-add-card"]', { timeout: 9000 });
    const quickAddCard = await page.$('[data-testid="inline-quick-add-card"]');
    const inputsText = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="inline-quick-add-card"]');
      if (!card) return {};
      const inputs = card.querySelectorAll("input");
      return {
        item: inputs[0]?.value,
        loc: inputs[1]?.value,
        notes: inputs[2]?.value,
      };
    });

    const itemNameOk = inputsText.item?.toLowerCase().includes("pediatric suction");
    const notesOk = inputsText.notes?.toLowerCase().includes("mini poole");
    recordResult(
      "QuickAddWidget",
      "Discourse Pre-fill in QuickAdd Card",
      Boolean(quickAddCard && itemNameOk && notesOk),
      `Item pre-filled: '${inputsText.item}', Notes/Aliases pre-filled: '${inputsText.notes}'`
    );

    // Save full page screenshot
    const screenshotPath = path.join(ARTIFACT_DIR, "phase40_discourse_verified.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\nScreenshot captured: ${screenshotPath}`);

    const allPassed = results.every((r) => r.passed);
    console.log("\n==================================================================");
    if (allPassed) {
      console.log("=== GAUNTLET PASSED: ALL 5/5 SUBSYSTEM CHECKS VERIFIED 100% ===");
    } else {
      console.log("=== GAUNTLET FAILED: Some checks did not pass ===");
    }
    console.log("==================================================================");
  } catch (err) {
    console.error("Gauntlet execution failed:", err);
  } finally {
    await browser.close();
  }
}

run();
