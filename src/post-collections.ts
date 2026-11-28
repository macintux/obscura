import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { loadAllBlogPosts } from './markdown.js';
import type { SlugIndex } from './slugs.js';
import type { BlogPost, Page } from './types.js';

export interface PostCollectionConfig {
  readonly key: string;
  readonly title: string;
  readonly source: string;
  readonly url: string;
}

export interface PostCollection extends PostCollectionConfig {
  readonly posts: readonly BlogPost[];
}

export const DEFAULT_POST_COLLECTION: PostCollectionConfig = {
  key: 'blog',
  title: 'Blog',
  source: 'posts',
  url: '/blog/',
};

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadPostCollections(
  projectDir: string,
  slugIndex: SlugIndex,
  basePath: string,
): Promise<PostCollection[]> {
  const file = resolve(projectDir, 'site/config/posts.yaml');
  const contentDir = resolve(projectDir, 'site/content');
  let yaml: string;
  try {
    yaml = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const posts = await loadAllBlogPosts(
      resolve(contentDir, DEFAULT_POST_COLLECTION.source),
      slugIndex,
      basePath,
    );
    return [withPostUrls(DEFAULT_POST_COLLECTION, posts)];
  }

  const config: unknown = parse(yaml);
  if (!isMapping(config) || !isMapping(config['collections'])) {
    throw new Error('posts.yaml requires a collections mapping');
  }

  const collections: PostCollection[] = [];
  for (const [key, entry] of Object.entries(config['collections'])) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || !isMapping(entry)) {
      throw new Error(`Invalid posts.yaml collection "${key}"`);
    }
    const { title, source, url } = entry;
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      typeof source !== 'string' ||
      !source
        .split('/')
        .every(
          (part) => part !== '.' && part !== '..' && /^[^\\/:]+$/.test(part),
        ) ||
      typeof url !== 'string' ||
      !/^(?:\/[a-z0-9][a-z0-9_-]*)+\/?$/.test(url)
    ) {
      throw new Error(
        `posts.yaml collection "${key}" requires a title, a source relative to site/content, and a local URL path`,
      );
    }
    const posts = await loadAllBlogPosts(
      resolve(contentDir, source),
      slugIndex,
      basePath,
      true,
    );
    collections.push(
      withPostUrls(
        { key, title, source, url: url.endsWith('/') ? url : `${url}/` },
        posts,
      ),
    );
  }
  return collections;
}

function withPostUrls(
  config: PostCollectionConfig,
  posts: readonly BlogPost[],
): PostCollection {
  return {
    ...config,
    posts: posts.map((post) => ({
      ...post,
      url: `${config.url}${post.slug}/`,
    })),
  };
}

export function validatePostRoutes(
  collections: readonly PostCollection[],
  pages: readonly Page[],
): void {
  const used = new Map(
    pages.map((page) => [
      `/${page.slug}/`.toLowerCase(),
      `page "${page.slug}"`,
    ]),
  );
  for (const collection of collections) {
    const owner = `post collection "${collection.key}"`;
    for (const url of [collection.url, ...collection.posts.map(postUrl)]) {
      const normalized = url.toLowerCase();
      const segments = normalized.split('/').slice(1, -1);
      const conflict = used.get(normalized);
      if (
        conflict ||
        segments.some(
          (part) =>
            part === 'index.html' || part === '.' || part === '..' || !part,
        ) ||
        /^\/(?:photography|tags|locations|assets|404\.html|feed\.xml|sitemap\.xml)\//.test(
          normalized,
        )
      ) {
        throw new Error(
          `Output path "${url}" for ${owner} conflicts with ${conflict ?? 'a reserved output path'}`,
        );
      }
      used.set(normalized, owner);
    }
  }
}

export function postUrl(post: BlogPost): string {
  return post.url ?? `${DEFAULT_POST_COLLECTION.url}${post.slug}/`;
}

export function collectionNavKey(collection: PostCollectionConfig): string {
  return collection.url.slice(1, -1);
}
