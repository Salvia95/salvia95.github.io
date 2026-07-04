# 문서 저장소 분리 & 선택 배포 가이드

이 사이트는 **테마·코드(공개 레포)** 와 **문서(private `document-repo`)** 를 분리해서 운영합니다.
private 저장소에서 모든 문서를 작업하고, 그중 **공개 디렉토리의 완료된(`publish: true`) 문서만** 배포됩니다.

```
document-repo (private, Obsidian 볼트)
└─ publish/blog/gitio/
   ├─ posts/       ─┐
   ├─ projects/     ├─ 공개 후보 디렉토리 (content-sources.config.mjs 의 mappings)
   └─ docs/        ─┘
        │
        │  import-content.js  (① 위 디렉토리만  ② 그중 publish:true 만)
        ▼
salvia95.github.io (public 코드 레포) → src/content/ → astro build → GitHub Pages
```

- `src/content/pages`(about·contact·privacy), `src/content/special`(home·404·목록) 은 **코드 레포에 유지**합니다.
- 선별 로직/모드는 `scripts/import-content.js`, 매핑은 `content-sources.config.mjs` 참고.

---

## 두 단계 선별 규칙

| 필터 | 기준 |
|---|---|
| ① 디렉토리 opt-in | `content-sources.config.mjs` 의 `mappings` 에 있는 디렉토리만 배포 후보 |
| ② 문서 완료 여부 | 프론트매터 `publish: true` 인 문서만 (prod 빌드 기준) |

- 미발행 문서 **및 그 문서만 참조하는 첨부 이미지**는 사이트로 나가지 않습니다(유출 방지).
- 로컬 `pnpm dev` 는 `--dev` 모드라 `publish` 여부와 무관하게 전부 미리보기합니다.

---

## 최초 1회 설정

### 1. 문서 이관 (시딩)

document-repo 를 코드 레포 옆(형제 폴더)에 클론:

```bash
cd ..
git clone https://github.com/Salvia95/document-repo.git
cd salvia95.github.io
```

현재 코드 레포에 있는 문서와 Obsidian 볼트를 문서 레포로 복사:

```bash
node scripts/seed-document-repo.mjs            # ../document-repo 로 복사
# 또는 위치 지정: node scripts/seed-document-repo.mjs --to /경로/document-repo
```

복사 결과 구조:

```
document-repo/
├─ .obsidian/                 # Obsidian 볼트 설정 (여기가 볼트 루트)
└─ publish/blog/gitio/
   ├─ posts/
   ├─ projects/
   └─ docs/
```

### 2. 공개할 문서에 `publish: true`

Obsidian 으로 `document-repo` 를 볼트로 열고, **공개하려는 문서**의 프론트매터에 추가:

```yaml
---
title: ...
publish: true
---
```

> `publish` 는 Obsidian 속성 UI 에서 체크박스로 쓰면 편합니다
> (`.obsidian/types.json` 에 `"publish": "checkbox"` 추가).

문서 레포 커밋 & 푸시:

```bash
cd ../document-repo
git add . && git commit -m "chore: 초기 문서 이관" && git push
```

### 3. 시크릿 등록 (2개)

각 시크릿은 **2단계**로 만든다: (A) Fine-grained PAT 발급 → (B) 대상 저장소의 Actions 시크릿으로 등록.
토큰은 "저장소 접근 열쇠", 시크릿은 "그 열쇠를 워크플로가 안전하게 꺼내 쓰도록 금고에 넣는 것".

| 시크릿 이름 | 등록 위치(저장소) | 토큰이 접근하는 대상 | 필요 권한 |
|---|---|---|---|
| `DOCS_REPO_TOKEN` | salvia95.github.io | document-repo | Contents: **Read** |
| `DISPATCH_TOKEN` | document-repo | salvia95.github.io | Contents: **Read/Write** |

> ⚠️ **"토큰이 접근하는 대상"과 "시크릿 등록 위치"는 서로 반대다.** 워크플로가 상대편 저장소에 접근하려고 자기 저장소에 열쇠를 보관하기 때문.

#### `DOCS_REPO_TOKEN` — 코드 레포가 document-repo 를 clone 할 때 사용

**(A) 토큰 발급**
1. GitHub 프로필 → **Settings → Developer settings**(`https://github.com/settings/tokens`)
2. **Personal access tokens → Fine-grained tokens → Generate new token**
3. 입력:
   - Token name: `docs-repo-read`
   - Resource owner: `Salvia95`
   - Expiration: 90일/1년 (만료 설정 권장)
   - Repository access: **Only select repositories** → `Salvia95/document-repo`
   - Permissions → Repository permissions → **Contents: Read-only** (Metadata Read-only 자동 포함, 나머지 No access)
