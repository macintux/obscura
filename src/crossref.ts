import type { BlogPost, CrossReferenceGraph } from './types.js';

export function buildCrossReferenceGraph(
  posts: readonly BlogPost[],
): CrossReferenceGraph {
  const photoToPostSlugs = new Map<string, string[]>();
  const postToPhotoSlugs = new Map<string, string[]>();

  for (const post of posts) {
    const postKey = post.url ?? post.slug;
    const uniquePhotos = [...new Set(post.referencedPhotos)];
    postToPhotoSlugs.set(postKey, uniquePhotos);

    for (const photoSlug of uniquePhotos) {
      const existing = photoToPostSlugs.get(photoSlug);
      if (existing) {
        existing.push(postKey);
      } else {
        photoToPostSlugs.set(photoSlug, [postKey]);
      }
    }
  }

  return { photoToPostSlugs, postToPhotoSlugs };
}

export function getBackLinks(
  graph: CrossReferenceGraph,
  photoSlug: string,
): readonly string[] {
  return graph.photoToPostSlugs.get(photoSlug) ?? [];
}

export function getReferencedPhotos(
  graph: CrossReferenceGraph,
  postSlug: string,
): readonly string[] {
  return graph.postToPhotoSlugs.get(postSlug) ?? [];
}
