# Astro 7 마이그레이션 — 남은 작업과 인수인계

2026-08-13 에 `astro@5.15.2 → 7.2.1` 마이그레이션을 브랜치 `chore/astro-7-migration` 에서 진행했다.
이 문서는 **그때 의도적으로 범위 밖에 둔 작업**과, 이어서 작업할 때 알아야 할 함정을 남긴다.

## 끝난 것 (요약)

| | 내용 |
|---|---|
| 버전 | Astro 5.15.2 → 7.2.1, Tailwind v3 → v4, Vite 7 → 8, Zod 3 → 4, Shiki 3 → 4, Node ≥ 22.12 |
| Markdown | Astro 7 의 기본 프로세서가 네이티브 Sätteri 로 바뀌었으나, 커스텀 remark/rehype 플러그인 8개 때문에 `markdown.processor: unified({...})` 로 unified 파이프라인을 명시 선택 |
| Tailwind | `@astrojs/tailwind`(astro ^5 에서 peer 끊김) → `@tailwindcss/vite`. 기존 `tailwind.config.mjs` 는 CSS 의 `@config` 로 계속 로드 |
| 제거 | `@astrojs/mdx`(.mdx 파일 0개), 최상위 `deployment` 설정 키, `ASTRO_CONTENT_COLLECTION_CACHE` 잔재, `cross-env` |
| 품질 게이트 | `astro check` 를 `pnpm run check` 로 노출하고 배포 워크플로우에 추가 (0 errors 상태) |

같이 고친 실버그는 커밋 메시지에 상세히 적혀 있다 (`git log chore/astro-7-migration`).

---

## 남은 작업

우선순위 순. 각 항목은 서로 독립적이라 따로 처리해도 된다.

### 1. 중복 사이트맵 정리

`@astrojs/sitemap` 통합이 `sitemap-index.xml` + `sitemap-0.xml` 을 만드는데,
손으로 쓴 `src/pages/sitemap.xml.ts` 가 `sitemap.xml` 을 따로 만든다. 둘이 공존한다.

- `public/robots.txt` 는 `Sitemap: .../sitemap.xml` (수동 쪽)을 가리킨다 — `src/pages/robots.txt.ts` 참고
- 수동 쪽은 lastmod/우선순위를 직접 제어할 수 있지만, 통합 쪽과 URL 집합이 어긋나도 아무도 모른다
- **판단 필요:** 하나로 줄일지, 유지하되 robots.txt 가 둘 다 가리키게 할지

같은 맥락으로 `src/pages/feed.xml.ts`(Atom) 와 `src/pages/rss.xml.ts`(RSS) 도 병행 중이다.
이쪽은 포맷이 달라 의도된 중복일 수 있다.

### 2. 죽은 코드 / 의존성 — ✅ 완료

정리 끝. `docs` 컬렉션은 검토 후 **유지하기로 결정**했다(아래 참고).

| 대상 | 조치 |
|---|---|
| `astro-redirect-from` | 제거. 어디서도 import 되지 않았다. 리다이렉트는 `astro.config.mjs` 의 `redirects` 와 생성된 `_redirects` 가 담당 |
| `lucide` | 제거. `Icon.astro` 는 SVG path 를 직접 하드코딩한다(Lucide 모양이지만 패키지에서 가져오지 않음) |
| 루트 `vite.config.mjs` | 삭제. Astro 는 이 파일을 읽지 않는다 — `terser` 가 설치돼 있지도 않은데 빌드가 통과하고, `manualChunks` 의 `vendor` 청크도 산출물에 없다는 점으로 확인 |
| `src/pages/api/og-image.ts` | 삭제. 410 을 의도했지만 **정적 빌드에서는 불가능**했다. 프리렌더돼 파일로 나가면서 실제로는 "사용 불가" 본문을 **HTTP 200** 으로 반환하고 있었다. 삭제하면 404 가 되어 의미가 맞다 |
| `package-lock.json` | 삭제 + `.gitignore` 에 추가. 초기 커밋 이후 방치(`name: astro-modular`, `version: 0.3.7`)였고 CI 는 pnpm 을 쓴다 |
| `@astrojs/check`, `typescript`, `@types/d3` | `dependencies` → `devDependencies` 이동. 런타임 번들에 들어갈 것이 아니다 |

