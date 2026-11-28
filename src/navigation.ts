import type { SiteConfig, Page, ResolvedNavItem } from './types.js';
import {
  collectionNavKey,
  DEFAULT_POST_COLLECTION,
} from './post-collections.js';
import type { PostCollectionConfig } from './post-collections.js';

/** Built-in route keywords and their URL paths. */
const BUILTIN_ROUTES: Readonly<Record<string, string>> = {
  photography: '/photography/',
  tags: '/tags/',
  locations: '/locations/',
};

/**
 * Default navigation matching the original hardcoded menu.
 * About/Contact use literal paths (not page: refs) so the default
 * works even when those pages don't exist — matching the old hardcoded
 * template behavior where the links were always present.
 */
const DEFAULT_NAV: readonly { readonly label: string; readonly url: string }[] =
  [
    { label: 'Photography', url: 'photography' },
    { label: 'Tags', url: 'tags' },
    { label: 'Locations', url: 'locations' },
    { label: 'About', url: '/about/' },
    { label: 'Contact', url: '/contact/' },
  ];

/**
 * Resolve navigation items from config into fully-resolved nav entries.
 * When `config.navigation` is omitted, uses the default menu with links to each collection.
 * Throws when a page or collection reference cannot be resolved.
 */
export function resolveNavigation(
  config: SiteConfig,
  pages: readonly Page[],
  collections: readonly PostCollectionConfig[] = [DEFAULT_POST_COLLECTION],
): readonly ResolvedNavItem[] {
  const items = config.navigation ?? [
    ...DEFAULT_NAV.slice(0, 3),
    ...collections.map(({ key, title }) => ({
      label: title,
      url: `posts:${key}`,
    })),
    ...DEFAULT_NAV.slice(3),
  ];
  const pageSlugs = new Set(pages.map((p) => p.slug));

  return items.map((item) =>
    resolveNavItem(item, config.base_path, pageSlugs, collections),
  );
}

function resolveNavItem(
  item: { readonly label: string; readonly url: string },
  basePath: string,
  pageSlugs: ReadonlySet<string>,
  collections: readonly PostCollectionConfig[],
): ResolvedNavItem {
  const { label, url } = item;

  // External URL
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { label, href: url, navKey: null, external: true };
  }

  // Page reference: page:<slug>
  if (url.startsWith('page:')) {
    const slug = url.slice(5);
    if (!pageSlugs.has(slug)) {
      throw new Error(
        `Navigation error: page "${slug}" not found. ` +
          `Referenced in nav item "${label}" (url: "${url}"). ` +
          `Available pages: ${[...pageSlugs].join(', ') || '(none)'}`,
      );
    }
    return {
      label,
      href: `${basePath}/${slug}/`,
      navKey: slug,
      external: false,
    };
  }

  if (url === 'blog' || url.startsWith('posts:')) {
    const key = url === 'blog' ? url : url.slice(6);
    const collection = collections.find((entry) => entry.key === key);
    if (!collection) {
      throw new Error(
        `Navigation error: post collection "${key}" not found (nav item "${label}")`,
      );
    }
    return {
      label,
      href: `${basePath}${collection.url}`,
      navKey: collectionNavKey(collection),
      external: false,
    };
  }

  // Built-in route keyword
  const builtinPath = BUILTIN_ROUTES[url];
  if (builtinPath) {
    return {
      label,
      href: `${basePath}${builtinPath}`,
      navKey: url,
      external: false,
    };
  }

  // Literal path starting with /
  if (url.startsWith('/')) {
    // Derive navKey from simple /<slug>/ paths for active-link highlighting
    const slugMatch = /^\/([^/]+)\/$/.exec(url);
    const collection = collections.find((entry) => entry.url === url);
    const navKey = collection
      ? collectionNavKey(collection)
      : (slugMatch?.[1] ?? null);
    return { label, href: `${basePath}${url}`, navKey, external: false };
  }

  // Unknown — treat as literal path
  return {
    label,
    href: `${basePath}/${url}/`,
    navKey: url,
    external: false,
  };
}
