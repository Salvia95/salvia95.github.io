#!/usr/bin/env node

/**
 * Graph Data Generation Script
 *
 * This script generates graph data for the local graph feature by analyzing
 * post connections (both wikilinks and standard links) and tag relationships.
 *
 * The generated data includes:
 * - Post nodes with metadata (title, slug, date, tags)
 * - Tag nodes with metadata (name, color)
 * - Connections between posts (direct links)
 * - Connections between posts and tags (shared tags)
 *
 * This data is used by the LocalGraph component to render an Obsidian-like graph view.
 *
 * ID Generation Strategy:
 * - Uses path-based IDs (no frontmatter required)
 * - Single files: "my-post.md" → ID: "my-post"
 * - Folder-based: "my-folder/index.md" → ID: "my-folder"
 * - Nested content: "category/my-post.md" → ID: "category-my-post"
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
// 사이트 렌더링과 동일한 링크 해석 규칙을 공유한다. 여기서 따로 구현하면
// 그래프의 노드 id 와 실제 페이지 URL 이 어긋난다.
import {
  getPostIndex,
  resolveLinkTarget,
} from "../src/utils/post-index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// Configuration
const OUTPUT_DIR = join(projectRoot, "public", "graph");
const OUTPUT_FILE = join(OUTPUT_DIR, "graph-data.json");

/**
 * Read maxNodes from config file
 */
function getMaxNodesFromConfig() {
  try {
    const configPath = join(projectRoot, "src", "config.ts");
    const configContent = readFileSync(configPath, "utf-8");

    // Extract maxNodes value from config
    const maxNodesMatch = configContent.match(/maxNodes:\s*(\d+)/);
    if (maxNodesMatch) {
      return parseInt(maxNodesMatch[1], 10);
    }

    // Default fallback
    return 100;
  } catch (error) {
    log.warn("Could not read config file, using default maxNodes: 100");
    return 100;
  }
}

// Simple logging utility
const isDev = process.env.NODE_ENV !== "production";
const log = {
  info: (...args) => isDev && console.log(...args),
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args),
};

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Extract wikilinks from content (Obsidian-style)
 * @param {string} content
 * @param {string} [fromId] 링크가 적힌 글의 post id (같은 폴더 우선 매칭용)
 */
function extractWikilinks(content, fromId) {
  const matches = [];
  const wikilinkRegex = /!?\[\[([^\]]+)\]\]/g;
  let match;

  while ((match = wikilinkRegex.exec(content)) !== null) {
    const [fullMatch, linkContent] = match;
    const isImageWikilink = fullMatch.startsWith("!");

    // Skip image wikilinks, only process link wikilinks
    if (!isImageWikilink) {
      const [link, displayText] = linkContent.includes("|")
        ? linkContent.split("|", 2)
        : [linkContent, linkContent];

      // Parse anchor if present
      const anchorIndex = link.indexOf("#");
      const baseLink =
        anchorIndex === -1 ? link : link.substring(0, anchorIndex);

      // 렌더링과 동일한 규칙으로 링크 대상 id 를 얻는다
      const { id: targetId } = resolveLinkTarget(baseLink, { fromId });

      matches.push({
        link: baseLink,
        display: displayText.trim(),
        slug: targetId,
      });
    }
  }

  return matches;
}

/**
 * Extract standard markdown links from content
 */
function extractStandardLinks(content, fromId) {
  const matches = [];
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = markdownLinkRegex.exec(content)) !== null) {
    const [fullMatch, displayText, url] = match;

    // Check if this is an internal link
    if (isInternalLink(url)) {
      const { linkText } = extractLinkTextFromUrl(url);
      if (linkText) {
        // Only include posts in graph data - this includes:
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
          // 렌더링과 동일한 규칙으로 링크 대상 id 를 얻는다
          const { id: targetId } = resolveLinkTarget(linkText, { fromId });

          matches.push({
            link: linkText,
            display: displayText.trim(),
            slug: targetId,
          });
        }
      }
    }
  }

  return matches;
}

/**
 * Check if a URL is an internal link
 */
function isInternalLink(url) {
  url = url.trim();

  // Skip external URLs
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

  // Check if it's an internal link:
  // - Ends with .md (markdown files)
  // - Starts with /posts/ or posts/ (post relative URLs)
  // - Is just a slug (no slashes) - assumes posts for backward compatibility
  const isInternal =
    url.endsWith(".md") ||
    url.startsWith("/posts/") ||
    url.startsWith("posts/") ||
    !url.includes("/");

  return isInternal;
}

