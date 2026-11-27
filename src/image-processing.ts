import { mkdir, readFile } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';
import sharp from 'sharp';
import type { ImageConfig, ImageVariant, Photo } from './types.js';

const THUMBNAIL_WIDTH = 400;
const WATERMARK_SIZE = 0.2;
const WATERMARK_INSET = 0.03;

/**
 * Version of the image-processing logic itself.
 *
 * The image cache keys entries on the source bytes and the config parameters,
 * neither of which changes when this file does. Bump this whenever a change
 * here alters the variants a given source produces, so existing caches
 * invalidate instead of quietly serving stale output.
 */
export const IMAGE_PIPELINE_VERSION = 2;

/**
 * Scale a source down so its longest side fits within `maxDimension`.
 * Never enlarges: a source already inside the box is returned unchanged.
 */
export function effectiveSize(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(sourceWidth, sourceHeight);
  if (longest <= 0) return { width: 0, height: 0 };

  const scale = Math.min(1, maxDimension / longest);
  return {
    width: Math.round(sourceWidth * scale),
    height: Math.round(sourceHeight * scale),
  };
}

function outputDir(distDir: string, gallerySlug: string): string {
  return resolve(distDir, 'assets', 'images', gallerySlug);
}

function variantFilename(photoBasename: string, width: number): string {
  return `${photoBasename}-${String(width)}w.webp`;
}

function thumbnailFilename(photoBasename: string): string {
  return `${photoBasename}-thumb.webp`;
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export interface ProcessPhotoResult {
  readonly variants: readonly ImageVariant[];
  readonly thumbnailPath: string;
}

export async function loadWatermark(
  config: ImageConfig,
): Promise<Buffer | undefined> {
  if (config.watermark_image === undefined || config.watermark_opacity === 0)
    return undefined;
  return readFile(config.watermark_image);
}

export async function processPhoto(
  sourcePath: string,
  gallerySlug: string,
  distDir: string,
  config: ImageConfig,
  watermark?: Buffer,
): Promise<ProcessPhotoResult> {
  watermark ??= await loadWatermark(config);
  const photoBase = basename(sourcePath, extname(sourcePath));
  const outDir = outputDir(distDir, gallerySlug);
  await ensureDir(outDir);

  const image = sharp(sourcePath);
  const metadata = await image.metadata();
  const sourceWidth: number = (metadata.width as number | undefined) ?? 0;
  const sourceHeight: number = (metadata.height as number | undefined) ?? 0;

  // Apply the longest-side cap once, up front. Everything downstream works
  // from this effective size, so no individual variant can exceed the cap and
  // breakpoints keep their plain width semantics.
  const effective = effectiveSize(
    sourceWidth,
    sourceHeight,
    config.max_dimension,
  );
  const effectiveWidth = effective.width;
  const watermarkSize = config.watermark_size ?? WATERMARK_SIZE;
  const watermarkInset = config.watermark_inset ?? WATERMARK_INSET;
  const watermarkOpacity = config.watermark_opacity ?? 1;

  async function writeVariant(width: number, outPath: string) {
    const variant = sharp(sourcePath).resize(width, undefined, {
      withoutEnlargement: true,
    });

    if (watermark) {
      const height = Math.max(
        1,
        Math.round((sourceHeight * width) / sourceWidth),
      );
      const shortSide = Math.min(width, height);
      const inset = Math.floor(shortSide * watermarkInset);
      const size = Math.max(
        1,
        Math.min(Math.floor(shortSide * watermarkSize), shortSide - 2 * inset),
      );
      const { data, info } = await sharp(watermark)
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      if (watermarkOpacity !== 1) {
        for (let alpha = 3; alpha < data.length; alpha += 4) {
          data[alpha] = Math.min(
            255,
            Math.round(data.readUInt8(alpha) * watermarkOpacity),
          );
        }
      }

      variant.composite([
        {
          input: data,
          raw: { width: info.width, height: info.height, channels: 4 },
          left: width - info.width - inset,
          top: height - info.height - inset,
        },
      ]);
    }

    return variant.webp({ quality: config.webp_quality }).toFile(outPath);
  }

  const variants: ImageVariant[] = [];

  for (const breakpoint of config.breakpoints) {
    // Skip breakpoints larger than the (capped) source image
    if (breakpoint > effectiveWidth && effectiveWidth > 0) {
      continue;
    }

    const filename = variantFilename(photoBase, breakpoint);
    const outPath = resolve(outDir, filename);

    const info = await writeVariant(breakpoint, outPath);

    variants.push({
      width: info.width,
      height: info.height,
      path: `/assets/images/${gallerySlug}/${filename}`,
    });
  }

  // Emit the native (capped) variant whenever the breakpoints leave resolution
  // on the table. This also covers sources smaller than every breakpoint, which
  // would otherwise produce no variants at all and render as nothing.
  const maxGeneratedWidth =
    variants.length > 0 ? Math.max(...variants.map((v) => v.width)) : 0;

  if (maxGeneratedWidth === 0 && effectiveWidth > 0) {
    console.warn(
      `Warning: ${basename(sourcePath)} is only ${String(sourceWidth)}x${String(sourceHeight)}, ` +
        `smaller than the smallest breakpoint (${String(Math.min(...config.breakpoints))}px). ` +
        `It will be served at its native size.`,
    );
  }

  if (effectiveWidth > maxGeneratedWidth) {
    const filename = variantFilename(photoBase, effectiveWidth);
    const outPath = resolve(outDir, filename);

    const info = await writeVariant(effectiveWidth, outPath);

    variants.push({
      width: info.width,
      height: info.height,
      path: `/assets/images/${gallerySlug}/${filename}`,
    });
  }

  // Generate thumbnail
  const thumbFilename = thumbnailFilename(photoBase);
  const thumbPath = resolve(outDir, thumbFilename);

  await sharp(sourcePath)
    .resize(THUMBNAIL_WIDTH, undefined, { withoutEnlargement: true })
    .webp({ quality: config.webp_quality })
    .toFile(thumbPath);

  const thumbnailWebPath = `/assets/images/${gallerySlug}/${thumbFilename}`;

  return { variants, thumbnailPath: thumbnailWebPath };
}

export async function processAllPhotos(
  galleries: readonly Photo[][],
  gallerySlugs: readonly string[],
  distDir: string,
  config: ImageConfig,
): Promise<Map<string, ProcessPhotoResult>> {
  const results = new Map<string, ProcessPhotoResult>();
  const watermark = await loadWatermark(config);

  for (let i = 0; i < galleries.length; i++) {
    const photos = galleries[i];
    const gallerySlug = gallerySlugs[i];
    if (!photos || !gallerySlug) continue;

    for (const photo of photos) {
      const result = await processPhoto(
        photo.sourcePath,
        gallerySlug,
        distDir,
        config,
        watermark,
      );
      results.set(photo.slug, result);
    }
  }

  return results;
}
