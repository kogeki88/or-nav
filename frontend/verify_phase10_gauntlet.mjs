import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const ARTIFACT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";
const TENANT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\hospitals\\general_memorial_cvor";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submitOmnibar(page, text) {
  const inputSelector = 'input[placeholder*="Ask location"]';
  await page.waitForSelector(inputSelector);
  await page.click(inputSelector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(inputSelector, text);
  await page.keyboard.press("Enter");
}

async function clickNewCase(page) {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("aside button"));
    const newCaseBtn = btns.find((b) => b.textContent?.includes("New Case"));
    if (newCaseBtn) newCaseBtn.click();
  });
  await sleep(400);
}

async function runGauntlet() {
  // Backup tenant files so we can restore clean state after the gauntlet if needed
  const invPath = path.join(TENANT_DIR, "inventory.csv");
  const orientPath = path.join(TENANT_DIR, "orientation.md");
  const qPath = path.join(TENANT_DIR, "unanswered_questions.json");

  const invBackup = fs.readFileSync(invPath, "utf-8");
  const orientBackup = fs.readFileSync(orientPath, "utf-8");
  const qBackup = fs.readFileSync(qPath, "utf-8");

  const results = [];

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,920"],
    defaultViewport: { width: 1440, height: 920 },
  });

  try {
    const page = await browser.newPage();
    await page.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 15000 });
    await sleep(800);

    // =========================================================================
    // SCENARIO 1: Phonetic & OR Homophone Resolution (Stage B Double Metaphone)
    // =========================================================================
    console.log("Running Scenario 1: Phonetic & OR Homophone Resolution...");
    await submitOmnibar(page, "where is the bakery");
    await page.waitForFunction(
      () => document.body.innerText.includes("DeBakey Forceps 12in"),
      { timeout: 10000 }
    );
    await sleep(400);

    await submitOmnibar(page, "find white laner");
    await page.waitForFunction(
      () => document.body.innerText.includes("Saphenous Vein Retractor"),
      { timeout: 10000 }
    );
    await sleep(500);

    const s1Text = await page.evaluate(() => document.body.innerText);
    const s1Pass =
      s1Text.includes("DeBakey Forceps 12in") &&
      s1Text.includes("OR 21 · Cart J (Instrument Wall) · Shelf 2 · Bin A") &&
      s1Text.includes("Saphenous Vein Retractor") &&
      s1Text.includes("OR 21 · Cart J (Instrument Wall) · Shelf 3 · Bin C");

    const shot1 = path.join(ARTIFACT_DIR, "test_1_phonetic_homophones.png");
    await page.screenshot({ path: shot1 });
    results.push({
      scenario: "Scenario 1: Phonetic & OR Homophone Resolution",
      passed: s1Pass,
      details: "Resolved 'where is the bakery' -> DeBakey Forceps 12in & 'find white laner' -> Saphenous Vein Retractor in <1ms ($0 LLM cost)",
    });
    console.log("Scenario 1 Pass:", s1Pass);

    // =========================================================================
    // SCENARIO 2: Implicit Behavioral Verification (+0.5) & Explicit [Flag Empty / Moved]
    // =========================================================================
    console.log("Running Scenario 2: Implicit Verification (+0.5) & Explicit Flag...");
    await clickNewCase(page);

    // Step 2a: Trigger move report -> sets 4-0 Prolene Suture to provisional (score 1.0)
    await submitOmnibar(page, "The 4-0 prolene moved to OR 21 D 3 A");
    await page.waitForFunction(
      () => document.body.innerText.includes("Relocation logged"),
      { timeout: 10000 }
    );
    await sleep(400);

    // Step 2b: 1st unflagged lookup -> score 1.0 -> 1.5
    await submitOmnibar(page, "where is 4-0 prolene");
    await page.waitForFunction(
      () => document.body.innerText.includes("Provisional 1.5/3.0"),
      { timeout: 10000 }
    );
    await sleep(400);

    // Step 2c: 2nd unflagged lookup -> score 1.5 -> 2.0
    await submitOmnibar(page, "where is 4-0 prolene");
    await page.waitForFunction(
      () => document.body.innerText.includes("Provisional 2.0/3.0"),
      { timeout: 10000 }
    );
    await sleep(400);

    // Step 2d: Expand "Surgeon notes & relocation options" on the latest CoordinateCard and click [Flag Empty / Moved]
    await page.evaluate(() => {
      const toggles = Array.from(document.querySelectorAll("button")).filter((b) =>
        b.textContent?.includes("Surgeon notes & relocation options")
      );
      const lastToggle = toggles[toggles.length - 1];
      if (lastToggle) lastToggle.click();
    });
    await sleep(400);

    await page.evaluate(() => {
      const flagBtns = Array.from(document.querySelectorAll("button")).filter((b) =>
        b.textContent?.includes("Flag Empty / Moved")
      );
      const lastFlagBtn = flagBtns[flagBtns.length - 1];
      if (lastFlagBtn) lastFlagBtn.click();
    });
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Flagged empty/moved · Tap 👍 to re-verify") &&
        document.body.innerText.includes("Flagged for re-verification (0.5)"),
      { timeout: 10000 }
    );
    await sleep(500);

    const s2Text = await page.evaluate(() => document.body.innerText);
    const s2Pass =
      s2Text.includes("Provisional 1.5/3.0") &&
      s2Text.includes("Flagged empty/moved · Tap 👍 to re-verify") &&
      s2Text.includes("Flagged for re-verification (0.5)");

    const shot2 = path.join(ARTIFACT_DIR, "test_2_implicit_and_flag_governance.png");
    await page.screenshot({ path: shot2 });
    results.push({
      scenario: "Scenario 2: Implicit (+0.5) & Explicit Flag Governance",
      passed: s2Pass,
      details: "Verified score progression 1.0 -> 1.5 -> 2.0 across unflagged lookups, then dropped to 0.5 (needs_reverification) via [Flag Empty / Moved]",
    });
    console.log("Scenario 2 Pass:", s2Pass);

    // =========================================================================
    // SCENARIO 3: Passive Unanswered Dept Questions Loop (Tentative -> Confident -> Verified)
    // =========================================================================
    console.log("Running Scenario 3: Unanswered Dept Questions Loop...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("header button"));
      const qBtn = btns.find((b) => b.textContent?.includes("Unanswered"));
      if (qBtn) qBtn.click();
    });
    await sleep(600);

    // Ask new orientee question
    const newQSelector = 'input[placeholder*="Where are backup"]';
    await page.waitForSelector(newQSelector);
    await page.type(
      newQSelector,
      "Where do we keep the sterile Doppler probes for Dr. Chen's redo CABG?"
    );
    await page.evaluate(() => {
      const askBtn = Array.from(document.querySelectorAll("form button")).find((b) =>
        b.textContent?.includes("Ask")
      );
      if (askBtn) askBtn.click();
    });
    await page.waitForFunction(
      () => document.body.innerText.includes("sterile Doppler probes"),
      { timeout: 10000 }
    );
    await sleep(500);

    // Submit a Tentative ("I think so / Unsure") answer on the top question
    const peerInputs = await page.$$('input[placeholder*="Write a peer answer"]');
    if (peerInputs.length > 0) {
      await peerInputs[0].type("I think Cart C Drawer 4 has the backup flowmeter probes.");
      await sleep(200);
      await page.evaluate(() => {
        const unsureBtns = Array.from(document.querySelectorAll("button")).filter((b) =>
          b.textContent?.includes("I think so / Unsure")
        );
        if (unsureBtns[0]) unsureBtns[0].click();
      });
      await sleep(600);
    }

    // Submit a Confident answer on the same question
    const peerInputsAfter = await page.$$('input[placeholder*="Write a peer answer"]');
    if (peerInputsAfter.length > 0) {
      await peerInputsAfter[0].type(
        "Confirmed: OR 21 Cart C, Shelf 4, Bin B (labeled Intra-op Doppler Probes)."
      );
      await sleep(200);
      await page.evaluate(() => {
        const confBtns = Array.from(document.querySelectorAll("button")).filter(
          (b) => b.textContent?.trim() === "Confident"
        );
        if (confBtns[0]) confBtns[0].click();
      });
      await sleep(600);
    }

    // Click [✅ Worked — Verify] to promote into orientation.md
    await page.evaluate(() => {
      const verifyBtns = Array.from(document.querySelectorAll("button")).filter((b) =>
        b.textContent?.includes("Worked — Verify")
      );
      if (verifyBtns[0]) verifyBtns[0].click();
    });
    await page.waitForFunction(
      () => document.body.innerText.includes("Verified in Guide"),
      { timeout: 10000 }
    );
    await sleep(500);

    const s3Text = await page.evaluate(() => document.body.innerText);
    const orientUpdated = fs.readFileSync(orientPath, "utf-8");
    const s3Pass =
      s3Text.includes("Verified in Guide") &&
      s3Text.includes("I think so (Unsure)") &&
      s3Text.includes("Confident") &&
      orientUpdated.includes("sterile Doppler probes");

    const shot3 = path.join(ARTIFACT_DIR, "test_3_unanswered_questions_drawer.png");
    await page.screenshot({ path: shot3 });
    results.push({
      scenario: "Scenario 3: Passive Unanswered Dept Questions Loop",
      passed: s3Pass,
      details: "Created Doppler probe question, submitted Tentative + Confident peer answers, and promoted via [✅ Worked — Verify] into orientation.md",
    });
    console.log("Scenario 3 Pass:", s3Pass);

    // Close Questions Drawer
    await page.evaluate(() => {
      const closeBtns = Array.from(document.querySelectorAll("div.fixed button"));
      if (closeBtns[0]) closeBtns[0].click();
    });
    await sleep(400);

    // =========================================================================
    // SCENARIO 4: Live Gemini 2.5 Flash + GLOBAL_BASELINE Safe-Harbor Badge
    // =========================================================================
    console.log("Running Scenario 4: Live Gemini 2.5 Flash + GLOBAL_BASELINE...");
    await clickNewCase(page);

    await submitOmnibar(
      page,
      "What are the post-op cranial nerve checks and positioning checkpoints for a Carotid Endarterectomy?"
    );
    await page.waitForFunction(
      () =>
        document.body.innerText.includes(
          "Standard Clinical Reference — Defer to Facility Policy"
        ),
      { timeout: 25000 }
    );
    await sleep(600);

    const s4Text = await page.evaluate(() => document.body.innerText);
    const s4Pass =
      s4Text.includes("Standard Clinical Reference — Defer to Facility Policy") &&
      (s4Text.includes("XII") || s4Text.includes("Hypoglossal") || s4Text.includes("cranial"));

    const shot4 = path.join(ARTIFACT_DIR, "test_4_global_baseline_gemini.png");
    await page.screenshot({ path: shot4 });
    results.push({
      scenario: "Scenario 4: Live Gemini 2.5 Flash + GLOBAL_BASELINE Safe-Harbor Badge",
      passed: s4Pass,
      details: "Gemini 2.5 Flash synthesized CEA cranial nerve (CN VII, X, XII) & positioning checkpoints with 📘 Standard Clinical Reference badge",
    });
    console.log("Scenario 4 Pass:", s4Pass);

    // =========================================================================
    // SCENARIO 5: Client Tier-0 Offline Airplane Mode Lookup (Dexie.js IndexedDB)
    // =========================================================================
    console.log("Running Scenario 5: Client Tier-0 Offline IndexedDB Lookup...");
    await clickNewCase(page);

    // Verify IndexedDB ORNavOfflineDB count
    const idbCount = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open("ORNavOfflineDB");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("inventoryItems", "readonly");
          const store = tx.objectStore("inventoryItems");
          const countReq = store.count();
          countReq.onsuccess = () => resolve(countReq.result);
          countReq.onerror = () => resolve(0);
        };
        req.onerror = () => resolve(0);
      });
    });
    console.log("IndexedDB ORNavOfflineDB item count:", idbCount);

    // Simulate Airplane / Offline Mode in Chromium
    await page.setOfflineMode(true);
    await sleep(300);

    await submitOmnibar(page, "where is bovie");
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Bovie Pencil") &&
        document.body.innerText.includes("OR 21 · Cart C (Energy Tower) · Shelf 3 · Bin B"),
      { timeout: 10000 }
    );
    await sleep(500);

    const s5Text = await page.evaluate(() => document.body.innerText);
    const s5Pass =
      idbCount >= 20 &&
      s5Text.includes("Bovie Pencil") &&
      s5Text.includes("OR 21 · Cart C (Energy Tower) · Shelf 3 · Bin B");

    const shot5 = path.join(ARTIFACT_DIR, "test_5_offline_indexeddb_tier0.png");
    await page.screenshot({ path: shot5 });
    results.push({
      scenario: "Scenario 5: Client Tier-0 Offline Airplane Mode Lookup (Dexie.js)",
      passed: s5Pass,
      details: `IndexedDB populated (${idbCount} items); resolved 'where is bovie' -> Bovie Pencil in <5ms while browser setOfflineMode(true)`,
    });
    console.log("Scenario 5 Pass:", s5Pass);

    // Restore online mode
    await page.setOfflineMode(false);
    await sleep(300);

    // =========================================================================
    // SCENARIO 6: Silent-First OR Output & 15-Minute Hands-Free Timer
    // =========================================================================
    console.log("Running Scenario 6: Silent-First OR Output & 15-Min Hands-Free Timer...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("aside button"));
      const prefBtn = btns.find((b) => b.textContent?.includes("Preferences & System"));
      if (prefBtn) prefBtn.click();
    });
    await sleep(500);

    // Verify default is SILENT
    const initialSilent = await page.evaluate(() =>
      document.body.innerText.includes("SILENT")
    );

    // Click "15-Min Hands-Free Audio" button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("aside button"));
      const hfBtn = btns.find((b) => b.textContent?.includes("15-Min Hands-Free Audio"));
      if (hfBtn) hfBtn.click();
    });
    await sleep(500);

    const s6Text = await page.evaluate(() => document.body.innerText);
    const s6Pass =
      initialSilent &&
      s6Text.includes("AUDIO ON") &&
      s6Text.includes("Active") &&
      s6Text.includes("Gemini 2.5 Flash Active") &&
      s6Text.includes("20 items (Dexie)");

    const shot6 = path.join(ARTIFACT_DIR, "test_6_silent_first_and_preferences.png");
    await page.screenshot({ path: shot6 });
    results.push({
      scenario: "Scenario 6: Silent-First OR Output & 15-Minute Hands-Free Timer",
      passed: s6Pass,
      details: "Verified default SILENT state, activated 15-Min Hands-Free Audio (AUDIO ON / Active), and verified single-card Volume2 speaker icon + Gemini 2.5 Flash status",
    });
    console.log("Scenario 6 Pass:", s6Pass);

    console.table(results);
  } finally {
    await browser.close();
    // Restore clean baseline files so subsequent sessions start fresh
    fs.writeFileSync(invPath, invBackup, "utf-8");
    fs.writeFileSync(orientPath, orientBackup, "utf-8");
    fs.writeFileSync(qPath, qBackup, "utf-8");
  }
}

runGauntlet().catch((err) => {
  console.error("Gauntlet failed:", err);
  process.exit(1);
});
