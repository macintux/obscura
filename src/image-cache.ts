import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { ImageConfig, ImageVariant } from './types.js';
import {
  processPhoto,
  loadWatermark,
  IMAGE_PIPELINE_VERSION,
} from './image-processing.js';
import type { ProcessPhotoResult } from './image-processing.js';

const CACHE_DIR = '.cache';
const CACHE_FILENAME = 'image-cache.json';

interface CacheEntry {
  readonly hash: string;
  readonly variants: readonly ImageVariant[];
  readonly thumbnailPath: string;
}

interface CacheManifest {
  readonly entries: Record<string, CacheEntry>;
}

function emptyCacheManifest(): CacheManifest {
  return { entries: {} };
}

async function loadCacheManifest(projectDir: string): Promise<CacheManifest> {
  const cachePath = resolve(projectDir, CACHE_DIR, CACHE_FILENAME);
  try {
    const content = await readFile(cachePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && 'entries' in parsed) {
      return parsed as CacheManifest;
    }
    return emptyCacheManifest();
  } catch {
    return emptyCacheManifest();
  }
}

async function saveCacheManifest(
  projectDir: string,
  manifest: CacheManifest,
): Promise<void> {
  const cacheDir = resolve(projectDir, CACHE_DIR);
  await mkdir(cacheDir, { recursive: true });
  const cachePath = resolve(cacheDir, CACHE_FILENAME);
  await writeFile(cachePath, JSON.stringify(manifest, null, 2), 'utf-8');
}

async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function computeParamsHash(
  config: ImageConfig,
  watermark: Buffer | undefined,
): string {
  const params = JSON.stringify({
    // The pipeline version is part of the key so that changes to the image
    // processing code invalidate the cache, not just changes to config.
    pipeline: IMAGE_PIPELINE_VERSION,
    breakpoints: config.breakpoints,
    webp_quality: config.webp_quality,
    max_dimension: config.max_dimension,
    watermark: watermark && {
      hash: createHash('sha256').update(watermark).digest('hex'),
      size: config.watermark_size,
      inset: config.watermark_inset,
      opacity: config.watermark_opacity,
    },
  });
  return createHash('sha256').update(params).digest('hex');
}

function computeCacheKey(fileHash: string, paramsHash: string): string {
  return `${fileHash}:${paramsHash}`;
}

async function outputFilesExist(
  distDir: string,
  entry: CacheEntry,
): Promise<boolean> {
  try {
    for (const variant of entry.variants) {
      await access(resolve(distDir, variant.path.replace(/^\//, '')));
    }
    await access(resolve(distDir, entry.thumbnailPath.replace(/^\//, '')));
    return true;
  } catch {
    return false;
  }
}

export interface CachedProcessResult {
  readonly result: ProcessPhotoResult;
  readonly fromCache: boolean;
}

export async function processPhotoWithCache(
  sourcePath: string,
  photoSlug: string,
  gallerySlug: string,
  distDir: string,
  config: ImageConfig,
  manifest: CacheManifest,
): Promise<CachedProcessResult> {
  const watermark = await loadWatermark(config);
  const cacheKey = computeCacheKey(
    await computeFileHash(sourcePath),
    computeParamsHash(config, watermark),
  );
  return processCachedPhoto(
    sourcePath,
    gallerySlug,
    distDir,
    config,
    watermark,
    cacheKey,
    manifest.entries[photoSlug],
  );
}

async function processCachedPhoto(
  sourcePath: string,
  gallerySlug: string,
  distDir: string,
  config: ImageConfig,
  watermark: Buffer | undefined,
  cacheKey: string,
  cached: CacheEntry | undefined,
): Promise<CachedProcessResult> {
  if (
    cached &&
    cached.hash === cacheKey &&
    (await outputFilesExist(distDir, cached))
  ) {
    return {
      result: {
        variants: cached.variants,
        thumbnailPath: cached.thumbnailPath,
      },
      fromCache: true,
    };
  }

  const result = await processPhoto(
    sourcePath,
    gallerySlug,
    distDir,
    config,
    watermark,
  );

  return { result, fromCache: false };
}

export async function processAllPhotosWithCache(
  photos: readonly {
    readonly slug: string;
    readonly gallerySlug: string;
    readonly sourcePath: string;
  }[],
  projectDir: string,
  distDir: string,
  config: ImageConfig,
): Promise<Map<string, ProcessPhotoResult>> {
  const manifest = await loadCacheManifest(projectDir);
  const results = new Map<string, ProcessPhotoResult>();
  const newEntries: Record<string, CacheEntry> = { ...manifest.entries };
  const watermark = await loadWatermark(config);
  const paramsHash = computeParamsHash(config, watermark);
  let cacheHits = 0;

  for (const photo of photos) {
    const cacheKey = computeCacheKey(
      await computeFileHash(photo.sourcePath),
      paramsHash,
    );
    const { result, fromCache } = await processCachedPhoto(
      photo.sourcePath,
      photo.gallerySlug,
      distDir,
      config,
      watermark,
      cacheKey,
      manifest.entries[photo.slug],
    );

    results.set(photo.slug, result);

    if (fromCache) {
      cacheHits++;
    } else {
      newEntries[photo.slug] = {
        hash: cacheKey,
        variants: result.variants,
        thumbnailPath: result.thumbnailPath,
      };
    }
  }

  const newManifest: CacheManifest = { entries: newEntries };
  await saveCacheManifest(projectDir, newManifest);

  if (cacheHits > 0) {
    const total = photos.length;
    console.log(
      `Image cache: ${String(cacheHits)}/${String(total)} photos skipped (unchanged)`,
    );
  }

  return results;
}
