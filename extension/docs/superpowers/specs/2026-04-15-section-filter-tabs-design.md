# Section Filter Tabs — Design Spec

**Date:** 2026-04-15
**Status:** Approved

## Summary

Add IMDb section headings (e.g. "Cast", "Directed by", "Written by") as top-level filter tabs in the results panel, alongside the existing All / People / Titles tabs. Lets users filter results by the job/role context in which a person or title appeared.

## Background

The scraper in `content.js` already captures `sections` on every result — these are the `h3`/`h4` headings that were active when each link was scraped (e.g. "Cast", "Directed by", "Produced by"). This data is stored but currently unused for filtering.

## Design

### Scope

One file changes: `xref.js`. The change is entirely inside `buildFilters`.

### Behavior

1. After the existing All / People / Titles tabs are created, collect every unique `sections` value across `allResults` and sort them alphabetically.
2. For each unique section, create a tab labeled `<section> (<count>)` where count is the number of results whose `sections` array includes that section.
3. Clicking a section tab filters `allResults` to items where `e.sections.includes(section)`.
4. Active-state logic is unchanged — one tab is active at a time.
5. Results with an empty `sections` array are unaffected: they still appear under All / People / Titles.

### Filter tabs row (after change)

```
[ All (N) ] [ People (N) ] [ Titles (N) ] [ Cast (N) ] [ Directed by (N) ] [ Written by (N) ] ...
```

All tabs share the same `.ftab` / `.ftab.active` styles. The row already wraps on narrow viewports.

### No data changes

No changes to storage schema, scraping logic, or `content.js`. The `sections` field already exists on every result object.

## Out of scope

- Normalizing/grouping section names (e.g. "Directed by" vs "Director") — raw names shown as-is.
- Compound filtering (e.g. People AND Cast simultaneously).
- Section tabs for the collected-pages list.
