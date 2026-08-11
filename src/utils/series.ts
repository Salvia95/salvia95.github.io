import type { CollectionEntry } from "astro:content";
import { optimizePostImagePath } from "@/utils/images";
import { shouldShowPost } from "@/utils/markdown";

export interface SeriesInfo {
  slug: string; // series directory name, e.g. "chunk-batch"
  title: string;
  summary: string;
  imageUrl: string | null;
  imageAlt: string;
  count: number; // number of visible member posts
  latest: Date; // most recent member/index date (recency for ranking)
  href: string; // carousel click target: the newest member post
}

type PostEntry = CollectionEntry<"posts">;

// Resolve the folder that owns a post id, handling both id conventions:
//   "chunk-batch/index" (loader keeps /index)  -> "chunk-batch"
//   "chunk-batch"        (loader strips /index) -> "chunk-batch"
function seriesDirOf(id: string): string {
  if (id.endsWith("/index")) return id.slice(0, -"/index".length);
  return id;
}

/**
 * Discover series and rank them for the carousel.
 *
 * A series is a folder whose `index.md` sets `series: true` in frontmatter; the
 * other markdown files in that folder are its member posts. Series are ranked by
 * the most recently dated member post (posts only carry `date`), and the top
 * `limit` are returned.
 */
export function getTopSeries(
  allPosts: PostEntry[],
  isDev: boolean,
  limit = 3
): SeriesInfo[] {
  const seriesIndexes = allPosts.filter((p) => (p.data as any).series === true);

  const ranked: Array<{ info: SeriesInfo; order: number }> = [];

  for (const index of seriesIndexes) {
    const dir = seriesDirOf(index.id);
    if (!dir) continue;

    const memberPrefix = `${dir}/`;
    const members = allPosts.filter(
      (p) =>
        p.id !== index.id &&
        p.id.startsWith(memberPrefix) &&
        shouldShowPost(p as any, isDev)
    );

    // A series with no visible members has nothing to link to — skip it.
    if (members.length === 0) continue;

    const newestMember = members.reduce((a, b) =>
      b.data.date.getTime() > a.data.date.getTime() ? b : a
    );

    const latest = new Date(
      Math.max(
        index.data.date.getTime(),
        ...members.map((m) => m.data.date.getTime())
      )
    );

    const rawImage = (index.data as any).image;
    const imageUrl = rawImage
      ? optimizePostImagePath(String(rawImage), dir, index.id)
      : null;

    ranked.push({
      order: (index.data as any).seriesOrder ?? Number.POSITIVE_INFINITY,
      info: {
        slug: dir,
        title: index.data.title,
        summary: (index.data as any).summary || index.data.description || "",
        imageUrl,
        imageAlt: index.data.imageAlt || index.data.title,
        count: members.length,
        latest,
        href: `/posts/${newestMember.id}`,
      },
    });
  }

  // Most recently updated first; tie-break by explicit seriesOrder, then title.
  ranked.sort((a, b) => {
    const byDate = b.info.latest.getTime() - a.info.latest.getTime();
    if (byDate !== 0) return byDate;
    if (a.order !== b.order) return a.order - b.order;
    return a.info.title.localeCompare(b.info.title);
  });

  return ranked.slice(0, limit).map((r) => r.info);
}
