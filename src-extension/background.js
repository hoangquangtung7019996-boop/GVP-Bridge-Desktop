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

console.log('[GVP Bridge BG] Background service worker loaded');
