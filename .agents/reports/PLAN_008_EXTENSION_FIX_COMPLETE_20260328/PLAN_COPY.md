# Implementation Plan — Extension URL Fix + UI & Debugging

**Plan ID:** PLAN-008
**Feature:** Fix grok.com URLs, add popup UI, keyboard shortcuts, and enhanced debugging
**Target:** `src-extension/`
**Date:** 2025-03-28
**Depends On:** PLAN-007
**Priority:** CRITICAL - Extension not working on grok.com

---

## Overview

This plan combines two critical fixes:
1. **URL Fix** - Extension uses old `x.com/i/grok` URLs but Grok is now at `grok.com`
2. **UI & Debugging** - Add popup UI, keyboard shortcuts, and comprehensive logging

**Actual Grok URLs:**
- `https://grok.com/imagine/` - Fresh generated images gallery
- `https://grok.com/imagine/saved` - User's personal gallery (saved creations)
- `https://grok.com/imagine/post/{id}` - Individual post view

**Keyboard Shortcuts:**
- `Ctrl+Shift+B` - Activate extension
- `Ctrl+Shift+F` - Reload extension & refresh page

**Total Steps:** 8
**Estimated Time:** 15 minutes

---

## STEP 1 — Fix manifest.json URLs & Add Commands

**File:** `src-extension/manifest.json`
**Action:** REPLACE ENTIRE FILE

```json
{
  "manifest_version": 3,
  "name": "GVP Bridge",
  "version": "0.1.0",
  "description": "Bridge extension for GVP Desktop - connects to desktop app via WebSocket",
  "permissions": [
    "activeTab",
    "scripting",
    "storage"
  ],
  "host_permissions": [
    "https://grok.com/*"
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "commands": {
    "activate-extension": {
      "suggested_key": {
        "default": "Ctrl+Shift+B",
        "mac": "Command+Shift+B"
      },
      "description": "Activate GVP Bridge on current tab"
    },
    "reload-extension": {
      "suggested_key": {
        "default": "Ctrl+Shift+F",
        "mac": "Command+Shift+F"
      },
      "description": "Reload extension and refresh page"
    }
  },
  "content_scripts": [
    {
      "matches": [
        "https://grok.com/*"
      ],
      "js": [
        "selectors.js",
        "ws-client.js",
        "dom-ops.js",
        "content.js"
      ],
      "type": "module"
    }
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## STEP 2 — Fix selectors.js URL Pattern

**File:** `src-extension/selectors.js`
**Action:** EDIT EXISTING FILE

**Find:**
```javascript
// URL patterns for detecting post view
export const URL_PATTERNS = {
  POST_VIEW: /\/imagine\/post\/([a-f0-9-]+)/,
  GROK_BASE: /x\.com\/i\/grok/
};
```

**Replace with:**
```javascript
// URL patterns for detecting post view
export const URL_PATTERNS = {
  POST_VIEW: /\/imagine\/post\/([a-f0-9-]+)/,
  GROK_BASE: /grok\.com/
};
```

---

## STEP 3 — Create Popup HTML

**File:** `src-extension/popup/popup.html`
**Action:** CREATE NEW FILE

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 350px;
      min-height: 400px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #f4f4f5;
    }
    .header {
      background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
      padding: 16px;
      text-align: center;
    }
    .header h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
    .header .version { font-size: 11px; opacity: 0.8; }
    .status-section { padding: 16px; border-bottom: 1px solid #333; }
    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
    }
    .status-label { font-size: 12px; color: #a1a1aa; }
    .status-value { font-size: 12px; font-weight: 500; }
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
    }
    .status-dot.connected { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
    .status-dot.disconnected { background: #ef4444; }
    .status-dot.connecting { background: #f59e0b; animation: pulse 1s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .actions { padding: 16px; display: flex; gap: 8px; }
    .btn {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary { background: #dc2626; color: white; }
    .btn-primary:hover { background: #b91c1c; }
    .btn-secondary { background: #333; color: #f4f4f5; }
    .btn-secondary:hover { background: #444; }
    .debug-section { padding: 16px; }
    .debug-header {
      font-size: 12px;
      color: #a1a1aa;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
    }
    .debug-log {
      background: #0a0a0a;
      border-radius: 6px;
      padding: 8px;
      max-height: 150px;
      overflow-y: auto;
      font-family: 'Monaco', 'Consolas', monospace;
      font-size: 10px;
      line-height: 1.4;
    }
    .log-entry { padding: 2px 0; border-bottom: 1px solid #222; }
    .log-entry:last-child { border-bottom: none; }
    .log-time { color: #666; margin-right: 6px; }
    .log-info { color: #3b82f6; }
    .log-success { color: #22c55e; }
    .log-error { color: #ef4444; }
    .log-warn { color: #f59e0b; }
    .shortcuts { padding: 16px; border-top: 1px solid #333; }
    .shortcuts h3 { font-size: 12px; color: #a1a1aa; margin-bottom: 8px; }
    .shortcut-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 11px;
    }
    .shortcut-key {
      background: #333;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>GVP Bridge</h1>
    <div class="version">v0.1.0 • Desktop Connector</div>
  </div>
  
  <div class="status-section">
    <div class="status-row">
      <span class="status-label">WebSocket</span>
      <span class="status-value" id="ws-status">
        <span class="status-dot disconnected"></span>
        <span id="ws-status-text">Disconnected</span>
      </span>
    </div>
    <div class="status-row">
      <span class="status-label">Desktop App</span>
      <span class="status-value" id="desktop-status">Unknown</span>
    </div>
    <div class="status-row">
      <span class="status-label">Current URL</span>
      <span class="status-value" id="current-url">-</span>
    </div>
    <div class="status-row">
      <span class="status-label">Last Action</span>
      <span class="status-value" id="last-action">None</span>
    </div>
  </div>
  
  <div class="actions">
    <button class="btn btn-primary" id="btn-connect">Connect</button>
    <button class="btn btn-secondary" id="btn-reload">Reload</button>
    <button class="btn btn-secondary" id="btn-clear">Clear Log</button>
  </div>
  
  <div class="debug-section">
    <div class="debug-header">
      <span>Debug Log</span>
      <span id="log-count">0 entries</span>
    </div>
    <div class="debug-log" id="debug-log">
      <div class="log-entry">
        <span class="log-time">--:--:--</span>
        <span class="log-info">Popup opened</span>
      </div>
    </div>
  </div>
  
  <div class="shortcuts">
    <h3>Keyboard Shortcuts</h3>
    <div class="shortcut-row">
      <span>Activate Extension</span>
      <span class="shortcut-key">Ctrl+Shift+B</span>
    </div>
    <div class="shortcut-row">
      <span>Reload & Refresh</span>
      <span class="shortcut-key">Ctrl+Shift+F</span>
    </div>
  </div>
  
  <script src="popup.js"></script>
</body>
</html>
```

