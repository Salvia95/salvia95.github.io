/**
 * Optimized Mermaid utility with lazy loading, caching, and performance improvements
 */

import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import { readThemeColor } from "./graph-theme-colors";
import { siteConfig, getFontFamily } from "@/config";

// Mermaid configuration
const mermaidConfig = {
  startOnLoad: false,
  securityLevel: "loose" as const,
  // ELK(elk.layered)를 기본 레이아웃 엔진으로 쓴다. dagre 보다 엣지 교차가 적고
  // subgraph 중첩을 제대로 다뤄서 노드가 많은 플로우차트가 훨씬 읽을 만해진다.
  //
  // 적용 범위: 통합 렌더러를 쓰는 다이어그램(flowchart / class / state /
  // ER / requirement / mindmap)만. sequence·gantt·pie 등은 자체 렌더러라 무관하다.
  // 개별 다이어그램에서 끄려면 소스 맨 앞에 프론트매터를 넣는다:
  //   ---
  //   config:
  //     layout: dagre
  //   ---
  layout: "elk",
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
  },
};

/**
 * ELK 레이아웃 로더 등록.
 *
 * layout-elk 의 엔트리는 로더 목록만 들고 있고 실제 엔진(elkjs, ~1.5MB)은
 * 로더가 처음 호출될 때 동적 import 된다. 그래서 등록 자체는 공짜고,
 * 번들도 별도 청크로 갈린다. mermaid.render 전에 한 번만 부르면 된다.
 */
let layoutLoadersRegistered = false;
function registerLayoutLoaders(): void {
  if (layoutLoadersRegistered) return;
  mermaid.registerLayoutLoaders(elkLayouts);
  layoutLoadersRegistered = true;
}

// Cache for rendered diagrams to avoid re-rendering on theme changes
const diagramCache = new Map<string, { svg: string; theme: string }>();

/**
 * 렌더된 SVG 를 넣은 뒤 항상 거쳐야 하는 후처리.
 *
 * 캐시 적중 경로와 새로 그리는 경로 양쪽에서 불러야 한다
 * (테마를 바꾸면 SVG 가 통째로 다시 꽂힌다).
 *
 * 다이어그램 폭은 건드리지 않는다. mermaid 가 useMaxWidth 로 본문 폭에 맞춰
 * 축소해주는 편이 낫다 — 기본 상태에서는 다이어그램 전체가 한눈에 보여야 하고,
 * 자세히 볼 필요가 있으면 확대해서 보면 된다. (가로 스크롤로 원래 크기를
 * 유지하는 방식도 넣어봤지만, 전체 모양을 먼저 못 보게 되어 되돌렸다.)
 */
function enhanceDiagram(diagram: HTMLElement): void {
  // 렌더 실패 시 content 에는 에러 박스만 있다 — 조용히 건너뛴다.
  const svg = diagram.querySelector<SVGSVGElement>(
    ".mermaid-diagram-content svg"
  );
  if (!svg) return;

  ensureZoomTrigger(diagram);
}

/** 다이어그램 우상단에 전체화면 확대 버튼을 붙인다. 컨테이너당 한 번만. */
function ensureZoomTrigger(diagram: HTMLElement): void {
  if (diagram.querySelector(".mermaid-zoom-trigger")) return;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "mermaid-zoom-trigger";
  trigger.setAttribute("aria-label", "다이어그램 확대해서 보기");
  trigger.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;

  trigger.addEventListener("click", async () => {
    // 테마를 바꾸면 SVG 노드가 교체되므로 누르는 시점에 다시 찾는다.
    const svg = diagram.querySelector<SVGSVGElement>(
      ".mermaid-diagram-content svg"
    );
    if (!svg) return;
    const { openMermaidZoom } = await import("../scripts/mermaid-zoom");
    openMermaidZoom(svg);
  });

  diagram.appendChild(trigger);
}

// Intersection Observer for lazy loading
let intersectionObserver: IntersectionObserver | null = null;

/**
 * 현재 적용된 테마를 식별하는 키.
 *
 * 다크모드 여부만으로는 부족하다. 이 블로그는 팔레트 테마가 17종이고
 * 전환하면 --color-* 변수만 바뀌므로, 팔레트 이름까지 넣어야 캐시가
 * 올바르게 갈린다. (예전에는 'dark'|'default' 뿐이라 팔레트를 바꿔도
 * 낡은 SVG 가 그대로 나왔다.)
 */
