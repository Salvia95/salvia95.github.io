/**
 * Mermaid 다이어그램 전체화면 확대/이동(pan & zoom) 오버레이.
 *
 * mermaid 에는 확대 기능이 없다. 11.x 공개 API 어디에도 zoom/pan 이 없고
 * render() 는 정적 SVG 문자열만 돌려준다. Live Editor 에서 확대가 되는 건
 * 에디터가 직접 붙인 것이라 라이브러리를 쓴다고 따라오지 않는다.
 *
 * 이미지용 Lightbox.astro 를 재사용하지 않은 이유:
 * 그쪽은 `<img src>` 기반인데 이 사이트는 htmlLabels:true 라 다이어그램 라벨이
 * <foreignObject> 안의 HTML 이다. SVG 를 data URL 로 <img> 에 넣으면 그 HTML 이
 * 문서의 CSS·폰트와 끊겨 라벨이 깨진다. 그래서 살아있는 SVG 노드를 복제해
 * 문서 안에서 확대한다.
 *
 * 이 모듈은 사용자가 확대 버튼을 처음 누를 때 동적 import 된다
 * (src/utils/mermaid.ts 의 ensureZoomTrigger). d3-zoom 을 끌어오므로
 * 다이어그램만 보고 지나가는 사람은 받지 않는다.
 */

import { select, zoom, zoomIdentity, type ZoomBehavior } from "d3";

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const STEP = 1.4;

// 처음 열었을 때: 화면에 꽉 채우지 않고 여백을 조금 남기고,
// 작은 다이어그램을 흐릿해질 때까지 키우지는 않는다.
const FIT_MARGIN = 0.94;
const FIT_MAX_SCALE = 3;

interface Overlay {
  root: HTMLDivElement;
  stage: HTMLDivElement;
  wrapper: HTMLDivElement;
  scaleLabel: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  behavior: ZoomBehavior<HTMLElement, unknown>;
}

let overlay: Overlay | null = null;
let restoreFocusTo: HTMLElement | null = null;
let naturalSize = { width: 0, height: 0 };

function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function button(action: string, label: string, inner: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `mermaid-zoom-button mermaid-zoom-${action}`;
  element.setAttribute("aria-label", label);
  element.innerHTML = inner;
  return element;
}

function createOverlay(): Overlay {
  const root = document.createElement("div");
  root.className = "mermaid-zoom-overlay";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "다이어그램 확대 보기");

  const stage = document.createElement("div");
  stage.className = "mermaid-zoom-stage";

  const wrapper = document.createElement("div");
  wrapper.className = "mermaid-zoom-wrapper";
  stage.appendChild(wrapper);

  const toolbar = document.createElement("div");
  toolbar.className = "mermaid-zoom-toolbar";

  const zoomOut = button("out", "축소", icon('<line x1="5" y1="12" x2="19" y2="12"/>'));
  const scaleLabel = button("scale", "원래 크기로 되돌리기", "100%");
  const zoomIn = button(
    "in",
    "확대",
    icon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')
  );
  const closeButton = button(
    "close",
    "닫기",
    icon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>')
  );

  toolbar.append(zoomOut, scaleLabel, zoomIn, closeButton);
  root.append(stage, toolbar);
  document.body.appendChild(root);

  const behavior = zoom<HTMLElement, unknown>()
    .scaleExtent([MIN_SCALE, MAX_SCALE])
    .on("zoom", (event) => {
      const { x, y, k } = event.transform;
      wrapper.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
      scaleLabel.textContent = `${Math.round(k * 100)}%`;
    });

  select<HTMLElement, unknown>(stage).call(behavior);

  const instance: Overlay = {
    root,
    stage,
    wrapper,
    scaleLabel,
    closeButton,
    behavior,
  };

  zoomOut.addEventListener("click", () => scaleBy(1 / STEP));
  zoomIn.addEventListener("click", () => scaleBy(STEP));
  scaleLabel.addEventListener("click", () => resetZoom());
  closeButton.addEventListener("click", () => closeMermaidZoom());

  // 배경 클릭으로 닫기. d3-zoom 이 드래그로 mousedown 을 먹으므로
  // "거의 움직이지 않은 클릭"만 닫기로 친다. 다이어그램 위 클릭은 제외.
  let downX = 0;
  let downY = 0;
  stage.addEventListener("pointerdown", (event) => {
    downX = event.clientX;
    downY = event.clientY;
  });
  stage.addEventListener("pointerup", (event) => {
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 5) return;
    if (wrapper.contains(event.target as Node)) return;
    closeMermaidZoom();
  });

  return instance;
}

