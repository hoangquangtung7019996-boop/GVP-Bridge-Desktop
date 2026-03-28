# Implementation Plan — Fix Content Script Module Loading

**Plan ID:** PLAN-009
**Feature:** Bundle content scripts into single file (fix ES module loading)
**Target:** `src-extension/`
**Date:** 2025-03-28
**Depends On:** PLAN-008
**Priority:** CRITICAL - Extension not working

---

## Overview

Chrome is not recognizing `type: "module"` in content_scripts. The files use ES module syntax (`import/export`) but are being loaded as regular scripts, causing syntax errors.

**Solution:** Bundle all content scripts into a single `content.bundle.js` file without ES module syntax.

**Total Steps:** 3
**Estimated Time:** 10 minutes

---

## STEP 1 — Update manifest.json to use bundled script

**File:** `src-extension/manifest.json`
**Action:** EDIT EXISTING FILE

**Find:**
```json
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
```

**Replace with:**
```json
  "content_scripts": [
    {
      "matches": [
        "https://grok.com/*"
      ],
      "js": [
        "content.bundle.js"
      ]
    }
  ],
```

---

## STEP 2 — Create bundled content script

**File:** `src-extension/content.bundle.js`
**Action:** CREATE NEW FILE

```javascript
/**
 * GVP Bridge - Bundled Content Script
 * All modules combined for Chrome MV3 compatibility
 */

(function() {
  'use strict';

  // ============================================================================
  // SELECTORS MODULE
  // ============================================================================
  
  const URL_PATTERNS = {
    POST_VIEW: /\/imagine\/post\/([a-f0-9-]+)/,
    GROK_BASE: /grok\.com/
  };

  const SELECTORS = {
    PROMPT_EDITOR: '[contenteditable="true"]',
    PROMPT_EDITOR_ALT: '[data-slate-editor="true"]',
    PROMPT_EDITOR_FALLBACK: '.ProseMirror',
    SUBMIT_BUTTON: 'button[type="submit"]',
    SUBMIT_BUTTON_ALT: 'button[aria-label*="Send"]',
    SUBMIT_BUTTON_FALLBACK: 'button[data-testid="send-button"]',
    VIDEO_MODE_BUTTON: '[data-testid="video-mode-button"]',
    IMAGE_IN_POST: 'img[src*="/imagine/"]'
  };

  function findPromptEditor() {
    for (const selector of [SELECTORS.PROMPT_EDITOR, SELECTORS.PROMPT_EDITOR_ALT, SELECTORS.PROMPT_EDITOR_FALLBACK]) {
      const el = document.querySelector(selector);
      if (el && el.isContentEditable) return el;
    }
    return document.querySelector('[contenteditable="true"]');
  }

  function findSubmitButton() {
    for (const selector of [SELECTORS.SUBMIT_BUTTON, SELECTORS.SUBMIT_BUTTON_ALT, SELECTORS.SUBMIT_BUTTON_FALLBACK]) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function extractImageIdFromUrl() {
    const match = window.location.pathname.match(URL_PATTERNS.POST_VIEW);
    return match ? match[1] : null;
  }

  function isOnPostView() {
    return URL_PATTERNS.POST_VIEW.test(window.location.pathname);
  }

  function isOnGrok() {
    return URL_PATTERNS.GROK_BASE.test(window.location.href);
  }

  function waitForEditor(timeout = 5000, interval = 100) {
    return new Promise((resolve) => {
      const editor = findPromptEditor();
      if (editor) { resolve(editor); return; }
      
      const startTime = Date.now();
      const pollInterval = setInterval(() => {
        if (Date.now() - startTime > timeout) {
          clearInterval(pollInterval);
          debug('Editor wait timeout');
          resolve(null);
          return;
        }
        const editor = findPromptEditor();
        if (editor && editor.offsetParent !== null) {
          clearInterval(pollInterval);
          debug('Editor found after', Date.now() - startTime, 'ms');
          resolve(editor);
        }
      }, interval);
    });
  }

  function waitForSubmitButton(timeout = 5000) {
    return new Promise((resolve) => {
      const button = findSubmitButton();
      if (button) { resolve(button); return; }
      
      const startTime = Date.now();
      const pollInterval = setInterval(() => {
        if (Date.now() - startTime > timeout) {
          clearInterval(pollInterval);
          resolve(null);
          return;
        }
        const button = findSubmitButton();
        if (button) {
          clearInterval(pollInterval);
          resolve(button);
        }
      }, 100);
    });
  }

  // ============================================================================
  // WEBSOCKET CLIENT MODULE
  // ============================================================================

  const WS_URL = 'ws://127.0.0.1:8765';
  
  let ws = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 2000;
  let messageHandler = null;
  let isConnected = false;

  function debug(...args) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] [GVP Bridge]`, ...args);
  }

  const wsClient = {
    connect() {
      return new Promise((resolve) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          debug('Already connected');
          resolve(true);
          return;
        }

        debug('Connecting to', WS_URL);
        
        try {
          ws = new WebSocket(WS_URL);
        } catch (e) {
          debug('WebSocket creation failed:', e);
          resolve(false);
          return;
        }

        ws.onopen = () => {
          debug('Connected!');
          isConnected = true;
          reconnectAttempts = 0;
          resolve(true);
        };

        ws.onclose = (event) => {
          debug('Disconnected:', event.code, event.reason);
          isConnected = false;
          
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            debug(`Reconnecting in ${RECONNECT_DELAY}ms (attempt ${reconnectAttempts})`);
            setTimeout(() => wsClient.connect(), RECONNECT_DELAY);
          }
        };

        ws.onerror = (error) => {
          debug('WebSocket error:', error);
          isConnected = false;
          resolve(false);
        };

        ws.onmessage = (event) => {
          debug('Received:', event.data);
          try {
            const message = JSON.parse(event.data);
            if (messageHandler) {
              messageHandler(message);
            }
          } catch (e) {
            debug('Failed to parse message:', e);
          }
        };
      });
    },

    disconnect() {
      if (ws) {
        ws.close();
        ws = null;
        isConnected = false;
      }
    },

    send(message) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const json = typeof message === 'string' ? message : JSON.stringify(message);
        ws.send(json);
        debug('Sent:', json);
        return true;
      }
      debug('Cannot send - not connected');
      return false;
    },

    onMessage(handler) {
      messageHandler = handler;
    },

    isConnected() {
      return isConnected;
    },

    requestPrompt(imageId) {
      return wsClient.send({
        type: 'prompt_request',
        payload: { imageId },
        timestamp: Date.now()
      });
    },

    notifyUrlChange(url, imageId) {
      return wsClient.send({
        type: 'url_changed',
        payload: { url, imageId },
        timestamp: Date.now()
      });
    },

    sendStatus(status, extra = {}) {
      return wsClient.send({
        type: 'status',
        payload: { status, success: true, ...extra },
        timestamp: Date.now()
      });
    }
  };

  // ============================================================================
  // DOM OPERATIONS MODULE
  // ============================================================================

  async function injectPrompt(editor, text) {
    debug('Injecting prompt:', text.substring(0, 50) + '...');
    
    editor.focus();
    
    // Clear existing content
    editor.textContent = '';
    
    // Create input event
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    });
    
    // Set content
    editor.textContent = text;
    
    // Dispatch event
    editor.dispatchEvent(inputEvent);
    
    // Also dispatch key events for good measure
    editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    
    debug('Prompt injected');
    return true;
  }

  async function clickSubmit(button) {
    debug('Clicking submit button');
    
    button.click();
    
    // Also try dispatching click event
    button.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    }));
    
    debug('Submit clicked');
    return true;
  }

  async function injectAndSubmitAsync(prompt, maxAttempts = 3) {
    debug('injectAndSubmitAsync called, attempts:', maxAttempts);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      debug(`Attempt ${attempt}/${maxAttempts}`);
      
      const editor = await waitForEditor(3000);
      if (!editor) {
        debug('Editor not found, retrying...');
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      const button = await waitForSubmitButton(2000);
      if (!button) {
        debug('Submit button not found, retrying...');
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      // Inject prompt
      const injected = await injectPrompt(editor, prompt);
      
      // Wait a bit for React to process
      await new Promise(r => setTimeout(r, 100));
      
      // Submit
      const submitted = await clickSubmit(button);
      
      return { injected, submitted, attempt };
    }
    
    return { injected: false, submitted: false, error: 'Max attempts reached', attempts: maxAttempts };
  }

  // ============================================================================
  // MAIN CONTENT SCRIPT
  // ============================================================================

  let lastUrl = window.location.href;
  let urlCheckInterval = null;
  let lastAction = 'None';

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

  async function init() {
    debug('=== INITIALIZING ===');
    debug('URL:', window.location.href);
    debug('User Agent:', navigator.userAgent.substring(0, 80));

    if (!isOnGrok()) {
      debug('Not on Grok, skipping');
      return;
    }

    // Connect to desktop app
    const connected = await wsClient.connect();

    if (connected) {
      debug('Connected to desktop app');
      lastAction = 'Connected';
      wsClient.sendStatus('ready', { url: window.location.href });
    } else {
      debug('Failed to connect to desktop app, will retry...');
      lastAction = 'Connection failed';
    }

    // Set up message handler
    wsClient.onMessage(handleMessage);

    // Start URL monitoring
    startUrlMonitoring();

    // Check current URL state
    checkCurrentUrl();

    debug('Ready');
  }

  function handleMessage(message) {
    debug('Handling message:', message.type);

    switch (message.type) {
      case 'prompt_response':
        handlePromptResponse(message.payload);
        break;
      case 'ping':
        wsClient.sendStatus('pong');
        break;
      default:
        debug('Unknown message type:', message.type);
    }
  }

  async function handlePromptResponse(payload) {
    const { prompt, imageId } = payload;

    if (!prompt) {
      debug('No prompt in response');
      lastAction = 'Error: No prompt';
      return;
    }

    debug('Received prompt for image:', imageId);
    lastAction = `Injecting prompt (${prompt.length} chars)`;

    const result = await injectAndSubmitAsync(prompt);

    lastAction = result.submitted ? 'Prompt submitted!' : `Error: ${result.error || 'Unknown'}`;

    wsClient.sendStatus('injected', {
      success: result.injected && result.submitted,
      imageId,
      error: result.error,
      attempts: result.attempts
    });
  }

  function startUrlMonitoring() {
    urlCheckInterval = setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        debug('URL changed:', currentUrl);
        lastUrl = currentUrl;
        handleUrlChange(currentUrl);
      }
    }, 500);

    window.addEventListener('popstate', () => handleUrlChange(window.location.href));

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      handleUrlChange(window.location.href);
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      handleUrlChange(window.location.href);
    };
  }

  function handleUrlChange(url) {
    const imageId = extractImageIdFromUrl();
    wsClient.notifyUrlChange(url, imageId);

    if (isOnPostView() && imageId) {
      debug('On post view, requesting prompt for:', imageId);
      lastAction = `Requesting prompt for ${imageId}`;
      wsClient.requestPrompt(imageId);
    }
  }

  function checkCurrentUrl() {
    const imageId = extractImageIdFromUrl();
    if (imageId) {
      debug('Already on post view:', imageId);
      wsClient.notifyUrlChange(window.location.href, imageId);
    }
  }

  function cleanup() {
    if (urlCheckInterval) clearInterval(urlCheckInterval);
    wsClient.disconnect();
  }

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

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeunload', cleanup);

  debug('Content script loaded');

})();
```

---

## STEP 3 — Delete old module files (optional cleanup)

These files are no longer needed since everything is bundled:
- `src-extension/selectors.js`
- `src-extension/ws-client.js`
- `src-extension/dom-ops.js`
- `src-extension/content.js`

**Action:** DELETE FILES (or keep for reference, they won't be loaded)

---

## VERIFICATION CHECKLIST

| Check | Expected |
|-------|----------|
| `manifest.json` uses `content.bundle.js` | YES |
| `content.bundle.js` exists | YES |
| No `type: "module"` in content_scripts | YES |
| Console shows `[GVP Bridge] Content script loaded` | YES |
| No syntax errors | YES |

---

## TESTING

1. Reload extension in `chrome://extensions/`
2. Open `https://grok.com/imagine/`
3. Open DevTools (F12) → Console
4. Should see: `[HH:MM:SS] [GVP Bridge] Content script loaded`
5. Should see: `[HH:MM:SS] [GVP Bridge] === INITIALIZING ===`
6. No syntax errors!

---

## END OF PLAN

**STOP after completing all 3 steps.**
**Produce Work Report as specified in `/report` workflow.**
