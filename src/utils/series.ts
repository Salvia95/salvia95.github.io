import type { CollectionEntry } from "astro:content";
import { optimizePostImagePath } from "@/utils/images";
import { shouldShowPost } from "@/utils/markdown";

type PostEntry = CollectionEntry<"posts">;

// Full series detail used by the series landing route.
export interface SeriesDetail {
  slug: string; // series directory name, e.g. "chunk-batch"
  title: string;
  summary: string;
  imageUrl: string | null;
  imageAlt: string;
  count: number;
  latest: Date; // most recent member/index date (recency for ranking)
  index: PostEntry; // the series' index.md — its body is the landing page intro
  members: PostEntry[]; // reading order (oldest first)
}

// Compact card used by the carousel.
export interface SeriesInfo {
  slug: string;
  title: string;
  summary: string;
  imageUrl: string | null;
  imageAlt: string;
  count: number;
  latest: Date;
  href: string; // series landing page
}

// Public URL of a series landing page.
export function seriesHref(slug: string): string {
  return `/posts/series/${slug}`;
}

// Resolve the folder that owns a post id, handling both id conventions:
//   "chunk-batch/index" (loader keeps /index)  -> "chunk-batch"
//   "chunk-batch"        (loader strips /index) -> "chunk-batch"
function seriesDirOf(id: string): string {
  if (id.endsWith("/index")) return id.slice(0, -"/index".length);
  return id;
}

/**
 * Discover every series and its members.
 *
 * A series is a folder whose `index.md` sets `series: true`; the other markdown
 * files in that folder are its members. Members are returned in reading order
 * (oldest first, tie-broken by id so 01-, 02-, … stay in sequence). Series are
 * sorted by their most recently dated member (recency), newest first.
 */
export function getSeriesList(
  allPosts: PostEntry[],
  isDev: boolean
): SeriesDetail[] {
  const seriesIndexes = allPosts.filter((p) => (p.data as any).series === true);

  const details: Array<{ detail: SeriesDetail; order: number }> = [];

  for (const index of seriesIndexes) {
    const dir = seriesDirOf(index.id);
    if (!dir) continue;

    const memberPrefix = `${dir}/`;
    const members = allPosts
      .filter(
        (p) =>
          p.id !== index.id &&
          p.id.startsWith(memberPrefix) &&
          shouldShowPost(p as any, isDev)
      )
      .sort(
        (a, b) =>
          a.data.date.getTime() - b.data.date.getTime() ||
          a.id.localeCompare(b.id)
      );

    // A series with no visible members has nothing to show — skip it.
    if (members.length === 0) continue;

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

    details.push({
      order: (index.data as any).seriesOrder ?? Number.POSITIVE_INFINITY,
      detail: {
        slug: dir,
        title: index.data.title,
        summary: (index.data as any).summary || index.data.description || "",
        imageUrl,
        imageAlt: index.data.imageAlt || index.data.title,
        count: members.length,
        latest,
        index,
        members,
      },
    });
  }

  // Most recently updated first; tie-break by explicit seriesOrder, then title.
  details.sort((a, b) => {
    const byDate = b.detail.latest.getTime() - a.detail.latest.getTime();
    if (byDate !== 0) return byDate;
    if (a.order !== b.order) return a.order - b.order;
    return a.detail.title.localeCompare(b.detail.title);
  });

  return details.map((d) => d.detail);
}

/**
 * Top-N most recently updated series as compact carousel cards. Clicking a card
 * opens that series' landing page.
 */
export function getTopSeries(
  allPosts: PostEntry[],
  isDev: boolean,
  limit = 3
): SeriesInfo[] {
  return getSeriesList(allPosts, isDev)
    .slice(0, limit)
    .map(({ members, index, ...rest }) => ({
      ...rest,
      href: seriesHref(rest.slug),
    }));
}
