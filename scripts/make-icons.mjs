/**
 * Build the PWA icon set from `public/icons/icon-source.png`.
 *
 *   node scripts/make-icons.mjs
 *
 * Produces icon-192.png, icon-512.png and maskable-512.png (the maskable
 * variant is inset to 80% and padded, so Android's adaptive-icon masks never
 * clip the artwork). The sized PNGs are git-ignored; the source is committed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const ICONS = path.join(ROOT, 'public', 'icons');
const SOURCE = path.join(ICONS, 'icon-source.png');

const TARGETS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'maskable-512.png', size: 512, maskable: true },
];

async function main() {
  const source = await readFile(SOURCE);

  for (const target of TARGETS) {
    let buffer = source;
    if (target.maskable) {
      // Draw the artwork at 80% onto a solid field matching its own backdrop so
      // a circular/squircle mask never cuts into the design.
      const inner = Math.round(target.size * 0.8);
      const art = await sharp(source).resize(inner, inner).png().toBuffer();
      buffer = await sharp({
        create: {
          width: target.size,
          height: target.size,
          channels: 4,
          background: { r: 42, g: 114, b: 232, alpha: 1 },
        },
      })
        .composite([{ input: art, gravity: 'center' }])
        .png()
        .toBuffer();
    } else {
      buffer = await sharp(source).resize(target.size, target.size).png().toBuffer();
    }

    const out = path.join(ICONS, target.file);
    await writeFile(out, buffer);
    const kb = (buffer.length / 1024).toFixed(1);
    console.log(`  ✓ ${target.file}  ${target.size}×${target.size}  ${kb} kB`);
  }

  console.log('\nIcon set written to public/icons/');
}

main().catch((err) => {
  console.error('Failed to build icons:', err.message);
  process.exit(1);
});
