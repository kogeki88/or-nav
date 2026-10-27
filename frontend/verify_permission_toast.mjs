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
  });

  try {
    const page = await browser.newPage();

    // Mock SpeechRecognition throwing not-allowed immediately
    await page.evaluateOnNewDocument(() => {
      class DeniedSpeechRecognition {
        constructor() {
          this.continuous = true;
          this.interimResults = true;
          this.lang = "en-US";
          this.onerror = null;
        }
        start() {
          setTimeout(() => {
            if (this.onerror) this.onerror({ error: "not-allowed" });
          }, 50);
        }
        abort() {}
        stop() {}
      }
      window.SpeechRecognition = DeniedSpeechRecognition;
      window.webkitSpeechRecognition = DeniedSpeechRecognition;
    });

    await page.goto("http://localhost:3000", { waitUntil: "networkidle2" });
    await sleep(400);

    const micBtn = await page.waitForSelector('[data-testid="ptt-mic-btn"]');
    await micBtn.click();
    await sleep(200);

    const placeholder = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="omnibar-input"]');
      return el ? el.getAttribute("placeholder") : "";
    });

    console.log("Placeholder on permission denied:", placeholder);
    if (!placeholder.includes("Mic permission needed")) {
      throw new Error(`Expected 'Mic permission needed', but got: '${placeholder}'`);
    }

    const shot = path.join(ARTIFACT_DIR, "phase13_mic_permission_needed_toast.png");
    await page.screenshot({ path: shot });
    console.log("Saved Screenshot:", shot);
    console.log("Permission toast verified successfully!");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
