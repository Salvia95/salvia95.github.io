import fs from "node:fs";
import path from "node:path";
import { slug as githubSlug } from "github-slugger";
import contentSourcesConfig from "../../content-sources.config.mjs";

/**
 * 빌드 타임 포스트 인덱스.
 *
 * remark 플러그인은 마크다운 컴파일 도중 실행되므로 getCollection() 을 쓸 수 없다
 * (콘텐츠 로딩이 곧 이 컴파일을 유발하는 순환 관계). 대신 파일은 이미 디스크에
 * 있으므로 src/content/posts 를 직접 훑어서 링크 해석용 인덱스를 만든다.
 *
 * 옵시디언의 "shortest path when possible" 링크는 디렉토리 없이 파일명만 남기기
 * 때문에([[01-intro]]), 폴더로 묶인 시리즈 글에서 링크가 깨진다. 이 인덱스가
 * 파일명·제목·별칭을 실제 post id 로 되돌린다.
 *
 * .ts 가 아니라 .mjs 인 이유: astro 빌드(vite)와 scripts/generate-graph-data.js
 * (순수 node) 양쪽에서 같은 모듈을 그대로 import 하기 위해서다. 한쪽만 고치면
 * 그래프의 노드 id 와 사이트의 URL 이 다시 어긋난다.
 */

const POSTS_DIR = path.resolve(process.cwd(), "src/content/posts");
const MARKDOWN_EXT = new Set([".md", ".mdx"]);

/**
 * @typedef {object} PostRef
 * @property {string} id Astro glob 로더가 만드는 id (= URL 경로). 예: "chunk-batch/01-intro"
 * @property {string} dirId 소속 디렉토리를 id 와 같은 규칙으로 슬러그화한 값. 루트면 "".
 * @property {string} basename 확장자 없는 원본 파일명. 예: "01-intro"
 * @property {string} title
 * @property {string[]} aliases
 */

/**
 * document-repo 에서 사이트 루트가 되는 하위 경로 (예: "publish/blog/gitio").
 * 옵시디언의 "볼트 내 절대 경로" 링크가 이 접두사를 그대로 달고 오기 때문에,
 * 떼어내지 않으면 실제 경로가 아닌 리터럴 슬러그로 취급되어 링크가 깨지고
 * 저장소 경로가 노출된다.
 */
const CONTENT_ROOT_PREFIX = String(
  (contentSourcesConfig && contentSourcesConfig.contentRoot) || ""
).replace(/^\/+|\/+$/g, "");

/**
 * 링크 대상에서 document-repo 콘텐츠 루트 접두사를 제거한다.
 * 접두사가 없으면 아무것도 하지 않으므로 여러 지점에서 반복 적용해도 안전하다.
 *
 * @param {string} url
 * @returns {string}
 */
export function stripContentRootPrefix(url) {
  if (!CONTENT_ROOT_PREFIX || typeof url !== "string") return url;
  const candidates = [`${CONTENT_ROOT_PREFIX}/`, `/${CONTENT_ROOT_PREFIX}/`];
  for (const prefix of candidates) {
    if (url.startsWith(prefix)) {
      return url.slice(prefix.length);
    }
  }
  return url;
}

/**
 * Astro glob 로더의 id 생성 규칙을 그대로 재현한다.
 * (astro/dist/content/utils.js: getContentEntryIdAndSlug)
 *
 * 경로 세그먼트마다 github-slugger 를 적용하고 후행 "/index" 를 떼어낸다.
 * 한글은 보존되고 공백은 하이픈이 되므로 "한글시리즈/문제 정의.md" 는
 * "한글시리즈/문제-정의" 가 된다.
 *
 * @param {string} relativePathWithoutExt
 * @returns {string}
 */
export function toPostId(relativePathWithoutExt) {
  return relativePathWithoutExt
    .split("/")
    .map((segment) => githubSlug(segment))
    .join("/")
    .replace(/\/index$/, "");
}

/**
 * 슬래시가 있는 링크 경로를 실제 URL 경로로 정규화한다.
 *
 * 기존 코드는 경로를 그대로 이어 붙였기 때문에 "한글시리즈/문제 정의" 처럼
 * 공백이 든 경로가 실제 페이지(/posts/한글시리즈/문제-정의)와 어긋났다.
 * 세그먼트마다 로더와 동일한 슬러그 규칙을 적용해 맞춘다.
 *
 * @param {string} pathWithoutPrefix
 * @returns {string}
 */
