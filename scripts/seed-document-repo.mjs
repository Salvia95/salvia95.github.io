#!/usr/bin/env node
//
// seed-document-repo.mjs  (일회성 마이그레이션 헬퍼)
//
// 현재 코드 레포의 src/content/{posts,projects,docs} 와 .obsidian 볼트를
// document-repo 의 올바른 위치로 복사한다. 이미 존재하는 파일은 덮어쓰지 않는다.
//
// 사용법:
//   node scripts/seed-document-repo.mjs --to /path/to/document-repo
//   node scripts/seed-document-repo.mjs            # content-sources.config 의 localPath 사용
//
// 실행 후 할 일:
//   1) document-repo 의 publish/blog/gitio/** 문서 중 공개할 것에 `publish: true` 추가
//   2) document-repo 에서 git add / commit / push
//   3) (코드 레포) 이관이 끝나면 cutover: git rm -r --cached src/content/{posts,projects,docs} 등

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function copyNoOverwrite(src, dest) {
  let stat;
  try {
    stat = await fs.stat(src);
  } catch {
    return { copied: 0, skipped: 0, missing: true };
  }
  let copied = 0;
  let skipped = 0;
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    for (const name of await fs.readdir(src)) {
      const r = await copyNoOverwrite(path.join(src, name), path.join(dest, name));
      copied += r.copied || 0;
      skipped += r.skipped || 0;
    }
  } else {
    try {
      await fs.access(dest);
      skipped++;
    } catch {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
      copied++;
    }
  }
  return { copied, skipped };
}

async function main() {
  const configUrl = pathToFileURL(path.join(projectRoot, 'content-sources.config.mjs')).href;
  const config = (await import(configUrl)).default;

  const toIdx = process.argv.indexOf('--to');
  const localPath = toIdx !== -1 && process.argv[toIdx + 1]
    ? path.resolve(process.argv[toIdx + 1])
    : path.resolve(projectRoot, config.localPath);

  const contentRoot = path.join(localPath, config.contentRoot);

  console.log(`📦 document-repo 시딩`);
  console.log(`   대상 볼트     : ${localPath}`);
  console.log(`   콘텐츠 루트   : ${contentRoot}`);
  console.log('');

  // 1) 콘텐츠 컬렉션 복사
  for (const mapping of config.mappings) {
    const src = path.join(projectRoot, 'src', 'content', mapping.to);
    const dest = path.join(contentRoot, mapping.from);
    const r = await copyNoOverwrite(src, dest);
    if (r.missing) {
      console.log(`   - ${mapping.to}: (소스 없음, 건너뜀)`);
    } else {
      console.log(`   - ${mapping.to} → ${config.contentRoot}/${mapping.from}: 복사 ${r.copied}, 유지 ${r.skipped}`);
    }
  }

  // 2) Obsidian 볼트 설정을 문서 레포 루트로 복사
  const obsSrc = path.join(projectRoot, 'src', 'content', '.obsidian');
  const obsDest = path.join(localPath, '.obsidian');
  const ro = await copyNoOverwrite(obsSrc, obsDest);
  if (!ro.missing) {
    console.log(`   - .obsidian → (볼트 루트): 복사 ${ro.copied}, 유지 ${ro.skipped}`);
  }

  console.log('');
  console.log('✅ 시딩 완료. 다음 단계:');
  console.log('   1) 공개할 문서 프론트매터에 `publish: true` 추가');
  console.log('   2) Obsidian 으로 이 폴더를 볼트로 열어 확인');
  console.log('   3) document-repo 에서 commit & push');
  console.log('   4) 코드 레포 cutover: docs/content-separation/README.md 참고');
}

main().catch((e) => {
  console.error('❌ 시딩 실패:', e);
  process.exit(1);
});
