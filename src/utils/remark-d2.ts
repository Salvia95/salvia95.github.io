import { createHash } from 'node:crypto';
import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Code } from 'mdast';
import { D2 } from '@terrastruct/d2';

/**
 * Remark plugin for processing D2 diagrams
 *
 * ```d2 코드블록을 빌드 타임에 SVG 로 렌더링해서 인라인으로 심는다.
 * Mermaid(클라이언트 렌더)와 달리 브라우저로 나가는 JS 가 0 이다.
 *
 * 색은 SVG 에 박아 넣지 않는다. D2 는 도형/텍스트에 fill-N1, stroke-B1 같은
 * "의미 토큰" 클래스를 붙이고 실제 색은 <style> 안에만 두기 때문에, style 을
 * 걷어내면 색 전체를 사이트 CSS 변수로 갈아끼울 수 있다. 그래서 다이어그램이
 * 블로그 테마 17종과 다크모드 토글을 자동으로 따라간다.
 * 실제 색 매핑은 global.css 의 `.d2-diagram` 블록에 있다.
 *
 * 기존 remark-mermaid.ts 와 같은 자리에서 같은 방식으로 동작하되,
 * 렌더가 비동기라 transformer 가 async 다.
 */

// D2 WASM 인스턴스는 무겁다(초기화 ~1초). 빌드 한 번에 하나만 만들어 재사용한다.
let d2Singleton: D2 | null = null;

function getD2(): D2 {
  if (d2Singleton) return d2Singleton;

  d2Singleton = new D2();

  // @terrastruct/d2 는 worker_threads 를 띄우는데 종료 API 를 공개하지 않는다
  // (public 은 compile/render 뿐). 살아있는 worker 가 이벤트 루프를 붙잡으면
  // 빌드가 끝나고도 프로세스가 종료되지 않는다. unref() 로 "이 worker 는
  // 프로세스를 붙잡지 말라"고 표시해 둔다 — 내부 구현이라 방어적으로 접근한다.
  try {
    const worker = (d2Singleton as unknown as { worker?: { unref?: () => void } }).worker;
    worker?.unref?.();
  } catch {
    // 내부 구조가 바뀌었을 뿐이므로 렌더 자체에는 영향이 없다.
  }

  return d2Singleton;
}

// 같은 빌드 안에서 동일한 다이어그램을 두 번 렌더하지 않는다.
const svgCache = new Map<string, string>();

/**
 * D2 가 SVG 안에 심어 놓은 <style> 을 통째로 걷어낸다.
 *
 * 그 안에는 (1) 토큰별 색상 정의 (2) 다크 테마를 위한
 * `@media (prefers-color-scheme: dark)` 블록 (3) 한글 글리프가 없는
 * bold/italic @font-face 가 들어 있다. 셋 다 사이트와 충돌한다.
 *  - 이 블로그의 다크모드는 `.dark` 클래스 + localStorage 수동 토글이라
 *    OS 설정을 보는 prefers-color-scheme 과 어긋난다.
 *  - 색을 CSS 변수에 위임해야 테마 전환을 따라간다.
 *
 * <style> 밖(도형, marker, mask, class 속성)은 건드리지 않으므로 구조는 그대로다.
 * 대신 style 에 있던 구조적 규칙(.shape/.connection/.blend, .light-code/.dark-code,
 * .md 변수)은 global.css 에서 다시 정의해 준다.
 */
function stripEmbeddedStyles(svg: string): string {
  return svg.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
}

async function renderDiagram(source: string): Promise<string> {
  const key = createHash('sha256').update(source).digest('hex');
  const cached = svgCache.get(key);
  if (cached) return cached;

  const d2 = getD2();
  const result = await d2.compile({
    fs: { 'index.d2': source },
    inputPath: 'index.d2',
    options: {
      layout: 'dagre',
      // 색은 어차피 전부 걷어내고 CSS 로 다시 칠하므로 테마 번호는 의미가 없다.
      // (테마를 바꿔도 어떤 요소에 어떤 토큰이 붙는지는 동일하다.)
      themeID: 0,
      // 기본 pad 100 은 본문 흐름에 비해 여백이 과하다.
      pad: 20,
      // 기본값은 화면에 맞춰 늘리므로 작은 다이어그램이 과하게 커진다.
      // 자연 크기로 뽑고 반응형 축소는 CSS 에 맡긴다.
      scale: 1,
    },
  });

  const svg = stripEmbeddedStyles(await d2.render(result.diagram, result.renderOptions));
  svgCache.set(key, svg);
  return svg;
}

/**
 * D2 컴파일 에러는 `[{"range":…,"errmsg":"index.d2:1:1: …"}, …]` 형태의 JSON
 * 문자열로 던져진다. 그대로 보여주면 읽을 수 없으므로 errmsg 만 추려낸다.
 * (JSON 이 아니면 원본 메시지를 그대로 쓴다)
 */
function formatD2Error(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const messages = parsed
        .map((e) => (e && typeof e.errmsg === 'string' ? e.errmsg.replace(/^index\.d2:/, '') : null))
        .filter(Boolean);
      if (messages.length > 0) return messages.join(' / ');
    }
  } catch {
    // JSON 이 아닌 일반 에러
  }
  return raw;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 렌더 실패가 빌드 전체를 죽이지는 않게 한다. 대신 어떤 다이어그램이 왜 실패했는지
// 빌드 로그에 남기고, 화면에는 원본 소스를 보여줘서 글이 통째로 비지 않게 한다.
function errorBlock(source: string, message: string): string {
  return `<div class="d2-diagram d2-diagram-error">
  <p class="d2-diagram-error-message">D2 다이어그램을 렌더링하지 못했습니다: ${escapeHtml(message)}</p>
  <pre class="d2-diagram-source"><code>${escapeHtml(source)}</code></pre>
</div>`;
}

const remarkD2: Plugin<[], Root> = () => {
  return async (tree, file: any) => {
    // visit 은 동기라 렌더를 그 안에서 await 할 수 없다. 대상을 먼저 모은 뒤 처리한다.
    const targets: Array<{ node: Code; index: number; parent: any }> = [];

    visit(tree, 'code', (node: Code, index, parent) => {
      if (node.lang !== 'd2') return;
      if (!node.value || typeof node.value !== 'string') return;
      if (parent && typeof index === 'number') {
        targets.push({ node, index, parent });
      }
    });

    if (targets.length === 0) return;

    for (const { node, index, parent } of targets) {
      let html: string;

      try {
        const svg = await renderDiagram(node.value);
        html = `<div class="d2-diagram">${svg}</div>`;
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const message = formatD2Error(raw);
        const where = file?.path ? ` (${String(file.path).split('/src/content/').pop()})` : '';
        const line = node.position?.start.line;
        console.warn(
          `[remark-d2] 다이어그램 렌더 실패${where}${line ? `:${line}` : ''} — ${message}`
        );
        html = errorBlock(node.value, message);
      }

      // 1:1 치환이라 뒤따르는 노드의 인덱스가 밀리지 않는다.
      parent.children.splice(index, 1, { type: 'html', value: html } as any);
    }
  };
};

export default remarkD2;
