# New Branch!

양정훈의 기술 블로그. 백엔드 시스템 설계와 운영 과정에서 겪은 문제 해결기와 회고를 기록합니다.

- 사이트: https://salvia95.github.io
- 소개: https://salvia95.github.io/about

## Tech Stack

[![Astro](https://img.shields.io/badge/Astro-5-FF5D01?logo=astro&logoColor=white)](https://astro.build/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

[Astro Modular](https://github.com/davidvkimball/astro-modular) 테마를 기반으로 커스터마이징한 블로그입니다.

## 로컬 개발

```bash
pnpm install
pnpm dev     # http://localhost:5000
pnpm build   # 정적 빌드 (dist/)
```

## 콘텐츠 구조

글·프로젝트·문서(posts/projects/docs)는 **별도 private 저장소 `document-repo`** 에서 관리하며,
그중 `publish: true` 로 표시된 문서만 빌드 시 이 저장소로 가져와 배포합니다.
자세한 설정·워크플로우는 [`docs/content-separation/README.md`](docs/content-separation/README.md) 참고.

- `document-repo/publish/blog/gitio/{posts,projects,docs}/` - 글·프로젝트·문서 (private)
- `src/content/pages/` - 소개, 연락처 등 고정 페이지 (코드 레포 유지)
- `src/content/special/` - 홈/404/목록 페이지 (코드 레포 유지)
- `content-sources.config.mjs` - 문서 저장소 매핑·선별 설정
- `src/config.ts` - 사이트 전역 설정

## 배포

- `main` 브랜치 푸시(테마/코드 변경) 또는 `document-repo` 푸시(문서 변경) 시
  GitHub Actions(`.github/workflows/deploy.yml`)가 자동으로 빌드 후 GitHub Pages에 배포합니다.
- 문서 저장소 푸시 → 코드 레포 배포 트리거는 `repository_dispatch(content-updated)` 로 연결됩니다.

## License

[MIT License](LICENSE) - [Astro Modular](https://github.com/davidvkimball/astro-modular) 원 저작자(David V. Kimball)에게 저작권이 있습니다.
