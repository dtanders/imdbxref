# IMDb XRef Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone MV3 browser extension that injects a collection toolbar into IMDB pages, stores data in `chrome.storage.local`, and renders cross-reference results in a bundled extension tab — no server required.

**Architecture:** A content script injects a floating toolbar on all IMDB pages; collected page data is stored in `chrome.storage.local`; a background service worker opens/focuses the XRef tab on demand; the XRef tab reads storage directly and runs the same intersection logic currently in the .NET server.

**Tech Stack:** Plain JS/HTML (no bundler), Manifest V3, `chrome.storage.local`, `chrome.tabs` API, Python (icon generation)

---

## File Map

| File | Responsibility |
|---|---|
| `extension/manifest.json` | MV3 manifest: permissions, content/background scripts, icons |
| `extension/background.js` | Service worker: open/focus XRef tab, handle storage reset |
| `extension/content.js` | Injected toolbar UI, scrape logic, storage writes |
| `extension/xref.html` | Results page shell (no bookmarklet card) |
| `extension/xref.js` | Reads storage, runs comparison, renders results |
| `extension/icons/icon16.png` | 16×16 toolbar icon |
| `extension/icons/icon48.png` | 48×48 extension management icon |
| `extension/icons/icon128.png` | 128×128 store/install icon |
| `extension/make_icons.py` | One-time script to generate PNG icons |

---

### Task 1: Scaffold + manifest

**Files:**
- Create: `extension/manifest.json`

- [ ] Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "IMDb XRef",
  "version": "1.0.0",
  "description": "Collect IMDB pages and find connections between them.",
  "permissions": ["storage", "tabs"],
  "host_permissions": ["*://*.imdb.com/*"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["*://*.imdb.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_title": "IMDb XRef",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "imdbxref@local",
      "strict_min_version": "109.0"
    }
  }
}
```

- [ ] Commit:

```bash
git -C /path/to/imdbxref add extension/manifest.json
git -C /path/to/imdbxref commit -m "feat: add extension manifest"
```

---

### Task 2: Generate icons

**Files:**
- Create: `extension/make_icons.py`
- Create: `extension/icons/icon16.png`
- Create: `extension/icons/icon48.png`
- Create: `extension/icons/icon128.png`

- [ ] Create `extension/make_icons.py`:

```python
import struct, zlib, os

def make_png(size, r, g, b):
    def chunk(name, data):
        c = struct.pack('>I', len(data)) + name + data
        return c + struct.pack('>I', zlib.crc32(name + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + bytes([r, g, b] * size) for _ in range(size))
    idat = zlib.compress(raw)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', idat)
            + chunk(b'IEND', b''))

os.makedirs('extension/icons', exist_ok=True)
for size in [16, 48, 128]:
    with open(f'extension/icons/icon{size}.png', 'wb') as f:
        f.write(make_png(size, 245, 197, 24))  # IMDb gold #f5c518
print('Icons generated.')
```

- [ ] Run it from the repo root and verify the files are created:

```bash
python extension/make_icons.py
ls extension/icons/
```

Expected output:
```
Icons generated.
icon128.png  icon16.png  icon48.png
```

- [ ] Commit:

```bash
git add extension/icons/ extension/make_icons.py
git commit -m "feat: add extension icons"
```

---

### Task 3: background.js

**Files:**
- Create: `extension/background.js`

- [ ] Create `extension/background.js`:

```js
let xrefTabId = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'openXref') {
    if (xrefTabId !== null) {
      chrome.tabs.get(xrefTabId, tab => {
        if (chrome.runtime.lastError || !tab) {
          openNewXrefTab(sendResponse);
        } else {
          chrome.tabs.update(xrefTabId, { active: true });
          sendResponse({ ok: true });
        }
      });
    } else {
      openNewXrefTab(sendResponse);
    }
    return true; // keep message channel open for async response
  }

  if (msg.action === 'reset') {
    chrome.storage.local.remove('imdbxref_pages', () => sendResponse({ ok: true }));
    return true;
  }
});

