---
name: weegloo-cda-publish
description: CDA (and ACDA) expose only published resources with publish-time values; create/update must publish; unpublish hides from delivery; delete removes in CMA. Use when debugging “missing” CDA content or planning write→read flows.
---

# Weegloo — CDA delivery vs CMA management (publish model)

## When to use

- A site reads **CDA** but **does not see** new or edited Content, Media, or other resources after **CMA** changes.
- Designing **Create → Publish** or **Update → Publish** workflows, or explaining why **draft** CMA state differs from **CDA**.
- Choosing between **Unpublish** (hide from delivery) and **Delete** (remove the resource in management).

Canonical API bullets: **`weegloo-api-endpoints`** rule → *CDA — published snapshot only*.

## Behavior

1. **Published only** — **CDA** lists and returns **published** resources. Values are the **snapshot at publish time**, not arbitrary in-progress edits that exist only as drafts in **CMA**.

2. **New content** — **Create** in **CMA** (API or console), then **Publish**. The resource **does not appear on CDA** until it is published.

3. **Edits** — After **Update** in **CMA**, **Publish** again so **CDA** serves the new snapshot. Skipping publish leaves delivery on the **previous** published version.

4. **Unpublish vs delete** — **Unpublish** stops the resource from being **delivered** on **CDA**; it may still exist in **CMA** as unpublished. **Permanent removal** requires the **Delete** operation on the management API (per **OpenAPI**), not unpublish alone.

5. **ACDA** — For **app-managed** members, use **ACDA** instead of **CDA** for the same **published-delivery** idea; operation names and paths follow that API’s Swagger.

## Related

- **Rule (URLs, CDA token, publish bullets):** **`weegloo-api-endpoints`**.
- **Delivery token provisioning:** **`weegloo-delivery-access-token`** skill.
- **Default locale on Content create (CMA):** **`weegloo-default-locale`** skill.
