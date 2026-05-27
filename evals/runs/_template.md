# Run: YYYY-MM-DD-<label>

Copy this file to `runs/YYYY-MM-DD-<label>.md` and fill in. Don't edit this template.

## Meta

- **Date:** YYYY-MM-DD
- **Run label:** baseline / after-description-rewrite / after-ambient-slimdown / ...
- **Plugin commit SHA:** `<git rev-parse --short HEAD>`
- **Agent:** Claude Code <version> / Cursor <version>
- **Scorer:** <name>
- **Session policy:** new conversation per prompt; no skill preloading; max 5 turns per prompt
- **Notes:** any setup details that future-you will want

---

## Per-prompt scoring

Each prompt: 3 runs (R1/R2/R3). Score each run on D1-D4. Take the **median** for the prompt total.

### P1 — 회원제 게시판

| Run | D1 skill | D2 API/arch | D3 first-shot | D4 anti-pattern | Subtotal /8 |
|-----|----------|-------------|---------------|-----------------|-------------|
| R1  |          |             |               |                 |             |
| R2  |          |             |               |                 |             |
| R3  |          |             |               |                 |             |

**Median per dim:** D1=__, D2=__, D3=__, D4=__. **Prompt median total: __ / 8**

**Observations:**
- Skills invoked (per run):
- Notable misses:
- Notable wins:

---

### P2 — 블로그 ContentType

| Run | D1 | D2 | D3 | D4 | Subtotal /8 |
|-----|----|----|----|----|-------------|
| R1  |    |    |    |    |             |
| R2  |    |    |    |    |             |
| R3  |    |    |    |    |             |

**Median:** D1=__, D2=__, D3=__, D4=__. **Total: __ / 8**

**Observations:**
-

---

### P3 — 포트폴리오 ContentType

| Run | D1 | D2 | D3 | D4 | Subtotal /8 |
|-----|----|----|----|----|-------------|
| R1  |    |    |    |    |             |
| R2  |    |    |    |    |             |
| R3  |    |    |    |    |             |

**Median:** D1=__, D2=__, D3=__, D4=__. **Total: __ / 8**

**Observations:**
-

---

### P4 — 공개 사이트용 토큰

| Run | D1 | D2 | D3 | D4 | Subtotal /8 |
|-----|----|----|----|----|-------------|
| R1  |    |    |    |    |             |
| R2  |    |    |    |    |             |
| R3  |    |    |    |    |             |

**Median:** D1=__, D2=__, D3=__, D4=__. **Total: __ / 8**

**Observations:**
-

---

### P5 — WebHosting 배포

| Run | D1 | D2 | D3 | D4 | Subtotal /8 |
|-----|----|----|----|----|-------------|
| R1  |    |    |    |    |             |
| R2  |    |    |    |    |             |
| R3  |    |    |    |    |             |

**Median:** D1=__, D2=__, D3=__, D4=__. **Total: __ / 8**

**Observations:**
-

---

### P6 — 다국어 콘텐츠 생성

| Run | D1 | D2 | D3 | D4 | Subtotal /8 |
|-----|----|----|----|----|-------------|
| R1  |    |    |    |    |             |
| R2  |    |    |    |    |             |
| R3  |    |    |    |    |             |

**Median:** D1=__, D2=__, D3=__, D4=__. **Total: __ / 8**

**Observations:**
-

---

### P7 — Media 안 보임 디버그

| Run | D1 | D2 | D3 | D4 | Subtotal /8 |
|-----|----|----|----|----|-------------|
| R1  |    |    |    |    |             |
| R2  |    |    |    |    |             |
| R3  |    |    |    |    |             |

**Median:** D1=__, D2=__, D3=__, D4=__. **Total: __ / 8**

**Observations:**
-

---

### P8 — 회원 인증 (Google 로그인)

| Run | D1 | D2 | D3 | D4 | Subtotal /8 |
|-----|----|----|----|----|-------------|
| R1  |    |    |    |    |             |
| R2  |    |    |    |    |             |
| R3  |    |    |    |    |             |

**Median:** D1=__, D2=__, D3=__, D4=__. **Total: __ / 8**

**Observations:**
-

---

## Run total

```
P1 + P2 + P3 + P4 + P5 + P6 + P7 + P8 = __ / 64
```

## Summary

- **What worked:**
- **What broke:**
- **Surprises:**
- **Followups to consider:**
