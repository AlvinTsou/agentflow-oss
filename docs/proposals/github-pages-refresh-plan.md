# Proposal: GitHub Pages Refresh Plan

This document plans a refresh of the public GitHub Pages presence for
`agentflow-oss`.

The goal is to explain what the project is, what has already shipped, how the
workflow works, and what is coming next. The page should be useful for
maintainers, contributors, and evaluators who need a fast, accurate view of the
project without reading the entire repository.

## 1. Goals

- Present `agentflow-oss` as a maintainer workflow engine for repeatable
  AI-assisted coding, review, quality gates, provider routing, sprint state,
  and carry-over workflows.
- Explain current progress with source-backed claims, not aspirational wording.
- Show how a sprint works from recipe selection to persisted artifacts,
  review, fixes, readiness, and resume.
- Make the middleman scope clear: it is an internal workflow provider routing
  layer, not an external proxy or team dashboard.
- Publish a future-facing roadmap that separates active work from longer-term
  ideas.
- Support five languages:
  - `en` - English
  - `zh-TW` - Traditional Chinese
  - `zh-CN` - Simplified Chinese
  - `ja` - Japanese
  - `ko` - Korean

## 2. Current Project Progress

Status snapshot as of 2026-06-10:

- The repository has been prepared for public OSS maintenance with Apache-2.0
  licensing, contribution docs, security policy, issue templates, PR template,
  CI, and public roadmap.
- Core CLI workflows are available: `init`, `run`, `resume`, `status`,
  `replay`, `approve`, `request-changes`, `force-pass`, and `resolve`.
- Built-in recipes include:
  - `mini` for installation and provider self-tests.
  - `research` for structured research workflows.
  - `sdd` for 9-step spec-driven development.
  - `release-readiness` for release audit workflows.
- Middleman routing has shipped as an internal orchestration layer:
  provider capability registry, capability validation, route metadata,
  security profiles, and route audit events.
- Provider support includes Claude, Codex, OpenAI-compatible gateways,
  OpenRouter, and Gemini.
- Offline tests cover middleman routing, contract gates, readiness parsing,
  best-so-far behavior, research recipe behavior, and release-readiness recipe
  loading.
- The current Week 3 maintenance focus is release-readiness hardening, fixture
  coverage, custom redaction patterns, docs sync, and `v0.2.0` release notes.

## 3. Page Structure

Recommended URL structure:

```text
/
/en/
/zh-tw/
/zh-cn/
/ja/
/ko/
/docs/
/docs/architecture/
/docs/cli/
/docs/provider-routing/
/docs/recipes/
/docs/roadmap/
```

Recommended first-pass implementation:

- Use GitHub Pages with static Markdown or simple generated HTML.
- Keep English as the source content for release accuracy.
- Add localized landing pages first, then localize deep docs incrementally.
- Do not add a large documentation framework until the content model is stable.

Possible later implementation:

- Move to VitePress, Astro, or Docusaurus only if navigation, search, or
  versioned docs become painful with static Markdown.

## 4. Homepage Content Blocks

The homepage should be short and factual.

1. Hero
   - Project name.
   - One-sentence positioning.
   - Primary call to action: read quick start.
   - Secondary call to action: view roadmap.

2. Project Progress
   - Public repo baseline is complete.
   - CI and offline tests are active.
   - Core recipes and provider routing are implemented.
   - Release-readiness and custom redaction work are current priorities.

3. How It Works
   - Choose a recipe.
   - Initialize or run a sprint.
   - Middleman routes provider calls and applies policy.
   - Quality loop produces, reviews, and fixes artifacts.
   - Readiness summarizes blocking/deferred/nit follow-ups.
   - Resume continues from persisted state.

4. Shipped Features
   - CLI-first sprint engine.
   - Recipe system.
   - Quality loop and review scoring.
   - Contract gates.
   - Middleman provider routing.
   - Route audit metadata.
   - Security profiles.
   - Sprint state and artifacts.
   - Feedback ingestion.
   - Release-readiness recipe.

5. Future Features
   - Release-readiness fixture coverage.
   - Custom secret redaction patterns.
   - PR review recipe.
   - Security review recipe.
   - Better status CLI layout.
   - Route audit replay formatting.
   - Web UI after CLI architecture remains stable.

## 5. Multilingual Strategy

### Locale Rules

- Use `en` as the canonical source.
- Use BCP-47 locale paths:
  - `/en/`
  - `/zh-tw/`
  - `/zh-cn/`
  - `/ja/`
  - `/ko/`
- Keep technical terms in English when they name code or project concepts:
  `Middleman`, `recipe`, `sprint`, `quality loop`, `contract gate`,
  `readiness`, `provider`, `route metadata`, `CLI`.
- Translate explanatory prose, page titles, and navigation labels.
- Avoid claims that imply autonomous coding without maintainer review.
- Every translation update should include a source date, for example
  `Source: en homepage, 2026-06-10`.

