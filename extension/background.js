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