function openNewXrefTab(sendResponse) {
  chrome.tabs.create({ url: chrome.runtime.getURL('xref.html') }, tab => {
    xrefTabId = tab.id;
    sendResponse({ ok: true });
  });
}

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === xrefTabId) xrefTabId = null;
});
```

- [ ] Load the extension unpacked in Chrome:
  1. Open `chrome://extensions`
  2. Enable "Developer mode" (top right toggle)
  3. Click "Load unpacked" → select the `extension/` directory
  4. Click the service worker "inspect" link for IMDb XRef
  5. Verify the service worker console shows no errors

- [ ] Commit:

```bash
git add extension/background.js
git commit -m "feat: add background service worker"
```

---

### Task 4: content.js — toolbar, scrape, storage

**Files:**
- Create: `extension/content.js`

- [ ] Create `extension/content.js`:

```js
(function () {
  if (document.getElementById('imdbxref-toolbar')) return;

  // ── Scrape ────────────────────────────────────────────────────────────────
  function scrape() {
    const links = [];
    const seen = {};
    let sec = '';
    document.body.querySelectorAll('h4,a[href]').forEach(node => {
      if (node.tagName === 'H4') {
        const t = node.textContent.trim().replace(/\s+/g, ' ');
        if (t && t.length < 60) sec = t;
      } else {
        const m = node.href && node.href.match(/imdb\.com\/(name\/(nm\d+)|title\/(tt\d+))/);
        if (m) {
          const id = m[2] || m[3];
          if (!seen[id]) {
            seen[id] = 1;
            const type = m[2] ? 'name' : 'title';
            const name = node.textContent.trim().replace(/\s+/g, ' ');
            if (name && name.length > 1) {
              links.push({ id, type, name, url: `https://www.imdb.com/${type}/${id}/`, section: sec });
            }
          }
        }
      }
    });
    return links;
  }

  // ── Storage helpers ───────────────────────────────────────────────────────
  function getPages(cb) {
    chrome.storage.local.get('imdbxref_pages', r => cb(r.imdbxref_pages || []));
  }

  function setPages(pages, cb) {
    chrome.storage.local.set({ imdbxref_pages: pages }, cb);
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.id = 'imdbxref-toolbar';
  toolbar.style.cssText = `
    position:fixed;bottom:16px;right:16px;z-index:2147483647;
    background:#1a1a1a;border:1px solid #2d2d2d;border-radius:10px;
    padding:8px 12px;display:flex;align-items:center;gap:8px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-size:13px;color:#e8e8e8;box-shadow:0 4px 16px rgba(0,0,0,.5);
    user-select:none;
  `;

  const badge = document.createElement('span');
  badge.style.cssText = `
    background:#f5c518;color:#000;font-weight:800;font-size:11px;
    padding:2px 7px;border-radius:4px;letter-spacing:-.3px;
  `;
  badge.textContent = 'IMDb XRef';

  const countSpan = document.createElement('span');
  countSpan.style.cssText = 'color:#888;font-size:12px;min-width:5ch;';

  const collectBtn = document.createElement('button');
  collectBtn.textContent = 'Collect';
  collectBtn.style.cssText = `
    background:#f5c518;color:#000;font-weight:700;font-size:12px;
    border:none;border-radius:6px;padding:4px 10px;cursor:pointer;
  `;

  const compareBtn = document.createElement('button');
  compareBtn.textContent = 'Find Connections';
  compareBtn.style.cssText = `
    background:#f5c518;color:#000;font-weight:700;font-size:12px;
    border:none;border-radius:6px;padding:4px 10px;cursor:pointer;display:none;
  `;

  const toast = document.createElement('span');
  toast.style.cssText = 'color:#888;font-size:12px;display:none;';

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = '×';
  dismissBtn.style.cssText = `
    background:none;border:none;color:#555;font-size:16px;
    cursor:pointer;padding:0 2px;line-height:1;
  `;

  toolbar.append(badge, countSpan, collectBtn, compareBtn, toast, dismissBtn);
  document.body.appendChild(toolbar);

  // ── Update UI from storage ────────────────────────────────────────────────
  function updateUI(pages) {
    const n = pages.length;
    countSpan.textContent = n ? `${n} collected` : '';
    compareBtn.style.display = n >= 2 ? '' : 'none';
  }

  getPages(updateUI);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.imdbxref_pages) {
      updateUI(changes.imdbxref_pages.newValue || []);
    }
  });

  // ── Toast helper ──────────────────────────────────────────────────────────
  function showToast(msg, ms = 2000) {
    toast.textContent = msg;
    toast.style.display = '';
    setTimeout(() => { toast.style.display = 'none'; }, ms);
  }

  // ── Collect ───────────────────────────────────────────────────────────────
  function doCollect() {
    const title = document.title.replace(/\s*[-|].*$/, '').trim() || location.href;
    const links = scrape();
    getPages(pages => {
      if (pages.some(p => p.title === title)) {
        showToast('Already collected');
        return;
      }
      pages.push({ title, links });
      setPages(pages, () => {
        showToast(`✓ Collected (${pages.length})`);
        updateUI(pages);
      });
    });
  }

  collectBtn.addEventListener('click', () => {
    const isName = /\/name\/nm/.test(location.href);
    const isFC   = /\/fullcredits/.test(location.href);
    if (isName && !isFC) {
      const allBtn = document.querySelector('[data-testid="nm-flmg-all-credits"]');
      if (allBtn) {
        allBtn.click();
        collectBtn.disabled = true;
        collectBtn.textContent = 'Loading…';
        setTimeout(() => {
          collectBtn.disabled = false;
          collectBtn.textContent = 'Collect';
          doCollect();
        }, 2000);
        return;
      }
    }
    doCollect();
  });

  // ── Find Connections ──────────────────────────────────────────────────────
  compareBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openXref' });
  });

  // ── Dismiss ───────────────────────────────────────────────────────────────
  dismissBtn.addEventListener('click', () => toolbar.remove());
})();
```

- [ ] Reload the extension in Chrome (`chrome://extensions` → click the refresh icon for IMDb XRef). Navigate to any IMDB title page and verify:
  - Toolbar appears bottom-right
  - Clicking Collect shows "✓ Collected (1)"
  - Navigating to a second IMDB page and collecting shows "2 collected" and reveals "Find Connections"
  - Collecting the same page again shows "Already collected"
  - The × button removes the toolbar

