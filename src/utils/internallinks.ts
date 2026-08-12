import type { Post, WikilinkMatch } from "@/types";
import { visit } from "unist-util-visit";
// 링크 해석은 post-index 에 모여 있다. astro(vite)와 순수 node 스크립트가 같은
// 규칙을 쓰도록 .mjs 로 두었고, 상대 경로로 가져온다 (astro.config.mjs 가 이
// 파일을 직접 import 하는 시점에는 vite 의 "@" 별칭이 아직 적용되지 않는다).
// @ts-ignore - plain .mjs module without type declarations (build-time only)
import {
  getPostIndex,
  normalizePostPath,
  resolvePostRef,
  stripContentRootPrefix,
} from "./post-index.mjs";

// 이미 확정된 post id 로 제목을 찾는다. 경로로 적은 링크([[posts/a/b]])의
// 표시 텍스트를 원시 경로 대신 글 제목으로 바꾸는 데 쓴다.
function titleOfPostId(id: string): string {
  const found = getPostIndex().find((p) => p.id === id);
  return found?.title || "";
}

// 해석에 실패한 링크는 빌드 로그에 남겨 오타를 잡을 수 있게 한다.
const warnedLinks = new Set<string>();
function warnUnresolvedLink(target: string, fromFile?: string): void {
  const key = `${fromFile || ""}::${target}`;
  if (warnedLinks.has(key)) return;
  warnedLinks.add(key);
  const where = fromFile ? ` (${fromFile.split("/src/content/").pop()})` : "";
  console.warn(`[internallinks] 링크를 해석하지 못했습니다: [[${target}]]${where}`);
}

// Global posts cache for build-time wikilink resolution
let globalPostsCache: any[] = [];

// Function to set the global posts cache
export function setGlobalPostsCache(posts: any[]) {
  globalPostsCache = posts;
}

// Function to get the global posts cache
export function getGlobalPostsCache(): any[] {
  return globalPostsCache;
}