**`docs` 컬렉션은 유지한다 (결정됨).** 죽은 코드가 아니라 **콘텐츠가 아직 없는 기능**이다.
`src/pages/docs/*`, `DocumentationLayout`, `DocumentationCard`, 스키마가 모두 살아 있어서
지우면 기능 제거가 된다. 앞으로 문서를 채울 계획이므로 그대로 둔다.

그 결과 빌드마다 아래 경고가 계속 나오는데, **정상이며 무시해도 된다**:

```
[WARN] [glob-loader] No files found matching "**/*.md" in directory "src/content/docs"
```

`document-repo` 의 `publish/blog/gitio/docs/` 에 `publish: true` 문서가 생기면 자동으로 사라진다.
경고를 없애겠다고 컬렉션을 지우지 말 것.

### 3. 레거시 Swup 리스너

Swup 4 는 `swup:contentReplaced` DOM 이벤트를 발생시키지 않는다 (Swup 2/3 API).
아래 4곳의 재초기화 핸들러는 이미 죽어 있을 가능성이 높다:

- `src/layouts/PostLayout.astro`
- `src/layouts/ProjectLayout.astro`
- `src/components/SeriesCarousel.astro`
- `src/pages/posts/series/[...slug].astro`

정상 경로는 `window.swup.hooks.on('content:replace' | 'page:view' | 'visit:end', ...)` 이고
`src/layouts/BaseLayout.astro` 와 `src/components/GraphModal.astro` 가 이 방식을 쓴다.

**확인 방법:** 브라우저에서 페이지 전환 후 해당 핸들러에 `console.log` 를 걸어 호출 여부를 본다.
죽어 있다면 `hooks.on` 으로 옮기거나, 이미 BaseLayout 이 처리 중이면 삭제.

관련해서 `BaseLayout.astro` 에는 Swup 초기화 경쟁을 덮는 `swupRetryCount` 폴링 루프와
`MutationObserver` 폴백이 있다. 리스너를 정리하면 이것들도 필요 없어질 수 있다.

### 4. 정적 페이지 안의 `Astro.redirect`

12곳이 프리렌더 페이지에서 `Astro.redirect` 를 부른다. 정적 출력에서는 실제 리다이렉트가 아니라
meta-refresh HTML 이 된다. 대부분 `getStaticPaths` 가 만든 엔트리라 도달 불가능한 가드다.

예외로 `src/pages/posts/tag/[...tag].astro:41` 의 소문자 태그 리다이렉트는 **의도된 기능**이므로 건드리지 말 것.

### 5. 툴체인

- pnpm 8 → 9/10, lockfile v6 → v9. 노이즈가 큰 변경이라 단독 커밋 권장
- `packageManager` 필드와 `pnpm/action-setup@v6` 이 연동돼 있어 함께 올려야 한다

### 6. 도입 검토

- **반응형 이미지**: 현재 `src/components/ImageWrapper.astro` 가 legacy `densities` prop 을 쓴다.
  Astro 5+ 의 `layout`/`widths`/`sizes` 와 `image.responsiveStyles` 설정은 미도입
- **`image.remotePatterns`**: `[{ protocol: 'https' }]` 로 호스트 제한이 없다. 임의의 HTTPS 이미지
  최적화를 허용하는 상태
- **PR 단계 타입 체크**: 지금 `astro check` 는 배포 워크플로우(main 푸시)에서만 돈다. PR 에서
  걸리게 하려면 `pull_request` 트리거를 가진 별도 워크플로우가 필요하다. 단, 콘텐츠 컬렉션
  타입 때문에 private `document-repo` 체크아웃(`secrets.DOCS_REPO_TOKEN`)이 선행돼야 한다

