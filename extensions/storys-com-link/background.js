// Opens only the local editor. No Instagram session, request, or tab is inspected.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
});
