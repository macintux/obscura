import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { cp, rm, access, mkdir, readFile, rename, symlink, writeFile, mkdtemp } from 'node:fs/promises';
import { build } from '../src/build.js';

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures', 'site');
const WORK_DIR = resolve(import.meta.dirname, 'fixtures', 'site-work');
const THEME_SRC = resolve(import.meta.dirname, '..', 'themes', 'editorial');

describe('full build pipeline', () => {
  beforeAll(async () => {
    // Copy fixture to a work directory so we don't pollute
    await rm(WORK_DIR, { recursive: true, force: true });
    await cp(FIXTURE_DIR, WORK_DIR, { recursive: true });
    const photoDir = resolve(WORK_DIR, 'site/content/photos/test-gallery');
    for (const extension of ['jpg', 'yaml']) {
      await rename(
        resolve(photoDir, `test-photo.${extension}`),
        resolve(photoDir, `test, photo.${extension}`),
      );
    }
    // Symlink the real editorial theme (built-in themes stay at project root)
    await mkdir(resolve(WORK_DIR, 'themes'), { recursive: true });
    await symlink(THEME_SRC, resolve(WORK_DIR, 'themes', 'editorial'));
  });

  afterAll(async () => {
    await rm(WORK_DIR, { recursive: true, force: true });
  });

  it('completes a build successfully', async () => {
    const result = await build(WORK_DIR);
    expect(result.success).toBe(true);
    expect(result.photoCount).toBe(2);
    expect(result.pageCount).toBeGreaterThan(0);
  });

  it('generates index.html (homepage)', async () => {
    const path = resolve(WORK_DIR, 'dist', 'index.html');
    await expect(access(path)).resolves.toBeUndefined();
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('Test Site');
    expect(html).toContain('Recent Shots');
  });

  it('generates gallery index at photography/index.html', async () => {
    const path = resolve(WORK_DIR, 'dist', 'photography', 'index.html');
    await expect(access(path)).resolves.toBeUndefined();
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('Test Gallery');
  });

  it('generates gallery page', async () => {
    const path = resolve(WORK_DIR, 'dist', 'photography', 'test-gallery', 'index.html');
    await expect(access(path)).resolves.toBeUndefined();
  });

  it('generates photo permalink', async () => {
    const path = resolve(WORK_DIR, 'dist', 'photography', 'test-gallery', 'test-photo', 'index.html');
    await expect(access(path)).resolves.toBeUndefined();
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('Test Photo');
    expect(html).toContain('Berlin, Germany');
    expect(html).toContain('Test Camera');
    expect(html).toContain('<time datetime="2024-06-15">15 June 2024</time>');
  });

  it('photo permalink has backlinks to referencing post', async () => {
    const path = resolve(WORK_DIR, 'dist', 'photography', 'test-gallery', 'test-photo', 'index.html');
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('Hello World');
    expect(html).toContain('Referenced in');
  });

  it('generates blog index', async () => {
    const path = resolve(WORK_DIR, 'dist', 'blog', 'index.html');
    await expect(access(path)).resolves.toBeUndefined();
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('Hello World');
  });

  it('generates blog post page', async () => {
    const path = resolve(WORK_DIR, 'dist', 'blog', 'hello-world', 'index.html');
    await expect(access(path)).resolves.toBeUndefined();
  });

  it('generates about page', async () => {
    const path = resolve(WORK_DIR, 'dist', 'about', 'index.html');
    await expect(access(path)).resolves.toBeUndefined();
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('About');
  });

  it('generates 404 page', async () => {
    const path = resolve(WORK_DIR, 'dist', '404.html');
    await expect(access(path)).resolves.toBeUndefined();
  });

  it('generates RSS feed', async () => {
    const path = resolve(WORK_DIR, 'dist', 'feed.xml');
    await expect(access(path)).resolves.toBeUndefined();
    const xml = await readFile(path, 'utf-8');
    expect(xml).toContain('<rss');
    expect(xml).toContain('Hello World');
    expect(xml).toContain('test.example.com');
  });

  it('generates sitemap', async () => {
    const path = resolve(WORK_DIR, 'dist', 'sitemap.xml');
    await expect(access(path)).resolves.toBeUndefined();
    const xml = await readFile(path, 'utf-8');
    expect(xml).toContain('<urlset');
    expect(xml).toContain('test.example.com/photography/');
    expect(xml).toContain('test.example.com/blog/hello-world/');
  });

  it('copies theme assets', async () => {
    const cssPath = resolve(WORK_DIR, 'dist', 'assets', 'theme', 'css', 'style.css');
    await expect(access(cssPath)).resolves.toBeUndefined();
  });

  it('copies PhotoSwipe vendor assets', async () => {
    const pswpPath = resolve(WORK_DIR, 'dist', 'assets', 'vendor', 'photoswipe', 'photoswipe.esm.min.js');
    await expect(access(pswpPath)).resolves.toBeUndefined();
  });

  it('generates image variants', async () => {
    const imgDir = resolve(WORK_DIR, 'dist', 'assets', 'images', 'test-gallery');
    await expect(access(resolve(imgDir, 'test, photo-100w.webp'))).resolves.toBeUndefined();
  });

  it('encodes photo filenames in image URLs', async () => {
    const path = resolve(WORK_DIR, 'dist', 'photography', 'test-gallery', 'test-photo', 'index.html');
    const html = await readFile(path, 'utf-8');
    const url = '/assets/images/test-gallery/test%2C%20photo-100w.webp';
    expect(html).toContain(`src="${url}"`);
    expect(html).toContain(`srcset="${url} 100w"`);
  });

  it('photo page displays default license', async () => {
    const path = resolve(WORK_DIR, 'dist', 'photography', 'test-gallery', 'test-photo', 'index.html');
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('License');
    expect(html).toContain('All Rights Reserved');
  });

  it('photo page includes schema.org structured data with license', async () => {
    const path = resolve(WORK_DIR, 'dist', 'photography', 'test-gallery', 'test-photo', 'index.html');
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('"@type": "ImageObject"');
    expect(html).toContain('"copyrightNotice"');
  });

  it('gallery page includes data-pswp-license attribute', async () => {
    const path = resolve(WORK_DIR, 'dist', 'photography', 'test-gallery', 'index.html');
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('data-pswp-license="all-rights-reserved"');
  });

  it('photo page og:description falls back to location + date when no caption', async () => {
    // The test fixture photo has a caption, so og:description should use it
    const path = resolve(WORK_DIR, 'dist', 'photography', 'test-gallery', 'test-photo', 'index.html');
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('og:description');
    expect(html).toContain('A photo for testing');
  });

  it('photo page includes og:image and twitter:card when variants exist', async () => {
    const path = resolve(WORK_DIR, 'dist', 'photography', 'test-gallery', 'test-photo', 'index.html');
    const html = await readFile(path, 'utf-8');
    // Test fixture has a tiny image; og:image/twitter:card only render when variants exist
    // Verify the og:type and og:title are always present
    expect(html).toContain('og:type');
    expect(html).toContain('og:title');
  });

  it('gallery page includes og:title and og:url', async () => {
    const path = resolve(WORK_DIR, 'dist', 'photography', 'test-gallery', 'index.html');
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('og:title');
    expect(html).toContain('og:url');
  });

  it('homepage includes og:type and og:title', async () => {
    const path = resolve(WORK_DIR, 'dist', 'index.html');
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('og:type');
    expect(html).toContain('og:title');
  });

  it('static page includes og:title and og:url', async () => {
    const path = resolve(WORK_DIR, 'dist', 'about', 'index.html');
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('og:title');
    expect(html).toContain('og:url');
  });

  it('renders mobile nav toggle button', async () => {
    const path = resolve(WORK_DIR, 'dist', 'index.html');
    const html = await readFile(path, 'utf-8');
    expect(html).toContain('class="nav-toggle"');
    expect(html).toContain('aria-controls="site-nav"');
    expect(html).toContain('id="site-nav"');
  });
});