---

## 작업 전 반드시 알아야 할 함정

### 빌드가 추적 중인 파일을 덮어쓴다

| 파일 | 무엇이 | 대응 |
|---|---|---|
| `public/graph/graph-data.json` | `scripts/generate-graph-data.js` 가 매 빌드 재생성 | 로컬 `document-repo` 가 불완전하면 노드가 빠진 채 생성된다. **커밋 전 `git checkout -- public/graph/graph-data.json`** |
| `astro.config.mjs` | `scripts/generate-deployment-config.js` 가 `redirects` 블록을 정규식으로 재작성 | 설정을 편집했으면 스크립트를 한 번 돌려 round-trip 을 확인할 것 |

`astro.config.mjs` 쪽 정규식은 `/redirects:\s*\{[^}]*\}/s` 라서 **중첩 객체를 못 견딘다.**
Astro 가 지원하는 `'/x': { status, destination }` 형태를 쓰는 순간 설정이 깨진다.
지금은 값이 전부 문자열이라 우연히 안전하다.

### 콘텐츠는 별도 private 저장소에서 온다

`../document-repo` (또는 `DOCS_LOCAL_PATH`) 의 `publish/blog/gitio/` 아래에서
`publish: true` 인 문서만 `src/content/` 로 복사된다 (`scripts/import-content.js`).
`docs/content-separation/README.md` 참고.

**빌드 산출물을 비교해 검증할 때는 콘텐츠가 상수인지 먼저 확인할 것.**
이번 작업 중 `document-repo` 가 세션 도중 갱신돼(mermaid 다이어그램 개선 커밋) 베이스라인 비교가
오염됐고, 잠깐 코드 회귀로 오인했다. 안전한 방법은 **콘텐츠를 고정한 채 코드 변경 전후로 각각
빌드해서 비교**하는 것이다:

```bash
git stash push -- <바꾼 파일들>
pnpm run build && cp -r dist /tmp/dist-before
git stash pop
pnpm run build
# /tmp/dist-before 와 dist 비교
```

### 테스트가 없다

`package.json` 의 `test` 는 여전히 스캐폴드 placeholder 다.
안전망은 **빌드 산출물 비교**뿐이므로, 비교할 때는 아래 빌드 비결정성을 정규화해야 한다:

- `data-mermaid-id="mermaid-<랜덤>"` — 빌드마다 새로 생성
- RSS/Atom/sitemap 의 `lastBuildDate` / `pubDate` / `updated` / `lastmod`
  (`date` 프론트매터가 없는 글은 빌드 시각이 기본값이 된다)
- `/_assets/*.css|js` 의 콘텐츠 해시
- HTML 엔티티 표기 (`&#34;` vs `&quot;`)

렌더된 **텍스트**만 비교하는 방식이 가장 신호가 좋았다 (태그를 공백으로 치환 후 비교).

**단, 산출물 비교는 CSS 회귀를 잡지 못한다.** 실제로 Tailwind v4 의 캐스케이드 레이어 문제로
사이트 전체의 링크·헤딩·테두리·배경색이 어긋났는데, 마크업도 렌더 텍스트도 CSS 번들 크기도
전부 동일해서 비교로는 전혀 드러나지 않았다. 색상 셀렉터가 **생성되는지**는 확인했지만
**어느 규칙이 이기는지**는 확인하지 않았던 탓이다.

스타일을 건드렸다면 산출물 비교에 더해 다음을 볼 것:

1. 브라우저에서 실제로 확인한다 (가장 확실하다. 특히 다크모드와 호버 상태)
2. 브라우저가 없으면 빌드된 CSS 를 파싱해 **레이어 소속**을 대조한다.
   `@layer <name> { ... }` 블록의 중괄호를 세어 각 규칙이 어느 레이어에 있는지 구한 뒤,
   기본 스타일이 `base` 에, 유틸리티가 `utilities` 에 있는지 본다. 기본 스타일이
   `UNLAYERED` 로 나오면 유틸리티를 이기고 있다는 뜻이다.

