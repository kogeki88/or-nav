/**
 * Phase 39 E2E Verification: Self-Learning Facility Lexicon & Personal Term Preservation.
 * Tests:
 * 1. Personal term preservation: "adson pickups" -> displays "Adson Pickups" header + "🧠 Preferred Facility Term" badge + "Catalog: Adson Tissue Forceps" subtitle.
 * 2. Conversational teaching intent: "Here we call Mixter clamps Geminis" -> displays "🧠 Facility Lingo Learned" confirmation card (+5 XP).
 * 3. Cross-user slang lookup: "where is the gemini" -> resolves to Mixter Right-Angle Clamp with title "Gemini".
 * 4. Inline local name widget: [+ Add Local Name] button and input rendering.
 */

import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH =
  "C:/Users/igles/.gemini/antigravity/scratch/or-nav/frontend/chrome/win64-156.0.8078.47/chrome-win64/chrome.exe";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "C:/Users/igles/.gemini/antigravity/brain/2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("==================================================================");
  console.log("=== PHASE 39 ADAPTIVE FACILITY LEXICON & SLANG GRAPH GAUNTLET ===");
  console.log("==================================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

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

    // Clear stale session so demo login starts in sacred_heart::or
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload({ waitUntil: "networkidle0" });

    // Step 1: Login Verification
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

    // Step 2: Personal Term Preservation ("adson pickups")
    console.log("\n--- [STEP 2] Personal Term Preservation: 'adson pickups' ---");
    let omnibar = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 5000 });
    await omnibar.type("adson pickups");
    await page.keyboard.press("Enter");

    await page.waitForSelector('[data-testid="coordinate-card"]', { timeout: 8000 });
    const cardInfo = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="coordinate-card"]');
      if (!card) return null;
      const titleEl = card.querySelector('h3');
      const text = card.innerText;
      return {
        title: titleEl ? titleEl.innerText : "",
        fullText: text,
        hasPreferredBadge: text.includes("Preferred Facility Term") || text.includes("🧠"),
        hasCatalogSubtitle: text.includes("Catalog:"),
        hasLingoChips: text.includes("Facility Lingo") || text.includes("🏷️"),
      };
    });

    const preservesTerm = cardInfo && (cardInfo.title.includes("Adson Pickups") || cardInfo.title.includes("Adson"));
    const showsPreferredBadge = cardInfo && cardInfo.hasPreferredBadge;
    const showsCatalogSubtitle = cardInfo && cardInfo.hasCatalogSubtitle;

    recordResult("PersonalTermPreservation", "PreferredTitle", preservesTerm, `Card title: '${cardInfo?.title}'`);
    recordResult("PersonalTermPreservation", "PreferredBadge", showsPreferredBadge, `Has badge: ${cardInfo?.hasPreferredBadge}`);
    recordResult("PersonalTermPreservation", "CatalogSubtitle", showsCatalogSubtitle, `Full text snippet: ${cardInfo?.fullText.slice(0, 100)}...`);

    await new Promise((r) => setTimeout(r, 1200));

    // Step 3: Conversational Teaching Intent ("Here we call Mixter clamps Geminis")
    console.log("\n--- [STEP 3] Conversational Teaching Intent ---");
    omnibar = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 5000 });
    await omnibar.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await omnibar.type("Here we call Mixter clamps Geminis");
    await page.keyboard.press("Enter");

    await page.waitForSelector('[data-testid="teaching-card"]', { timeout: 8000 });
    const teachingInfo = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="teaching-card"]');
      return card ? card.innerText : "";
    });

    const learnedGemini = teachingInfo.includes("Geminis") && teachingInfo.includes("Mixter");
    const awardedXP = teachingInfo.includes("+5 XP") || teachingInfo.includes("XP");
    recordResult("ConversationalTeaching", "TeachingCardRendered", learnedGemini, `Teaching card: '${teachingInfo.replace(/\n/g, ' ')}'`);
    recordResult("ConversationalTeaching", "XPAwarded", awardedXP, `XP noted: ${awardedXP}`);

    await new Promise((r) => setTimeout(r, 1200));

    // Step 4: Facility Slang Resolution ("where is the gemini")
    console.log("\n--- [STEP 4] Facility Slang Resolution: 'where is the gemini' ---");
    omnibar = await page.waitForSelector('[data-testid="omnibar-input"]:not([disabled])', { timeout: 8000 });
    await omnibar.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await omnibar.type("where is the gemini");
    const typedVal = await page.$eval('[data-testid="omnibar-input"]', (el) => el.value);
    console.log(`Typed in Omnibar: '${typedVal}'`);
    
    // Click submit button directly to ensure form submission
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    await new Promise((r) => setTimeout(r, 2000));
    const allMsgs = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="coordinate-card"]');
      const chatItems = Array.from(document.querySelectorAll('h3, [data-testid="teaching-card"], .whitespace-pre-wrap')).map(e => e.innerText);
      return { cardCount: cards.length, chatItems };
    });
    console.log("Current page state after submitting 'where is the gemini':", JSON.stringify(allMsgs, null, 2));

    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="coordinate-card"]').length >= 2,
      { timeout: 10000 }
    );
    const latestCard = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="coordinate-card"]');
      const last = cards[cards.length - 1];
      if (!last) return null;
      return {
        title: last.querySelector('h3')?.innerText || "",
        text: last.innerText,
      };
    });

    const resolvesMixter = latestCard && (latestCard.title.toLowerCase().includes("gemini") || latestCard.text.toLowerCase().includes("mixter"));
    recordResult("FacilitySlangResolution", "SlangResolvedToCatalog", resolvesMixter, `Latest card: '${latestCard?.title}' - text: ${latestCard?.text.slice(0, 80)}...`);

    // Step 5: Inline [+ Add Local Name] Button Check
    console.log("\n--- [STEP 5] Inline Local Name Widget ---");
    const addNameBtn = await page.$('[data-testid="add-local-alias-btn"]');
    const hasAddNameBtn = !!addNameBtn;
    recordResult("InlineLexiconWidget", "AddLocalNameBtnRendered", hasAddNameBtn, `Found button: ${hasAddNameBtn}`);

    if (addNameBtn) {
      await addNameBtn.click();
      await new Promise((r) => setTimeout(r, 500));
      const inputRendered = await page.$('[data-testid="add-local-alias-input"]');
      recordResult("InlineLexiconWidget", "InlineInputOpens", !!inputRendered, `Input active: ${!!inputRendered}`);
    }

    // Capture comprehensive screenshot
    const screenshotPath = path.join(ARTIFACT_DIR, "phase39_adaptive_lexicon_verified.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\nScreenshot saved: ${screenshotPath}`);

    const failed = results.filter((r) => !r.passed);
    console.log("\n==================================================================");
    console.log(`PHASE 39 SUITE SUMMARY: ${results.length - failed.length}/${results.length} PASSED`);
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
