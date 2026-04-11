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
  const updated = currentPages.filter((_, i) => i !== idx);
  chrome.storage.local.set({ imdbxref_pages: updated }, () => {
    if (chrome.runtime.lastError) console.error('XRef: remove page failed', chrome.runtime.lastError);
  });
}

function resetAll() {
  chrome.storage.local.remove('imdbxref_pages', () => {
    if (chrome.runtime.lastError) console.error('XRef: reset failed', chrome.runtime.lastError);
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
    if (currentPages.length >= 2) {
      compare();
    } else {
      document.getElementById('results').style.display = 'none';
      allResults = [];
    }
  }
});