function getThemeKey(): string {
  const mode = document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
  const palette =
    document.documentElement.getAttribute("data-theme") ||
    document.documentElement.getAttribute("data-theme-config") ||
    "default";
  return `${mode}:${palette}`;
}

/** mermaid 의 THEME_COLOR_LIMIT. cScale0..11 이 이 개수만큼 생성된다. */
const THEME_COLOR_LIMIT = 12;

/**
 * 마인드맵 전용 색.
 *
 * 마인드맵만 다른 변수 계열을 쓴다 — 노드는 cScale*, 글자는 cScaleLabel*,
 * 밑줄은 cScaleInv*, 루트 노드는 git0/gitBranchLabel0. 아래를 지정하지 않으면
 * mermaid 가 primaryColor 의 색상환을 30도씩 돌려 12색을 만들어내서 블로그
 * 팔레트와 무관한 색이 나온다. 다른 다이어그램은 이 계열을 쓰지 않으므로
 * (mindmap / timeline / kanban / treemap / radar 만 소비, 그중 이 블로그에
 * 있는 건 마인드맵뿐) 여기서 고정해도 flowchart·sequence·ER 은 그대로다.
 *
 * mermaid 의 Theme.calculate 는 [오버라이드 적용 → 파생 계산 → 오버라이드
 * 재적용] 순서라, 여기서 준 값은 darken/lighten 가공을 거치지 않고 그대로
 * 쓰인다. 덕분에 darkMode 플래그를 건드리지 않고 마인드맵만 바꿀 수 있다
 * (그 플래그는 ER 의 행 색 rowOdd/rowEven 에도 영향을 준다).
 *
 * 색 선택: 노드 채움색이 노드 사이 연결선(.section-edge-N) 색도 겸하므로,
 * 본문 배경 위에서 선으로도 보이는 중간 톤이어야 한다. 그래서 surface 처럼
 * 옅은 단계는 못 쓰고, 라이트/다크에서 각각 반대 방향으로 잡는다.
 */
function buildMindmapScale(
  isDark: boolean,
  c: (shade: number, fallback: string) => string,
  a: (shade: number, fallback: string) => string
): Record<string, string> {
  // 중립 ↔ 강조를 번갈아 써서 가지를 구분하되 팔레트 두 계열 안에 머문다.
  const fills = isDark
    ? [c(500, "#71717a"), a(400, "#578af2")]
    : [c(600, "#52525b"), a(700, "#0369a1")];
  // 라이트는 어두운 채움색 위 밝은 글자, 다크는 그 반대.
  const label = isDark ? c(900, "#21252c") : c(50, "#fafafa");
  const rootFill = isDark ? c(300, "#d8d8d9") : c(800, "#282c34");

  const scale: Record<string, string> = {
    git0: rootFill,
    gitBranchLabel0: label,
  };
  for (let i = 0; i < THEME_COLOR_LIMIT; i++) {
    scale[`cScale${i}`] = fills[i % fills.length];
    scale[`cScaleLabel${i}`] = label;
    scale[`cScaleInv${i}`] = label;
  }
  return scale;
}

/**
 * 블로그 팔레트를 Mermaid themeVariables 로 변환한다.
 *
 * 예전에는 Mermaid 내장 default/dark 테마를 쓰고 그 결과를 global.css 에서
 * !important 로 덮었다. 증상 억제라 테마가 늘 때마다 규칙이 따라 늘었다.
 * theme:'base' 는 이 변수들을 기준으로 나머지 색을 파생시키므로,
 * 팔레트를 직접 주입하면 다이어그램이 본문과 같은 계열로 그려지고
 * 테마 17종을 자동으로 따라간다.
 *
 * 색 방향: 구조(노드·선·텍스트)는 primary, 강조(신호·활성 구간·클러스터)는 highlight.
 * 팔레트 변수는 다크모드에서 반전되지 않으므로 단계를 각각 지정한다.
 */
