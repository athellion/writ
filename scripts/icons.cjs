// Renders Writ's icons from build/icon.svg: build/icon.png (512) and build/icon.ico (16–256).
// The smallest sizes are drawn on their own (no glow, whole pixels) so they stay sharp.
// Run: node scripts/icons.cjs   (needs ImageMagick's `convert` for the .ico; CHROMIUM_PATH in the cloud)
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const build = path.join(__dirname, '..', 'build');
const big = fs.readFileSync(path.join(build, 'icon.svg'), 'utf8');
// 16–20 px: the tile, the sheet with its fold, and the seal, on whole pixels
const small = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2430"/><stop offset="1" stop-color="#34131a"/></linearGradient></defs>
  <rect x="0" y="0" width="16" height="16" rx="3.5" fill="url(#bg)"/>
  <rect x="2" y="4" width="12" height="8" fill="#efe6d4" shape-rendering="crispEdges"/>
  <path d="M2.5 4.5L8 8.6l5.5-4.1" fill="none" stroke="#b9a684" stroke-width="1"/>
  <circle cx="8" cy="9" r="2.4" fill="#e3a14a"/>
</svg>`;
// 24–40 px: the same, a little finer
const mid = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2430"/><stop offset="1" stop-color="#32121a"/></linearGradient></defs>
  <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="url(#bg)"/>
  <rect x="5" y="8.5" width="22" height="15.5" rx="1.5" fill="#efe6d4"/>
  <path d="M5.8 9.4L16 17.2l10.2-7.8" fill="none" stroke="#bfae8c" stroke-width="1.3" stroke-linejoin="round"/>
  <circle cx="16" cy="17.6" r="4" fill="#e3a14a"/>
  <circle cx="16" cy="17.6" r="2.4" fill="none" stroke="#f8d791" stroke-width="0.9"/>
</svg>`;
const pick = (px) => (px <= 20 ? small : px <= 40 ? mid : big);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  async function shot(svg, px, out) {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${px}" height="${px}" `)}</body></html>`);
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
  }
  await shot(big, 512, path.join(build, 'icon.png'));
  const parts = [];
  for (const px of [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
    const f = path.join(build, `.ico-${px}.png`);
    await shot(pick(px), px, f);
    parts.push(f);
  }
  await browser.close();
  execFileSync('convert', [...parts, path.join(build, 'icon.ico')]);
  // a sheet of every size, to look at
  if (process.env.ICON_SHEET) execFileSync('convert', [...parts, '+append', process.env.ICON_SHEET]);
  for (const f of parts) fs.rmSync(f);
  console.log('icons written');
})();
