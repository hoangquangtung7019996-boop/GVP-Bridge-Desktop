# PLAN-021: Native Chrome WebRequest Statsig Sniffer

## Problem Statement
The `x-statsig-id` header is attached to background API calls by Grok's service worker, bypassing the page-level `window.fetch` interceptor. The only way to reliably capture it instantly on page load or scrolling is to sniff the raw HTTP headers using Chrome's native `webRequest` API.

## Files to Modify
| File | Action | Purpose |
|------|--------|---------|
| `GVP-Desktop/src-extension/manifest.json` | MODIFY | Add `webRequest` permissions to monitor raw HTTP headers. |
| `GVP-Desktop/src-extension/background.js` | MODIFY | Add listener to catch `x-statsig-id` on any `/rest/*` call and forward it to the content script. |
| `GVP-Desktop/src-extension/content.bundle.js` | MODIFY | Listen for the background script's statsig message. |

## Implementation Details

### STEP 1 — Add Permissions to Manifest
**File:** `A:\Tools n Programs\GVP-Desktop\src-extension\manifest.json`
**Action:** MODIFY EXISTING

**Find this EXACT block:**
  "permissions": [
    "activeTab",
    "scripting",
    "storage"
  ],

**Replace with:**
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "webRequest"
  ],

⚠️ DO NOT modify any line outside this block.

### STEP 2 — Add Sniffer to Background Script
**File:** `A:\Tools n Programs\GVP-Desktop\src-extension\background.js`
**Action:** MODIFY EXISTING

**Find this EXACT block:**
setInterval(() => console.log('[GVP Bridge BG] Heartbeat'), 20000);

console.log('[GVP Bridge BG] Background service worker loaded');

**Replace with:**
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

⚠️ DO NOT modify any line outside this block.

### STEP 3 — Receive Sniffed ID in Content Script
**File:** `A:\Tools n Programs\GVP-Desktop\src-extension\content.bundle.js`
**Action:** MODIFY EXISTING

**Find this EXACT block:**
  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    debug('Received message:', message.type);
    
    switch (message.type) {
      case 'get_status':

**Replace with:**
  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only log non-spam messages
    if (message.type !== 'GVP_BG_STATSIG_CAPTURED') debug('Received message:', message.type);
    
    switch (message.type) {
      case 'GVP_BG_STATSIG_CAPTURED':
        if (message.statsigId && message.statsigId !== capturedStatsigId) {
          capturedStatsigId = message.statsigId;
          debug('[Background Sniffer] Captured x-statsig-id:', capturedStatsigId.substring(0, 20) + '...');
          updateStatsigPanel();
          wsClient.send({
            type: 'statsig_captured',
            payload: { success: true },
            timestamp: Date.now()
          });
        }
        sendResponse({ received: true });
        break;

      case 'get_status':

⚠️ DO NOT modify any line outside this block.

## VERIFICATION CHECKLIST
| Check | Expected |
|-------|----------|
| `webRequest` permission added | YES |
| `onBeforeSendHeaders` listener added | YES |
| Content script receives `GVP_BG_STATSIG_CAPTURED` | YES |