- [ ] Navigate to an IMDB person page (e.g. `imdb.com/name/nm...`) and verify:
  - Clicking Collect briefly disables the button with "Loading…"
  - After ~2 seconds, the full credits expand and the page is collected

- [ ] Commit:

```bash
git add extension/content.js
git commit -m "feat: add content script with toolbar and scrape logic"
```

---

### Task 5: xref.html + xref.js

**Files:**
- Create: `extension/xref.html`
- Create: `extension/xref.js`

- [ ] Create `extension/xref.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>IMDb XRef</title>
  <style>
    :root {
      --bg:       #0f0f0f;
      --surface:  #1a1a1a;
      --surface2: #232323;
      --border:   #2d2d2d;
      --gold:     #f5c518;
      --text:     #e8e8e8;
      --dim:      #888;
      --muted:    #555;
      --name-bg:  rgba(124,185,232,.13);
      --name-fg:  #7cb9e8;
      --title-bg: rgba(168,216,168,.13);
      --title-fg: #8ecf8e;
      --ok:       #4caf50;
      --err:      #ff6b6b;
      --r:        12px;
      --r-sm:     8px;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      background:var(--bg);color:var(--text);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      min-height:100dvh;display:flex;flex-direction:column;
    }
    header{padding:1.5rem 1rem 0;text-align:center}
    .logo{display:inline-flex;align-items:center;gap:.5rem}
    .logo-badge{background:var(--gold);color:#000;font-weight:900;font-size:.95rem;padding:.18rem .42rem;border-radius:4px;letter-spacing:-.5px}
    .logo-word{font-size:1.5rem;font-weight:700}
    .logo-word span{color:var(--gold)}
    .tagline{color:var(--dim);font-size:.82rem;margin-top:.3rem}
    main{flex:1;padding:1.25rem 1rem 2.5rem;max-width:680px;margin:0 auto;width:100%}
    .collected-section{margin-bottom:1rem}
    .collected-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
    .collected-label{font-size:.75rem;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;display:flex;align-items:center;gap:.45rem}
    .badge{font-size:.78rem;color:var(--dim);background:var(--surface2);padding:.15rem .55rem;border-radius:20px;border:1px solid var(--border)}
    .clear-all-btn{background:none;border:none;color:var(--muted);font-size:.75rem;cursor:pointer;padding:.15rem .35rem;border-radius:4px;transition:color .15s}
    .clear-all-btn:hover{color:var(--err)}
    .page-items{display:flex;flex-direction:column;gap:.5rem}
    .slot{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm);padding:.75rem 1rem;display:flex;align-items:center;gap:.75rem}
    .slot-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;background:var(--ok)}
    .slot-info{flex:1;min-width:0}
    .slot-label{font-size:.7rem;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
    .slot-title{font-size:.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:.1rem}
    .slot-count{font-size:.72rem;color:var(--muted);margin-top:.05rem}
    .slot-clear{background:none;border:none;color:var(--muted);cursor:pointer;padding:.2rem;border-radius:4px;display:flex;align-items:center;transition:color .15s}
    .slot-clear:hover{color:var(--err)}
    .empty-state{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm);padding:.75rem 1rem;font-size:.82rem;color:var(--muted)}
    .action-bar{display:flex;gap:.5rem;margin-bottom:.75rem}
    .btn{flex:1;border:none;border-radius:var(--r-sm);font-size:.9rem;font-weight:700;padding:.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.4rem;transition:background .15s,transform .1s}
    .btn:active{transform:scale(.98)}
    .btn-primary{background:var(--gold);color:#000}
    .btn-primary:hover{background:#ffd740}
    .btn-primary:disabled{background:var(--surface2);color:var(--muted);cursor:not-allowed;transform:none}
    .results{display:none}
    .results-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;gap:.5rem;flex-wrap:wrap}
    .results-title{font-size:1rem;font-weight:700}
    .page-labels{display:flex;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap}
    .page-label{flex:1 1 calc(50% - .25rem);min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:.4rem .65rem;overflow:hidden}
    .page-label-num{font-size:.65rem;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:.05em}
    .page-label-title{font-size:.78rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .filter-tabs{display:flex;gap:.4rem;margin-bottom:.75rem;flex-wrap:wrap}
    .ftab{background:var(--surface);border:1px solid var(--border);color:var(--dim);font-size:.78rem;font-weight:600;padding:.28rem .7rem;border-radius:20px;cursor:pointer;transition:all .15s}
    .ftab.active{background:var(--gold);border-color:var(--gold);color:#000}
    .result-list{display:flex;flex-direction:column;gap:.45rem}
    .result-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm);padding:.7rem .9rem;display:flex;align-items:center;gap:.7rem;text-decoration:none;color:inherit;transition:border-color .15s,background .15s}
    .result-item:hover{border-color:var(--gold);background:var(--surface2)}
    .result-icon{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center}
    .result-icon.name{background:var(--name-bg);color:var(--name-fg)}
    .result-icon.title{background:var(--title-bg);color:var(--title-fg)}
    .result-info{flex:1;min-width:0}
    .result-name{font-size:.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .result-type{font-size:.7rem;color:var(--muted);margin-top:.08rem}
    .result-sections{font-size:.68rem;color:var(--dim);margin-top:.1rem}
    .result-arrow{color:var(--muted);flex-shrink:0}
    .empty{text-align:center;padding:2.5rem 1rem;font-size:.9rem;color:var(--muted)}
    .empty .icon{font-size:2rem;margin-bottom:.6rem}
    footer{text-align:center;padding:.85rem 1rem;color:var(--muted);font-size:.72rem;border-top:1px solid var(--border)}
    @media(min-width:480px){header{padding:2rem 1.5rem 0}main{padding:1.5rem 1.5rem 2.5rem}.logo-word{font-size:1.7rem}}
  </style>
</head>
<body>
<header>
  <div class="logo">
    <span class="logo-badge">IMDb</span>
    <span class="logo-word">X<span>Ref</span></span>
  </div>
  <p class="tagline">Find connections between any two IMDb pages</p>
</header>
<main>
  <div class="collected-section">
    <div class="collected-header">
      <span class="collected-label">
        Collected Pages
        <span class="badge" id="collectedCount" style="display:none"></span>
      </span>
      <button class="clear-all-btn" id="clearAllBtn" style="display:none" onclick="resetAll()">Clear all</button>
    </div>
    <div class="page-items" id="pageList"></div>
  </div>
  <div class="action-bar">
    <button class="btn btn-primary" id="compareBtn" disabled onclick="compare()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      Find Connections
    </button>
  </div>
  <div class="results" id="results">
    <div class="page-labels" id="pageLabels"></div>
    <div class="results-head">
      <span class="results-title">Connections</span>
      <span class="badge" id="resultCount">0</span>
    </div>
    <div class="filter-tabs" id="filterTabs"></div>
    <div class="result-list" id="resultList"></div>
  </div>
</main>
<footer>Data is stored locally in your browser — nothing leaves your device.</footer>
<script src="xref.js"></script>
</body>
</html>
```