### Suggested Navigation Labels

| Page | en | zh-TW | zh-CN | ja | ko |
| --- | --- | --- | --- | --- | --- |
| Home | Home | 首頁 | 首页 | ホーム | 홈 |
| Quick Start | Quick Start | 快速開始 | 快速开始 | クイックスタート | 빠른 시작 |
| How It Works | How It Works | 運作方式 | 工作方式 | 仕組み | 작동 방식 |
| Progress | Progress | 專案進度 | 项目进展 | 進捗 | 진행 상황 |
| Roadmap | Roadmap | Roadmap | Roadmap | Roadmap | Roadmap |
| Docs | Docs | 文件 | 文档 | ドキュメント | 문서 |
| GitHub | GitHub | GitHub | GitHub | GitHub | GitHub |

## 6. Landing Page Copy Drafts

These are first-pass localized drafts for the homepage. They should be reviewed
before publication, but they give the site enough shape to start implementation.

### English (`en`)

**Headline**

agentflow-oss

**Positioning**

A CLI-first workflow engine for repeatable AI-assisted coding, review, quality
gates, provider routing, sprint state, and carry-over workflows.

**Progress**

The public repository now has its OSS baseline in place: CI, issue templates,
security policy, contribution docs, CLI reference, architecture docs, and an
active roadmap. The core engine runs sprint recipes, persists artifacts and
state, applies quality loops, supports resume, and records readiness signals.
The middleman layer now validates provider capabilities, records route metadata,
and applies security profiles before provider calls.

**How it works**

Choose a recipe, initialize a sprint, and let AgentFlow run each step through a
produce-review-fix loop. The middleman routes provider requests and applies
policy checks. Artifacts, state, events, route decisions, and carry-over items
are persisted so maintainers can review, resume, or replay work.

**What is next**

Current work focuses on release-readiness testing, fixture coverage, custom
redaction patterns, roadmap sync, and `v0.2.0` release notes. Future work may
add PR review workflows, security review recipes, route audit replay formatting,
status CLI improvements, and a web UI after the CLI architecture stabilizes.

### Traditional Chinese (`zh-TW`)

**Headline**

agentflow-oss

**Positioning**

一個 CLI-first 的 workflow engine，用來讓 AI-assisted coding、review、
quality gates、provider routing、sprint state 與 carry-over workflows
可以重複、可追蹤、可維護。

**Progress**

公開 repository 的 OSS baseline 已經到位：CI、issue templates、security
policy、contribution docs、CLI reference、architecture docs 與 active
roadmap 都已建立。Core engine 已能執行 sprint recipes、保存 artifacts
與 state、套用 quality loops、支援 resume，並產生 readiness signals。
Middleman layer 已支援 provider capability validation、route metadata
記錄，以及 provider calls 前的 security profiles。

**How it works**

選擇 recipe、初始化 sprint，AgentFlow 會讓每個 step 進入
produce-review-fix loop。Middleman 會負責 provider request routing 與
policy checks。Artifacts、state、events、route decisions 與 carry-over
items 都會被保存，讓 maintainer 可以 review、resume 或 replay。

**What is next**

目前工作重點是 release-readiness tests、fixture coverage、custom redaction
patterns、roadmap sync 與 `v0.2.0` release notes。後續可能加入 PR review
workflow、security review recipe、route audit replay formatting、status CLI
改善，以及在 CLI architecture 穩定後推出 web UI。

### Simplified Chinese (`zh-CN`)

**Headline**

agentflow-oss

**Positioning**

一个 CLI-first 的 workflow engine，用于让 AI-assisted coding、review、
quality gates、provider routing、sprint state 和 carry-over workflows
变得可重复、可追踪、可维护。

**Progress**

公开 repository 的 OSS baseline 已经到位：CI、issue templates、security
policy、contribution docs、CLI reference、architecture docs 和 active
roadmap 都已建立。Core engine 已能运行 sprint recipes、保存 artifacts
和 state、应用 quality loops、支持 resume，并生成 readiness signals。
Middleman layer 已支持 provider capability validation、route metadata
记录，以及 provider calls 前的 security profiles。

**How it works**

选择 recipe、初始化 sprint，AgentFlow 会让每个 step 进入
produce-review-fix loop。Middleman 负责 provider request routing 和
policy checks。Artifacts、state、events、route decisions 和 carry-over
items 都会被保存，方便 maintainer review、resume 或 replay。

**What is next**

当前重点是 release-readiness tests、fixture coverage、custom redaction
patterns、roadmap sync 和 `v0.2.0` release notes。后续可能加入 PR review
workflow、security review recipe、route audit replay formatting、status CLI
改进，以及在 CLI architecture 稳定后推出 web UI。

### Japanese (`ja`)

**Headline**

agentflow-oss

**Positioning**