export function normalizePostPath(pathWithoutPrefix) {
  return toPostId(pathWithoutPrefix.replace(/\.mdx?$/, ""));
}

// 프론트매터에서 title 과 aliases 만 값싸게 뽑는다. 링크 해석에 필요한 것이
// 이 둘 뿐이라 YAML 파서를 끌어오지 않는다.
function readFrontmatter(filePath) {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { title: "", aliases: [] };
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { title: "", aliases: [] };

  const lines = match[1].split(/\r?\n/);
  const unquote = (v) => v.trim().replace(/^["'](.*)["']$/s, "$1").trim();

  let title = "";
  const aliases = [];
  let inAliasBlock = false;

  for (const line of lines) {
    // aliases 의 블록 시퀀스 항목 ("  - 별칭")
    if (inAliasBlock) {
      const item = line.match(/^\s+-\s+(.*)$/);
      if (item) {
        const value = unquote(item[1]);
        if (value) aliases.push(value);
        continue;
      }
      inAliasBlock = false;
    }

    const kv = line.match(/^(title|aliases)\s*:\s*(.*)$/);
    if (!kv) continue;

    const [, key, rest] = kv;
    if (key === "title") {
      title = unquote(rest);
      continue;
    }

    // aliases: [a, b] / aliases: 단일값 / aliases: (다음 줄부터 블록)
    const value = rest.trim();
    if (value.startsWith("[")) {
      for (const part of value.replace(/^\[|\]$/g, "").split(",")) {
        const alias = unquote(part);
        if (alias) aliases.push(alias);
      }
    } else if (value === "") {
      inAliasBlock = true;
    } else {
      const alias = unquote(value);
      if (alias) aliases.push(alias);
    }
  }

  return { title, aliases };
}

function walk(dir, relative, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    // 첨부파일 디렉토리와 숨김 폴더(.obsidian 등)는 글이 아니다.
    if (entry.name.startsWith(".") || entry.name === "attachments") continue;

    const absolute = path.join(dir, entry.name);
    const relativePath = relative ? `${relative}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      walk(absolute, relativePath, out);
      continue;
    }

    const ext = path.extname(entry.name);
    if (!MARKDOWN_EXT.has(ext)) continue;

    const withoutExt = relativePath.slice(0, -ext.length);
    const { title, aliases } = readFrontmatter(absolute);

    out.push({
      id: toPostId(withoutExt),
      dirId: relative ? toPostId(relative) : "",
      basename: entry.name.slice(0, -ext.length),
      title,
      aliases,
      /** POSTS_DIR 기준 원본 상대 경로 (그래프 스크립트가 파일을 다시 읽을 때 쓴다) */
      relativePath,
    });
  }
}

let cache = null;

/** @returns {PostRef[]} */
export function getPostIndex() {
  // dev 에서는 글을 추가·수정하면 곧바로 반영되어야 하므로 캐시하지 않는다.
  // 글 수가 수십 편 규모라 매번 훑어도 부담이 없다.
  // (import.meta.env 는 vite 에서만 존재한다. 순수 node 에서는 undefined.)
  if (cache && !import.meta.env?.DEV) return cache;
  const found = [];
  walk(POSTS_DIR, "", found);
  cache = found;
  return found;
}

// 테스트/개발용 캐시 무효화.
export function clearPostIndexCache() {
  cache = null;
}

// 비교용 정규화: 대소문자와 공백/하이픈 차이를 흡수한다.
function normalize(value) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

// 후보가 여러 개일 때 결정론적으로 하나를 고른다.
// 같은 디렉토리를 우선하고(옵시디언의 근접성 규칙), 그다음 id 사전순.
function pick(candidates, fromDirId) {
  if (candidates.length === 1) return candidates[0];

  const sameDir = candidates.filter((c) => c.dirId === fromDirId);
  const pool = sameDir.length > 0 ? sameDir : candidates;
  return [...pool].sort((a, b) => a.id.localeCompare(b.id))[0];
}

/**
 * @typedef {object} ResolveOrigin
 * @property {string} [fromFile] 링크가 적힌 파일의 절대 경로 (remark 의 file.path)
 * @property {string} [fromId] 링크가 적힌 글의 post id (콘텐츠 컬렉션에서 호출할 때)
 */

/**
 * 디렉토리 없는 링크 타깃(파일명·제목·별칭)을 실제 post 로 해석한다.
 *
 * 슬래시가 포함된 타깃은 이 함수를 거치지 않는다. 그런 링크는 기존 경로
 * 정규화(볼트 절대경로 제거 → posts/... → /posts/...)가 담당한다.
 *
 * @param {string} target 링크에 적힌 문자열. 예: "01-intro", "문제 정의"
 * @param {ResolveOrigin} [origin] 링크가 어디에 적혀 있는지. 같은 디렉토리를 우선 매칭한다.
 * @returns {PostRef | null}
 */
export function resolvePostRef(target, origin) {
  const needle = String(target || "").trim();
  if (!needle) return null;

  const posts = getPostIndex();
  if (posts.length === 0) return null;

  const fromDirId = originDirId(origin);
  const normalized = normalize(needle);

  // 1) 같은 디렉토리의 파일명 — 시리즈 내부 참조 대부분이 여기서 끝난다.
  const sameDirFile = posts.filter(
    (p) => p.dirId === fromDirId && normalize(p.basename) === normalized
  );
  if (sameDirFile.length > 0) return pick(sameDirFile, fromDirId);

  // 2) 전체에서 파일명 일치
  const byBasename = posts.filter((p) => normalize(p.basename) === normalized);
  if (byBasename.length > 0) return pick(byBasename, fromDirId);

  // 3) 제목 일치 — slugify 로 사라지던 한글 제목 링크가 여기서 살아난다.
  const byTitle = posts.filter(
    (p) => p.title && normalize(p.title) === normalized
  );
  if (byTitle.length > 0) return pick(byTitle, fromDirId);

  // 4) 별칭 일치
  const byAlias = posts.filter((p) =>
    p.aliases.some((alias) => normalize(alias) === normalized)
  );
  if (byAlias.length > 0) return pick(byAlias, fromDirId);

  // 5) id 직접 일치 (이미 슬러그 형태로 적어둔 경우)
  const byId = posts.filter(
    (p) => p.id === needle || normalize(p.id) === normalized
  );
  if (byId.length > 0) return pick(byId, fromDirId);

  return null;
}

/**
 * 링크 타깃 하나를 post id 로 바꾼다. 슬래시 유무로 두 경로를 가른다.
 * remark 플러그인과 그래프 스크립트가 같은 결과를 내도록 여기에 모아 둔다.
 *
 * @param {string} rawTarget 링크에 적힌 원본 문자열 (앵커 제거 후)
 * @param {ResolveOrigin} [origin]
 * @returns {{ id: string, ref: PostRef | null }}
 */
export function resolveLinkTarget(rawTarget, origin) {
  const target = stripContentRootPrefix(String(rawTarget || "").trim());

  if (target.startsWith("posts/")) {
    const id = normalizePostPath(target.replace(/^posts\//, ""));
    return { id, ref: getPostIndex().find((p) => p.id === id) || null };
  }

  if (target.includes("/")) {
    const id = normalizePostPath(target);
    return { id, ref: getPostIndex().find((p) => p.id === id) || null };
  }

  const ref = resolvePostRef(target, origin);
  return { id: ref ? ref.id : normalizePostPath(target), ref };
}

// 링크 출발지의 디렉토리를 id 와 같은 슬러그 규칙으로 환산한다.
// posts 밖의 파일(pages/projects 등)이면 "" 를 돌려 루트로 취급한다.
function originDirId(origin) {
  if (origin?.fromId) {
    // id 만으로는 폴더글(chunk-batch/index.md -> "chunk-batch")과 루트글
    // (chunk-batch.md -> "chunk-batch")을 구분할 수 없으므로 인덱스에서 찾는다.
    const self = getPostIndex().find((p) => p.id === origin.fromId);
    if (self) return self.dirId;
    const lastSlash = origin.fromId.lastIndexOf("/");
    return lastSlash === -1 ? "" : origin.fromId.slice(0, lastSlash);
  }

  if (!origin?.fromFile) return "";

  const normalizedPath = origin.fromFile.split(path.sep).join("/");
  const marker = "/src/content/posts/";
  const at = normalizedPath.lastIndexOf(marker);
  if (at === -1) return "";

  const relative = normalizedPath.slice(at + marker.length);
  const lastSlash = relative.lastIndexOf("/");
  return lastSlash === -1 ? "" : toPostId(relative.slice(0, lastSlash));
}
