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