function ensureOverlay(): Overlay {
  if (!overlay || !overlay.root.isConnected) {
    overlay = createOverlay();
  }
  return overlay;
}

/** 다이어그램 전체가 보이도록 맞추는 초기 변환. */
function fitTransform(instance: Overlay) {
  const { width, height } = naturalSize;
  const stageWidth = instance.stage.clientWidth;
  const stageHeight = instance.stage.clientHeight;
  if (!width || !height || !stageWidth || !stageHeight) return zoomIdentity;

  const scale = Math.min(
    FIT_MAX_SCALE,
    Math.max(MIN_SCALE, Math.min(stageWidth / width, stageHeight / height) * FIT_MARGIN)
  );
  return zoomIdentity
    .translate((stageWidth - width * scale) / 2, (stageHeight - height * scale) / 2)
    .scale(scale);
}

function scaleBy(factor: number): void {
  if (!overlay) return;
  const center: [number, number] = [
    overlay.stage.clientWidth / 2,
    overlay.stage.clientHeight / 2,
  ];
  overlay.behavior.scaleBy(select<HTMLElement, unknown>(overlay.stage), factor, center);
}

function resetZoom(): void {
  if (!overlay) return;
  overlay.behavior.transform(
    select<HTMLElement, unknown>(overlay.stage),
    fitTransform(overlay)
  );
}

function onKeyDown(event: KeyboardEvent): void {
  if (!overlay) return;
  switch (event.key) {
    case "Escape":
      event.preventDefault();
      closeMermaidZoom();
      break;
    case "+":
    case "=":
      event.preventDefault();
      scaleBy(STEP);
      break;
    case "-":
    case "_":
      event.preventDefault();
      scaleBy(1 / STEP);
      break;
    case "0":
      event.preventDefault();
      resetZoom();
      break;
  }
}

export function openMermaidZoom(svg: SVGSVGElement): void {
  const instance = ensureOverlay();
  restoreFocusTo = document.activeElement as HTMLElement | null;

  // 자연 크기는 viewBox 가 진짜다. 인라인 SVG 는 컨테이너에 맞춰 줄어든
  // 상태라 getBoundingClientRect 는 축소된 값을 준다(폴백으로만 쓴다).
  const box = svg.viewBox?.baseVal;
  const rect = svg.getBoundingClientRect();
  naturalSize = {
    width: box?.width || rect.width,
    height: box?.height || rect.height,
  };

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(naturalSize.width));
  clone.setAttribute("height", String(naturalSize.height));
  clone.style.width = `${naturalSize.width}px`;
  clone.style.height = `${naturalSize.height}px`;
  clone.style.maxWidth = "none";
  clone.style.display = "block";
  instance.wrapper.replaceChildren(clone);

  instance.root.classList.add("is-open");
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", onKeyDown);

  // 열기 전에는 display:none 이라 stage 크기가 0 이다. 한 프레임 뒤에 맞춘다.
  requestAnimationFrame(() => {
    if (!overlay) return;
    resetZoom();
    overlay.closeButton.focus();
  });
}

export function closeMermaidZoom(): void {
  if (!overlay || !overlay.root.classList.contains("is-open")) return;

  overlay.root.classList.remove("is-open");
  overlay.wrapper.replaceChildren();
  document.body.style.overflow = "";
  document.removeEventListener("keydown", onKeyDown);

  restoreFocusTo?.focus?.();
  restoreFocusTo = null;
}

// Swup 전환 중 오버레이가 열린 채 남지 않도록 BaseLayout 의
// content:replace 훅이 부른다. 이 모듈은 확대를 처음 열 때에야 로드되므로
// 호출부에서는 반드시 옵셔널로 접근해야 한다.
if (typeof window !== "undefined") {
  (window as any).closeMermaidZoom = closeMermaidZoom;
}
