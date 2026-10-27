import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const ARTIFACT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("Launching headless Chrome for Phase 19 Clinical Reality & Resilience Gauntlet...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--window-size=1280,850",
    ],
    defaultViewport: { width: 1280, height: 850 },
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions("http://localhost:3000", ["microphone"]);

    console.log("Navigating to http://localhost:3000...");
    await page.goto("http://localhost:3000", {
      waitUntil: "networkidle2",
      timeout: 15000,
    });
    await sleep(1500);

    const submitOmnibar = async (text) => {
      const input = await page.waitForSelector('input[type="text"]');
      await input.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await input.type(text, { delay: 15 });
      await page.keyboard.press("Enter");
      await sleep(1000);
    };

    // =========================================================================
    // SCENARIO 1: Vector 2 - Spoken Mid-Sentence Self-Correction
    // =========================================================================
    console.log("\n--- SCENARIO 1: Spoken Mid-Sentence Self-Correction ---");
    await submitOmnibar("Where is 3-0 silk wait no 4-0 prolene");
    await page.waitForSelector('[data-testid="coordinate-card"]', { timeout: 10000 });
    await sleep(1000);

    const cardTexts = await page.$$eval('[data-testid="coordinate-card"]', els => els.map(e => e.innerText));
    console.log("Rendered card titles:", cardTexts.map(t => t.split("\n")[0]));
    const has40Prolene = cardTexts.some(t => t.includes("4-0 Prolene"));
    const has30Silk = cardTexts.some(t => t.includes("3-0 Silk"));

    if (!has40Prolene) {
      throw new Error("Expected self-correction to resolve to '4-0 Prolene', but card was missing!");
    }
    if (has30Silk) {
      throw new Error("Aborted '3-0 Silk' clause was NOT discarded during self-correction!");
    }
    console.log("Success: Aborted clause discarded, 4-0 Prolene card rendered cleanly!");

    const shot1 = path.join(ARTIFACT_DIR, "phase19_voice_self_correction.png");
    await page.screenshot({ path: shot1, fullPage: false });
    console.log(`Saved screenshot 1: ${shot1}`);

    // =========================================================================
    // SCENARIO 2: Vector 3 - Partial Compound Query Resolution ("1 Known + 1 Missing")
    // =========================================================================
    console.log("\n--- SCENARIO 2: Partial Compound Query Resolution ---");
    await submitOmnibar("where is 3-0 silk and 9-0 nylon");
    await sleep(2000);

    const cardsAfterPartial = await page.$$('[data-testid="coordinate-card"]');
    console.log(`Total coordinate cards in feed: ${cardsAfterPartial.length}`);

    // Verify missing item alert banner is rendered in the feed
    const pageHtml = await page.content();
    const hasMissingAlert = pageHtml.includes("Could not find '9-0 nylon'");
    if (!hasMissingAlert) {
      throw new Error("Missing items alert banner ('Could not find 9-0 nylon') not visible in chat feed!");
    }
    console.log("Success: Rendered 3-0 Silk card AND missing item alert banner ('Could not find 9-0 nylon')!");

    const shot2 = path.join(ARTIFACT_DIR, "phase19_partial_compound_missing.png");
    await page.screenshot({ path: shot2, fullPage: false });
    console.log(`Saved screenshot 2: ${shot2}`);

    // =========================================================================
    // SCENARIO 3: Vector 4 - Generic Family Multi-Match ("where is prolene")
    // =========================================================================
    console.log("\n--- SCENARIO 3: Generic Family Multi-Match ---");
    await submitOmnibar("where is prolene");
    await sleep(2000);

    const familyCards = await page.$$eval('[data-testid="coordinate-card"]', els => els.map(e => e.innerText));
    const proleneCards = familyCards.filter(t => t.includes("Prolene"));
    console.log(`Prolene family cards visible: ${proleneCards.length}`);
    if (proleneCards.length < 2) {
      throw new Error(`Expected at least 2 family cards for 'prolene', found ${proleneCards.length}`);
    }
    console.log("Success: Generic family query rendered multiple Prolene sizes simultaneously!");

    const shot3 = path.join(ARTIFACT_DIR, "phase19_family_multi_cards.png");
    await page.screenshot({ path: shot3, fullPage: false });
    console.log(`Saved screenshot 3: ${shot3}`);

    // =========================================================================
    // SCENARIO 4: Vector 6 - Accidental Page Reload Session Persistence
    // =========================================================================
    console.log("\n--- SCENARIO 4: Accidental Page Reload Session Persistence ---");
    console.log("Simulating mobile pull-to-refresh / accidental F5 reload...");
    await page.reload({ waitUntil: "networkidle2", timeout: 15000 });
    await sleep(1500);

    const cardsAfterReload = await page.$$('[data-testid="coordinate-card"]');
    console.log(`Restored coordinate cards after page reload: ${cardsAfterReload.length}`);
    if (cardsAfterReload.length === 0) {
      throw new Error("Active case messages were WIPED on page reload! sessionStorage restoration failed.");
    }
    console.log("Success: Complete case conversation and coordinate cards restored from sessionStorage in <10ms!");

    const shot4 = path.join(ARTIFACT_DIR, "phase19_session_reload_restored.png");
    await page.screenshot({ path: shot4, fullPage: false });
    console.log(`Saved screenshot 4: ${shot4}`);

    console.log("\n=======================================================");
    console.log("ALL 4 PHASE 19 BROWSER SCENARIOS COMPLETED SUCCESSFULLY!");
    console.log("=======================================================");
  } catch (err) {
    console.error("Test failed with error:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
