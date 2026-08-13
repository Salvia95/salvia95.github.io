import { siteConfig } from "../config";

/**
 * 사이트 기준 URL. **항상 후행 슬래시로 끝난다.**
 *
 * `siteConfig.site` 는 후행 슬래시 없이 적혀 있고 `import.meta.env.SITE` 도
 * 그대로 넘어오는데, 호출부 대부분이 `${siteUrl}posts/...` 처럼 슬래시가
 * 있다고 가정하고 문자열을 이어붙였다. 그 결과 `https://example.ioposts/`
 * 같은 URL 이 RSS/Atom/sitemap 전체에 나갔다. 결합 전에 여기서 한 번만
 * 정규화한다.
 */
export function getSiteBase(): string {
  const raw = import.meta.env.SITE || siteConfig.site;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/**
 * 기준 URL 에 경로를 붙인다. 경로의 선행 슬래시 유무와 관계없이
 * 슬래시 하나로 이어진다.
 */
export function absoluteUrl(path = ""): string {
  return `${getSiteBase()}${path.replace(/^\/+/, "")}`;
}
