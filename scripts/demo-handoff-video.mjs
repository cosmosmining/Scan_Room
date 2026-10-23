/**
 * Record the iPad → website handoff as a video.
 *
 * The DATA FLOW is real: the left panel genuinely POSTs a `mozu.roomscan/1`
 * payload to the running server, and the code shown is the one the server
 * generated. Only the iPad's bezel is a prop — there is no way to drive a
 * physical device from here.
 *
 *   node scripts/demo-handoff-video.mjs [baseUrl] [outDir]
 *
 * Needs the app running (`npm run build && npx next start -p 3111`).
 */
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3111';
const OUT = process.argv[3] ?? 'demo-out';
const CHROME = process.env.DEMO_CHROME; // optional explicit browser path

mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

await page.goto(`${BASE}/demo/handoff.html`, { waitUntil: 'networkidle' });
await wait(2600); // let the viewer read the scanned plan

// 1. The iPad uploads the room and shows the code it got back.
await page.click('#send');
await page.waitForFunction(() => Boolean(window.__mozuCode), null, { timeout: 15000 });
const code = await page.evaluate(() => window.__mozuCode);
console.log('server issued code:', code);
await wait(2400);

// 2. Someone types that code on the laptop — one character at a time, in lower
//    case, the way a person actually would.
const site = page.frameLocator('#site');
const field = site.locator('#code');
await field.click();
for (const ch of code.toLowerCase()) {
  await field.press(ch);
  await wait(190);
}
await wait(900);

// 3. The laptop asks the server for the room, and draws it.
await page.evaluate(() => window.__wireFetch());
await page.evaluate((c) => {
  document.getElementById('addr').textContent = `app.mozu.com/room/${c}`;
}, code);
await site.locator('#go').click();
await wait(4200); // the site draws the room it received

await page.evaluate(() => {
  const el = document.querySelector('.caption');
  if (el) el.textContent = '1 · iPad — scanned on site';
});
await wait(2600);

await context.close();
await browser.close();

// Playwright names videos by internal id; give it something a human can find.
const file = readdirSync(OUT).find((f) => f.endsWith('.webm'));
if (file) {
  renameSync(join(OUT, file), join(OUT, 'mozu-scan-to-web.webm'));
  console.log('video:', join(OUT, 'mozu-scan-to-web.webm'));
}