---

## STEP 4 — Create Popup JavaScript

**File:** `src-extension/popup/popup.js`
**Action:** CREATE NEW FILE

```javascript
/**
 * GVP Bridge - Popup UI Controller
 */

let debugLogs = [];

const wsStatusDot = document.querySelector('#ws-status .status-dot');
const wsStatusText = document.getElementById('ws-status-text');
const desktopStatus = document.getElementById('desktop-status');
const currentUrl = document.getElementById('current-url');
const lastAction = document.getElementById('last-action');
const debugLog = document.getElementById('debug-log');
const logCount = document.getElementById('log-count');

const btnConnect = document.getElementById('btn-connect');
const btnReload = document.getElementById('btn-reload');
const btnClear = document.getElementById('btn-clear');

function log(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  debugLogs.push({ time, message, type });
  if (debugLogs.length > 100) debugLogs.shift();
  renderLogs();
  saveLogs();
}

function renderLogs() {
  debugLog.innerHTML = debugLogs.map(e => `
    <div class="log-entry">
      <span class="log-time">${e.time}</span>
      <span class="log-${e.type}">${e.message}</span>
    </div>
  `).join('');
  logCount.textContent = `${debugLogs.length} entries`;
  debugLog.scrollTop = debugLog.scrollHeight;
}

function saveLogs() {
  chrome.storage.local.set({ debugLogs: debugLogs.slice(-50) });
}

async function loadLogs() {
  const data = await chrome.storage.local.get('debugLogs');
  if (data.debugLogs) {
    debugLogs = data.debugLogs;
    renderLogs();
  }
}

function updateStatus(connected, text) {
  wsStatusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  wsStatusText.textContent = text || (connected ? 'Connected' : 'Disconnected');
}

async function queryTabStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { log('No active tab', 'warn'); return; }
    
    const url = new URL(tab.url);
    currentUrl.textContent = url.hostname + url.pathname.substring(0, 20);
    currentUrl.title = tab.url;
    
    if (!tab.url.includes('grok.com')) {
      log('Not on grok.com - extension inactive', 'warn');
      updateStatus(false, 'Wrong site');
      desktopStatus.textContent = 'Navigate to grok.com';
      return;
    }
    
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'get_status' });
      if (response) {
        updateStatus(response.connected, response.connected ? 'Connected' : 'Disconnected');
        desktopStatus.textContent = response.desktopStatus || 'Unknown';
        lastAction.textContent = response.lastAction || 'None';
        log(`Status: ${response.connected ? 'Connected' : 'Disconnected'}`, response.connected ? 'success' : 'warn');
      }
    } catch (e) {
      log('Content script not responding', 'error');
      updateStatus(false, 'No response');
      desktopStatus.textContent = 'Refresh page';
    }
  } catch (error) {
    log(`Error: ${error.message}`, 'error');
  }
}

async function sendConnect() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('grok.com')) {
      log('Navigate to grok.com first', 'warn');
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: 'force_connect' });
    log('Connect command sent', 'info');
  } catch (error) {
    log(`Connect failed: ${error.message}`, 'error');
  }
}

async function reloadAndRefresh() {
  log('Reloading extension...', 'info');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.reload();
  if (tab) chrome.tabs.reload(tab.id);
}

btnConnect.addEventListener('click', sendConnect);
btnReload.addEventListener('click', reloadAndRefresh);
btnClear.addEventListener('click', () => {
  debugLogs = [];
  renderLogs();
  saveLogs();
  log('Log cleared', 'info');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'status_update') {
    updateStatus(message.connected, message.statusText);
    desktopStatus.textContent = message.desktopStatus || 'Unknown';
    log(message.log || 'Status update', message.logType || 'info');
  }
  sendResponse({ received: true });
});

async function init() {
  await loadLogs();
  log('Popup opened', 'info');
  await queryTabStatus();
}

init();
```

