import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const ARTIFACT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("Launching headless Chrome for Phase 16 Chaos & Concurrency Gauntlet...");
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
    await sleep(1000);

    // =========================================================================
    // VECTOR 6: Rapid-Fire Mic Mashing & MediaStream Leak Audit
    // =========================================================================
    console.log("\n--- VECTOR 6: Rapid-Fire Mic Mashing Test ---");
    const micBtn = await page.waitForSelector('[data-testid="ptt-mic-btn"]');
    if (!micBtn) throw new Error("Mic button not found!");

    console.log("Mashing mic button 6 times rapidly (100ms intervals)...");
    for (let i = 0; i < 6; i++) {
      await micBtn.click();
      await sleep(100);
    }

    console.log("Waiting 2.5s for state machine and audio cleanup to settle...");
    await sleep(2500);

    const micStatus = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="omnibar-input"]');
      const mic = document.querySelector('[data-testid="ptt-mic-btn"]');
      return {
        inputDisabled: input ? input.disabled : null,
        placeholder: input ? input.getAttribute("placeholder") : null,
        micClasses: mic ? mic.className : null,
      };
    });

    console.log("Post-mashing UI status:", JSON.stringify(micStatus, null, 2));

    if (micStatus.inputDisabled) {
      throw new Error("Omnibar input remained disabled/locked after mic mashing!");
    }

    const micMashingScreenshot = path.join(
      ARTIFACT_DIR,
      "phase16_mic_mashing_recovery.png"
    );
    await page.screenshot({ path: micMashingScreenshot });
    console.log(`Saved screenshot: ${micMashingScreenshot}`);

    // =========================================================================
    // VECTOR 7: Mid-Query Offline Drop & Re-Sync Recovery
    // =========================================================================
    console.log("\n--- VECTOR 7: Mid-Query Offline Drop & Re-Sync Recovery ---");

    async function submitOmnibar(text) {
      const inputSelector = '[data-testid="omnibar-input"]';
      await page.waitForSelector(inputSelector);
      await page.click(inputSelector, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(inputSelector, text);
      await page.keyboard.press("Enter");
    }

    // Ensure IndexedDB is populated
    await sleep(800);

    console.log("Simulating network drop (setOfflineMode = true)...");
    await page.setOfflineMode(true);
    await sleep(300);

    // 1. Offline Homophone Lookup: "where is the bakery" -> should match DeBakey Forceps
    console.log("Query 1 (Offline Homophone): 'where is the bakery'...");
    await submitOmnibar("where is the bakery");
    await page.waitForFunction(
      () => document.body.innerText.includes("DeBakey Forceps"),
      { timeout: 6000 }
    );
    await sleep(400);

    const cardsAfterQuery1 = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="coordinate-card"]'));
      return cards.map((c) => ({
        item: c.querySelector("h3")?.textContent?.trim(),
        alias: c.querySelector("p")?.textContent?.trim(),
      }));
    });
    console.log("Cards rendered after Query 1:", JSON.stringify(cardsAfterQuery1, null, 2));
    if (!cardsAfterQuery1.some((c) => c.item?.includes("DeBakey Forceps"))) {
      throw new Error("Offline homophone query 'the bakery' failed to resolve DeBakey Forceps!");
    }

    // 2. Offline Conflicting Suture Gauge: "where is 5-0 prolene" -> MUST NOT match 4-0 Prolene!
    console.log("Query 2 (Offline Conflicting Gauge): 'where is 5-0 prolene'...");
    await submitOmnibar("where is 5-0 prolene");
    await sleep(1500);

    const cardsAfterQuery2 = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="coordinate-card"]'));
      return cards.map((c) => ({
        item: c.querySelector("h3")?.textContent?.trim(),
      }));
    });
    console.log("Cards rendered after Query 2:", JSON.stringify(cardsAfterQuery2, null, 2));
    // Verify that NO card for "Prolene" was added!
    const proleneCards = cardsAfterQuery2.filter((c) => c.item?.toLowerCase().includes("prolene"));
    if (proleneCards.length > 0) {
      throw new Error(`CRITICAL SUTURE GAUGE VIOLATION: Offline query '5-0 prolene' falsely matched ${JSON.stringify(proleneCards)}!`);
    }

    // 3. Offline Valid Suture: "where is 3-0 silk" -> should resolve 3-0 Silk Suture
    console.log("Query 3 (Offline Valid Suture): 'where is 3-0 silk'...");
    await submitOmnibar("where is 3-0 silk");
    await page.waitForFunction(
      () => document.body.innerText.includes("3-0 Silk Suture"),
      { timeout: 6000 }
    );
    await sleep(400);

    const cardsAfterQuery3 = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="coordinate-card"]'));
      return cards.map((c) => c.querySelector("h3")?.textContent?.trim());
    });
    console.log("Cards rendered after Query 3:", JSON.stringify(cardsAfterQuery3, null, 2));
    if (!cardsAfterQuery3.some((name) => name?.includes("3-0 Silk Suture"))) {
      throw new Error("Offline query '3-0 silk' failed to resolve 3-0 Silk Suture!");
    }

    const offlineScreenshot = path.join(
      ARTIFACT_DIR,
      "phase16_offline_gauge_guard.png"
    );
    await page.screenshot({ path: offlineScreenshot });
    console.log(`Saved screenshot: ${offlineScreenshot}`);

    // 4. Online Reconnect & Re-Sync: "where is 2-0 prolene"
    console.log("\nReconnecting network (setOfflineMode = false)...");
    await page.setOfflineMode(false);
    await sleep(500);

    console.log("Query 4 (Online Server Query): 'where is 2-0 prolene'...");
    await submitOmnibar("where is 2-0 prolene");
    await page.waitForFunction(
      () => document.body.innerText.includes("2-0 Prolene Suture"),
      { timeout: 8000 }
    );
    await sleep(400);

    const cardsAfterQuery4 = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="coordinate-card"]'));
      return cards.map((c) => c.querySelector("h3")?.textContent?.trim());
    });
    console.log("Cards rendered after Query 4 (Online):", JSON.stringify(cardsAfterQuery4, null, 2));
    if (!cardsAfterQuery4.some((name) => name?.includes("2-0 Prolene Suture"))) {
      throw new Error("Online query '2-0 prolene' failed to resolve after reconnect!");
    }

    const onlineScreenshot = path.join(
      ARTIFACT_DIR,
      "phase16_online_resync_recovery.png"
    );
    await page.screenshot({ path: onlineScreenshot });
    console.log(`Saved screenshot: ${onlineScreenshot}`);

    console.log("\n>>> ALL VECTOR 6 & 7 BROWSER CHAOS TESTS PASSED SUCCESSFULLY! <<<");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