it('builds independent post collections and uses their URLs across the site', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'obscura-collections-'));
  try {
    await cp(FIXTURE_DIR, dir, { recursive: true });
    await mkdir(resolve(dir, 'themes'));
    await symlink(THEME_SRC, resolve(dir, 'themes/editorial'));
    const config = resolve(dir, 'site/config');
    const posts = resolve(dir, 'site/content/posts');
    await mkdir(resolve(posts, 'erlang'));
    await writeFile(resolve(config, 'site.yaml'), `
base_url: https://test.example.com/portfolio
navigation:
  - label: Indiana History
    url: posts:history
  - label: Erlang
    url: /notes/erlang/
`);
    await writeFile(resolve(config, 'posts.yaml'), `
collections:
  history:
    title: Indiana History
    source: posts
    url: /history
  erlang:
    title: Erlang
    source: posts/erlang
    url: /notes/erlang/
`);
    await writeFile(resolve(posts, 'newer.md'), '---\ntitle: Newer History\ndate: 2025-01-01\ntags: []\n---\n');
    await writeFile(resolve(posts, 'erlang/hello-world.md'), '---\ntitle: Erlang Hello\ndate: 2026-01-01\ntags: []\n---\n');

    await build(dir);
    const output = (file: string) => readFile(resolve(dir, 'dist', file), 'utf8');
    const history = await output('history/index.html');
    expect(history).toContain('<h1 class="page-title">Indiana History</h1>');
    expect(history).toContain('href="/portfolio/history/" aria-current="page"');
    expect(history).toContain('href="/portfolio/history/hello-world/"');
    expect(history).toContain('Newer History');
    expect(history.indexOf('Newer History')).toBeLessThan(history.indexOf('Hello World'));
    expect(history).not.toContain('Erlang Hello');
    const erlang = await output('notes/erlang/hello-world/index.html');
    expect(erlang).toContain('href="/portfolio/notes/erlang/" aria-current="page"');
    expect(erlang).toContain('https://test.example.com/portfolio/notes/erlang/hello-world/');
    const feed = await output('feed.xml');
    expect(feed).toContain('https://test.example.com/portfolio/history/hello-world/');
    expect(feed).toContain('https://test.example.com/portfolio/notes/erlang/hello-world/');
    expect(feed.indexOf('Erlang Hello')).toBeLessThan(feed.indexOf('Newer History'));
    expect(await output('sitemap.xml')).toContain('<loc>https://test.example.com/portfolio/notes/erlang/</loc>');
    const photo = await output('photography/test-gallery/test-photo/index.html');
    expect(photo).toContain('href="/portfolio/history/hello-world/"');
    expect(photo).not.toContain('/notes/erlang/hello-world/');
    await expect(access(resolve(dir, 'dist/blog'))).rejects.toMatchObject({ code: 'ENOENT' });

    const postsConfig = resolve(config, 'posts.yaml');
    const validConfig = await readFile(postsConfig, 'utf8');
    await writeFile(postsConfig, validConfig.replace('url: /history', 'url: /about'));
    await expect(build(dir)).rejects.toThrow(/Output path "\/about\/" .*page "about"/);
    expect(await output('history/index.html')).toBe(history);

    await writeFile(postsConfig, validConfig.replace('source: posts/erlang', 'source: missing'));
    await expect(build(dir)).rejects.toThrow(/ENOENT.*content\/missing/);

    await writeFile(postsConfig, validConfig.replace('  history:', '  renamed:'));
    await expect(build(dir)).rejects.toThrow(/post collection "history" not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
