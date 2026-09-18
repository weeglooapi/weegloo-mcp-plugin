---
id: weegloo-media-lifecycle
type: rule
title: Weegloo Media - sys.status, file processing, and safe use from Content
description: >
  Media sys.status and fields.file locale state; automatic processing and transition to Published;
  wait before referencing from Content; unpublish before delete. CMA/MCP and app code.
---

rules:
  - section: Status — what is deliverable
    items:
      - **`sys.status`** is one of **`Draft`** | **`Changed`** | **`Published`** | **`Archived`**, and **only `Published` is served by CDA** — everything else is CMA-only, absent from delivery with no error.
      - **`Changed`** = was published, now carries local edits: **delivery keeps serving the OLD copy until you publish again** (**`cma_PublishOneMedia`**), and nothing warns you. **`Archived`** is reversible (unarchive) but, like `Draft`, is **not** in delivery.

  - section: `fields.file.{locale}.state` — per-locale processing
    items:
      - **`PENDING`** = queued · **`PROCESSING`** = in progress · **`FAILED`** = errored, **not deliverable** · **`null`** = that locale's file finished processing.
      - ⚠️ **An absent `file` / locale bucket is NOT the same as "ready".** It means nothing is pending for that locale — which is equally true when **no file was ever uploaded** for it. Absence alone never proves a deliverable asset: check the state **of each locale you actually need**, and confirm a file exists there.

  - section: After create the platform publishes it — wait, don't publish manually
    items:
      - Creating a **Media** processes every **`file`** locale entry and, on success, Weegloo **moves `sys.status` to `Published` itself**. **`cma_PublishOneMedia`** is **not** the normal post-upload step — **poll until `Published`** instead (manual publish is for the other transitions, e.g. republishing a **`Changed`** asset).
      - **Before referencing a Media from Content** (**`Refer → Media`**) or assuming CDA-safe delivery, **wait until `sys.status === Published`** and until **`file.{locale}.state`** for every locale you need is not **`PENDING`** / **`PROCESSING`** / **`FAILED`**. This is **readiness gating**, not a human approval step.

  - section: Delete
    items:
      - **A Media that is deleted is not unlinked from Content.** Nothing checks inbound references, so a `Refer → Media` field on another Content keeps a stub pointing at a row that no longer exists — an image that never loads. Find referrers before deleting.
      - Preconditions, each of which returns a readable error: delete requires **`Draft`** or **`Archived`** (unpublish a `Published`/`Changed` Media first), and a Media whose file is still processing refuses update, patch and delete alike — wait. Order, codes and the wider dependency graph: **`weegloo-resource-deletion`**.