- [ ] Create `extension/xref.js`:

```js
// ── Comparison logic ──────────────────────────────────────────────────────────
function dedup(links) {
  const map = {};
  for (const link of links) {
    if (!map[link.id] || link.name.length > map[link.id].name.length) {
      map[link.id] = link;
    }
  }
  return map;
}

function runCompare(pages) {
  const maps = pages.map(p => dedup(p.links));
  let commonIds = new Set(Object.keys(maps[0]));
  for (let i = 1; i < maps.length; i++) {
    const keys = new Set(Object.keys(maps[i]));
    for (const id of commonIds) {
      if (!keys.has(id)) commonIds.delete(id);
    }
  }
  return [...commonIds].map(id => {
    const candidates = maps.map(m => m[id]);
    const best = candidates.reduce((a, b) => b.name.length > a.name.length ? b : a);
    return {
      id: best.id, type: best.type, name: best.name, url: best.url,
      sections: candidates.map(c => c.section)
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Render helpers ────────────────────────────────────────────────────────────
const CLOSE_SVG  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const PERSON_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const FILM_SVG   = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>`;
const ARROW_SVG  = `<svg class="result-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderPages(pages) {
  const list       = document.getElementById('pageList');
  const countBadge = document.getElementById('collectedCount');
  const clearBtn   = document.getElementById('clearAllBtn');
  const n          = pages.length;

  countBadge.textContent = n;
  countBadge.style.display = n ? '' : 'none';
  clearBtn.style.display = n ? '' : 'none';
  document.getElementById('compareBtn').disabled = n < 2;

  if (!n) {
    list.innerHTML = `<div class="empty-state">No pages collected yet. Use the toolbar on any IMDB page.</div>`;
    return;
  }

  list.innerHTML = pages.map((page, i) => `
    <div class="slot">
      <div class="slot-dot"></div>
      <div class="slot-info">
        <div class="slot-label">Page ${i + 1}</div>
        <div class="slot-title">${esc(page.title)}</div>
        <div class="slot-count">${page.links.length} entities extracted</div>
      </div>
      <button class="slot-clear" onclick="removePage(${i})" title="Remove">${CLOSE_SVG}</button>
    </div>`).join('');
}

function renderResults(items) {
  const list = document.getElementById('resultList');
  if (!items.length) {
    list.innerHTML = `<div class="empty"><div class="icon">🔍</div>No shared people or works found.</div>`;
    return;
  }
  list.innerHTML = items.map(e => {
    const secs = e.sections ? [...new Set(e.sections.filter(Boolean))].join(' · ') : '';
    return `
    <a class="result-item" href="${esc(e.url)}" target="_blank" rel="noopener">
      <div class="result-icon ${e.type}">${e.type === 'name' ? PERSON_SVG : FILM_SVG}</div>
      <div class="result-info">
        <div class="result-name">${esc(e.name)}</div>
        <div class="result-type">${e.type === 'name' ? 'Person' : 'Title'}</div>
        ${secs ? `<div class="result-sections">${esc(secs)}</div>` : ''}
      </div>
      ${ARROW_SVG}
    </a>`;
  }).join('');
}

function buildFilters(items) {
  const names  = items.filter(e => e.type === 'name').length;
  const titles = items.filter(e => e.type === 'title').length;
  const tabs   = document.getElementById('filterTabs');
  tabs.innerHTML = '';
  const makeTab = (label, filter) => {
    const btn = document.createElement('button');
    btn.className = 'ftab';
    btn.textContent = label;
    btn.onclick = () => {
      tabs.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderResults(filter === 'all' ? allResults : allResults.filter(e => e.type === filter));
    };
    return btn;
  };
  const allTab = makeTab(`All (${items.length})`, 'all');
  allTab.classList.add('active');
  tabs.appendChild(allTab);
  if (names)  tabs.appendChild(makeTab(`People (${names})`, 'name'));
  if (titles) tabs.appendChild(makeTab(`Titles (${titles})`, 'title'));
}

// ── State + actions ───────────────────────────────────────────────────────────
let allResults   = [];
let currentPages = [];

function compare() {
  if (currentPages.length < 2) return;
  allResults = runCompare(currentPages);

  document.getElementById('pageLabels').innerHTML = currentPages.map((page, i) => `
    <div class="page-label">
      <div class="page-label-num">Page ${i + 1}</div>
      <div class="page-label-title" title="${esc(page.title)}">${esc(page.title)}</div>
    </div>`).join('');

  document.getElementById('resultCount').textContent = allResults.length;
  buildFilters(allResults);
  renderResults(allResults);
  const el = document.getElementById('results');
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function removePage(idx) {
  currentPages.splice(idx, 1);
  chrome.storage.local.set({ imdbxref_pages: currentPages }, () => {
    renderPages(currentPages);
    document.getElementById('results').style.display = 'none';
  });
}

function resetAll() {
  currentPages = [];
  chrome.storage.local.remove('imdbxref_pages', () => {
    renderPages([]);
    document.getElementById('results').style.display = 'none';
    allResults = [];
  });
}

// ── Boot + live updates ───────────────────────────────────────────────────────
chrome.storage.local.get('imdbxref_pages', r => {
  currentPages = r.imdbxref_pages || [];
  renderPages(currentPages);
  if (currentPages.length >= 2) compare();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.imdbxref_pages) {
    currentPages = changes.imdbxref_pages.newValue || [];
    renderPages(currentPages);
    if (currentPages.length >= 2) compare();
  }
});
```

