#!/usr/bin/env node
//
// import-content.js
//
// private 문서 저장소(document-repo)에서 이 사이트로 콘텐츠를 선별 복사한다.
// 빌드 파이프라인의 가장 앞단에서 실행되며, 이후 sync-images.js 등이 이어진다.
//
// 사용법:
//   node scripts/import-content.js --prod   # publish:true 문서만 (배포용)
//   node scripts/import-content.js --dev    # 전부 복사 (로컬 미리보기용)
//   node scripts/import-content.js          # 플래그 없으면 --prod 로 간주(안전측)
//
// 소스(document-repo)가 없으면 아무것도 지우지 않고 조용히 건너뛴다.
// (문서 저장소를 아직 연결하지 않은 환경에서도 기존 콘텐츠로 빌드가 되도록)

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const isDevMode = process.argv.includes('--dev');
const MODE = isDevMode ? 'dev' : 'prod';

// 복사 대상 루트(기본 src/content). 테스트 시 CONTENT_DEST_ROOT 로 오버라이드 가능.
const destRoot = process.env.CONTENT_DEST_ROOT
  ? path.resolve(projectRoot, process.env.CONTENT_DEST_ROOT)
  : path.join(projectRoot, 'src', 'content');

const log = {
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

const MARKDOWN_RE = /\.mdx?$/i;

// --- 프론트매터 파싱 (간단 파서: publish 같은 boolean 만 신뢰성 있게 읽으면 됨) ---
function splitFrontmatter(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: content };
  const fmText = m[1];
  const body = m[2];
  const frontmatter = {};
  for (const rawLine of fmText.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    const km = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!km) continue;
    const key = km[1];
    let val = km[2].trim();
    if (val === '') { frontmatter[key] = ''; continue; }
    // 따옴표 제거
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val === 'true') frontmatter[key] = true;
    else if (val === 'false') frontmatter[key] = false;
    else frontmatter[key] = val;
  }
  return { frontmatter, body };
}

// --- 디렉토리 재귀 순회: sourceDir 기준 상대경로 목록 반환 ---
async function walk(dir, base = dir) {
  let out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return out;
    throw e;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(await walk(full, base));
    } else if (entry.isFile()) {
      out.push({ full, rel: path.relative(base, full) });
    }
  }
  return out;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function rmDirContents(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  for (const entry of entries) {
    await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
  }
}

// 자산(이미지 등)이 "발행된 문서에서 도달 가능한지" 판단.
//  1) 발행된 마크다운과 같은 폴더에 있으면(폴더형 포스트) 복사
//  2) 파일명이 발행된 문서 본문/프론트매터에 등장하면 복사
//  그 외에는 복사하지 않는다 → 미발행 문서의 첨부가 public 으로 새지 않음.
function isAssetReachable(assetRel, includedDirs, includedRawText) {
  const dir = path.dirname(assetRel);
  if (includedDirs.has(dir)) return true;
  const base = path.basename(assetRel);
  return includedRawText.includes(base);
}

async function importMapping(sourceRoot, mapping) {
  const sourceDir = path.join(sourceRoot, mapping.from);
  const targetDir = path.join(destRoot, mapping.to);

  // 대상 컬렉션 디렉토리는 항상 존재하도록(빈 경우에도 astro glob base 유지)
  await ensureDir(targetDir);

  const files = await walk(sourceDir);
  if (files.length === 0) {
    // 소스 디렉토리가 비었으면 대상도 비운다(stale 제거)
    await rmDirContents(targetDir);
    return { docs: 0, skipped: 0, assets: 0 };
  }

  // 1) 마크다운 판정 → 포함/제외 결정
  const markdown = files.filter((f) => MARKDOWN_RE.test(f.rel));
  const included = [];
  let skipped = 0;
  const rawByFile = new Map();

  for (const f of markdown) {
    const content = await fs.readFile(f.full, 'utf8');
    rawByFile.set(f.rel, content);
    if (MODE === 'dev') {
      included.push(f);
      continue;
    }
    const { frontmatter } = splitFrontmatter(content);
    if (frontmatter.publish === true) included.push(f);
    else skipped++;
  }

  const includedDirs = new Set(included.map((f) => path.dirname(f.rel)));
  const includedRawText = included.map((f) => rawByFile.get(f.rel)).join('\n');

  // 2) 대상 디렉토리 초기화 후 새로 채움
  await rmDirContents(targetDir);

  let docsCopied = 0;
  let assetsCopied = 0;

  for (const f of files) {
    const isMd = MARKDOWN_RE.test(f.rel);
    let copyIt = false;
    if (isMd) {
      copyIt = included.some((i) => i.rel === f.rel);
    } else {
      copyIt = isAssetReachable(f.rel, includedDirs, includedRawText);
    }
    if (!copyIt) continue;

    const dest = path.join(targetDir, f.rel);
    await ensureDir(path.dirname(dest));
    await fs.copyFile(f.full, dest);
    if (isMd) docsCopied++;
    else assetsCopied++;
  }

  return { docs: docsCopied, skipped, assets: assetsCopied };
}

async function loadConfig() {
  const configUrl = pathToFileURL(path.join(projectRoot, 'content-sources.config.mjs')).href;
  const mod = await import(configUrl);
  return mod.default;
}

async function main() {
  const config = await loadConfig();
  const localPath = path.resolve(projectRoot, config.localPath);
  const sourceRoot = path.join(localPath, config.contentRoot);

  // 대상 컬렉션 디렉토리는 소스 유무와 무관하게 항상 보장(빌드 안전)
  for (const mapping of config.mappings) {
    await ensureDir(path.join(destRoot, mapping.to));
  }

  // 소스가 없으면 건너뜀 — 기존 src/content 를 그대로 사용
  try {
    await fs.access(sourceRoot);
  } catch {
    log.warn(`⏭️  문서 저장소를 찾지 못해 import 를 건너뜁니다: ${sourceRoot}`);
    log.warn('    (DOCS_LOCAL_PATH 를 지정하거나 ../document-repo 에 클론하세요. 기존 콘텐츠로 계속 빌드합니다.)');
    return;
  }

  log.info(`📥 문서 import 시작 [${MODE}] ← ${sourceRoot}`);
  let totalDocs = 0;
  let totalSkipped = 0;
  let totalAssets = 0;

  for (const mapping of config.mappings) {
    const r = await importMapping(sourceRoot, mapping);
    log.info(`   ${mapping.from} → src/content/${mapping.to}: 문서 ${r.docs}개, 자산 ${r.assets}개` +
      (r.skipped > 0 ? `, 미발행 제외 ${r.skipped}개` : ''));
    totalDocs += r.docs;
    totalSkipped += r.skipped;
    totalAssets += r.assets;
  }

  log.info(`🎉 import 완료: 문서 ${totalDocs}개 / 자산 ${totalAssets}개` +
    (MODE === 'prod' && totalSkipped > 0 ? ` (미발행 ${totalSkipped}개 제외)` : ''));
}

main().catch((err) => {
  log.error('❌ import-content 실패:', err);
  process.exit(1);
});
