import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Define schema for blog posts
const postsCollection = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string().default('Untitled Post'),
    description: z.string().nullable().optional().default('No description provided'),
    date: z.coerce.date().default(() => new Date()),
    tags: z.array(z.string()).nullable().optional(),
    draft: z.boolean().optional(),
    // 시리즈 캐러셀: 폴더의 index.md에 series: true 를 두면 그 폴더를 하나의
    // 시리즈로 인식하고, 같은 폴더의 나머지 글을 소속 글로 묶는다.
    series: z.boolean().optional(),
    summary: z.string().nullable().optional(), // 시리즈 한 줄 요약(캐러셀 좌측)
    seriesOrder: z.number().optional(),        // (선택) 동점 시 정렬 보조
    // 공개 배포 게이트: document-repo에서 이 값이 true인 문서만 사이트로 가져옴
    // (scripts/import-content.js). 로컬 dev(--dev)에서는 무시하고 전부 미리보기.
    publish: z.boolean().optional(),
    image: z.any().nullable().optional().transform((val) => {
      // Handle various Obsidian syntax formats
      if (Array.isArray(val)) {
        // Handle array format from [[...]] syntax - take first element
        return val[0] || null;
      }
      if (typeof val === 'string') {
        // Handle string format - return as-is
        return val;
      }
      return null;
    }),
    imageOG: z.boolean().optional(),
    imageAlt: z.string().nullable().optional(),
    hideCoverImage: z.boolean().optional(),
    hideTOC: z.boolean().optional(),
    targetKeyword: z.string().nullable().optional(),
    author: z.string().nullable().optional(),
    noIndex: z.boolean().optional(),
  }),
});

// Define schema for static pages
const pagesCollection = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string().default('Untitled Page'),
    description: z.string().nullable().optional().default('No description provided'),
    draft: z.boolean().optional(),
    lastModified: z.coerce.date().optional(),
    // 공개 배포 게이트 (posts와 동일). document-repo 에서 가져오는 페이지
    // (about/contact)에 필요하다. 코드 레포가 소유한 페이지는 없어도 된다.
    publish: z.boolean().optional(),
    aliases: z.array(z.string()).nullable().optional(),
    image: z.any().nullable().optional().transform((val) => {
      // Handle various Obsidian syntax formats
      if (Array.isArray(val)) {
        // Handle array format from [[...]] syntax - take first element
        return val[0] || null;
      }
      if (typeof val === 'string') {
        // Handle string format - return as-is
        return val;
      }
      return null;
    }),
    imageAlt: z.string().nullable().optional(),
    hideCoverImage: z.boolean().optional(),
    hideTOC: z.boolean().optional(),
    noIndex: z.boolean().optional(),
  }),
});

// Define schema for projects
const projectsCollection = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string().default('Untitled Project'),
    description: z.string().nullable().optional().default('No description provided'),
    date: z.coerce.date().default(() => new Date()),
    categories: z.array(z.string()).nullable().optional().default([]),
    repositoryUrl: z.string().url().nullable().optional(),
    projectUrl: z.string().url().nullable().optional(),
    status: z.string().nullable().optional(),
    image: z.any().nullable().optional().transform((val) => {
      // Handle various Obsidian syntax formats
      if (Array.isArray(val)) {
        // Handle array format from [[...]] syntax - take first element
        return val[0] || null;
      }
      if (typeof val === 'string') {
        // Handle string format - return as-is
        return val;
      }
      return null;
    }),
    imageAlt: z.string().nullable().optional(),
    hideCoverImage: z.boolean().optional(),
    hideTOC: z.boolean().optional(),
    draft: z.boolean().optional(),
    // 공개 배포 게이트 (posts와 동일)
    publish: z.boolean().optional(),
    noIndex: z.boolean().optional(),
    featured: z.boolean().optional(),
  }),
});

// Define schema for docs
const docsCollection = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string().default('Untitled Documentation'),
    description: z.string().nullable().optional().default('No description provided'),
    category: z.string().nullable().optional().default('General'),
    order: z.number().default(0),
    lastModified: z.coerce.date().optional(),
    version: z.string().nullable().optional(),
    image: z.any().nullable().optional().transform((val) => {
      // Handle various Obsidian syntax formats
      if (Array.isArray(val)) {
        // Handle array format from [[...]] syntax - take first element
        return val[0] || null;
      }
      if (typeof val === 'string') {
        // Handle string format - return as-is
        return val;
      }
      return null;
    }),
    imageAlt: z.string().nullable().optional(),
    hideCoverImage: z.boolean().optional(),
    hideTOC: z.boolean().optional(),
    draft: z.boolean().optional(),
    // 공개 배포 게이트 (posts와 동일)
    publish: z.boolean().optional(),
    noIndex: z.boolean().optional(),
    showTOC: z.boolean().optional(),
    featured: z.boolean().optional(),
  }),
});

// Define schema for special home pages (homepage blurb, 404, projects index, docs index)
const specialCollection = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/special' }),
  schema: z.object({
    title: z.string().default('Untitled Page'),
    description: z.string().nullable().optional().default('No description provided'),
    hideTOC: z.boolean().optional(),
    // These pages have fixed URLs and special logic
    // URLs are determined by the file location, not frontmatter
  }),
});

// Export collections
export const collections = {
  posts: postsCollection,
  pages: pagesCollection,
  projects: projectsCollection,
  docs: docsCollection,
  special: specialCollection,
};

