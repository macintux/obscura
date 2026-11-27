import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { processAllPhotosWithCache } from '../src/image-cache.js';
import type { ImageConfig } from '../src/types.js';

const WORK_DIR = resolve(import.meta.dirname, 'fixtures', 'image-cache-work');
const DIST_DIR = resolve(WORK_DIR, 'dist');
const SOURCE = resolve(WORK_DIR, 'wide.jpg');

const CONFIG: ImageConfig = {
  breakpoints: [400, 800, 1200, 2400],
  webp_quality: 85,
  max_dimension: 2400,
};

const PHOTOS = [{ slug: 'wide', gallerySlug: 'test', sourcePath: SOURCE }];

function largestWidth(variants: readonly { readonly width: number }[]): number {
  return Math.max(...variants.map((v) => v.width));
}

beforeAll(async () => {
  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });
  await sharp({
    create: {
      width: 6000,
      height: 4000,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  })
    .jpeg()
    .toFile(SOURCE);
});

afterAll(async () => {
  await rm(WORK_DIR, { recursive: true, force: true });
});

describe('image cache', () => {
  it('watermarks both panoramic orientations and refreshes variants when the artwork changes', async () => {
    const watermarkPath = resolve(WORK_DIR, 'watermark.png');
    const photos = await Promise.all(
      [
        [340, 120],
        [120, 340],
      ].map(async ([width, height]) => {
        const slug = `panorama-${width}`;
        const sourcePath = resolve(WORK_DIR, `${slug}.png`);
        await sharp({
          create: { width, height, channels: 3, background: 'black' },
        })
          .png()
          .toFile(sourcePath);
        return { slug, gallerySlug: 'test', sourcePath };
      }),
    );
    const config = {
      ...CONFIG,
      breakpoints: [100],
      watermark_image: watermarkPath,
      watermark_size: 0.35,
      watermark_inset: 0.02,
    };
    const original = await processAllPhotosWithCache(
      photos,
      WORK_DIR,
      DIST_DIR,
      CONFIG,
    );
    const distPath = (path: string) => resolve(DIST_DIR, path.slice(1));
    const thumbnails = await Promise.all(
      photos.map(({ slug }) =>
        readFile(distPath(original.get(slug)!.thumbnailPath)),
      ),
    );

    for (const [color, opacity, expectedValue] of [
      [255, 4, 255],
      [255, 1, 64],
      [0, 1, 0],
    ] as const) {
      await sharp({
        create: {
          width: 80,
          height: 80,
          channels: 4,
          background: { r: color, g: color, b: color, alpha: 0.25 },
        },
      })
        .png()
        .toFile(watermarkPath);
      const results = await processAllPhotosWithCache(
        photos,
        WORK_DIR,
        DIST_DIR,
        { ...config, watermark_opacity: opacity },
      );

      for (const [index, { slug }] of photos.entries()) {
        const result = results.get(slug)!;
        expect(result.variants).toHaveLength(2);
        for (const { path, width, height } of result.variants) {
          const shortSide = Math.min(width, height);
          const offset =
            Math.floor(shortSide * 0.02) + Math.ceil(shortSide * 0.24);
          const pixel = await sharp(distPath(path))
            .extract({
              left: width - offset,
              top: height - offset,
              width: 1,
              height: 1,
            })
            .raw()
            .toBuffer();
          expect(Math.abs(pixel[0]! - expectedValue)).toBeLessThan(15);
        }
        expect(await readFile(distPath(result.thumbnailPath))).toEqual(
          thumbnails[index],
        );
      }
    }
  });

  it('invalidates cached variants when max_dimension changes', async () => {
    const first = await processAllPhotosWithCache(
      PHOTOS,
      WORK_DIR,
      DIST_DIR,
      CONFIG,
    );
    expect(largestWidth(first.get('wide')!.variants)).toBe(2400);

    // Same source, same breakpoints — only the cap differs.
    const second = await processAllPhotosWithCache(PHOTOS, WORK_DIR, DIST_DIR, {
      ...CONFIG,
      max_dimension: 1600,
    });
    expect(largestWidth(second.get('wide')!.variants)).toBe(1600);
  });

  it('reuses cached variants when nothing changes', async () => {
    const config = { ...CONFIG, max_dimension: 1600 };
    const first = await processAllPhotosWithCache(
      PHOTOS,
      WORK_DIR,
      DIST_DIR,
      config,
    );
    const variantPath = resolve(
      DIST_DIR,
      first.get('wide')!.variants[0]!.path.replace(/^\//, ''),
    );
    const before = await stat(variantPath);

    const again = await processAllPhotosWithCache(
      PHOTOS,
      WORK_DIR,
      DIST_DIR,
      config,
    );
    expect(largestWidth(again.get('wide')!.variants)).toBe(1600);
    // Untouched on disk — the second run served the cache rather than re-encoding.
    expect((await stat(variantPath)).mtimeMs).toBe(before.mtimeMs);
  });
});
