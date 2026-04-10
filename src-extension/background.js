/**
 * GVP Bridge — Background Service Worker (PLAN_040)
 * 
 * Responsibilities:
 * 1. Detect ghost tab (any tab on grok.com/imagine/saved)
 * 2. Apply declarativeNetRequest media blocking on ghost tab
 * 3. Keyboard shortcuts
 * 
 * NOT responsible for:
 * - Creating/spawning ghost windows (Desktop App owns this)
 * - Statsig header sniffing (dead)
 * - webRequest interception (dead)
 */

// ============================================================================
// STATE
// ============================================================================

let ghostTabId = null;
const GHOST_URL_PATTERN = 'https://grok.com/imagine/saved';
const MEDIA_BLOCK_RULE_ID_START = 1000;

// ============================================================================
// MEDIA BLOCKING (Tier 1 — 90% of RAM savings)
// Uses declarativeNetRequest session rules scoped to the ghost tab only.
// ============================================================================

async function applyMediaBlockRules(tabId) {
  if (!tabId) return;

  // Remove any existing ghost rules first
  const existingRules = await chrome.declarativeNetRequest.getSessionRules();
  const existingIds = existingRules
    .filter(r => r.id >= MEDIA_BLOCK_RULE_ID_START && r.id < MEDIA_BLOCK_RULE_ID_START + 100)
    .map(r => r.id);

  const rules = [
    {
      id: MEDIA_BLOCK_RULE_ID_START,
      priority: 1,
      condition: { tabIds: [tabId], resourceTypes: ['image'] },
      action: { type: 'block' }
    },
    {
      id: MEDIA_BLOCK_RULE_ID_START + 1,
      priority: 1,
      condition: { tabIds: [tabId], resourceTypes: ['media'] },
      action: { type: 'block' }
    },
    {
      id: MEDIA_BLOCK_RULE_ID_START + 2,
      priority: 1,
      condition: { tabIds: [tabId], resourceTypes: ['font'] },
      action: { type: 'block' }
    },
    {
      id: MEDIA_BLOCK_RULE_ID_START + 3,
      priority: 1,
      condition: { tabIds: [tabId], urlFilter: '*sentry*' },
      action: { type: 'block' }
    },
    {
      id: MEDIA_BLOCK_RULE_ID_START + 4,
      priority: 1,
      condition: { tabIds: [tabId], urlFilter: '*statsig*' },
      action: { type: 'block' }
    },
    {
      id: MEDIA_BLOCK_RULE_ID_START + 5,
      priority: 1,
      condition: { tabIds: [tabId], urlFilter: '*analytics*' },
      action: { type: 'block' }
    }
  ];

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: existingIds,
    addRules: rules
  });

  console.log(`[GVP BG] Media block rules applied for ghost tab ${tabId} (${rules.length} rules)`);
}

async function removeMediaBlockRules() {
  const existingRules = await chrome.declarativeNetRequest.getSessionRules();
  const existingIds = existingRules
    .filter(r => r.id >= MEDIA_BLOCK_RULE_ID_START && r.id < MEDIA_BLOCK_RULE_ID_START + 100)
    .map(r => r.id);
  
  if (existingIds.length > 0) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existingIds });
    console.log('[GVP BG] Media block rules removed');
  }
}

// ============================================================================
// GHOST TAB DETECTION
// The extension does NOT create windows. It only detects and instruments them.
// The Desktop App (Tauri) spawns the ghost window via std::process::Command.
// ============================================================================

async function detectGhostTab() {
  const tabs = await chrome.tabs.query({ url: 'https://grok.com/imagine/saved*' });
  
  if (tabs.length > 0) {
    ghostTabId = tabs[0].id;
    console.log(`[GVP BG] Ghost tab detected: ${ghostTabId}`);
    await applyMediaBlockRules(ghostTabId);
    return true;
  }
  
  console.log('[GVP BG] No ghost tab found (Desktop App will spawn it)');
  return false;
}

// ============================================================================
// TAB LIFECYCLE TRACKING
// ============================================================================

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === ghostTabId) {
    console.log('[GVP BG] Ghost tab closed');
    ghostTabId = null;
    removeMediaBlockRules();
  }
});

// Detect new ghost tabs as they appear (Desktop App spawns them)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.startsWith(GHOST_URL_PATTERN)) {
    if (tabId !== ghostTabId) {
      console.log(`[GVP BG] New ghost tab detected via onUpdated: ${tabId}`);
      ghostTabId = tabId;
      applyMediaBlockRules(tabId);
    }
  }
  // If ghost tab navigated away from /imagine, redirect back
  if (tabId === ghostTabId && changeInfo.url) {
    if (!changeInfo.url.startsWith('https://grok.com/imagine')) {
      console.warn('[GVP BG] Ghost tab navigated away:', changeInfo.url);
      chrome.tabs.update(tabId, { url: GHOST_URL_PATTERN });
    }
  }
});

// Also detect via onCreated for tabs that start with the ghost URL
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.pendingUrl && tab.pendingUrl.startsWith(GHOST_URL_PATTERN)) {
    console.log(`[GVP BG] Ghost tab created: ${tab.id}`);
    ghostTabId = tab.id;
    applyMediaBlockRules(tab.id);
  }
});

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

chrome.commands.onCommand.addListener(async (command) => {
  console.log('[GVP BG] Command:', command);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  switch (command) {
    case 'activate-extension':
      if (tab.url?.includes('grok.com')) {
        chrome.tabs.sendMessage(tab.id, { type: 'activate' });
      }
      break;
    case 'reload-extension':
      await chrome.tabs.reload(tab.id);
      setTimeout(() => chrome.runtime.reload(), 500);
      break;
  }
});

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'status_update':
      chrome.runtime.sendMessage(message).catch(() => {});
      break;
    case 'get_ghost_status':
      sendResponse({ ghostTabId, hasGhost: !!ghostTabId });
      return true;
    case 'get_cookies':
      chrome.cookies.getAll({ domain: "grok.com" }, (cookies) => {
        if (!cookies) {
          sendResponse({ cookies: "" });
          return;
        }
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        sendResponse({ cookies: cookieString });
      });
      return true;
    default:
      break;
  }
  sendResponse({ received: true });
  return true;
});

// ============================================================================
// STARTUP
// ============================================================================

detectGhostTab();
setInterval(() => console.log('[GVP BG] Heartbeat | ghost:', ghostTabId), 25000);
console.log('[GVP BG] Background service worker loaded (PLAN_040)');