// Function to populate the global posts cache (called from layouts)
export function populateGlobalPostsCache(posts: any[]) {
  globalPostsCache = posts;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Utility functions for content-aware URL processing
function isFolderBasedContent(
  collection: "posts" | "pages",
  slug: string,
  allContent: any[]
): boolean {
  const content = allContent.find((item) => item.id === slug);
  return content ? content.id.endsWith("/index") : false;
}

function shouldRemoveIndexFromUrl(
  url: string,
  allPosts: any[],
  allPages: any[]
): boolean {
  // Determine collection type from URL
  if (url.startsWith("/posts/")) {
    const slug = url.replace("/posts/", "").split("#")[0]; // Remove anchor
    return isFolderBasedContent("posts", slug, allPosts);
  } else if (url.startsWith("/pages/")) {
    const slug = url.replace("/pages/", "").split("#")[0]; // Remove anchor
    return isFolderBasedContent("pages", slug, allPages);
  }
  return false; // Don't remove /index for other URLs
}

// Create slug from title for wikilink resolution
function createSlugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Create anchor slug from text (for heading anchors)
function createAnchorSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Parse link with potential anchor fragment
function parseLinkWithAnchor(linkText: string): {
  link: string;
  anchor: string | null;
} {
  const anchorIndex = linkText.indexOf("#");
  if (anchorIndex === -1) {
    return { link: linkText, anchor: null };
  }

  const link = linkText.substring(0, anchorIndex);
  const anchor = linkText.substring(anchorIndex + 1);

  return { link, anchor };
}

// Helper function to check if a node is inside a code block
function isInsideCodeBlock(parent: any, tree: any): boolean {
  // Check if the immediate parent is a code-related node
  if (!parent) return false;

  // Check for inline code or code blocks
  if (parent.type === "inlineCode" || parent.type === "code") {
    return true;
  }

  // Walk up the AST to check for code block ancestors
  let currentNode = parent;
  while (currentNode) {
    if (currentNode.type === "inlineCode" || currentNode.type === "code") {
      return true;
    }
    // Try to find the parent node in the tree (simplified check)
    currentNode = currentNode.parent;
  }

  return false;
}

// Helper function to check if a wikilink is inside backticks in raw content
function isWikilinkInCode(content: string, wikilinkIndex: number): boolean {
  // Find all backtick pairs in the content
  const backtickRegex = /`([^`]*)`/g;
  let match;

  while ((match = backtickRegex.exec(content)) !== null) {
    const codeStart = match.index;
    const codeEnd = match.index + match[0].length;

    // Check if the wikilink is inside this code block
    if (wikilinkIndex >= codeStart && wikilinkIndex < codeEnd) {
      return true;
    }
  }

  return false;
}

// Helper function to check if a URL is an internal link
function isInternalLink(url: string): boolean {
  // Remove any leading/trailing whitespace
  url = url.trim();

  // Skip external URLs (http/https)
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return false;
  }

  // Skip email links
  if (url.startsWith("mailto:")) {
    return false;
  }

  // Skip anchors only
  if (url.startsWith("#")) {
    return false;
  }

  // Parse anchor if present to check the base URL
  const { link } = parseLinkWithAnchor(url);

  // Check if it's an internal link:
  // - Ends with .md (markdown files)
  // - Starts with /posts/, /pages/, /projects/, /docs/, /special/ (relative URLs)
  // - Starts with posts/, pages/, projects/, docs/, special/ (relative paths)
  // - Is just a slug (no slashes) - assumes posts for backward compatibility
  const isInternal =
    link.endsWith(".md") ||
    link.startsWith("/posts/") ||
    link.startsWith("/pages/") ||
    link.startsWith("/projects/") ||
    link.startsWith("/docs/") ||
    link.startsWith("/special/") ||
    link.startsWith("posts/") ||
    link.startsWith("pages/") ||
    link.startsWith("projects/") ||
    link.startsWith("docs/") ||
    link.startsWith("special/") ||
    !link.includes("/");

  return isInternal;
}

// Helper function to map relative URLs to their actual site URLs
function mapRelativeUrlToSiteUrl(url: string): string {
  // Handle special case: /index/ or /index -> homepage
  if (url === "/index/" || url === "/index") {
    return "/";
  }

  // Handle special pages mapping
  if (url.startsWith("/special/")) {
    const specialPath = url.replace("/special/", "");
    if (specialPath === "home") {
      return "/"; // Homepage
    } else if (specialPath === "404") {
      return "/404"; // 404 page
    } else if (specialPath === "projects") {
      return "/projects"; // Projects index
    } else if (specialPath === "docs") {
      return "/docs"; // Docs index
    } else {
      // Other special pages - use normal page routing
      return `/${specialPath}`;
    }
  }

  // Handle pages mapping - remove /pages prefix
  if (url.startsWith("/pages/")) {
    const pagePath = url.replace("/pages/", "");
    return `/${pagePath}`;
  }

  // Handle special/ prefixed links (without leading slash)
  if (url.startsWith("special/")) {
    const specialPath = url.replace("special/", "");
    if (specialPath === "home") {
      return "/"; // Homepage
    } else if (specialPath === "404") {
      return "/404"; // 404 page
    } else if (specialPath === "projects") {
      return "/projects"; // Projects index
    } else if (specialPath === "docs") {
      return "/docs"; // Docs index
    } else {
      // Other special pages - use normal page routing
      return `/${specialPath}`;
    }
  }

  // Handle pages/ prefixed links (without leading slash)
  if (url.startsWith("pages/")) {
    const pagePath = url.replace("pages/", "");
    return `/${pagePath}`;
  }

  // For all other URLs, return as-is
  return url;
}

// Helper function to extract link text and anchor from URL for internal links
function extractLinkTextFromUrlWithAnchor(
  url: string,
  allPosts: any[] = [],
  allPages: any[] = []
): { linkText: string | null; anchor: string | null } {
  url = stripContentRootPrefix(url.trim());

  // Parse anchor if present
  const { link, anchor } = parseLinkWithAnchor(url);

  // Handle posts/ prefixed links first
  if (link.startsWith("posts/")) {
    let linkText = link.replace("posts/", "").replace(/\.md$/, "");
    // Conservative approach: only remove /index if it follows folder-based pattern
    if (linkText.endsWith("/index") && linkText.split("/").length === 2) {
      linkText = linkText.replace("/index", "");
    }
    return {
      linkText: linkText,
      anchor: anchor,
    };
  }

  // Handle /posts/ URLs (relative links)
  if (link.startsWith("/posts/")) {
    let linkText = link.replace("/posts/", "").replace(/\.md$/, "");
    // Conservative approach: only remove /index if it follows folder-based pattern
    if (linkText.endsWith("/index") && linkText.split("/").length === 2) {
      linkText = linkText.replace("/index", "");
    }
    return {
      linkText: linkText,
      anchor: anchor,
    };
  }

  // Handle special pages first
  if (link.startsWith("special/")) {
    const specialPath = link.replace("special/", "").replace(/\.md$/, "");
    if (specialPath === "home") {
      return {
        linkText: "homepage", // Special marker for homepage
        anchor: anchor,
      };
    } else if (specialPath === "404") {
      return {
        linkText: "404", // Special marker for 404 page
        anchor: anchor,
      };
    } else {
      return {
        linkText: specialPath,
        anchor: anchor,
      };
    }
  }

  // Handle /special/ URLs
  if (link.startsWith("/special/")) {
    const specialPath = link.replace("/special/", "");
    if (specialPath === "home") {
      return {
        linkText: "homepage", // Special marker for homepage
        anchor: anchor,
      };
    } else if (specialPath === "404") {
      return {
        linkText: "404", // Special marker for 404 page
        anchor: anchor,
      };
    } else {
      return {
        linkText: specialPath,
        anchor: anchor,
      };
    }
  }

  // Handle /pages/ URLs (relative links)
  if (link.startsWith("/pages/")) {
    let linkText = link.replace("/pages/", "").replace(/\.md$/, "");
    if (linkText.endsWith("/index")) {
      linkText = linkText.replace("/index", "");
    }
    return {
      linkText: linkText === "" ? "homepage" : linkText, // Special case for /pages/index -> homepage
      anchor: anchor,
    };
  }

  // Handle pages/ prefixed links (without leading slash)
  if (link.startsWith("pages/")) {
    let linkText = link.replace("pages/", "").replace(/\.md$/, "");
    if (linkText.endsWith("/index")) {
      linkText = linkText.replace("/index", "");
    }
    return {
      linkText: linkText === "" ? "homepage" : linkText, // Special case for pages/index -> homepage
      anchor: anchor,
    };
  }

  // Handle .md files - these should be treated as post references
  if (link.endsWith(".md")) {
    let linkText = link.replace(/\.md$/, "");
    // Conservative approach: only remove /index if it follows folder-based pattern
    if (linkText.endsWith("/index") && linkText.split("/").length === 1) {
      linkText = linkText.replace("/index", "");
    }
    return {
      linkText: linkText,
      anchor: anchor,
    };
  }

  // If it's just a slug (no slashes), use it directly
  if (!link.includes("/")) {
    return {
      linkText: link,
      anchor: anchor,
    };
  }

  return { linkText: null, anchor: null };
}

// ============================================================================
// WIKILINKS (OBSIDIAN-STYLE) - POSTS ONLY
// ============================================================================

/**
 * WIKILINKS: Obsidian-style [[Post Title]] syntax
 *
 * IMPORTANT: Wikilinks ONLY work with posts collection
 * - [[Post Title]] → /posts/post-title
 * - [[Post Title|Custom Text]] → /posts/post-title with custom display text
 * - ![[image.jpg]] → image reference
 *
 * This is Obsidian's special linking syntax and is intentionally limited to posts
 * to maintain simplicity and avoid confusion with standard markdown links.
 */

// Remark plugin for processing wikilinks (Obsidian-style) - original behavior
export function remarkWikilinks() {
  return function transformer(tree: any, file: any) {
    const nodesToReplace: Array<{
      parent: any;
      index: number;
      newChildren: any[];
    }> = [];

    visit(tree, "text", (node: any, index: any, parent: any) => {
      if (!node.value || typeof node.value !== "string") {
        return;
      }

      // Skip wikilink processing if we're inside a code block
      if (isInsideCodeBlock(parent, tree)) {
        return;
      }

      // Process both link wikilinks [[...]] and image wikilinks ![[...]]
      const wikilinkRegex = /!?\[\[([^\]]+)\]\]/g;
      let match;
      const newChildren: any[] = [];
      let lastIndex = 0;
      let hasWikilinks = false;

      while ((match = wikilinkRegex.exec(node.value)) !== null) {
        hasWikilinks = true;
        const [fullMatch, content] = match;
        const isImageWikilink = fullMatch.startsWith("!");
        const [link, displayText] = content.includes("|")
          ? content.split("|", 2)
          : [content, null]; // null means we'll resolve it later

        // Add text before the wikilink
        if (match.index > lastIndex) {
          newChildren.push({
            type: "text",
            value: node.value.slice(lastIndex, match.index),
          });
        }

        const linkText = link.trim();
        const finalDisplayText = displayText ? displayText.trim() : linkText;

        if (isImageWikilink) {
          // Process image wikilink - convert to markdown image syntax
          // Use the image path as-is (Obsidian doesn't use ./ by default)
          const imagePath = linkText;
          const altText = displayText || "";

          // Create a proper image node that Astro can process
          newChildren.push({
            type: "image",
            url: imagePath,
            alt: altText,
            title: null,
            data: {
              hName: "img",
              hProperties: {
                src: imagePath,
                alt: altText,
              },
            },
          });
        } else {
          // Process link wikilink - WIKILINKS ONLY WORK WITH POSTS
          const { link: rawLink, anchor } = parseLinkWithAnchor(linkText);
          // Strip a document-repo vault-absolute prefix (publish/blog/gitio/...)
          // so vault-absolute wikilinks resolve to the real post slug.
          const link = stripContentRootPrefix(rawLink);

          // Handle different link formats
          let url: string;
          let wikilinkData: string;
          // 해석된 글의 제목. 표시 텍스트가 따로 없을 때 대신 쓴다.
          let resolvedTitle = "";
          let unresolved = false;

          if (link.startsWith("posts/")) {
            // 경로로 적은 링크 - 로더와 동일한 슬러그 규칙으로 정규화한다.
            // (후행 "/index" 제거도 여기서 함께 처리된다)
            const cleanPath = normalizePostPath(link.replace(/^posts\//, ""));
            url = `/posts/${cleanPath}`;
            wikilinkData = cleanPath;
            resolvedTitle = titleOfPostId(cleanPath);
          } else if (link.includes("/")) {
            // Paths with slashes that don't start with posts/ are not valid for wikilinks
            // Skip processing - this would not work in Obsidian
            return;
          } else {
            // 디렉토리 없는 링크(옵시디언 "shortest path when possible").
            // 파일명·제목·별칭으로 실제 글을 찾는다.
            const ref = resolvePostRef(link, { fromFile: file?.path });
            if (ref) {
              url = `/posts/${ref.id}`;
              wikilinkData = ref.id;
              resolvedTitle = ref.title;
            } else {
              // 못 찾으면 기존 동작(슬러그 추측)으로 폴백하고 경고를 남긴다.
              unresolved = true;
              warnUnresolvedLink(link, file?.path);
              url = `/posts/${createSlugFromTitle(link)}`;
              wikilinkData = link.trim();
            }
          }

          // Add anchor if present
          if (anchor) {
            const anchorSlug = createAnchorSlug(anchor);
            url += `#${anchorSlug}`;
          }

          // Add the wikilink as a link node
          // We'll use the link text as placeholder - the actual resolution happens in PostLayout
          newChildren.push({
            type: "link",
            url: url,
            title: null,
            data: {
              hName: "a",
              hProperties: {
                className: unresolved
                  ? ["wikilink", "wikilink-broken"]
                  : ["wikilink"],
                "data-wikilink": wikilinkData,
                "data-display-override": displayText,
              },
            },
            children: [
              {
                type: "text",
                // [[link|display]] > 해석된 글 제목 > 링크에 적힌 문자열
                value: displayText || resolvedTitle || link.trim(),
              },
            ],
          });
        }

        lastIndex = wikilinkRegex.lastIndex;
      }

      // Add remaining text
      if (lastIndex < node.value.length) {
        newChildren.push({
          type: "text",
          value: node.value.slice(lastIndex),
        });
      }

      if (hasWikilinks && parent && parent.children) {
        nodesToReplace.push({
          parent,
          index,
          newChildren,
        });
      }
    });

    // Replace nodes with wikilinks
    nodesToReplace.reverse().forEach(({ parent, index, newChildren }) => {
      if (parent && parent.children && Array.isArray(parent.children)) {
        parent.children.splice(index, 1, ...newChildren);
      }
    });
  };
}