/**
 * Extract link text from URL
 */
function extractLinkTextFromUrl(url) {
  url = url.trim();

  // Parse anchor if present
  const anchorIndex = url.indexOf("#");
  const link = anchorIndex === -1 ? url : url.substring(0, anchorIndex);
  const anchor = anchorIndex === -1 ? null : url.substring(anchorIndex + 1);

  // Handle posts/ prefixed links
  if (link.startsWith("posts/")) {
    let linkText = link.replace("posts/", "").replace(/\.md$/, "");
    // Remove /index for folder-based posts
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
    // Remove /index for folder-based posts
    if (linkText.endsWith("/index") && linkText.split("/").length === 2) {
      linkText = linkText.replace("/index", "");
    }
    return {
      linkText: linkText,
      anchor: anchor,
    };
  }

  // Handle .md files
  if (link.endsWith(".md")) {
    let linkText = link.replace(/\.md$/, "");
    // Remove /index for folder-based posts
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

/**
 * Read and parse markdown files from content directory
 */
function readContentFiles(dirPath) {
  const posts = [];

  // 예전에는 최상위 파일과 폴더의 index.md 만 읽어서, 시리즈 폴더 안의 소속 글
  // (chunk-batch/01-intro.md)이 그래프에서 통째로 빠졌다. 이제는 사이트와 같은
  // 인덱스를 써서 중첩된 글까지 모두 노드로 만든다.
  try {
    for (const ref of getPostIndex()) {
      const filePath = join(dirPath, ref.relativePath);
      if (!existsSync(filePath)) continue;

      const content = readFileSync(filePath, "utf-8");
      const parsed = parseMarkdownFile(content, ref.id);
      if (parsed) {
        posts.push(parsed);
      }
    }
  } catch (error) {
    log.error("Error reading content directory:", error);
  }

  return posts;
}

/**
 * Parse markdown file and extract frontmatter and content
 */
function parseMarkdownFile(content, slug) {
  try {
    // Extract frontmatter (handle both \n and \r\n line endings)
    const frontmatterMatch = content.match(
      /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
    );
    if (!frontmatterMatch) {
      return null;
    }

    const [, frontmatter, body] = frontmatterMatch;
    const lines = frontmatter.split(/\r?\n/);
    const data = {};

    // Parse frontmatter (improved YAML parser)
    let currentKey = null;
    let currentArray = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Skip empty lines
      if (!trimmedLine) continue;

      // Check if this is a key-value pair
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0 && !line.startsWith(" ")) {
        // Save previous array if we have one
        if (currentKey && currentArray.length > 0) {
          data[currentKey] = [...currentArray];
          currentArray = [];
        }

        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();

        // Remove quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        // Check if this is an array key (next line starts with dash)
        if (i + 1 < lines.length && lines[i + 1].trim().startsWith("- ")) {
          currentKey = key;
          currentArray = [];
        } else {
          // Single value
          if (key === "date") {
            data[key] = new Date(value);
          } else if (key === "draft") {
            data[key] = value === "true";
          } else if (
            key === "imageOG" ||
            key === "hideCoverImage" ||
            key === "noIndex" ||
            key === "featured" ||
            key === "series"
          ) {
            data[key] = value === "true";
          } else {
            data[key] = value;
          }
        }
      } else if (trimmedLine.startsWith("- ")) {
        // This is an array item
        const item = trimmedLine.substring(2).trim();
        currentArray.push(item);
      }
    }

    // Save final array if we have one
    if (currentKey && currentArray.length > 0) {
      data[currentKey] = [...currentArray];
    }

    return {
      id: slug,
      data,
      body,
    };
  } catch (error) {
    log.warn(`Error parsing file ${slug}:`, error.message);
    return null;
  }
}

/**
 * Generate graph data from posts
 */