function buildThemeVariables(): Record<string, string> {
  const isDark = document.documentElement.classList.contains("dark");
  const c = (shade: number, fallback: string) =>
    readThemeColor(`--color-primary-${shade}`, fallback);
  const a = (shade: number, fallback: string) =>
    readThemeColor(`--color-highlight-${shade}`, fallback);

  // 라이트/다크에서 서로 다른 단계를 쓴다.
  const bg = isDark ? c(900, "#21252c") : c(50, "#fafafa");
  const surface = isDark ? c(800, "#282c34") : c(100, "#eaeaeb");
  const surfaceAlt = isDark ? c(700, "#3f3f46") : c(200, "#dbdbdc");
  const border = isDark ? c(500, "#71717a") : c(400, "#8e8e90");
  const text = isDark ? c(50, "#fafafa") : c(900, "#21252c");
  const textMuted = isDark ? c(300, "#d8d8d9") : c(600, "#52525b");
  const accent = isDark ? a(400, "#578af2") : a(600, "#1a92ff");
  const accentSoft = isDark ? a(900, "#0c4a6e") : a(100, "#cce7ff");
  const accentBorder = isDark ? a(700, "#0369a1") : a(300, "#66b7ff");

  return {
    // --- 시드: Mermaid 가 나머지를 파생시키는 기준값 ---
    darkMode: String(isDark),
    background: bg,
    primaryColor: surface,
    primaryBorderColor: border,
    primaryTextColor: text,
    secondaryColor: surfaceAlt,
    tertiaryColor: bg,
    lineColor: border,
    textColor: text,

    // --- 타이포: 본문과 같은 폰트 스택(한글 폴백 포함), 크기는 한 단계 작게 ---
    fontFamily: getFontFamily(siteConfig.fonts.families.body),
    fontSize: "14px",

    // --- 플로우차트 / 상태 ---
    mainBkg: surface,
    nodeBkg: surface,
    nodeBorder: border,
    nodeTextColor: text,
    clusterBkg: isDark ? c(800, "#282c34") : c(100, "#eaeaeb"),
    clusterBorder: accentBorder,
    defaultLinkColor: border,
    edgeLabelBackground: bg,
    titleColor: text,
    transitionColor: border,
    transitionLabelColor: textMuted,
    stateLabelColor: text,
    stateBkg: surface,
    specialStateColor: accent,

    // --- 시퀀스 ---
    actorBkg: surface,
    actorBorder: border,
    actorTextColor: text,
    actorLineColor: border,
    signalColor: accent,
    signalTextColor: text,
    activationBkgColor: accentSoft,
    activationBorderColor: accentBorder,
    sequenceNumberColor: bg,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: border,
    labelTextColor: text,
    loopTextColor: text,
    noteBkgColor: accentSoft,
    noteBorderColor: accentBorder,
    noteTextColor: text,

    // --- ER ---
    attributeBackgroundColorEven: bg,
    attributeBackgroundColorOdd: surface,
    relationColor: border,
    relationLabelBackground: bg,
    relationLabelColor: text,

    // --- 마인드맵 (cScale* / git*) ---
    ...buildMindmapScale(isDark, c, a),
  };
}

// Initialize Mermaid with current theme
function initializeMermaid(): void {
  registerLayoutLoaders();
  mermaid.initialize({
    ...mermaidConfig,
    // 'base' 만이 themeVariables 를 온전히 반영한다.
    theme: "base",
    themeVariables: buildThemeVariables(),
  });
}

// Create intersection observer for lazy loading
function createIntersectionObserver(): IntersectionObserver {
  if (intersectionObserver) {
    return intersectionObserver;
  }

  intersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const diagram = entry.target as HTMLElement;
          renderDiagram(diagram);
          intersectionObserver?.unobserve(diagram);
        }
      });
    },
    {
      rootMargin: "50px", // Start loading 50px before entering viewport
      threshold: 0.1,
    }
  );

  return intersectionObserver;
}