AI-assisted coding、review、quality gates、provider routing、sprint state、
carry-over workflows を、再現可能で追跡しやすい形にする CLI-first の
workflow engine。

**Progress**

公開 repository の OSS baseline は整備済みです。CI、issue templates、
security policy、contribution docs、CLI reference、architecture docs、
active roadmap が用意されています。Core engine は sprint recipes の実行、
artifacts と state の保存、quality loops、resume、readiness signals を
サポートしています。Middleman layer は provider capability validation、
route metadata の記録、provider calls 前の security profiles を提供します。

**How it works**

recipe を選び、sprint を初期化すると、AgentFlow は各 step を
produce-review-fix loop で処理します。Middleman は provider request
routing と policy checks を担当します。Artifacts、state、events、
route decisions、carry-over items は保存されるため、maintainer は review、
resume、replay を行えます。

**What is next**

現在の重点は release-readiness tests、fixture coverage、custom redaction
patterns、roadmap sync、`v0.2.0` release notes です。今後は PR review
workflow、security review recipe、route audit replay formatting、status CLI
改善、CLI architecture 安定後の web UI が候補です。

### Korean (`ko`)

**Headline**

agentflow-oss

**Positioning**

AI-assisted coding, review, quality gates, provider routing, sprint state,
carry-over workflows 를 반복 가능하고 추적 가능한 방식으로 운영하기 위한
CLI-first workflow engine.

**Progress**

공개 repository 의 OSS baseline 은 준비되어 있습니다. CI, issue templates,
security policy, contribution docs, CLI reference, architecture docs,
active roadmap 이 갖추어졌습니다. Core engine 은 sprint recipes 실행,
artifacts 와 state 저장, quality loops, resume, readiness signals 를
지원합니다. Middleman layer 는 provider capability validation, route metadata
기록, provider calls 전 security profiles 적용을 제공합니다.

**How it works**

recipe 를 선택하고 sprint 를 초기화하면 AgentFlow 는 각 step 을
produce-review-fix loop 로 처리합니다. Middleman 은 provider request routing
과 policy checks 를 담당합니다. Artifacts, state, events, route decisions,
carry-over items 가 저장되므로 maintainer 는 review, resume, replay 를 할 수
있습니다.

**What is next**

현재 초점은 release-readiness tests, fixture coverage, custom redaction
patterns, roadmap sync, `v0.2.0` release notes 입니다. 이후에는 PR review
workflow, security review recipe, route audit replay formatting, status CLI
개선, CLI architecture 안정화 이후의 web UI 가 후보입니다.

## 7. Implementation Plan

### Phase 1 - Content Refresh

- Add a simple GitHub Pages homepage with localized landing page content.
- Add locale switch links.
- Link to existing README, CLI reference, architecture, provider routing,
  roadmap, and maintenance plans.
- Keep the site static and low-maintenance.

Validation:

```bash
git diff --check
pnpm run test:secret-scan
```

### Phase 2 - Documentation Navigation

- Add a docs index page.
- Group docs into:
  - Getting Started
  - Concepts
  - CLI Reference
  - Recipes
  - Provider Routing
  - Roadmap
- Keep deep technical docs in English first.
- Add localized summaries for the highest-traffic pages.

Validation:

```bash
pnpm run test
git diff --check
```

### Phase 3 - Progress And Roadmap Pages

- Add a progress page backed by `docs/maintenance-plans.md` and maintenance
  logs.
- Add a roadmap page that separates:
  - shipped
  - active
  - planned
  - future
- Add a release status block for `v0.2.0`.

Validation:

```bash
pnpm run test:secret-scan
git diff --check
```

### Phase 4 - Site Tooling Decision

Only add a site framework if static Markdown becomes limiting.

Decision criteria:

- Search is needed.
- Localized navigation becomes hard to maintain.
- Versioned docs are needed.
- Styling or examples require reusable components.

Candidate tools:

- VitePress for documentation-first static pages.
- Astro for a more flexible marketing and docs hybrid.
- Docusaurus if versioned docs and i18n workflows become central.

## 8. Acceptance Criteria

- The homepage explains the project in under one minute.
- Users can find quick start, CLI reference, provider routing, architecture,
  roadmap, and GitHub repository links.
- Five locale entry points exist: `en`, `zh-TW`, `zh-CN`, `ja`, `ko`.
- Project progress is accurate and dated.
- Future features are clearly marked as planned or future, not shipped.
- The middleman boundary is clear.
- No private project details or secrets are included.
- `pnpm run test:secret-scan` passes before publication.

## 9. Risks

- Translation drift: mitigated by keeping English canonical and adding source
  dates to localized pages.
- Overclaiming roadmap features: mitigated by using shipped/active/planned/future
  labels.
- Site tooling overhead: mitigated by starting with static pages.
- Maintenance burden: mitigated by localizing the homepage first and deep docs
  only when they become stable.

## 10. Suggested First Commit

```text
docs: plan multilingual github pages refresh
```
