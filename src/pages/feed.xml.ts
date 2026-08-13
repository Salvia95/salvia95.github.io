import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { siteConfig } from "../config";
import { shouldShowPost } from "../utils/markdown";
import { getSiteBase } from "../utils/urls";

export const GET: APIRoute = async () => {
  const siteUrl = getSiteBase();
  // shouldShowPost 로 걸러야 시리즈 인덱스 글(series: true)이 빠진다.
  // 이 글들은 /posts/<id>/ 라우트가 없어서 피드에 실리면 404 링크가 된다.
  const isDev = import.meta.env.DEV;
  const allPosts = await getCollection("posts");
  const posts = allPosts.filter((post) => shouldShowPost(post as any, isDev));

  // Sort posts by date (newest first)
  const sortedPosts = posts.sort(
    (a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime()
  );

  // Generate Atom feed XML
  const atomFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${siteConfig.title}</title>
  <subtitle>${siteConfig.description}</subtitle>
  <link href="${siteUrl}"/>
  <link href="${siteUrl}feed.xml" rel="self"/>
  <id>${siteUrl}</id>
  <author>
    <name>${siteConfig.author}</name>
  </author>
  <updated>${new Date().toISOString()}</updated>

  ${sortedPosts
    .map(
      (post) => `
  <entry>
    <title>${post.data.title}</title>
    <link href="${siteUrl}posts/${(post as any).id}/"/>
    <id>${siteUrl}posts/${(post as any).id}/</id>
    <published>${new Date(post.data.date).toISOString()}</published>
    <updated>${new Date(post.data.date).toISOString()}</updated>
    <summary>${post.data.description || ""}</summary>
    ${
      post.data.tags
        ? post.data.tags.map((tag) => `<category term="${tag}"/>`).join("")
        : ""
    }
  </entry>`
    )
    .join("")}
</feed>`;

  return new Response(atomFeed, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600", // Cache for 1 hour
    },
  });
};