- [ ] Reload the extension in Chrome. Click "Find Connections" from the toolbar on an IMDB page. Verify:
  - XRef tab opens with collected pages listed
  - Results render automatically when 2+ pages are present
  - Filter tabs (All / People / Titles) work correctly
  - Removing a page with × updates the list and hides results
  - "Clear all" removes all pages and hides results
  - Collecting another page while the XRef tab is open causes the tab to live-update

- [ ] Test in Firefox:
  1. Open `about:debugging` → "This Firefox" → "Load Temporary Add-on"
  2. Select `extension/manifest.json`
  3. Run the same smoke tests above

- [ ] Commit:

```bash
git add extension/xref.html extension/xref.js
git commit -m "feat: add xref results page"
```

---

### Task 6: End-to-end smoke test

- [ ] Full end-to-end flow in Chrome:
  1. Navigate to an IMDB person page → click Collect → button shows "Loading…" → 2s later toast shows "✓ Collected (1)"
  2. Navigate to an IMDB title/movie page → click Collect → badge shows "2 collected" → "Find Connections" button appears
  3. Click "Find Connections" → XRef tab opens → results rendered automatically
  4. Click "Find Connections" again → existing tab gains focus, no second tab opened
  5. On another IMDB page, collect a 3rd page → XRef tab updates live without refresh
  6. In XRef tab, click × on a page → list updates, results hidden
  7. Click "Clear all" → list empty, badge on open IMDB toolbar resets to blank

- [ ] Full end-to-end flow in Firefox (same steps).

- [ ] Commit if any fixes were made during testing:

```bash
git add extension/
git commit -m "fix: address issues found during end-to-end testing"
```