// Extract wikilinks from content (Obsidian-style)
export function extractWikilinks(
  content: string,
  fromId?: string
): WikilinkMatch[] {
  const matches: WikilinkMatch[] = [];

  // Extract wikilinks [[...]] and image wikilinks ![[...]]
  const wikilinkRegex = /!?\[\[([^\]]+)\]\]/g;
  let wikilinkMatch;

  while ((wikilinkMatch = wikilinkRegex.exec(content)) !== null) {
    const [fullMatch, linkContent] = wikilinkMatch;
    const isImageWikilink = fullMatch.startsWith("!");

    // Skip if wikilink is inside backticks (code)
    if (isWikilinkInCode(content, wikilinkMatch.index)) {
      continue;
    }

    // Only process link wikilinks for linked mentions, not image wikilinks
    if (!isImageWikilink) {
      const [link, displayText] = linkContent.includes("|")
        ? linkContent.split("|", 2)
        : [linkContent, linkContent];

      // Parse anchor if present
      const { link: rawBaseLink } = parseLinkWithAnchor(link.trim());
      const baseLink = stripContentRootPrefix(rawBaseLink);

      // 백링크 비교 대상은 post id 이므로, 렌더링과 동일한 규칙으로 해석한다.
      // (예전에는 ASCII slugify 를 써서 한글 제목 링크가 빈 문자열이 되었다)
      let finalSlug: string;
      if (baseLink.startsWith("posts/")) {
        finalSlug = normalizePostPath(baseLink.replace(/^posts\//, ""));
      } else if (baseLink.includes("/")) {
        finalSlug = normalizePostPath(baseLink);
      } else {
        const ref = resolvePostRef(baseLink, { fromId });
        finalSlug = ref ? ref.id : normalizePostPath(baseLink);
      }

      matches.push({
        link: baseLink,
        display: displayText.trim(),
        slug: finalSlug,
      });
    }
  }

  return matches;
}

// Resolve wikilink to actual post (posts only)
export function resolveWikilink(posts: Post[], linkText: string): Post | null {
  const targetSlug = createSlugFromTitle(linkText);

  // First try exact id match
  let post = posts.find((p) => p.id === targetSlug);

  // If not found, try title match
  if (!post) {
    post = posts.find((p) => createSlugFromTitle(p.data.title) === targetSlug);
  }

  return post || null;
}

// Validate wikilinks in content (posts only)
export function validateWikilinks(
  posts: Post[],
  content: string
): {
  valid: WikilinkMatch[];
  invalid: WikilinkMatch[];
} {
  const wikilinks = extractWikilinks(content);
  const valid: WikilinkMatch[] = [];
  const invalid: WikilinkMatch[] = [];

  wikilinks.forEach((wikilink) => {
    const resolved = resolveWikilink(posts, wikilink.link);
    if (resolved) {
      valid.push(wikilink);
    } else {
      invalid.push(wikilink);
    }
  });

  return { valid, invalid };
}

// ============================================================================
// STANDARD MARKDOWN LINKS - ALL CONTENT TYPES
// ============================================================================

/**
 * STANDARD MARKDOWN LINKS: [text](url) syntax
 *
 * These work with ALL content types:
 * - Posts: [Post Title](posts/post-slug) or [Post Title](post-slug)
 * - Pages: [Page Title](pages/page-slug) or [Page Title](page-slug)
 * - Projects: [Project Title](projects/project-slug)
 * - Documentation: [Doc Title](docs/doc-slug)
 * - Special pages: [Home](special/home) or [Home](homepage)
 *
 * This is the standard markdown linking behavior that works everywhere.
 */

// Remark plugin for processing standard markdown links (all content types)
export function remarkStandardLinks() {
  return function transformer(tree: any, file: any) {
    // Process existing link nodes to add wikilink data attributes for internal links
    visit(tree, "link", (node: any) => {
      // Normalize Obsidian vault-absolute links (publish/blog/gitio/...) down to
      // the real site-relative path before any prefix-based routing runs.
      if (node.url) {
        node.url = stripContentRootPrefix(node.url);
      }
      if (node.url && isInternalLink(node.url)) {
        const { linkText, anchor } = extractLinkTextFromUrlWithAnchor(node.url);
        if (linkText) {
          // Handle /pages/ URLs that don't end in .md (simple URL mapping)
          if (
            node.url.startsWith("/pages/") &&
            !node.url.endsWith(".md") &&
            !node.url.includes(".md#")
          ) {
            let mappedUrl = mapRelativeUrlToSiteUrl(node.url);
            if (anchor) {
              if (!mappedUrl.includes("#")) {
                mappedUrl += `#${createAnchorSlug(anchor)}`;
              }
            }
            node.url = mappedUrl;
          }
          // Convert .md file references to proper URLs based on collection
          else if (node.url.endsWith(".md") || node.url.includes(".md#")) {
            let baseUrl = "";

            // Determine collection and URL based on path structure
            if (node.url.startsWith("special/")) {
              // Special pages: handle special routing
              const specialPath = node.url
                .replace("special/", "")
                .replace(/\.md.*$/, "");
              if (specialPath === "home") {
                baseUrl = "/"; // Homepage
              } else if (specialPath === "404") {
                baseUrl = "/404"; // 404 page
              } else {
                // Other special pages - use normal page routing
                baseUrl = `/${specialPath}`;
              }
            } else if (linkText === "homepage") {
              // Handle special homepage marker
              baseUrl = "/";
            } else if (linkText === "404") {
              // Handle special 404 marker
              baseUrl = "/404";
            } else if (node.url.startsWith("posts/")) {
              // Posts: /posts/slug/ - 로더와 동일한 슬러그 규칙으로 정규화
              // (후행 "/index" 제거도 함께 처리된다)
              const postPath = node.url
                .replace(/\.md.*$/, "")
                .replace(/^posts\//, "");
              baseUrl = `/posts/${normalizePostPath(postPath)}`;
            } else if (node.url.startsWith("pages/")) {
              // Pages: /slug/ (no prefix) - use URL mapping
              baseUrl = mapRelativeUrlToSiteUrl(
                node.url.replace(/\.md.*$/, "")
              );
            } else if (node.url.startsWith("/pages/")) {
              // Pages: /slug/ (no prefix) - use URL mapping
              baseUrl = mapRelativeUrlToSiteUrl(node.url);
            } else if (node.url.startsWith("/special/")) {
              // Special pages: handle special routing
              baseUrl = mapRelativeUrlToSiteUrl(node.url);
            } else if (node.url.startsWith("special/")) {
              // Special pages: handle special routing
              baseUrl = mapRelativeUrlToSiteUrl(node.url);
            } else if (node.url.startsWith("projects/")) {
              // Projects: /projects/slug/
              baseUrl = `/${node.url.replace(/\.md.*$/, "")}`;
              // Remove /index for folder-based projects
              if (
                baseUrl.endsWith("/index") &&
                baseUrl.split("/").length === 3
              ) {
                baseUrl = baseUrl.replace("/index", "");
              }
            } else if (node.url.startsWith("docs/")) {
              // Docs: /docs/slug/
              baseUrl = `/${node.url.replace(/\.md.*$/, "")}`;
              // Remove /index for folder-based docs
              if (
                baseUrl.endsWith("/index") &&
                baseUrl.split("/").length === 3
              ) {
                baseUrl = baseUrl.replace("/index", "");
              }
            } else {
              // Direct .md reference without collection prefix - check for special pages first
              if (linkText === "special/home") {
                baseUrl = "/"; // Homepage
              } else if (linkText === "special/404") {
                baseUrl = "/404"; // 404 page
              } else if (linkText.startsWith("special/")) {
                // Other special pages - use normal page routing
                const specialPath = linkText.replace("special/", "");
                baseUrl = `/${specialPath}`;
              } else if (linkText.includes("/")) {
                // 경로가 있는 참조 - 정규화만 하면 된다
                baseUrl = `/posts/${normalizePostPath(linkText)}`;
              } else {
                // 디렉토리 없는 참조([파일명](01-intro.md)) - 인덱스로 해석한다
                const ref = resolvePostRef(linkText, { fromFile: file?.path });
                if (ref) {
                  baseUrl = `/posts/${ref.id}`;
                } else {
                  warnUnresolvedLink(linkText, file?.path);
                  baseUrl = `/posts/${normalizePostPath(linkText)}`;
                }
              }
            }

            if (anchor) {
              baseUrl += `#${createAnchorSlug(anchor)}`;
            }
            node.url = baseUrl;
          } else if (!node.url.startsWith("/") && !node.url.includes("/")) {
            // 확장자도 경로도 없는 참조([글](01-intro)) - 인덱스로 해석하고,
            // 못 찾으면 손대지 않는다(사이트 밖 상대 링크일 수 있다).
            const ref = resolvePostRef(linkText, { fromFile: file?.path });
            let mappedUrl = ref ? `/posts/${ref.id}` : node.url;
            if (anchor && !mappedUrl.includes("#")) {
              mappedUrl += `#${createAnchorSlug(anchor)}`;
            }
            node.url = mappedUrl;
          } else {
            // For non-.md URLs, apply URL mapping and handle anchors
            let mappedUrl = mapRelativeUrlToSiteUrl(node.url);
            if (anchor) {
              // Handle anchors in non-.md URLs - only add if not already present
              if (!mappedUrl.includes("#")) {
                mappedUrl += `#${createAnchorSlug(anchor)}`;
              }
            }
            node.url = mappedUrl;
          }

          // Add wikilink styling to internal links for visual consistency
          if (node.url.startsWith("/posts/")) {
            if (!node.data) {
              node.data = {};
            }
            if (!node.data.hProperties) {
              node.data.hProperties = {};
            }

            // Add wikilink class for styling consistency.
            // remarkWikilinks 가 만든 노드도 여기를 지나므로 중복을 제거한다.
            const existingClasses = node.data.hProperties.className || [];
            const classList = Array.isArray(existingClasses)
              ? existingClasses
              : [existingClasses].filter(Boolean);
            node.data.hProperties.className = [
              ...new Set([...classList, "wikilink"]),
            ];
          }
        }
      }
    });
  };
}

// Extract standard markdown links from content (all content types)
export function extractStandardLinks(
  content: string,
  fromId?: string
): WikilinkMatch[] {
  const matches: WikilinkMatch[] = [];

  // Extract standard markdown links [text](url) that point to internal content
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let markdownMatch;

  while ((markdownMatch = markdownLinkRegex.exec(content)) !== null) {
    const [fullMatch, displayText, url] = markdownMatch;

    // Skip if markdown link is inside backticks (code)
    if (isWikilinkInCode(content, markdownMatch.index)) {
      continue;
    }

    // Check if this is an internal link (relative path or pointing to any content)
    if (isInternalLink(url)) {
      const { linkText } = extractLinkTextFromUrlWithAnchor(url);
      if (linkText) {
        // Only include posts in linked mentions - this includes:
        // - posts/ prefixed links
        // - /posts/ relative links
        // - .md files (assumed to be posts)
        // - Simple slugs (assumed to be posts for backward compatibility)
        const isPostLink =
          linkText.startsWith("posts/") ||
          url.startsWith("/posts/") ||
          url.startsWith("posts/") ||
          url.endsWith(".md") ||
          (!linkText.includes("/") && !url.startsWith("/"));

        if (isPostLink) {
          // 위키링크와 동일한 해석 규칙 (extractWikilinks 주석 참고)
          let finalSlug: string;
          if (linkText.startsWith("posts/")) {
            finalSlug = normalizePostPath(linkText.replace(/^posts\//, ""));
          } else if (linkText.includes("/")) {
            finalSlug = normalizePostPath(linkText);
          } else {
            const ref = resolvePostRef(linkText, { fromId });
            finalSlug = ref ? ref.id : normalizePostPath(linkText);
          }

          matches.push({
            link: linkText,
            display: displayText.trim(),
            slug: finalSlug,
          });
        }
        // Note: Other content types (pages, projects, docs) are processed for URL conversion
        // but not included in linked mentions since linked mentions only work with posts
      }
    }
  }

  return matches;
}

// ============================================================================
// COMBINED LINK PROCESSING
// ============================================================================

/**
 * COMBINED LINK PROCESSING: Both wikilinks and standard links
 *
 * This combines both wikilink processing (posts only) and standard link processing (all content types)
 * into a single remark plugin for use in Astro configuration.
 */

// Combined remark plugin for both wikilinks and standard links
export function remarkInternalLinks() {
  return function transformer(tree: any, file: any) {
    // First process wikilinks (Obsidian-style, posts only) with build-time resolution
    const wikilinkPlugin = remarkWikilinks();
    wikilinkPlugin(tree, file);

    // Then process standard markdown links (all content types)
    const standardLinkPlugin = remarkStandardLinks();
    standardLinkPlugin(tree, file);
  };
}

// Extract all internal links (both wikilinks and standard links)
export function extractAllInternalLinks(
  content: string,
  fromId?: string
): WikilinkMatch[] {
  const wikilinks = extractWikilinks(content, fromId);
  const standardLinks = extractStandardLinks(content, fromId);

  // Combine and deduplicate
  const allLinks = [...wikilinks, ...standardLinks];
  const uniqueLinks = allLinks.filter(
    (link, index, self) => index === self.findIndex((l) => l.slug === link.slug)
  );

  return uniqueLinks;
}

// ============================================================================
// LINKED MENTIONS (POSTS ONLY)
// ============================================================================

/**
 * LINKED MENTIONS: Find which posts reference a target post
 *
 * IMPORTANT: Linked mentions only work with posts collection
 * This is because wikilinks only work with posts, and linked mentions
 * are primarily designed for the Obsidian workflow where posts are the main content.
 */

// Find linked mentions (backlinks) for a post
export function findLinkedMentions(
  posts: Post[],
  targetSlug: string,
  allPosts: any[] = [],
  allPages: any[] = []
) {
  const mentions = posts
    .filter((post) => post.id !== targetSlug)
    .map((post) => {
      // Skip if body is not available
      if (!post.body) return null;

      // Check both wikilinks and standard markdown links
      const wikilinks = extractWikilinks(post.body, post.id);
      const standardLinks = extractStandardLinks(post.body, post.id);
      const allLinks = [...wikilinks, ...standardLinks];

      const matchingLinks = allLinks.filter((link) => link.slug === targetSlug);

      if (matchingLinks.length > 0) {
        // Use the original link text from the content for excerpt creation
        const originalLinkText = matchingLinks[0].link;
        return {
          title: post.data.title,
          slug: post.id,
          excerpt: createExcerptAroundWikilink(
            post.body,
            originalLinkText,
            allPosts,
            allPages
          ),
        };
      }
      return null;
    })
    .filter(Boolean);

  return mentions;
}

// Create excerpt around wikilink for context
function createExcerptAroundWikilink(
  content: string,
  linkText: string,
  allPosts: any[] = [],
  allPages: any[] = []
): string {
  // Remove frontmatter
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, "");

  // Try to find wikilink pattern first
  const wikilinkPattern = `\\[\\[${linkText}[^\\]]*\\]\\]`;
  const wikilinkRegex = new RegExp(wikilinkPattern, "i");

  let match;
  let searchStart = 0;

  // Find the wikilink that's not in code
  while (
    (match = wikilinkRegex.exec(withoutFrontmatter.slice(searchStart))) !== null
  ) {
    const actualIndex = searchStart + match.index!;

    // Check if this wikilink is inside backticks
    if (!isWikilinkInCode(withoutFrontmatter, actualIndex)) {
      return extractExcerptAtPosition(
        withoutFrontmatter,
        actualIndex,
        match[0].length
      );
    }

    searchStart = actualIndex + match[0].length;
    wikilinkRegex.lastIndex = 0; // Reset regex for next search
  }

  // If no wikilink found, try to find standard markdown links that point to this linkText
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let markdownMatch;

  while (
    (markdownMatch = markdownLinkRegex.exec(withoutFrontmatter)) !== null
  ) {
    const [fullMatch, displayText, url] = markdownMatch;

    // Check if this markdown link is inside backticks
    if (!isWikilinkInCode(withoutFrontmatter, markdownMatch.index)) {
      // Check if this URL points to our target linkText
      if (isInternalLink(url)) {
        const { linkText: urlLinkText } = extractLinkTextFromUrlWithAnchor(
          url,
          allPosts,
          allPages
        );
        if (urlLinkText) {
          // Normalize both linkText and urlLinkText for comparison
          const normalizedLinkText = linkText.replace(/\/index$/, "");
          const normalizedUrlLinkText = urlLinkText.replace(/\/index$/, "");

          if (
            normalizedUrlLinkText === normalizedLinkText ||
            urlLinkText === linkText
          ) {
            return extractExcerptAtPosition(
              withoutFrontmatter,
              markdownMatch.index,
              fullMatch.length
            );
          }
        }
      }
    }
  }

  return "";
}

// Helper function to extract excerpt at a specific position
function extractExcerptAtPosition(
  content: string,
  position: number,
  linkLength: number
): string {
  const contextLength = 100;

  // Get context around the match
  const start = Math.max(0, position - contextLength);
  const end = Math.min(content.length, position + linkLength + contextLength);

  let excerpt = content.slice(start, end);

  // Clean up excerpt
  excerpt = excerpt
    .replace(/^\S*\s*/, "") // Remove partial word at start
    .replace(/\s*\S*$/, "") // Remove partial word at end
    .replace(/\n+/g, " ") // Replace newlines with spaces
    .trim();

  return excerpt;
}

// ============================================================================
// HTML PROCESSING
// ============================================================================

// Process HTML content to resolve wikilink display text with post titles
export function processWikilinksInHTML(
  posts: Post[],
  html: string,
  allPosts: any[] = [],
  allPages: any[] = []
): string {
  // Just return the HTML unchanged - let client-side handle all display text logic
  return html;
}

// Content-aware wikilinks processing for use in layouts where content collections are available
export function processContentAwareWikilinks(
  content: string,
  allPosts: any[],
  allPages: any[]
): string {
  // This function can be used to process wikilinks with full content collection awareness
  // For now, we'll use the existing remarkWikilinks plugin but with content collections
  // In the future, this could be enhanced to do more sophisticated processing

  // The actual processing happens in the remarkWikilinks plugin during markdown rendering
  // This function is a placeholder for future enhancements
  return content;
}

// ============================================================================
// IMAGE PROCESSING
// ============================================================================

// Custom remark plugin to handle folder-based post and project images
export function remarkFolderImages() {
  return function transformer(tree: any, file: any) {
    visit(tree, "image", (node: any) => {
      // Check if this is a folder-based post or project by looking at the file path
      const isFolderPost =
        file.path &&
        file.path.includes("/posts/") &&
        file.path.endsWith("/index.md");
      const isFolderProject =
        file.path &&
        file.path.includes("/projects/") &&
        file.path.endsWith("/index.md");

      if (
        (isFolderPost || isFolderProject) &&
        node.url &&
        !node.url.startsWith("/") &&
        !node.url.startsWith("http")
      ) {
        // Extract the content slug from the file path
        const pathParts = file.path.split("/");
        const contentIndex = isFolderPost
          ? pathParts.indexOf("posts")
          : pathParts.indexOf("projects");
        const contentSlug = pathParts[contentIndex + 1];
        const collection = isFolderPost ? "posts" : "projects";

        // Handle both relative paths and subdirectory paths
        let imagePath = node.url;

        // Remove leading './' if present
        if (imagePath.startsWith("./")) {
          imagePath = imagePath.slice(2);
        }

        // Update the image URL to point to the correct folder (preserving subdirectory structure)
        node.url = `/${collection}/${contentSlug}/${imagePath}`;

        // Also update the hProperties if they exist (for wikilink images)
        if (node.data && node.data.hProperties) {
          node.data.hProperties.src = node.url;
        }
      }
    });
  };
}

// Custom remark plugin to process image captions
export function remarkImageCaptions() {
  return function transformer(tree: any) {
    visit(tree, "image", (node: any) => {
      // If the image has a title attribute, store it as caption data
      if (node.title) {
        if (!node.data) {
          node.data = {};
        }
        if (!node.data.hProperties) {
          node.data.hProperties = {};
        }
        node.data.hProperties["data-caption"] = node.title;
        node.data.hProperties.title = node.title;
      }
    });
  };
}
