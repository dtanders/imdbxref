let xrefTabId = null;

// Rehydrate tab ID after service worker restart
chrome.storage.session.get('xrefTabId', r => {
  xrefTabId = r.xrefTabId ?? null;
});

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
    return true;
  }
});

function openNewXrefTab(sendResponse) {
  chrome.tabs.create({ url: chrome.runtime.getURL('xref.html') }, tab => {
    xrefTabId = tab.id;
    chrome.storage.session.set({ xrefTabId });
    sendResponse({ ok: true });
  });
}

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === xrefTabId) {
    xrefTabId = null;
    chrome.storage.session.remove('xrefTabId');
  }
});
