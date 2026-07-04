// content-sources.config.mjs
//
// private 문서 저장소(document-repo)에서 이 사이트로 콘텐츠를 가져오는 설정.
// 실제 복사 로직은 scripts/import-content.js 에 있음.
//
// 배포 흐름 요약:
//   document-repo (private, Obsidian 볼트)
//     └─ publish/blog/gitio/{posts,projects,docs}/   ← 이 사이트의 "공개 후보"
//   → import-content 가 publish:true 문서만 골라 src/content/ 로 복사
//   → 나머지 빌드 스크립트 + astro build
//
// 두 단계 선별:
//   ① 디렉토리 opt-in : 아래 mappings 에 등록된 디렉토리만 배포 후보
//   ② 문서 완료 여부   : 프론트매터에 publish: true 인 문서만 (prod 빌드 기준)

export default {
  // document-repo 클론 위치.
  //  - CI: deploy.yml 이 ./document-repo 로 checkout 하고 DOCS_LOCAL_PATH 를 지정
  //  - 로컬: 이 저장소 옆의 형제 디렉토리(../document-repo)를 기본값으로 사용
  localPath: process.env.DOCS_LOCAL_PATH || '../document-repo',

  // document-repo 안에서 이 사이트의 공개 콘텐츠가 위치하는 루트.
  // (개인 볼트 전체 중 이 하위 트리만 사이트 대상)
  contentRoot: 'publish/blog/gitio',

  // 디렉토리 화이트리스트. `from` 은 contentRoot 기준 상대 경로,
  // `to` 는 Astro 콘텐츠 컬렉션 이름(src/content/<to>).
  // 여기에 없는 디렉토리는 어떤 경우에도 사이트로 나가지 않음.
  mappings: [
    { from: 'posts', to: 'posts' },
    { from: 'projects', to: 'projects' },
    { from: 'docs', to: 'docs' },
  ],

  // 문서 완료/공개 신호로 사용할 프론트매터 필드 이름.
  // prod 빌드에서는 이 값이 true 인 마크다운만 복사한다.
  publishField: 'publish',
};
