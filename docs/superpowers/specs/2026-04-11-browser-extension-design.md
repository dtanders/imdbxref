# IMDb XRef Browser Extension — Design Spec

**Date:** 2026-04-11  
**Status:** Approved

---

## Overview

Add a standalone browser extension (Chrome/Edge/Firefox, Manifest V3) that replaces the bookmarklet workflow for collecting IMDB pages. The extension injects a floating toolbar into IMDB pages, stores collected data in `chrome.storage.local`, and opens a bundled XRef tab to display cross-reference results. The existing local .NET server and `index.html` are untouched.

---

## Architecture

```
extension/
  manifest.json       — MV3 manifest; declares permissions, scripts, icons
  content.js          — injected into imdb.com pages; toolbar UI + scrape logic
  background.js       — service worker; opens/focuses the XRef tab
  xref.html           — cross-reference results page (no bookmarklet card)
  xref.js             — reads chrome.storage.local, runs comparison, renders results
  icons/              — 16px, 48px, 128px PNGs
```

The extension lives in a new `extension/` subdirectory. No build step required — plain JS/HTML, no bundler.

---

## Data Flow

1. User visits any `*.imdb.com` page → `content.js` injects a fixed floating toolbar.
2. User clicks **Collect** → content script scrapes links (same algorithm as the bookmarklet: `h4`-as-section walk, `nm`/`tt` regex, dedup by ID) → reads `imdbxref_pages` from `chrome.storage.local`, appends `{title, links}`, writes back.
3. Toolbar badge updates to show count ("2 collected"). When count ≥ 2, **Find Connections** button appears.
4. User clicks **Find Connections** → content script sends `{ action: 'openXref' }` to `background.js` → background calls `chrome.tabs.create({ url: chrome.runtime.getURL('xref.html') })`.
5. `xref.html` loads → `xref.js` reads `chrome.storage.local` → runs intersection logic → renders results.

**Storage key:** `imdbxref_pages` — array of `{title: string, links: [{id, type, name, url, section}]}`.  
This format is identical to the server's `PageData` record; the two paths remain compatible.

---

## Components

### `content.js`

- Injected on `*://*.imdb.com/*`
- Renders a small fixed toolbar (bottom of page, dark/gold IMDb XRef aesthetic)
- **Collect button** — scrapes current page, appends to storage
- **Page count badge** — updates live via `chrome.storage.onChanged`
- **Find Connections button** — hidden until count ≥ 2; sends message to background
- **Dismiss button (×)** — hides toolbar for the session; does not clear data
- **Full Credits auto-expand** — on `/name/nm*` pages not already on `/fullcredits`, clicks the "all credits" button and waits 2 seconds before scraping (matches existing bookmarklet behaviour)
- **Duplicate detection** — if the same page title is already collected, shows a brief inline toast and skips re-adding

### `background.js`

- Minimal MV3 service worker
- Listens for `{ action: 'openXref' }` — creates XRef tab or focuses existing one (tracked by tab ID)
- Listens for `{ action: 'reset' }` — clears `imdbxref_pages` from storage

### `xref.html` + `xref.js`

- Port of the current `index.html`, with the bookmarklet setup card removed
- Shows collected pages list, reset button, Find Connections button, and results
- On load: reads storage, auto-compares if ≥ 2 pages present
- Listens to `chrome.storage.onChanged` — live-updates if pages are added/removed while tab is open
- Comparison/filter/render logic is identical to the current UI

### `manifest.json`

- Manifest V3
- Permissions: `storage`, `tabs`
- Host permissions: `*://*.imdb.com/*`
- `browser_specific_settings` block for Firefox (minimum version 109)
- Content script: `content.js` on `*://*.imdb.com/*`
- Background service worker: `background.js`

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Same page collected twice | Toast in toolbar, skip re-add |
| XRef tab already open | Background focuses existing tab |
| Storage cleared externally | `onChanged` fires; content script badge resets to 0, XRef tab clears results |
| On name page, not full credits | Auto-clicks "all credits", 2s delay before scrape |
| Find Connections clicked with < 2 pages | Button is hidden; not possible |

---

## Cross-Browser Compatibility

Firefox supports MV3 since v109. The `chrome.*` namespace works in Firefox MV3 via its built-in compatibility layer — no polyfill needed. The only Firefox-specific addition is a `browser_specific_settings` block in `manifest.json`.

---

## Testing

Manual smoke tests (load unpacked):

- [ ] Toolbar appears on IMDB person, title, and list pages
- [ ] Collect on name page triggers full-credits auto-expand
- [ ] Badge updates correctly after each collect
- [ ] Find Connections button hidden until 2+ pages collected
- [ ] XRef tab opens with correct results
- [ ] Clicking Find Connections again focuses existing tab
- [ ] Collecting a 3rd page while XRef tab is open causes live update
- [ ] Reset from XRef tab resets badge on open IMDB tabs
- [ ] Works in both Chrome and Firefox (load unpacked)

---

## Out of Scope

- Packaging for Chrome Web Store or Firefox Add-ons
- Automated tests
- Modifying the existing .NET server or `index.html`
