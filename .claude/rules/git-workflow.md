---
description: Git workflow conventions for the weegloo-mcp-plugin repo
---

# Git workflow

- **PR은 항상 `develop` 브랜치를 타겟으로 올린다.** `latest`/`main` 등 다른 브랜치로 직접 PR을 열지 않는다.
  - `gh pr create` 시 반드시 `--base develop` 을 지정한다.
