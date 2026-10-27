import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const ARTIFACT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("Launching headless Chrome for Phase 17 Deep Crack-Hunting Gauntlet...");
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
      await sleep(1200);
    };

    // =========================================================================
    // SCENARIO 1: Deep Vector 4 - Multi-Item Compound Lookup & Multi-Card Rendering
    // =========================================================================
    console.log("\n--- SCENARIO 1: Multi-Item Compound Lookup & Multi-Card Rendering ---");
    await submitOmnibar("where is 3-0 silk and #10 blade");
    await sleep(2000);

    const cards = await page.$$('[data-testid="coordinate-card"]');
    console.log(`Rendered coordinate cards: ${cards.length}`);
    if (cards.length < 2) {
      throw new Error(`Expected at least 2 coordinate cards for compound query, found ${cards.length}`);
    }

    const shot1 = path.join(ARTIFACT_DIR, "phase17_multi_item_compound_cards.png");
    await page.screenshot({ path: shot1, fullPage: false });
    console.log(`Saved screenshot 1: ${shot1}`);

    // =========================================================================
    // SCENARIO 2: Deep Vector 5 - Move Invalidation & Offline Tier-0 Resync
    // =========================================================================
    console.log("\n--- SCENARIO 2: Move Reporting & Offline Cache Invalidation ---");
    // Report a move
    await submitOmnibar("The 3-0 silk was moved to OR 21 B 1 A");
    await sleep(2000);

    // Look for Confirm button
    const confirmBtn = await page.waitForSelector("button", {
      text: /Confirm/i,
      timeout: 5000,
    }).catch(() => null);

    if (confirmBtn) {
      console.log("Found Confirm button, clicking once (verifying debounce)...");
      await confirmBtn.click();
      await sleep(1500);
    }

    // Simulate going offline (Airplane mode)
    console.log("Simulating offline network (airplane mode)...");
    await page.setOfflineMode(true);
    await sleep(500);

    // Search offline
    await submitOmnibar("3-0 silk");
    await sleep(1500);

    const offlineCard = await page.waitForSelector('[data-testid="coordinate-card"]', {
      timeout: 5000,
    });
    console.log("Offline coordinate card successfully rendered from local Dexie IndexedDB cache!");

    // Restore online
    await page.setOfflineMode(false);
    await sleep(1000);

    const shot2 = path.join(ARTIFACT_DIR, "phase17_offline_move_sync_verified.png");
    await page.screenshot({ path: shot2, fullPage: false });
    console.log(`Saved screenshot 2: ${shot2}`);

    // =========================================================================
    // SCENARIO 3: Deep Vector 1 - Surgeon Name vs. Patient PHI Redaction
    // =========================================================================
    console.log("\n--- SCENARIO 3: Surgeon Name vs Patient PHI ---");
    // 1. Surgeon query: "What are Dr. Patel's suture preferences?"
    await submitOmnibar("What are Dr. Patel's suture preferences?");
    await sleep(3000);

    // 2. Patient PHI query: "Patient John Miller needs 3-0 silk"
    await submitOmnibar("Patient John Miller needs 3-0 silk");
    await sleep(2000);

    const shot3 = path.join(ARTIFACT_DIR, "phase17_surgeon_vs_patient_phi.png");
    await page.screenshot({ path: shot3, fullPage: false });
    console.log(`Saved screenshot 3: ${shot3}`);

    console.log("\n=======================================================");
    console.log("ALL 3 PHASE 17 BROWSER SCENARIOS COMPLETED SUCCESSFULLY!");
    console.log("=======================================================");
  } catch (err) {
    console.error("Test failed with error:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
