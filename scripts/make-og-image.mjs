// Regenerates public/og-image.png (1200x630 social card) from the README screenshot.
import sharp from 'sharp';

const W = 1200, H = 630;
const shot = await sharp('docs/screenshots/arrange.png').resize({ width: 600 }).png().toBuffer();
const shotH = (await sharp(shot).metadata()).height;
const mask = Buffer.from(`<svg width="600" height="${shotH}"><rect width="600" height="${shotH}" rx="14"/></svg>`);
const rounded = await sharp(shot).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();

const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="b" cx="20%" cy="15%" r="90%"><stop offset="0" stop-color="#1c2f5e"/><stop offset="1" stop-color="#060a17"/></radialGradient>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9fe6ff"/><stop offset=".55" stop-color="#b6a6ff"/><stop offset="1" stop-color="#ffc9a3"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#b)"/>
  <g fill="#eaf6ff" opacity=".7"><circle cx="90" cy="70" r="2"/><circle cx="330" cy="40" r="1.5"/><circle cx="520" cy="110" r="1.5"/><circle cx="60" cy="560" r="2"/><circle cx="400" cy="590" r="1.5"/></g>
  <rect x="64" y="150" width="64" height="5" rx="2.5" fill="url(#g)"/>
  <text x="64" y="230" font-family="Inter, Helvetica, Arial, sans-serif" font-size="68" font-weight="700" fill="#eaf2ff">Sky Music</text>
  <text x="64" y="305" font-family="Inter, Helvetica, Arial, sans-serif" font-size="68" font-weight="700" fill="url(#g)">Studio</text>
  <text x="64" y="370" font-family="Inter, Helvetica, Arial, sans-serif" font-size="28" fill="#c4d2ee">Compose and play music for</text>
  <text x="64" y="406" font-family="Inter, Helvetica, Arial, sans-serif" font-size="28" fill="#c4d2ee">Sky: Children of the Light</text>
  <text x="64" y="560" font-family="Inter, Helvetica, Arial, sans-serif" font-size="24" fill="#8fd9ff">sky.thinhcorner.com</text>
  <text x="64" y="590" font-family="Inter, Helvetica, Arial, sans-serif" font-size="16" fill="#67789f">Unofficial fan project · free · in your browser</text>
</svg>`);

await sharp(bg)
  .composite([{ input: rounded, left: W - 600 - 30, top: Math.round((H - shotH) / 2) }])
  .png({ compressionLevel: 9 })
  .toFile('public/og-image.png');