---

## STEP 5 — Update background.js for Commands

**File:** `src-extension/background.js`
**Action:** REPLACE ENTIRE FILE

```javascript
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
```

---

## STEP 6 — Update content.js init function with debug logging

**File:** `src-extension/content.js`
**Action:** EDIT EXISTING FILE

**Find:**
```javascript
/**
 * Initialize the extension
 */
async function init() {
  console.log('[GVP Bridge] Initializing...');
```

**Replace with:**
```javascript
/**
 * Debug logger with timestamps
 */
function debug(...args) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${timestamp}] [GVP Bridge]`, ...args);
}

/**
 * Send status update to popup
 */
function sendStatusUpdate(status = {}) {
  chrome.runtime.sendMessage({
    type: 'status_update',
    connected: wsClient.isConnected(),
    statusText: wsClient.isConnected() ? 'Connected' : 'Disconnected',
    desktopStatus: status.desktopStatus || 'Unknown',
    lastAction: lastAction,
    url: window.location.href,
    log: status.log,
    logType: status.logType || 'info'
  }).catch(() => {});
}

let lastAction = 'None';

/**
 * Initialize the extension
 */
async function init() {
  debug('=== INITIALIZING ===');
  debug('URL:', window.location.href);
  debug('User Agent:', navigator.userAgent.substring(0, 80));
```

---

## STEP 7 — Add message handler to content.js

**File:** `src-extension/content.js`
**Action:** EDIT EXISTING FILE

**Find:**
```javascript
// Export for testing
export { init, handleUrlChange, handleMessage };
```

**Replace with:**
```javascript
// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debug('Received message:', message.type);
  
  switch (message.type) {
    case 'get_status':
      sendResponse({
        connected: wsClient.isConnected(),
        desktopStatus: wsClient.isConnected() ? 'Connected (1)' : 'Disconnected',
        lastAction: lastAction,
        url: window.location.href
      });
      break;
      
    case 'force_connect':
      debug('Force connect requested');
      wsClient.connect().then(connected => {
        sendStatusUpdate({
          log: connected ? 'Connected!' : 'Connection failed',
          logType: connected ? 'success' : 'error'
        });
      });
      sendResponse({ received: true });
      break;
      
    case 'activate':
      debug('Activate command received');
      checkCurrentUrl();
      sendResponse({ received: true });
      break;
      
    default:
      sendResponse({ unknown: true });
  }
  
  return true;
});

// Export for testing
export { init, handleUrlChange, handleMessage, debug, sendStatusUpdate };
```

---

## STEP 8 — Update handlePromptResponse to track lastAction

**File:** `src-extension/content.js`
**Action:** EDIT EXISTING FILE

**Find:**
```javascript
async function handlePromptResponse(payload) {
  const { prompt, imageId } = payload;

  if (!prompt) {
    console.error('[GVP Bridge] No prompt in response');
    return;
  }

  console.log('[GVP Bridge] Received prompt for image:', imageId);
```

**Replace with:**
```javascript
async function handlePromptResponse(payload) {
  const { prompt, imageId } = payload;

  if (!prompt) {
    debug('No prompt in response');
    lastAction = 'Error: No prompt';
    return;
  }

  debug('Received prompt for image:', imageId);
  lastAction = `Injecting prompt (${prompt.length} chars)`;
```

---

## VERIFICATION CHECKLIST

| Check | Expected |
|-------|----------|
| `manifest.json` has `grok.com/*` | YES |
| `manifest.json` has `commands` | YES |
| `manifest.json` has `action` (popup) | YES |
| `selectors.js` has `GROK_BASE: /grok\.com/` | YES |
| `popup/popup.html` exists | YES |
| `popup/popup.js` exists | YES |
| `background.js` handles commands | YES |
| `content.js` has debug() function | YES |

---

## TESTING

1. Reload extension in `chrome://extensions/`
2. Open `https://grok.com/imagine/`
3. Open DevTools (F12) → Console tab
4. Should see: `[HH:MM:SS] [GVP Bridge] === INITIALIZING ===`
5. Click extension icon → popup should appear
6. Popup should show WebSocket status
7. Press `Ctrl+Shift+B` → should see activate message
8. Press `Ctrl+Shift+F` → should reload extension

---

## END OF PLAN

**STOP after completing all 8 steps.**
**Produce Work Report as specified in `/report` workflow.**
