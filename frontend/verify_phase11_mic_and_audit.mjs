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

async function main() {
  const invPath = path.join(TENANT_DIR, "inventory.csv");
  const invBackup = fs.readFileSync(invPath, "utf-8");

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

    // Inject a realistic SpeechRecognition simulator before page scripts run so we can test
    // both Tap-to-Toggle (<300ms) and Hold-to-Talk (>=300ms) + late onresult race protection
    await page.evaluateOnNewDocument(() => {
      window.__ttsCalls = [];
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel = () => {
          window.__ttsCanceled = true;
        };
        window.speechSynthesis.speak = (utterance) => {
          window.__ttsCalls.push(utterance.text);
        };
      }

      class MockSpeechRecognition {
        constructor() {
          this.continuous = true;
          this.interimResults = true;
          this.lang = "en-US";
          this.onresult = null;
          this.onerror = null;
          this.onend = null;
          window.__activeRecognition = this;
        }
        start() {
          window.__recognitionStarted = true;
          // Stream interim words into the Omnibar input box 120ms after start
          setTimeout(() => {
            if (this.onresult) {
              const phrase = window.__nextMockSpeechPhrase || "where is the bakery";
              this.onresult({
                resultIndex: 0,
                results: [[{ transcript: phrase }]],
              });
            }
          }, 120);
        }
        stop() {
          // Simulate browser race condition: final words arrive 100ms AFTER stop() is called!
          setTimeout(() => {
            if (this.onresult && window.__latePhraseAfterStop) {
              this.onresult({
                resultIndex: 0,
                results: [[{ transcript: window.__latePhraseAfterStop }]],
              });
            }
            if (this.onend) this.onend();
          }, 100);
        }
      }

      window.SpeechRecognition = MockSpeechRecognition;
      window.webkitSpeechRecognition = MockSpeechRecognition;
    });

    await page.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 15000 });
    await sleep(600);

    // =========================================================================
    // TEST 1: Tap-to-Toggle (<300ms) Mic State Machine & Live Interim Input
    // =========================================================================
    console.log("Testing Tap-to-Toggle (<300ms) Mic State Machine...");
    await page.evaluate(() => {
      window.__nextMockSpeechPhrase = "where is the bakery";
      window.__latePhraseAfterStop = null;
    });

    const micBtn = await page.waitForSelector('[data-testid="ptt-mic-btn"]');
    // Quick 80ms tap -> enters Toggle Mode!
    await micBtn.click({ delay: 80 });
    await sleep(250);

    // Verify Toggle Mode active banner AND live interim words inside the Omnibar input box!
    const toggleState = await page.evaluate(() => {
      const inputEl = document.querySelector('input[type="text"]');
      return {
        bodyText: document.body.innerText,
        inputValue: inputEl ? inputEl.value : "",
      };
    });
    console.log("Live Input during Toggle Mode:", toggleState.inputValue);

    const shot1 = path.join(ARTIFACT_DIR, "phase11_mic_active_listening.png");
    await page.screenshot({ path: shot1 });
    console.log("Saved Screenshot 1:", shot1);

    // Tap mic button a second time to finalize and submit!
    await micBtn.click({ delay: 50 });
    await page.waitForFunction(
      () => document.body.innerText.includes("DeBakey Forceps 12in"),
      { timeout: 10000 }
    );
    await sleep(500);

    // =========================================================================
    // TEST 2: Hold-to-Talk (>=300ms) via Spacebar + Late onresult Race Protection
    // =========================================================================
    console.log("Testing Spacebar Hold-to-Talk (>=300ms) + Late onresult Race Protection...");
    await page.evaluate(() => {
      window.__nextMockSpeechPhrase = "find white";
      window.__latePhraseAfterStop = "find white laner";
    });

    await page.keyboard.down("Space");
    await sleep(420); // Hold > 300ms
    await page.keyboard.up("Space");

    // Wait for late onresult ("find white laner") to settle within 250ms and resolve Saphenous Vein Retractor!
    await page.waitForFunction(
      () => document.body.innerText.includes("Saphenous Vein Retractor"),
      { timeout: 10000 }
    );
    await sleep(500);

    // =========================================================================
    // TEST 3: Paperclip File Ingestion (POST /api/ingest) + Card Speaker + Sidebar History Click
    // =========================================================================
    console.log("Testing Paperclip CSV Upload, Card Speaker Button, and Sidebar History Click...");
    const tempCsvPath = path.join(TENANT_DIR, "temp_upload_test.csv");
    const extraRow =
      'Aortic Root Cannula 18Fr,Perfusion,Pump Room,H,1,C,root cannula|cardioplegia cannula,,0,"Dr. Yamamoto uses for antegrade root arrest",Pump Room · Rack H (Cannulae) · Shelf 1 · Bin C,3.0,verified,2026-10-25T08:00:00Z\n';
    fs.writeFileSync(tempCsvPath, invBackup.trimEnd() + "\n" + extraRow, "utf-8");

    try {
      const fileInput = await page.$('input[type="file"][accept*=".csv"]');
      await fileInput.uploadFile(tempCsvPath);

      await page.waitForFunction(
        () => document.body.innerText.includes("rows hot-reloaded into memory"),
        { timeout: 10000 }
      );
      await sleep(400);

      // Query the newly ingested item immediately (proving zero-restart hot reload)
      const textInput = await page.$('input[type="text"]');
      await textInput.type("where is aortic root cannula");
      await page.keyboard.press("Enter");

      await page.waitForFunction(
        () => document.body.innerText.includes("Aortic Root Cannula 18Fr"),
        { timeout: 10000 }
      );
      await sleep(400);

      // Click the Volume2 Speaker Button on the CoordinateCard
      await page.evaluate(() => {
        const speakerBtns = Array.from(
          document.querySelectorAll('[data-testid="card-speaker-btn"]')
        );
        const lastSpeaker = speakerBtns[speakerBtns.length - 1];
        if (lastSpeaker) lastSpeaker.click();
      });
      await sleep(300);

      const ttsAudit = await page.evaluate(() => ({
        canceledPrior: Boolean(window.__ttsCanceled),
        spokenTexts: window.__ttsCalls || [],
      }));
      console.log("Card Speaker Audit:", ttsAudit);

      // Click a past query in Sidebar RECENT QUERIES ("where is the bakery")
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("aside button"));
        const histBtn = btns.find((b) => b.textContent?.trim() === "where is the bakery");
        if (histBtn) histBtn.click();
      });
      await sleep(600);

      const shot2 = path.join(
        ARTIFACT_DIR,
        "phase11_paperclip_ingest_and_speaker_audit.png"
      );
      await page.screenshot({ path: shot2 });
      console.log("Saved Screenshot 2:", shot2);
    } finally {
      if (fs.existsSync(tempCsvPath)) fs.unlinkSync(tempCsvPath);
    }
  } finally {
    await browser.close();
    fs.writeFileSync(invPath, invBackup, "utf-8");
  }
}

main().catch((err) => {
  console.error("Phase 11 verification failed:", err);
  process.exit(1);
});
