#!/usr/bin/env node
// One-off asset-prep script (not part of the CI/build pipeline): generates
// responsive JPEG + WebP sizes from the already-processed, metadata-free
// source photo. Re-run manually only if the source photo changes; commit
// the generated files under apps/web/public/founder/ like any other
// static asset.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const source = join(root, 'assets/founder-private/founder-photo.jpg');
const outDir = join(root, 'apps/web/public/founder');
const widths = [320, 480, 640, 864];

mkdirSync(outDir, { recursive: true });

const sourceMeta = await sharp(source).metadata();
if (sourceMeta.exif || sourceMeta.iptc || sourceMeta.xmp || sourceMeta.hasProfile) {
  console.error('Refusing to process: source photo still carries metadata. Strip it first.');
  process.exit(1);
}

for (const width of widths) {
  const image = sharp(source).resize({ width, withoutEnlargement: true });

  await image
    .clone()
    .jpeg({ quality: 82, progressive: true })
    .toFile(join(outDir, `founder-${width}.jpg`));

  await image
    .clone()
    .webp({ quality: 82 })
    .toFile(join(outDir, `founder-${width}.webp`));

  console.log(`Generated founder-${width}.jpg / .webp`);
}

console.log(`Done. Source: ${sourceMeta.width}x${sourceMeta.height}, no metadata.`);