4. **Generate token** → `github_pat_...` 값 **즉시 복사** (화면 벗어나면 다시 못 봄)

**(B) 시크릿 등록**
1. `https://github.com/Salvia95/salvia95.github.io/settings/secrets/actions`
2. **New repository secret** → Name `DOCS_REPO_TOKEN`, Secret 에 토큰 값 붙여넣기 → **Add secret**

#### `DISPATCH_TOKEN` — document-repo 가 코드 레포 배포를 트리거할 때 사용

**(A) 토큰 발급** — 위와 동일 경로에서 하나 더, **대상·권한만 다름**:
   - Token name: `site-dispatch`
   - Repository access: **Only select repositories** → `Salvia95/salvia95.github.io`
   - Permissions → **Contents: Read and write** (`repository_dispatch` 호출에 쓰기 권한 필요)
   - **Generate token** → 값 즉시 복사

**(B) 시크릿 등록**
1. `https://github.com/Salvia95/document-repo/settings/secrets/actions`
2. **New repository secret** → Name `DISPATCH_TOKEN`, Secret 에 토큰 값 → **Add secret**

> **주의**
> - 이름 오타 금지(`DOCS_REPO_TOKEN`, `DISPATCH_TOKEN`) — 틀리면 빈 값으로 실행돼 실패.
> - 토큰 값은 한 번만 표시됨. 놓치면 폐기 후 재발급.
> - 만료되면 배포 실패 → 같은 이름으로 재발급 후 시크릿 값만 **Update**.
> - 검증: 코드 레포 Actions 탭 → *Deploy to GitHub Pages* → *Run workflow* 로 수동 실행 시 document-repo checkout 단계가 통과하면 정상.

### 4. document-repo 자동 배포 워크플로 추가

`docs/content-separation/notify.yml` 을 document-repo 의 `.github/workflows/notify.yml` 로 복사 후 푸시:

```bash
mkdir -p ../document-repo/.github/workflows
cp docs/content-separation/notify.yml ../document-repo/.github/workflows/notify.yml
cd ../document-repo && git add . && git commit -m "ci: 사이트 배포 트리거" && git push
```

### 5. 코드 레포 cutover (기존 문서 추적 해제)

문서가 document-repo 로 안전하게 이관된 것을 확인한 뒤, 코드 레포에서 기존 문서·동기화 이미지를 Git 추적에서 제거합니다(작업 트리 파일은 유지됨):

```bash
git rm -r --cached src/content/posts src/content/projects src/content/docs
git rm -r --cached src/content/.obsidian
git rm -r --cached public/posts public/projects public/docs 2>/dev/null || true
git commit -m "refactor: 문서를 private document-repo 로 분리"
git push
```

> 이후 이 디렉토리들은 `.gitignore` 에 의해 무시되고, 빌드 시 문서 레포에서 채워집니다.

---

## 평소 워크플로우

1. Obsidian 으로 `document-repo` 볼트에서 문서 작성 (개인 노트는 `publish/` 밖에 두면 됨)
2. 공개 준비가 되면 문서에 `publish: true`
3. `document-repo` 에 push
4. `notify.yml` → 코드 레포 배포 자동 실행 → GitHub Pages 반영

## 로컬 미리보기

```bash
# document-repo 가 ../document-repo 에 클론되어 있으면 자동 인식
pnpm dev        # publish 여부 무관하게 전부 미리보기(--dev)

# 배포와 동일하게(=publish:true 만) 확인하려면
pnpm build && pnpm preview
```

문서 레포 위치가 다르면 `DOCS_LOCAL_PATH` 로 지정:

```bash
DOCS_LOCAL_PATH=/경로/document-repo pnpm dev
```

---

## 참고 / 트러블슈팅

- **아무 문서도 안 보임(prod)**: 해당 문서에 `publish: true` 가 있는지, `publish/blog/gitio/<컬렉션>/` 아래에 있는지 확인.
- **문서 레포 없이 빌드**: `import-content` 가 경고만 남기고 건너뜀 → 기존 `src/content` 로 빌드(오류 아님).
- **공개 디렉토리 추가/이름 변경**: `content-sources.config.mjs` 의 `mappings`·`contentRoot` 수정.
- **완료 신호 필드 변경**: `content-sources.config.mjs` 의 `publishField` 와 `src/content.config.ts` 스키마 동시 수정.