// Render a single diagram with caching
async function renderDiagram(diagram: HTMLElement): Promise<void> {
  const source = diagram.getAttribute("data-mermaid-source");
  if (!source) return;

  const decodedSource = decodeURIComponent(source);
  const currentTheme = getThemeKey();
  const cacheKey = `${decodedSource}-${currentTheme}`;

  // Check cache first
  if (diagramCache.has(cacheKey)) {
    const cached = diagramCache.get(cacheKey)!;
    const contentDiv = diagram.querySelector(".mermaid-diagram-content");
    if (contentDiv) {
      contentDiv.innerHTML = cached.svg;
      enhanceDiagram(diagram);
    }
    return;
  }

  // Show loading state
  const contentDiv = diagram.querySelector(".mermaid-diagram-content");
  if (contentDiv) {
    contentDiv.innerHTML = `
      <div class="mermaid-loading-skeleton">
        <div class="animate-pulse bg-primary-100 dark:bg-primary-800 rounded h-32 flex items-center justify-center">
          <div class="text-primary-500 dark:text-primary-400 text-sm">Loading diagram...</div>
        </div>
      </div>
    `;
  }

  try {
    // Initialize Mermaid with current theme
    initializeMermaid();

    const diagramId = `mermaid-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const { svg } = await mermaid.render(diagramId, decodedSource);

    // Cache the rendered diagram
    diagramCache.set(cacheKey, { svg, theme: currentTheme });

    // Insert the rendered SVG
    if (contentDiv) {
      contentDiv.innerHTML = svg;
      enhanceDiagram(diagram);
    }
  } catch (error) {
    if (contentDiv) {
      contentDiv.innerHTML = `
        <div class="p-4 border border-red-200 dark:border-red-800 rounded bg-red-50 dark:bg-red-900/20">
          <p class="text-red-600 dark:text-red-400 text-sm">Diagram rendering failed</p>
          <details class="mt-2">
            <summary class="text-red-500 dark:text-red-400 text-xs cursor-pointer">Show source</summary>
            <pre class="mt-2 text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto">${decodedSource}</pre>
          </details>
        </div>
      `;
    }
  }
}

// Render all diagrams with lazy loading
async function renderAllDiagrams(): Promise<void> {
  const diagrams = document.querySelectorAll(
    ".mermaid-diagram[data-mermaid-source]"
  );

  if (diagrams.length === 0) {
    return;
  }

  // Initialize Mermaid
  initializeMermaid();

  // Set up intersection observer for lazy loading
  const observer = createIntersectionObserver();

  diagrams.forEach((diagram) => {
    observer.observe(diagram);
  });
}

// Handle theme changes with caching.
// 모드 토글과 팔레트 전환이 짧은 간격으로 겹쳐 들어올 수 있어 한 프레임 debounce 한다.
let themeChangeTimer: number | undefined;
function handleThemeChange(): void {
  if (themeChangeTimer !== undefined) {
    clearTimeout(themeChangeTimer);
  }
  themeChangeTimer = setTimeout(applyThemeChange, 16) as unknown as number;
}

function applyThemeChange(): void {
  const diagrams = document.querySelectorAll(
    ".mermaid-diagram[data-mermaid-source]"
  );
  const currentTheme = getThemeKey();

  diagrams.forEach((diagram) => {
    const source = diagram.getAttribute("data-mermaid-source");
    if (!source) return;

    const decodedSource = decodeURIComponent(source);
    const cacheKey = `${decodedSource}-${currentTheme}`;

    // Check if we have a cached version for this theme
    if (diagramCache.has(cacheKey)) {
      const cached = diagramCache.get(cacheKey)!;
      const contentDiv = diagram.querySelector(".mermaid-diagram-content");
      if (contentDiv) {
        contentDiv.innerHTML = cached.svg;
        enhanceDiagram(diagram as HTMLElement);
      }
    } else {
      // Re-render if no cache available
      renderDiagram(diagram as HTMLElement);
    }
  });
}

// Clear cache (useful for development)
function clearCache(): void {
  diagramCache.clear();
}

// Initialize Mermaid when DOM is ready
function initializeMermaidOnLoad(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderAllDiagrams);
  } else {
    renderAllDiagrams();
  }
}

// Export functions for global access
export {
  initializeMermaid,
  renderAllDiagrams,
  handleThemeChange,
  initializeMermaidOnLoad,
  clearCache,
};

// Make functions globally available for Swup compatibility
if (typeof window !== "undefined") {
  (window as any).initializeMermaid = renderAllDiagrams;
  (window as any).handleMermaidThemeChange = handleThemeChange;
  (window as any).clearMermaidCache = clearCache;
}
