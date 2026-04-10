// GVP Bridge - Background Service Worker
// Handles keyboard shortcuts and cross-tab communication

chrome.commands.onCommand.addListener(async (command) => {
  console.log('[GVP Bridge BG] Command received:', command);
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  
  switch (command) {
    case 'activate-extension':
      console.log('[GVP Bridge BG] Activate command');
      if (tab.url?.includes('grok.com')) {
        chrome.tabs.sendMessage(tab.id, { type: 'activate' });
      } else {
        console.log('[GVP Bridge BG] Not on grok.com');
      }
      break;
      
    case 'reload-extension':
      console.log('[GVP Bridge BG] Reload command');
      await chrome.tabs.reload(tab.id);
      setTimeout(() => chrome.runtime.reload(), 500);
      break;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[GVP Bridge BG] Message:', message.type);
  
  if (message.type === 'status_update') {
    chrome.runtime.sendMessage(message).catch(() => {});
  }
  
  sendResponse({ received: true });
  return true;
});

setInterval(() => console.log('[GVP Bridge BG] Heartbeat'), 20000);

// NEW: Native WebRequest Sniffer for Statsig ID
// This bypasses fetch interceptors and catches the header directly from Chrome's network layer.
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    if (!details.requestHeaders) return;
    
    // Look for the statsig header on any outgoing Grok API call
    for (let i = 0; i < details.requestHeaders.length; ++i) {
      if (details.requestHeaders[i].name.toLowerCase() === 'x-statsig-id') {
        const statsigId = details.requestHeaders[i].value;
        
        // Broadcast the captured ID to the content script on the active tab
        chrome.tabs.sendMessage(details.tabId, {
          type: 'GVP_BG_STATSIG_CAPTURED',
          statsigId: statsigId
        }).catch(() => {}); // Ignore errors if tab isn't ready yet
        
        break;
      }
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["https://grok.com/rest/*"] },
  ["requestHeaders"]
);

console.log('[GVP Bridge BG] Background service worker loaded');
