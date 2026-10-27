import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const ARTIFACT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("Launching headless Chrome for Phase 18 Second-Order & Race Condition Gauntlet...");
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
    // SCENARIO 1: Vector 1 - Elliptical Shared-Noun Compound Query
    // =========================================================================
    console.log("\n--- SCENARIO 1: Elliptical Shared-Noun Compound Query ---");
    await submitOmnibar("where is 2-0 and 4-0 prolene");
    await page.waitForSelector('[data-testid="coordinate-card"]', { timeout: 10000 });
    await sleep(1000);

    const cards = await page.$$('[data-testid="coordinate-card"]');
    console.log(`Rendered coordinate cards: ${cards.length}`);
    if (cards.length < 2) {
      throw new Error(`Expected at least 2 coordinate cards for elliptical compound query, found ${cards.length}`);
    }

    const cardTexts = await page.$$eval('[data-testid="coordinate-card"]', els => els.map(e => e.innerText));
    console.log("Card titles:", cardTexts.map(t => t.split("\n")[0]));
    const has20 = cardTexts.some(t => t.includes("2-0 Prolene"));
    const has40 = cardTexts.some(t => t.includes("4-0 Prolene"));
    if (!has20 || !has40) {
      throw new Error("Missing either 2-0 Prolene or 4-0 Prolene in rendered cards");
    }

    const shot1 = path.join(ARTIFACT_DIR, "phase18_elliptical_compound_cards.png");
    await page.screenshot({ path: shot1, fullPage: false });
    console.log(`Saved screenshot 1: ${shot1}`);

    // =========================================================================
    // SCENARIO 2: Vector 3 - Split-Brain Competing Move Consensus Reset
    // =========================================================================
    console.log("\n--- SCENARIO 2: Competing Move Reports & Consensus Reset ---");
    // Report initial move to OR 21 B 1 A
    await submitOmnibar("the 3-0 silk moved to or 21 b 1 a");
    await sleep(2000);

    // Verify initial widget
    let pageContent = await page.content();
    if (!pageContent.includes("OR 21 B 1 A")) {
      throw new Error("Move widget did not render initial target OR 21 B 1 A");
    }
    console.log("Initial move to OR 21 B 1 A registered in feed");

    // Submit competing move to Pump Room H 2 A
    await submitOmnibar("the 3-0 silk moved to pump room h 2 a");
    await sleep(2000);

    pageContent = await page.content();
    if (!pageContent.includes("Pump Room H 2 A")) {
      throw new Error("Move widget did not update to competing target Pump Room H 2 A");
    }
    console.log("Competing move to Pump Room H 2 A successfully registered and updated widget");

    const shot2 = path.join(ARTIFACT_DIR, "phase18_competing_move_reset.png");
    await page.screenshot({ path: shot2, fullPage: false });
    console.log(`Saved screenshot 2: ${shot2}`);

    // =========================================================================
    // SCENARIO 3: Vector 6 - Fast + New Case Mid-Flight Abort Guard
    // =========================================================================
    console.log("\n--- SCENARIO 3: Mid-Flight + New Case Abort Guard ---");
    const input = await page.waitForSelector('input[type="text"]');
    await input.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await input.type("What is the Dantrolene dosing for malignant hyperthermia?", { delay: 10 });
    
    // Press Enter and immediately click "+ New Case"
    await page.keyboard.press("Enter");
    
    // Click New Case button within 30ms
    const newCaseBtn = await page.waitForSelector('button[title*="New Case"]');
    await newCaseBtn.click();
    console.log("Clicked + New Case immediately while request in flight");

    // Wait 3.5s for backend request to complete over the network
    await sleep(3500);

    // Verify that the empty state welcome is visible (which ONLY renders when messages.length === 0)
    const emptyStateTitle = await page.$eval('h2', el => el.innerText).catch(() => null);
    console.log(`Empty state title visible: "${emptyStateTitle}"`);
    if (!emptyStateTitle || !emptyStateTitle.includes("What do you need for this case?")) {
      throw new Error(`Expected empty state title containing 'What do you need for this case?', found: "${emptyStateTitle}"`);
    }

    // Verify there are 0 user message bubbles in the chat canvas
    const userBubbles = await page.$$('.rounded-2xl.bg-zinc-800');
    console.log(`User message bubbles in cleared canvas: ${userBubbles.length}`);
    if (userBubbles.length > 0) {
      throw new Error(`Found ${userBubbles.length} user bubbles in what should be an empty case!`);
    }

    // Verify there are 0 coordinate cards
    const remainingCards = await page.$$('[data-testid="coordinate-card"]');
    console.log(`Remaining cards in cleared canvas: ${remainingCards.length}`);
    if (remainingCards.length > 0) {
      throw new Error(`Found ${remainingCards.length} cards in what should be an empty case!`);
    }

    console.log("Success: In-flight response was cleanly discarded, chat session is completely fresh!");

    const shot3 = path.join(ARTIFACT_DIR, "phase18_new_case_abort_clean.png");
    await page.screenshot({ path: shot3, fullPage: false });
    console.log(`Saved screenshot 3: ${shot3}`);

    console.log("\n=======================================================");
    console.log("ALL 3 PHASE 18 BROWSER SCENARIOS COMPLETED SUCCESSFULLY!");
    console.log("=======================================================");
  } catch (err) {
    console.error("Test failed with error:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
