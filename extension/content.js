(function () {
  if (document.getElementById('imdbxref-toolbar')) return;

  // ── Scrape ────────────────────────────────────────────────────────────────
  function imgSrc(img) {
    if (!img) return null;
    // Use getAttribute to get raw attribute values (img.src resolves "" to page URL)
    const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (src && src.startsWith('http')) return src;
    // Fall back to first URL in srcset
    const srcset = img.getAttribute('srcset') || '';
    const first = srcset.split(',')[0]?.trim().split(' ')[0] || '';
    return first.startsWith('http') ? first : null;
  }

  function scrape() {
    const root = document.querySelector('main') || document.body;
    const byId = {};
    let sec = '';
    root.querySelectorAll('h3,h4,a[href]').forEach(node => {
      if (node.tagName === 'H3' || node.tagName === 'H4') {
        const t = node.textContent.trim().replace(/\s+/g, ' ');
        if (t && t.length < 60) sec = t;
      } else {
        const m = node.href && node.href.match(/imdb\.com\/(name\/(nm\d+)|title\/(tt\d+))/);
        if (!m) return;
        const id = m[2] || m[3];
        const type = m[2] ? 'name' : 'title';
        const name = node.textContent.trim().replace(/\s+/g, ' ');
        const image = imgSrc(node.closest('li')?.querySelector('img'));
        if (byId[id]) {
          if (name.length > byId[id].name.length) byId[id].name = name;
          if (sec && !byId[id].sections.includes(sec)) byId[id].sections.push(sec);
          if (image && !byId[id].image) byId[id].image = image;
        } else {
          byId[id] = { id, type, name, url: `https://www.imdb.com/${type}/${id}/`, sections: sec ? [sec] : [], image };
        }
      }
    });
    return Object.values(byId).filter(e => e.name.length > 1);
  }

  // ── Storage helpers ───────────────────────────────────────────────────────
  function getPages(cb) {
    chrome.storage.local.get('imdbxref_pages', r => cb(r.imdbxref_pages || []));
  }

  function setPages(pages, onSuccess, onError) {
    chrome.storage.local.set({ imdbxref_pages: pages }, () => {
      if (chrome.runtime.lastError) { onError?.(chrome.runtime.lastError); return; }
      onSuccess?.();
    });
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

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.cssText = `
    background:none;border:1px solid #444;color:#888;font-weight:700;font-size:12px;
    border-radius:6px;padding:4px 10px;cursor:pointer;display:none;
  `;

  const warnSpan = document.createElement('span');
  warnSpan.style.cssText = 'color:#f5c518;font-size:12px;display:none;';
  warnSpan.textContent = 'Partial cast only';

  const fullCastBtn = document.createElement('button');
  fullCastBtn.textContent = 'Full Cast';
  fullCastBtn.style.cssText = `
    background:none;border:1px solid #f5c518;color:#f5c518;font-weight:700;font-size:12px;
    border-radius:6px;padding:4px 10px;cursor:pointer;display:none;
  `;

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = '×';
  dismissBtn.style.cssText = `
    background:none;border:none;color:#555;font-size:16px;
    cursor:pointer;padding:0 2px;line-height:1;
  `;

  toolbar.append(badge, countSpan, collectBtn, compareBtn, clearBtn, warnSpan, fullCastBtn, toast, dismissBtn);
  document.body.appendChild(toolbar);

  // ── Partial-cast warning ──────────────────────────────────────────────────
  const titleMatch = location.href.match(/imdb\.com\/title\/(tt\d+)/);
  const isFullCredits = /\/fullcredits/.test(location.href);
  if (titleMatch && !isFullCredits) {
    warnSpan.style.display = '';
    fullCastBtn.style.display = '';
    fullCastBtn.addEventListener('click', () => {
      location.href = `https://www.imdb.com/title/${titleMatch[1]}/fullcredits`;
    });
  }

  // ── Update UI from storage ────────────────────────────────────────────────
  function updateUI(pages) {
    const n = pages.length;
    countSpan.textContent = n ? `${n} collected` : '';
    compareBtn.style.display = n >= 2 ? '' : 'none';
    clearBtn.style.display = n ? '' : 'none';
  }

  getPages(updateUI);

  function onStorageChanged(changes, area) {
    if (area === 'local' && changes.imdbxref_pages) {
      updateUI(changes.imdbxref_pages.newValue || []);
    }
  }
  chrome.storage.onChanged.addListener(onStorageChanged);

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
    const idMatch = location.href.match(/imdb\.com\/(name\/(nm\d+)|title\/(tt\d+))/);
    const pageKey = idMatch ? (idMatch[2] || idMatch[3]) : location.pathname;
    getPages(pages => {
      if (pages.some(p => p.pageKey === pageKey)) {
        showToast('Already collected');
        return;
      }
      pages.push({ title, links, pageKey });
      setPages(pages, () => {
        showToast(`✓ Collected (${pages.length})`);
        updateUI(pages);
      }, () => {
        showToast('Save failed — storage full');
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
    chrome.runtime.sendMessage({ action: 'openXref' }, _r => {
      void chrome.runtime.lastError;
    });
  });

  // ── Clear all ─────────────────────────────────────────────────────────────
  clearBtn.addEventListener('click', () => {
    chrome.storage.local.remove('imdbxref_pages', () => {
      if (chrome.runtime.lastError) console.error('XRef: clear failed', chrome.runtime.lastError);
    });
  });

  // ── Dismiss ───────────────────────────────────────────────────────────────
  dismissBtn.addEventListener('click', () => {
    chrome.storage.onChanged.removeListener(onStorageChanged);
    toolbar.remove();
  });
})();
