---
title: 생성형 AI 지식 관리체계 구축 및 RAG 시스템 연동 PoC
description: 생성형 AI와 워크플로우 자동화를 활용하여 추가 인력 없이 조직 차원의 지식 베이스를 구축하고 RAG 시스템까지 연동한 PoC 프로젝트
date: 2025-06-01
categories:
  - n8n
  - AI
  - Flink CDC
  - Langchain
  - Qdrant
  - PostgreSQL
status: "Completed"
featured: true
draft: false
hideTOC: false
---

## 프로젝트 개요

체계적인 지식 관리가 이루어지지 않는 환경에서 생성형 AI를 이용해 **추가적인 인적/물적 자원의 투입 없이** 지식을 생성/관리하고, 향후 RAG 시스템 활용을 위한 방안을 제시하기 위해 기획하고 PoC를 진행한 프로젝트입니다.

이전에 구축한 [Obsidian 기반 클라이언트 Wiki](/posts/obsidian-wiki)와 [제로 리소스 지식 베이스](/posts/zero-resource-knowledge-base-1)의 연장선에서, "사람이 없다면 사람을 대체할 수 있는 기술을 활용하자"는 아이디어에서 출발했습니다.

## 배경: Wiki를 만들었는데 왜 또?

Obsidian으로 Wiki를 구성하고 운영하면서 가장 큰 문제는 **"일률적이지 못한 양식과 문서의 품질"** 이었습니다.

- 작성자의 성향에 따라 문체와 용어가 통일되지 않음
- 소수의 지식으로 편향되는 현상
- 문서 작성을 위한 재가공 공수가 과도하게 소요

테크니컬 라이터가 없는 조직에서 이 문제를 해결할 수 있는 현실적인 방법은 **생성형 AI를 테크니컬 라이터로 활용**하는 것이었습니다.

## 시스템 구성

### 워크플로우 자동화 (n8n)

Self-hosted n8n을 이용하여 세 가지 핵심 워크플로우를 구현했습니다:

1. **실시간 데이터 수집**: Webhook 기반 데이터 수신 및 분류
2. **AI Agent를 이용한 가공**: 프롬프트 기반 마크다운 문서 자동 생성
3. **AI 서비스 제공**: 축적된 지식을 기반으로 한 질의응답 서비스

n8n을 선택한 이유는 대부분의 노드가 사전 정의되어 **간단한 설정만으로 사용 가능**했고, 하나의 컨테이너로 웹페이지와 노드 사용이 모두 가능하여 Self-hosting 시 최소한의 자원으로 운영할 수 있었기 때문입니다.

### 데이터 파이프라인 (Flink CDC + Iceberg)

데이터 소스별 증분(CDC) 파이프라인을 구현하여 원천 지식이 변경될 때마다 자동으로 지식 베이스에 반영되도록 했습니다.

- **Flink CDC**: 데이터 소스의 변경 감지
- **Apache Iceberg**: 데이터 레이크 테이블 포맷
- **MinIO**: 오브젝트 스토리지

### 지식 저장 및 검색

실시간 수집되는 지식을 PostgreSQL의 **JSONB 컬럼**을 이용해 규격화된 데이터로 저장하고, 의미론적 검색을 위해 벡터 DB를 활용했습니다.

- **Langchain**: LLM 프레임워크로 문서 처리 파이프라인 구성
- **Qdrant**: 벡터 DB를 이용한 의미론적 지식 검색
- **Redis**: Semantic Search 캐싱을 통한 서비스 속도 및 토큰 사용 최적화

### 지식 문서 생성 자동화

AI Agent와 Gitlab MCP를 연동하여 마크다운 형식의 지식 문서를 자동으로 생성하고, Obsidian을 통해 지식을 배포/보정하는 프로세스를 구축했습니다.

```
원천 지식(질의응답, 문서 등) → CDC 파이프라인 → AI Agent 가공 →
마크다운 문서 생성 → Gitlab 커밋 → Obsidian Wiki 배포
```

## 주요 성과

- 기존 인력이 **최소한의 학습**으로 워크플로우를 구성/관리할 수 있는 환경 구성
- 질의응답, 문서 등의 원천 지식 → 지식베이스 **실시간 데이터 파이프라인** 설계 및 서비스 활용 가능성 증명
- 향후 RAG 시스템을 통한 조직 내 지식 검색 서비스의 기반 마련

## 관련 글

이 프로젝트의 배경과 과정을 블로그에 연재하고 있습니다:

- [Obsidian으로 구성해본 폐쇄망 환경에서의 클라이언트 중심 Wiki 페이지!](/posts/obsidian-wiki)
- [생성형 AI를 이용해 제로 리소스 지식 베이스 구축하기 - (1) 아이디어와 계획](/posts/zero-resource-knowledge-base-1)

## 활용 기술

- **Workflow**: n8n (Workflow Automation)
- **Data Pipeline**: Flink CDC, Apache Iceberg, MinIO
- **AI/LLM**: Claude (AI Agent), Langchain (LLM Framework)
- **Database**: PostgreSQL, Qdrant (Vector DB), Redis (Cache)
- **Knowledge**: Gitlab (CI/CD), Obsidian (Markdown Editor/Reader)