### Astro 7 컴파일러는 잘못된 마크업을 봐준다 → 이제 에러

Rust 컴파일러가 기본이 되면서 아래가 전부 빌드 에러다. 새 코드를 쓸 때 주의:

- 삼항/`&&` 분기의 루트 노드는 **하나여야 한다.** HTML 주석을 요소 앞에 두면 루트가 2개가 되므로
  `<>...</>` 로 감싸야 한다 (주석은 출력에 남기 때문에 지우면 출력이 바뀐다)
- 짝 없는 닫는 태그, 잉여 닫는 태그가 조용히 무시되지 않는다

### Tailwind v4 로 바뀐 규칙

- **`@layer` 밖에 쓴 규칙은 모든 유틸리티를 이긴다.** v4 의 `@import "tailwindcss"` 는 네이티브
  캐스케이드 레이어(`@layer theme, base, components, utilities`)를 만든다. CSS 규칙상 레이어에
  속하지 않은 선언은 **명시도와 무관하게** 레이어 안의 모든 선언을 이긴다.

  v3 에는 네이티브 레이어가 없어 명시도로 결정됐다. 그래서 `global.css` 의 `a { color }`(0,0,1)
  는 `.text-primary-600`(0,1,0) 유틸리티에 지는 게 정상이었는데, v4 로 오면서 뒤집혀 사이트
  전체의 링크·헤딩·테두리·배경색이 조용히 어긋났다.

  **규칙:** 요소·전체 선택자로 된 기본 스타일은 `@layer base { ... }` 안에 쓸 것. 새 규칙을
  추가할 때도 마찬가지다. 판단 기준은 "v3 에서 유틸리티에 졌을 규칙인가" — 즉 명시도가 클래스
  하나(0,1,0)보다 낮으면 `base` 로 간다.

  건드리면 안 되는 것도 있다. 클래스 기반 규칙(`.btn`, `.callout`)은 v3 에서도 소스 순서로
  유틸리티를 이겼으므로 레이어 밖이 맞다. `!important` 규칙은 important 선언의 레이어
  우선순위가 역전(레이어 밖이 가장 약함)이라 옮기면 관계가 오히려 바뀐다. `:root`,
  `:focus-visible` 같은 의사클래스는 명시도가 클래스와 같아 대상이 아니다.

- 컴포넌트 `<style>` 블록에서 `@apply` 를 쓰려면 `@reference "<global.css 경로>";` 가 먼저 와야 한다
- `@apply x !important` 는 `@apply x!` 로 쓴다
- `outline-none` 은 이제 `outline-style: none` 을 실제로 설정한다. v3 의 동작(투명 아웃라인,
  forced-colors 접근성 유지)은 `outline-hidden` 이다
- `ring-*` 기본 색상이 `blue-500/50` → `currentColor` 로 바뀌었다. 색상을 명시하지 않은 곳은 확인 필요
- **`:global()` 은 Astro 의 스코프 `<style>` 안에서만 쓸 것.** `src/styles/global.css` 같은 일반
  스타일시트에 쓰면 출력에 문자 그대로 남아 셀렉터가 무효화된다 (실제로 mermaid 팔레트 연동이
  이것 때문에 죽어 있었다)

### 조용히 실패하는 지점

`src/components/ImageWrapper.astro` 의 `import.meta.glob("/public/**")` 는 `public/` 을 Vite 로
글로빙한다. 원래 Vite 처리 대상이 아닌 디렉토리라 루트 해석에 기대고 있고, 실패는 `try/catch` 가
`isImageMissing = true` 로 삼킨다. **회귀해도 에러 없이 이미지만 사라진다.**
Vite 메이저를 올릴 때마다 이미지가 실제로 뜨는지 눈으로 확인할 것.
