import puppeteer from "puppeteer-core";

const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

async function run() {
  console.log("Launching headless browser to verify Phase 22 Multi-Department Switcher...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 15000 });

    // 1. Check default department is Operating Room (OR)
    const headerDept = await page.$eval('[data-testid="header-department-badge"]', el => el.textContent.trim());
    console.log("Initial Header Department:", headerDept);
    if (!headerDept.includes("Operating Room")) {
      throw new Error(`Expected Operating Room in header, got: ${headerDept}`);
    }

    const initialPlaceholder = await page.$eval('[data-testid="omnibar-input"]', el => el.getAttribute("placeholder"));
    console.log("Initial Omnibar Placeholder:", initialPlaceholder);
    if (!initialPlaceholder.includes("instrument/suture")) {
      throw new Error(`Unexpected OR placeholder: ${initialPlaceholder}`);
    }

    // 2. Switch to ICU / Critical Care
    console.log("Switching department to ICU / Critical Care...");
    await page.select('[data-testid="department-selector"]', "icu_critical_care");
    await new Promise(r => setTimeout(r, 600));

    const icuHeader = await page.$eval('[data-testid="header-department-badge"]', el => el.textContent.trim());
    console.log("ICU Header Department:", icuHeader);
    if (!icuHeader.includes("ICU")) {
      throw new Error(`Expected ICU in header, got: ${icuHeader}`);
    }

    const icuPlaceholder = await page.$eval('[data-testid="omnibar-input"]', el => el.getAttribute("placeholder"));
    console.log("ICU Omnibar Placeholder:", icuPlaceholder);
    if (!icuPlaceholder.includes("line kits, drip supplies")) {
      throw new Error(`Unexpected ICU placeholder: ${icuPlaceholder}`);
    }

    // 3. Switch to Emergency Dept (ER)
    console.log("Switching department to Emergency Dept (ER)...");
    await page.select('[data-testid="department-selector"]', "er_trauma");
    await new Promise(r => setTimeout(r, 600));

    const erHeader = await page.$eval('[data-testid="header-department-badge"]', el => el.textContent.trim());
    console.log("ER Header Department:", erHeader);
    if (!erHeader.includes("Emergency") && !erHeader.includes("ER")) {
      throw new Error(`Expected ER in header, got: ${erHeader}`);
    }

    const erPlaceholder = await page.$eval('[data-testid="omnibar-input"]', el => el.getAttribute("placeholder"));
    console.log("ER Omnibar Placeholder:", erPlaceholder);
    if (!erPlaceholder.includes("trauma trays, airway carts")) {
      throw new Error(`Unexpected ER placeholder: ${erPlaceholder}`);
    }

    // 4. Switch to PACU / Pre-Op
    console.log("Switching department to PACU / Pre-Op...");
    await page.select('[data-testid="department-selector"]', "pacu_periop");
    await new Promise(r => setTimeout(r, 600));

    const pacuHeader = await page.$eval('[data-testid="header-department-badge"]', el => el.textContent.trim());
    console.log("PACU Header Department:", pacuHeader);
    if (!pacuHeader.includes("PACU")) {
      throw new Error(`Expected PACU in header, got: ${pacuHeader}`);
    }

    const pacuPlaceholder = await page.$eval('[data-testid="omnibar-input"]', el => el.getAttribute("placeholder"));
    console.log("PACU Omnibar Placeholder:", pacuPlaceholder);
    if (!pacuPlaceholder.includes("reversal agents, block cart")) {
      throw new Error(`Unexpected PACU placeholder: ${pacuPlaceholder}`);
    }

    // Capture screenshot of PACU
    await page.screenshot({ path: "C:/Users/igles/.gemini/antigravity/brain/2d1ef619-85c4-431c-96f8-0301f7c0a3e2/phase22_pacu_switcher.png" });

    // Switch back to Operating Room (OR)
    await page.select('[data-testid="department-selector"]', "or_main");
    await new Promise(r => setTimeout(r, 600));

    // Capture screenshot of OR
    await page.screenshot({ path: "C:/Users/igles/.gemini/antigravity/brain/2d1ef619-85c4-431c-96f8-0301f7c0a3e2/phase22_or_switcher.png" });

    console.log("✅ Phase 22 Headless Verification Passed 100%!");
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
