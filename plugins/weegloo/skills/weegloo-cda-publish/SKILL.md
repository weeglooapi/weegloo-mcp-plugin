---
name: weegloo-cda-publish
description: CDA (and ACDA) expose only published resources with publish-time values; CMA create/update needs explicit publish; ACMA create/delete auto-publish/auto-unpublish (no separate publish/unpublish step); unpublish hides from delivery. Use when debugging “missing” CDA content or planning write→read flows.
---

# Weegloo - CDA delivery vs CMA management (publish model)

## When to use

- A site reads **CDA** but **does not see** new or edited Content, Media, or other resources after **CMA** changes.
- Designing **Create → Publish** or **Update → Publish** workflows (for **CMA**), or explaining why **draft** CMA state differs from **CDA**.
- Understanding **ACMA** writes: no separate **Publish** after **Create**, and no **Unpublish** before **Delete** (see **ACMA vs CMA** below).
- Choosing between **Unpublish** (hide from delivery) and **Delete** (remove the resource in management).

Canonical API bullets: **`weegloo-api-endpoints`** rule → *CDA - published snapshot only*.

## Behavior

1. **Published only** - **CDA** lists and returns **published** resources. Values are the **snapshot at publish time**, not arbitrary in-progress edits that exist only as drafts in **CMA**.

2. **New content** - **Create** in **CMA** (API or console), then **Publish**. The resource **does not appear on CDA** until it is published.

3. **Edits** - After **Update** in **CMA**, **Publish** again so **CDA** serves the new snapshot. Skipping publish leaves delivery on the **previous** published version.

4. **Unpublish vs delete** - **Unpublish** stops the resource from being **delivered** on **CDA**; it may still exist in **CMA** as unpublished. **Permanent removal** requires the **Delete** operation on the management API (per **OpenAPI**), not unpublish alone.

5. **ACDA** - For **app-managed** members, use **ACDA** instead of **CDA** for the same **published-delivery** idea; operation names and paths follow that API’s Swagger.

## ACMA vs CMA (publish / unpublish steps)

**ACMA** does **not** mirror **CMA**’s explicit publish workflow for the same operations:

- **After Create** — **ACMA** **automatically publishes** the new resource. You do **not** need to call **Publish** separately (unlike **CMA**, where **Create** then **Publish** is required for delivery).
- **Before Delete** — **ACMA** **automatically unpublishes** as part of removal. You do **not** need to call **Unpublish** first (unlike typical **CMA** flows where you may unpublish to hide from **CDA** without deleting, or sequence operations explicitly).

Delivery (**ACDA**) still reflects **published** state; with **ACMA**, that state is reached without an extra publish call after create.

## Related

- **Rule (URLs, CDA token, publish bullets):** **`weegloo-api-endpoints`**.
- **Delivery token provisioning:** **`weegloo-delivery-access-token`** skill.
- **Default locale on Content create (CMA):** **`weegloo-default-locale`** skill.
