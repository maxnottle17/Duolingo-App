// Renders public/icons/icon.svg to the PNG sizes Android needs. Run: node scripts/make-icons.mjs
// (needs Playwright with Chromium available)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const b64 = Buffer.from(svg).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
];
for (const [name, size, maskable] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons get a full-bleed background and the artwork inside the 80% safe zone.
  const inner = maskable ? size * 0.78 : size;
  await page.setContent(`<html><body style="margin:0;background:${maskable ? '#0f9d6b' : 'transparent'};display:grid;place-items:center;height:${size}px">
    <img src="data:image/svg+xml;base64,${b64}" width="${inner}" height="${inner}"></body></html>`);
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, omitBackground: !maskable });
  console.log('wrote', name);
}
await browser.close();
