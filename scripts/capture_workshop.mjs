import puppeteer from '../frontend/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'fs';
import path from 'path';

const chromePath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function capture() {
  console.log(`Launching browser using: ${chromePath}`);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  console.log('Navigating to http://localhost:3001/jules-workshop...');
  await page.goto('http://localhost:3001/jules-workshop', { waitUntil: 'networkidle0', timeout: 15000 });

  // Wait 2.5s for animations and sprite loops to settle in full swing
  await new Promise((r) => setTimeout(r, 2500));

  const docsDir = path.resolve('docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  const artifactDir = 'C:\\Users\\igles\\.gemini\\antigravity\\brain\\c7b8346c-72d6-4e0f-8948-e05576f54ccc';
  const outPath1 = path.join(docsDir, 'jules_workshop.png');
  const outPath2 = path.join(artifactDir, 'jules_workshop.png');

  await page.screenshot({ path: outPath1, fullPage: false });
  console.log(`Saved screenshot to: ${outPath1}`);

  try {
    if (fs.existsSync(artifactDir)) {
      fs.copyFileSync(outPath1, outPath2);
      console.log(`Copied screenshot to artifact dir: ${outPath2}`);
    }
  } catch (err) {
    console.warn(`Could not copy to artifact dir: ${err.message}`);
  }

  await browser.close();
  console.log('Capture complete!');
}

capture().catch((err) => {
  console.error('Capture failed:', err);
  process.exit(1);
});
