import puppeteer from '../frontend/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'fs';
import path from 'path';

const chromePath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function captureRO() {
  console.log(`Launching browser using: ${chromePath}`);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,960']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 2 });

  console.log('Navigating to http://localhost:3001/jules-workshop...');
  await page.goto('http://localhost:3001/jules-workshop', { waitUntil: 'networkidle0', timeout: 15000 });

  // Wait 2.5s for sprites and live telemetry to load
  await new Promise((r) => setTimeout(r, 2500));

  const docsDir = path.resolve('docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  const artifactDir = 'C:\\Users\\igles\\.gemini\\antigravity\\brain\\c7b8346c-72d6-4e0f-8948-e05576f54ccc';

  // 1. Capture 15-Grid View
  const out15 = path.join(docsDir, 'ro_workshop_15grid.png');
  await page.screenshot({ path: out15, fullPage: false });
  console.log(`Saved 15-Grid View screenshot to: ${out15}`);

  // 2. Click button to switch to 3-Slot View
  console.log('Switching to 3-Slot Classic View...');
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const text = await page.evaluate((el) => el.innerText, b);
    if (text.includes('3-Slot')) {
      await b.click();
      break;
    }
  }

  await new Promise((r) => setTimeout(r, 1200));

  // Capture 3-Slot View
  const out3 = path.join(docsDir, 'ro_workshop_3slot.png');
  await page.screenshot({ path: out3, fullPage: false });
  console.log(`Saved 3-Slot Classic View screenshot to: ${out3}`);

  // Copy to artifact directory
  try {
    if (fs.existsSync(artifactDir)) {
      fs.copyFileSync(out15, path.join(artifactDir, 'ro_workshop_15grid.png'));
      fs.copyFileSync(out3, path.join(artifactDir, 'ro_workshop_3slot.png'));
      console.log('Copied both screenshots to artifact dir successfully!');
    }
  } catch (err) {
    console.warn(`Could not copy to artifact dir: ${err.message}`);
  }

  await browser.close();
  console.log('RO Character Select Capture Complete!');
}

captureRO().catch((err) => {
  console.error('RO Capture failed:', err);
  process.exit(1);
});
