import { resolve } from 'node:path';
import { loadSiteConfig, loadGalleryConfig } from './config.js';
import { validateAllGalleryFormats } from './image-validation.js';
import { loadGalleries } from './gallery.js';
import { loadAllPages } from './markdown.js';
import { loadPostCollections, validatePostRoutes } from './post-collections.js';
import { resolveNavigation } from './navigation.js';
import { formatExifWarnings } from './exif.js';
import { loadTheme } from './theme.js';
import type { SlugIndex } from './slugs.js';

/**
 * Content validation — fast check without image processing.
 * Validates: config, image formats, EXIF/sidecars, slug uniqueness,
 * shortcode references, theme existence.
 */
async function main(): Promise<void> {
  const projectDir = resolve(process.cwd());
  const warnings: string[] = [];
  let hasErrors = false;

  console.log('Obscura — validating content…\n');

  // -- 1. Config --
  let siteConfig;
  let galleryConfig;

  try {
    siteConfig = await loadSiteConfig(projectDir);
    console.log('  ✓ site.yaml');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    console.error(`  ✗ site.yaml: ${msg}`);
    hasErrors = true;
  }

  try {
    galleryConfig = await loadGalleryConfig(projectDir);
    console.log('  ✓ galleries.yaml');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    console.error(`  ✗ galleries.yaml: ${msg}`);
    hasErrors = true;
  }

  if (!siteConfig || !galleryConfig) {
    console.error('\n✗ Validation failed — config errors must be fixed first.');
    process.exitCode = 1;
    return;
  }

  // -- 2. Theme --
  const userThemesDir = resolve(projectDir, 'site', 'themes');
  const builtinThemesDir = resolve(projectDir, 'themes');
  try {
    await loadTheme([userThemesDir, builtinThemesDir], siteConfig.theme);
    console.log(`  ✓ theme "${siteConfig.theme}"`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    console.error(`  ✗ theme: ${msg}`);
    hasErrors = true;
  }

  // -- 3. Image format validation --
  const photosDir = resolve(projectDir, 'site', 'content', 'photos');
  const gallerySlugs = galleryConfig.galleries.map((g) => g.slug);

  try {
    await validateAllGalleryFormats(photosDir, gallerySlugs);
    console.log('  ✓ image formats');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    console.error(`  ✗ image formats: ${msg}`);
    hasErrors = true;
  }

  // -- 4. Galleries (EXIF + sidecars + slug uniqueness) --
  let slugIndex: SlugIndex | undefined;
  try {
    const { slugIndex: loadedSlugIndex, warnings: galleryWarnings } =
      await loadGalleries(photosDir, galleryConfig.galleries);
    slugIndex = loadedSlugIndex;
    console.log(
      `  ✓ galleries (${String(gallerySlugs.length)} configured, ${String(slugIndex.size)} photos indexed)`,
    );
    if (galleryWarnings.length > 0) {
      warnings.push(formatExifWarnings(galleryWarnings));
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    console.error(`  ✗ galleries: ${msg}`);
    hasErrors = true;
  }

  // -- 5. Pages, post collections, and navigation --
  try {
    const pagesDir = resolve(projectDir, 'site', 'content', 'pages');
    const pages = await loadAllPages(pagesDir, siteConfig.base_path);
    console.log(`  ✓ pages (${String(pages.length)})`);
    if (slugIndex) {
      const collections = await loadPostCollections(
        projectDir,
        slugIndex,
        siteConfig.base_path,
      );
      validatePostRoutes(collections, pages);
      resolveNavigation(siteConfig, pages, collections);
      console.log(
        `  ✓ post collections (${String(collections.length)}) and navigation`,
      );
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    console.error(`  ✗ content: ${msg}`);
    hasErrors = true;
  }

  // -- Summary --
  if (warnings.length > 0) {
    console.warn('\n⚠ Warnings:\n');
    for (const w of warnings) {
      console.warn(w);
    }
  }

  if (hasErrors) {
    console.error('\n✗ Validation failed.');
    process.exitCode = 1;
  } else {
    console.log('\n✓ All content valid.');
  }
}

void main();
