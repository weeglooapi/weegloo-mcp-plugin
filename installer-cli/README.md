# weegloo

Weegloo MCP 플러그인을 Cursor IDE 또는 Claude Code에 대화형으로 설치하는 CLI 도구입니다.

## 사용법

```bash
npx weegloo@latest
```

또는 전역 설치 후:

```bash
npm install -g weegloo
weegloo
```

### ref(브랜치/태그) 오버라이드

Skills와 Rules 파일은 npm dist-tag과 1:1로 대응되는 GitHub 브랜치/태그에서 실시간으로 다운로드됩니다.

| npx 명령 | `pluginRef` 값 | 가져오는 GitHub ref |
|---|---|---|
| `npx weegloo@latest` | `"latest"` | branch `latest` |
| `npx weegloo@beta` | `"beta"` | branch `beta` |
| `npx weegloo@0.1.0` | `"v0.1.0"` | tag `v0.1.0` |

특정 브랜치에서 직접 받고 싶다면:

```bash
# CLI 인자
npx weegloo@latest --ref some-branch

# 환경변수
WEEGLOO_REF=some-branch npx weegloo@latest
```

## 설치 과정

CLI를 실행하면 다음 항목을 순서대로 물어봅니다:

1. **IDE 선택** — Cursor / Claude Code / Both
2. **Personal Access Token** — Weegloo 콘솔에서 발급
3. **MCP 서버 그룹** — `default` / `core` / `extra` / `all`
4. **Skills 선택** — 설치할 스킬 선택 (다중 선택)
5. **Rules 선택** — 설치할 규칙 선택 (다중 선택)

## 설치 내용

### Cursor
| 항목 | 경로 |
|------|------|
| MCP 서버 설정 | `~/.cursor/mcp.json` |
| Skills | `~/.cursor/skills/<skill-name>/` |
| Rules | `<현재 프로젝트>/.cursor/rules/<rule-name>.mdc` |

### Claude Code
| 항목 | 경로 |
|------|------|
| MCP 서버 설정 | `<현재 디렉토리>/.mcp.json` |
| Skills | `~/.claude/skills/<skill-name>/` |
| Rules | `<현재 디렉토리>/.claude/rules/<rule-name>.mdc` |

## 포함된 Skills

- **weegloo-create-content-type** — ContentType 리소스 생성 가이드
- **weegloo-web-hosting** — 웹 프로젝트 배포 및 호스팅 가이드

## 포함된 Rules

- **weegloo-global-rules** — MCP 전역 규칙 (모든 MCP 작업에 적용)
- **weegloo-web-hosting-rules** — 웹 호스팅 전용 규칙

## 요구사항

- Node.js >= 18
- Weegloo Personal Access Token ([콘솔에서 발급](https://console.weegloo.com))

## 관련 링크

- [Weegloo 공식 문서](https://docs.weegloo.com/mcp-server/)
- [GitHub Repository](https://github.com/weeglooapi/weegloo-mcp-plugin)
