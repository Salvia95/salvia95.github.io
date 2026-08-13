import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { remarkInternalLinks, remarkFolderImages, remarkImageCaptions } from './src/utils/internallinks.ts';
import remarkCallouts from './src/utils/remark-callouts.ts';
import remarkImageGrids from './src/utils/remark-image-grids.ts';
import remarkMermaid from './src/utils/remark-mermaid.ts';
import { remarkObsidianEmbeds } from './src/utils/remark-obsidian-embeds.ts';
import remarkMath from 'remark-math';
import remarkReadingTime from 'remark-reading-time';
import remarkToc from 'remark-toc';
import rehypeKatex from 'rehype-katex';
import rehypeMark from './src/utils/rehype-mark.ts';
import rehypeOptimizeImages from './src/utils/rehype-optimize-images.ts';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeTableDiagonal from './src/utils/rehype-table-diagonal.ts';
import { siteConfig } from './src/config.ts';
import swup from '@swup/astro';

export default defineConfig({
  site: siteConfig.site,
  // Astro 7 은 compressHTML 기본값이 'jsx' 로 바뀌어 인라인 요소 사이 공백을
  // JSX 규칙으로 제거한다. 기존 출력을 유지하려고 v6 동작('true')으로 고정한다.
  compressHTML: true,
  devToolbar: {
    enabled: true
  },
  redirects: {
  '/about-me': '/about',
  '/contact-me': '/contact',
  '/contact-us': '/contact',
  '/privacy': '/privacy-policy'
},
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        limitInputPixels: false,
      }
    },
    remotePatterns: [{
      protocol: 'https'
    }]
  },
  integrations: [
    sitemap(),
    swup({
      theme: false,
      animationClass: 'transition-swup-',
      containers: ['#swup-container'],
      smoothScrolling: false,
      cache: true,
      preload: true, 
      accessibility: false,
      updateHead: true,
      updateBodyClass: false,
      globalInstance: true,
      plugins: [], // Disable all plugins including scroll
      skipPopStateHandling: (event) => {
        // ALWAYS skip Swup handling for back/forward navigation
        // Let the browser handle it naturally
        return true;
      },
      // Simplified link selector for better compatibility
      linkSelector: 'a[href]:not([data-no-swup]):not([href^="mailto:"]):not([href^="tel:"])'
    })
  ],
  markdown: {
    // Astro 7 의 기본 Markdown 프로세서는 네이티브 파이프라인(Sätteri)이고
    // @astrojs/markdown-remark 는 더 이상 기본 설치되지 않는다. 이 저장소는
    // 커스텀 remark/rehype 플러그인 8개에 의존하므로 unified 파이프라인을
    // 명시적으로 선택한다. (markdown.remarkPlugins/rehypePlugins 최상위 지정도
    // 아직 동작하지만 deprecated 라 processor 쪽으로 옮긴다.)
    //
    // 실행 순서를 바꾸지 말 것: remarkInternalLinks 가 먼저 돌면서 뒤의
    // 플러그인들이 변형하는 노드를 만든다.
    processor: unified({
      remarkPlugins: [
        remarkInternalLinks,
        remarkFolderImages,
        remarkObsidianEmbeds,
        remarkImageCaptions,
        remarkMath,
        remarkCallouts,
        remarkImageGrids,
        remarkMermaid,
        [remarkReadingTime, {}],
        [remarkToc, {
          tight: true,
          ordered: false,
          maxDepth: 3,
          heading: 'contents|table[ -]of[ -]contents?|toc'
        }],
      ],
      rehypePlugins: [
        rehypeKatex,
        rehypeMark,
        rehypeTableDiagonal,
        rehypeOptimizeImages,
        [rehypeSlug, {
          test: (node) => node.tagName !== 'h1'
        }],
        [rehypeAutolinkHeadings, {
          behavior: 'wrap',
          test: (node) => node.tagName !== 'h1',
          properties: {
            className: ['anchor-link'],
            ariaLabel: 'Link to this section'
          }
        }]
      ],
    }),
    // 프로세서에 종속되지 않는 공통 옵션이라 최상위에 그대로 둔다.
    shikiConfig: {
      theme: 'github-dark',
      wrap: true
    }
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
        '@/components': new URL('./src/components', import.meta.url).pathname,
        '@/layouts': new URL('./src/layouts', import.meta.url).pathname,
        '@/utils': new URL('./src/utils', import.meta.url).pathname,
        '@/types': new URL('./src/types.ts', import.meta.url).pathname,
        '@/config': new URL('./src/config.ts', import.meta.url).pathname
      }
    },
    // server 키가 두 번 선언돼 있어서 뒤엣것이 앞엣것을 통째로 덮어썼다.
    // hmr / headers / allowedHosts 가 전부 무시되고 있었으므로 하나로 합친다.
    server: {
      host: 'localhost',
      port: 5000,
      allowedHosts: [],
      middlewareMode: false,
      hmr: false,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      watch: {
        usePolling: process.platform === 'win32', // Use polling on Windows for better file watching
        interval: 1000
      }
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
    },
    // Treat these deployment-platform passthrough files as raw static assets so
    // Vite never tries to parse their contents as JavaScript during the build.
    assetsInclude: ['**/_headers', '**/_redirects']
  },
  build: {
    assets: '_assets'
  }
});