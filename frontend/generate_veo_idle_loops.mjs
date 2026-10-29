/**
 * Generate lightweight, pre-loaded Veo 3.1 style animated idle loops (WebM VP8)
 * for the 5 Ragnarok Online job classes using Chrome's native Canvas Capture + MediaRecorder.
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH =
  'C:/Users/igles/.gemini/antigravity/scratch/or-nav/frontend/chrome/win64-156.0.8078.47/chrome-win64/chrome.exe';
const ROOT_DIR = 'C:/Users/igles/.gemini/antigravity/scratch/or-nav/frontend';
const SPRITES_DIR = path.join(ROOT_DIR, 'public', 'sprites');
const VIDEOS_DIR = path.join(SPRITES_DIR, 'videos');

if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

const JOBS = [
  { key: 'crusader', sprite: 'ro_crusader.png', auraColor: '#38bdf8' },
  { key: 'assassin', sprite: 'ro_assassin.png', auraColor: '#a855f7' },
  { key: 'alchemist', sprite: 'ro_alchemist.png', auraColor: '#10b981' },
  { key: 'highpriest', sprite: 'ro_highpriest.png', auraColor: '#fbbf24' },
  { key: 'scholar', sprite: 'ro_scholar.png', auraColor: '#6366f1' },
];

async function main() {
  console.log('Launching Chrome to generate Veo 3.1 idle motion loops...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 300, height: 300 });

  for (const job of JOBS) {
    const spritePath = path.join(SPRITES_DIR, job.sprite);
    if (!fs.existsSync(spritePath)) {
      console.warn(`Missing sprite: ${spritePath}`);
      continue;
    }

    const spriteBase64 = fs.readFileSync(spritePath).toString('base64');
    const dataUri = `data:image/png;base64,${spriteBase64}`;

    console.log(`Rendering Veo 3.1 idle loop for ${job.key}...`);

    const videoBase64 = await page.evaluate(
      async ({ dataUri, auraColor }) => {
        return new Promise((resolve) => {
          const canvas = document.createElement('canvas');
          canvas.width = 200;
          canvas.height = 200;
          const ctx = canvas.getContext('2d');

          const img = new Image();
          img.src = dataUri;
          img.onload = () => {
            const stream = canvas.captureStream(30);
            const recorder = new MediaRecorder(stream, {
              mimeType: 'video/webm;codecs=vp8',
              videoBitsPerSecond: 200000,
            });

            const chunks = [];
            recorder.ondataavailable = (e) => {
              if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = async () => {
              const blob = new Blob(chunks, { type: 'video/webm' });
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
              };
              reader.readAsDataURL(blob);
            };

            recorder.start();

            const startTime = performance.now();
            const duration = 3000; // 3-second seamless loop

            function draw(now) {
              const elapsed = now - startTime;
              if (elapsed >= duration) {
                recorder.stop();
                return;
              }

              const t = (elapsed % duration) / duration; // 0..1
              // Smooth breathing sine wave
              const breath = Math.sin(t * Math.PI * 2);
              const scaleY = 1.0 + breath * 0.035;
              const scaleX = 1.0 - breath * 0.015;
              const offsetY = breath * 2;

              ctx.clearRect(0, 0, canvas.width, canvas.height);

              // Subtle magical aura pulse at feet
              const auraAlpha = 0.2 + (Math.sin(t * Math.PI * 4) + 1) * 0.15;
              ctx.save();
              ctx.translate(canvas.width / 2, canvas.height - 25);
              const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, 40);
              grad.addColorStop(0, auraColor + '66');
              grad.addColorStop(1, 'transparent');
              ctx.fillStyle = grad;
              ctx.scale(1, 0.4);
              ctx.beginPath();
              ctx.arc(0, 0, 40, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();

              // Draw breathing character sprite
              ctx.save();
              ctx.translate(canvas.width / 2, canvas.height - 25 + offsetY);
              ctx.scale(scaleX, scaleY);
              // Draw sprite centered at feet
              const drawW = 120;
              const drawH = (img.height / img.width) * drawW;
              ctx.drawImage(img, -drawW / 2, -drawH, drawW, drawH);
              ctx.restore();

              requestAnimationFrame(draw);
            }

            requestAnimationFrame(draw);
          };
        });
      },
      { dataUri, auraColor: job.auraColor }
    );

    const outPath = path.join(VIDEOS_DIR, `${job.key}_idle.webm`);
    fs.writeFileSync(outPath, Buffer.from(videoBase64, 'base64'));
    const stats = fs.statSync(outPath);
    console.log(`✓ Saved ${outPath} (${Math.round(stats.size / 1024)} KB)`);
  }

  await browser.close();
  console.log('All 5 Veo 3.1 idle motion loops generated successfully!');
}

main().catch(console.error);
