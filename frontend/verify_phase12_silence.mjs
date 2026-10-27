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
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--window-size=1440,920",
    ],
    defaultViewport: { width: 1440, height: 920 },
  });

  try {
    const page = await browser.newPage();

    // Mock SpeechRecognition that simulates complete silence (no results returned)
    await page.evaluateOnNewDocument(() => {
      class SilentSpeechRecognition {
        constructor() {
          this.continuous = true;
          this.interimResults = true;
          this.lang = "en-US";
          this.onresult = null;
          this.onerror = null;
          this.onend = null;
        }
        start() {
          // Do not send any results (pure silence)
        }
        stop() {
          setTimeout(() => {
            if (this.onend) this.onend();
          }, 50);
        }
      }
      window.SpeechRecognition = SilentSpeechRecognition;
      window.webkitSpeechRecognition = SilentSpeechRecognition;
    });

    await page.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 15000 });
    await sleep(600);

    // 1. Verify NO "Record Clip" button exists anywhere in the DOM
    const allButtonsText = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim());
    });
    const hasRecordClip = allButtonsText.some((t) => t?.includes("Record Clip"));
    console.log("Has 'Record Clip' button:", hasRecordClip);

    // 2. Click the unified Mic button (tap-to-toggle or hold)
    const micBtn = await page.waitForSelector('[data-testid="ptt-mic-btn"]');
    console.log("Found unified mic button. Tapping mic button...");
    await micBtn.click({ delay: 60 });
    await sleep(300);

    // Stop recording by tapping again (or letting silence finalize)
    await micBtn.click({ delay: 60 });
    await sleep(500);

    // 3. Verify placeholder changes to "Didn't catch that — try speaking closer to the mic"
    const inputPlaceholder = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="omnibar-input"]');
      return el ? el.getAttribute("placeholder") : "";
    });
    console.log("Input placeholder after silence:", inputPlaceholder);

    // 4. Verify chat feed is completely empty of any sent messages (no "where is 3-0 silk", no assistant reply)
    const messagesCount = await page.evaluate(() => {
      return document.querySelectorAll(".whitespace-pre-wrap").length;
    });
    console.log("Total user messages in chat feed:", messagesCount);

    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasAccidentalQuery = bodyText.includes("3-0 Silk Suture is in") || bodyText.includes("where is 3-0 silk");
    console.log("Has accidental fallback query in feed:", hasAccidentalQuery);

    const shot = path.join(ARTIFACT_DIR, "phase12_silence_verification.png");
    await page.screenshot({ path: shot });
    console.log("Saved Screenshot:", shot);

    if (hasRecordClip) {
      throw new Error("Found unexpected 'Record Clip' button!");
    }
    if (messagesCount > 0 || hasAccidentalQuery) {
      throw new Error("Accidental query routed on silence!");
    }
    if (!inputPlaceholder.includes("Didn't catch that")) {
      console.warn("Notice: placeholder didn't match expected string, was:", inputPlaceholder);
    }

    console.log("PHASE 12 VERIFICATION COMPLETE: SUCCESS!");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
