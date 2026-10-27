import puppeteer from "puppeteer-core";
import path from "path";

const ARTIFACT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,920"],
    defaultViewport: { width: 1440, height: 920 },
  });

  try {
    const page = await browser.newPage();
    await page.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 15000 });
    await sleep(600);

    // 1. Submit "where is the bakery" in Omnibar
    const inputSelector = 'input[placeholder*="Ask"], textarea[placeholder*="Ask"], input[type="text"]';
    await page.waitForSelector(inputSelector);
    await page.type(inputSelector, "where is the bakery");
    await page.keyboard.press("Enter");

    await page.waitForFunction(
      () => document.body.innerText.includes("DeBakey Forceps 12in"),
      { timeout: 10000 }
    );
    await sleep(500);

    // Expand the collapsible "Surgeon notes & relocation options" on DeBakey Forceps card
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const detailsBtn = btns.find((b) =>
        b.textContent?.includes("Surgeon notes & relocation options")
      );
      if (detailsBtn) detailsBtn.click();
    });
    await sleep(500);

    // Also open Preferences & System on the left sidebar so 15-Min Hands-Free Audio & Offline Dexie Cache are visible
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("aside button"));
      const prefBtn = btns.find((b) =>
        b.textContent?.includes("Preferences & System")
      );
      if (prefBtn) prefBtn.click();
    });
    await sleep(600);

    const shot1 = path.join(ARTIFACT_DIR, "phase9_phonetic_bakery_and_header.png");
    await page.screenshot({ path: shot1 });
    console.log("Saved Screenshot 1:", shot1);

    // 2. Click the "💬 2 Unanswered" pill in the top header to open the QuestionsDrawer
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("header button"));
      const qBtn = btns.find((b) => b.textContent?.includes("Unanswered"));
      if (qBtn) qBtn.click();
    });
    await sleep(700);

    // Type a sample peer response in the first open question input to highlight Confident vs I think so / Unsure
    await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll('input[placeholder*="Write a peer answer"]')
      );
      if (inputs.length > 0) {
        const el = inputs[0];
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;
        nativeInputValueSetter.call(
          el,
          "Dr. Yamamoto only uses topical ice slush on combined CABG + AVR cases."
        );
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await sleep(500);

    const shot2 = path.join(ARTIFACT_DIR, "phase9_unanswered_questions_drawer.png");
    await page.screenshot({ path: shot2 });
    console.log("Saved Screenshot 2:", shot2);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