async function generateGraphData() {
  log.info("🔍 Analyzing post connections...");

  try {
    // Get configuration values
    const maxNodes = getMaxNodesFromConfig();

    // Read all posts from the content directory
    const postsDir = join(projectRoot, "src", "content", "posts");
    log.info("📁 Reading posts from:", postsDir);

    const posts = readContentFiles(postsDir);
    log.info(`📄 Found ${posts.length} posts`);

    // Filter out draft posts in production
    const isDev = process.env.NODE_ENV !== "production";
    const visiblePosts = posts.filter((post) => isDev || !post.data.draft);

    log.info(`📄 Processing ${visiblePosts.length} visible posts`);

    // Generate nodes and connections
    const nodes = [];
    const connections = [];

    // Process each post
    for (const post of visiblePosts) {
      // Add post node.
      // 시리즈 index.md 는 일반 글 라우트(/posts/<id>)가 만들어지지 않고
      // 시리즈 랜딩 페이지(/posts/series/<id>)로만 존재한다. 그래프 컴포넌트가
      // `/posts/${slug}` 로 이동하므로 slug 에 series/ 를 붙여 준다.
      const postNode = {
        id: post.id,
        type: "post",
        title: post.data.title,
        slug: post.data.series === true ? `series/${post.id}` : post.id,
        date: post.data.date
          ? post.data.date.toISOString()
          : new Date().toISOString(),
        connections: 0,
      };
      nodes.push(postNode);

      // Extract links from post content
      const wikilinks = extractWikilinks(post.body, post.id);
      const standardLinks = extractStandardLinks(post.body, post.id);
      const allLinks = [...wikilinks, ...standardLinks];

      // Process links to other posts.
      // 같은 글을 여러 번(파일명·제목·별칭 등) 가리켜도 간선은 하나여야 한다.
      const linkedTargets = new Set();
      for (const link of allLinks) {
        const targetPost = visiblePosts.find((p) => p.id === link.slug);
        if (targetPost && targetPost.id !== post.id) {
          if (linkedTargets.has(targetPost.id)) continue;
          linkedTargets.add(targetPost.id);

          // Add post-to-post connection
          connections.push({
            source: post.id,
            target: targetPost.id,
            type: "link",
          });

        }
      }
    }

    // 연결 수는 간선을 모두 만든 뒤에 센다. 루프 안에서 세면 아직 만들어지지
    // 않은 대상 노드를 놓쳐서, 파일을 읽은 순서에 따라 값이 달라진다.
    const connectionCounts = new Map();
    for (const conn of connections) {
      for (const nodeId of [conn.source, conn.target]) {
        connectionCounts.set(nodeId, (connectionCounts.get(nodeId) || 0) + 1);
      }
    }
    for (const node of nodes) {
      node.connections = connectionCounts.get(node.id) || 0;
    }

    // Apply maxNodes filtering if configured
    let filteredNodes = nodes;
    let filteredConnections = connections;

    if (maxNodes && nodes.length > maxNodes) {
      // Sort posts by connection count (descending), then by date (descending)
      const sortedPosts = nodes.sort((a, b) => {
        if (b.connections !== a.connections) {
          return b.connections - a.connections;
        }
        return new Date(b.date) - new Date(a.date);
      });

      filteredNodes = sortedPosts.slice(0, maxNodes);

      // Filter connections to only include those between selected nodes
      const selectedNodeIds = new Set(filteredNodes.map((n) => n.id));
      filteredConnections = connections.filter(
        (conn) =>
          selectedNodeIds.has(conn.source) && selectedNodeIds.has(conn.target)
      );
    }

    // Generate graph data
    const graphData = {
      nodes: filteredNodes,
      connections: filteredConnections,
      metadata: {
        generated: new Date().toISOString(),
        totalPosts: filteredNodes.length,
        totalConnections: filteredConnections.length,
        maxNodesApplied: maxNodes && nodes.length > maxNodes,
        originalNodeCount: nodes.length,
      },
    };

    // Write graph data to file
    writeFileSync(OUTPUT_FILE, JSON.stringify(graphData, null, 2));

    log.info("✅ Graph data generated successfully!");
    if (graphData.metadata.maxNodesApplied) {
      log.info(
        `📊 Stats: ${graphData.metadata.totalPosts} posts, ${graphData.metadata.totalConnections} connections (filtered from ${graphData.metadata.originalNodeCount} total nodes)`
      );
    } else {
      log.info(
        `📊 Stats: ${graphData.metadata.totalPosts} posts, ${graphData.metadata.totalConnections} connections`
      );
    }
    log.info(`💾 Saved to: ${OUTPUT_FILE}`);
  } catch (error) {
    log.error("❌ Error generating graph data:", error);
    process.exit(1);
  }
}

// Run the script
generateGraphData();
