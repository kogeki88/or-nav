import puppeteer from "puppeteer-core";
import path from "path";

const ARTIFACT_DIR = "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH = "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

async function verifyPhase8() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,920"],
    defaultViewport: { width: 1440, height: 920 },
  });

  try {
    const page = await browser.newPage();
    await page.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 15000 });
    await page.waitForSelector("button");

    // 1. Click "Where is 3-0 Silk?" starter button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const b = btns.find((btn) => btn.innerText.includes("Where is 3-0 Silk?"));
      if (b) b.click();
    });

    await page.waitForFunction(
      () => document.body.innerText.includes("OR 21") && document.body.innerText.includes("Surgeon notes"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 600));

    // 2. Expand "Surgeon notes & relocation options" on CoordinateCard
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const toggle = btns.find((btn) => btn.innerText.includes("Surgeon notes"));
      if (toggle) toggle.click();
    });

    await page.waitForFunction(
      () => document.body.innerText.includes("Dr. Chen"),
      { timeout: 10000 }
    );

    // 3. Open "Preferences & System" drawer in Sidebar
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("aside button"));
      const prefBtn = btns.find((btn) => btn.innerText.includes("Preferences & System"));
      if (prefBtn) prefBtn.click();
    });

    await page.waitForFunction(
      () => document.body.innerText.includes("Gemini AI Engine"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 800));

    const shot = path.join(ARTIFACT_DIR, "phase8_gemini_settings_and_polish.png");
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`Phase 8 screenshot saved: ${shot}`);
  } finally {
    await browser.close();
  }
}

verifyPhase8().catch((err) => {
  console.error(err);
  process.exit(1);
});
