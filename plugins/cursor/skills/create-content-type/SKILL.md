---
name: create-content-type
description: Creates a ContentType that defines the structure of Content. Use when creating a ContentType.
---

# Create ContentType

## When to use

- When creating a ContentType resource.

## Instructions
- Before creating a `Content` resource, you must first create a `ContentType` resource.
- After creating a `ContentType`, you must publish it before using it to create any `Content`.
- The characteristics of each `FieldType` are as follows:
  - **Array**: Stores multiple values in an array format.
  - **Boolean**: Stored values can be used for search.
  - **Date**: Stored values can be used for search.
  - **Long**: Stored values can be used for search.
  - **Number**: Stored values can be used for search; supports decimal numbers.
  - **Refer**: Stored values can be used for search.
  - **Json**: Stored values are **not indexed** and cannot be searched.
  - **ShortText**: Stored values support only exact or prefix search; suitable for storing product codes or similar identifiers.
  - **LongText**: Stored values support full-text search; suitable for storing titles, descriptions, or long text content.
  - **RichText**: Stored values are **not indexed** and cannot be searched; suitable for article bodies or content where search is not required.
  - **Location**: Stored values support geographic searches such as `near` or `within`; suitable for storing latitude and longitude coordinates.


## Important
A `ContentType` must be **published** before it can be used to create `Content` resources.
