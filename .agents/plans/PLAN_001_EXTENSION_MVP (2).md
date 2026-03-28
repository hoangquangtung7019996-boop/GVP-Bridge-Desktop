# Implementation Plan — Extension MVP: URL Detection + WebSocket Client

**Plan ID:** PLAN-001
**Feature:** Extension MVP
**Target:** `src-extension/`
**Date:** 2025-03-28

---

## Overview

Build the minimal Chrome extension that:
1. Detects URL changes on Grok (when user clicks gallery card)
2. Connects to desktop app via WebSocket
3. Requests prompt from desktop app when URL changes
4. Injects prompt into Grok's editor
5. Presses Enter/clicks send button

**Total Steps:** 8
**Estimated Files:** 5 new files

---

## Target Files

| File | Action | Purpose |
|------|--------|---------|
| `src-extension/manifest.json` | CREATE | Extension manifest (MV3) |
| `src-extension/content.js` | CREATE | Main content script |
| `src-extension/ws-client.js` | CREATE | WebSocket client |
| `src-extension/dom-ops.js` | CREATE | DOM operations (inject, click) |
| `src-extension/selectors.js` | CREATE | Grok DOM selectors |

---

## STEP 1 — Create selectors.js

**File:** `src-extension/selectors.js`
**Action:** CREATE NEW FILE

**Code to write:**
```javascript
/**
 * GVP Bridge - Grok DOM Selectors
 * Reference: gvp-tiptap-prosemirror-injection KI
 */

// URL patterns for detecting post view
export const URL_PATTERNS = {
  POST_VIEW: /\/imagine\/post\/([a-f0-9-]+)/,
  GROK_BASE: /x\.com\/i\/grok/
};

// DOM selectors for Grok's UI
export const SELECTORS = {
  // TipTap/ProseMirror editor (prompt input)
  PROMPT_EDITOR: '[contenteditable="true"]',
  PROMPT_EDITOR_ALT: '[data-slate-editor="true"]',
  PROMPT_EDITOR_FALLBACK: '.ProseMirror',

  // Submit/send button
  SUBMIT_BUTTON: 'button[type="submit"]',
  SUBMIT_BUTTON_ALT: 'button[aria-label*="Send"]',
  SUBMIT_BUTTON_FALLBACK: 'button[data-testid="send-button"]',

  // Video mode toggle (if needed later)
  VIDEO_MODE_BUTTON: '[data-testid="video-mode-button"]',

  // Image in post view
  IMAGE_IN_POST: 'img[src*="/imagine/"]'
};

/**
 * Find the prompt editor element
 * @returns {HTMLElement|null}
 */
export function findPromptEditor() {
  for (const selector of Object.values(SELECTORS).filter(s => s.includes('editor') || s.includes('Editor'))) {
    const el = document.querySelector(selector);
    if (el && el.isContentEditable) {
      return el;
    }
  }
  // Fallback: find any contenteditable in main area
  return document.querySelector('[contenteditable="true"]');
}

/**
 * Find the submit/send button
 * @returns {HTMLElement|null}
 */
export function findSubmitButton() {
  for (const selector of [SELECTORS.SUBMIT_BUTTON, SELECTORS.SUBMIT_BUTTON_ALT, SELECTORS.SUBMIT_BUTTON_FALLBACK]) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/**
 * Extract imageId from current URL
 * @returns {string|null}
 */
export function extractImageIdFromUrl() {
  const match = window.location.pathname.match(URL_PATTERNS.POST_VIEW);
  return match ? match[1] : null;
}

/**
 * Check if we're on a Grok post view page
 * @returns {boolean}
 */
export function isOnPostView() {
  return URL_PATTERNS.POST_VIEW.test(window.location.pathname);
}

/**
 * Check if we're on Grok at all
 * @returns {boolean}
 */
export function isOnGrok() {
  return URL_PATTERNS.GROK_BASE.test(window.location.href);
}
```

---

## STEP 2 — Create ws-client.js

**File:** `src-extension/ws-client.js`
**Action:** CREATE NEW FILE

**Code to write:**
```javascript
/**
 * GVP Bridge - WebSocket Client
 * Connects to desktop app on port 8765
 */

const WS_PORT = 8765;
const WS_URL = `ws://localhost:${WS_PORT}`;

class WSClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.messageQueue = [];
    this.onMessageCallback = null;
  }

  /**
   * Connect to desktop app WebSocket server
   * @returns {Promise<boolean>}
   */
  connect() {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
          console.log('[GVP Bridge] WebSocket connected');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.flushMessageQueue();
          resolve(true);
        };

        this.ws.onclose = () => {
          console.log('[GVP Bridge] WebSocket disconnected');
          this.connected = false;
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[GVP Bridge] WebSocket error:', error);
          this.connected = false;
          resolve(false);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        console.error('[GVP Bridge] Failed to create WebSocket:', error);
        resolve(false);
      }
    });
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[GVP Bridge] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);

    setTimeout(() => {
      console.log(`[GVP Bridge] Reconnect attempt ${this.reconnectAttempts}`);
      this.connect();
    }, delay);
  }

  /**
   * Handle incoming message
   * @param {string} data
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('[GVP Bridge] Received:', message);

      if (this.onMessageCallback) {
        this.onMessageCallback(message);
      }
    } catch (error) {
      console.error('[GVP Bridge] Failed to parse message:', error);
    }
  }

  /**
   * Set message handler callback
   * @param {Function} callback
   */
  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  /**
   * Send message to desktop app
   * @param {Object} message
   */
  send(message) {
    const payload = {
      ...message,
      timestamp: Date.now()
    };

    if (this.connected && this.ws) {
      this.ws.send(JSON.stringify(payload));
    } else {
      // Queue message for later
      this.messageQueue.push(payload);
    }
  }

  /**
   * Flush queued messages
   */
  flushMessageQueue() {
    while (this.messageQueue.length > 0 && this.connected) {
      const message = this.messageQueue.shift();
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Request prompt from desktop app
   * @param {string} imageId
   */
  requestPrompt(imageId) {
    this.send({
      type: 'prompt_request',
      payload: { imageId }
    });
  }

  /**
   * Notify desktop app of URL change
   * @param {string} url
   * @param {string|null} imageId
   */
  notifyUrlChange(url, imageId) {
    this.send({
      type: 'url_changed',
      payload: { url, imageId }
    });
  }

  /**
   * Send status update to desktop app
   * @param {string} status
   * @param {Object} details
   */
  sendStatus(status, details = {}) {
    this.send({
      type: 'status',
      payload: { status, ...details }
    });
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}

// Export singleton instance
export const wsClient = new WSClient();
export default wsClient;
```

---

## STEP 3 — Create dom-ops.js

**File:** `src-extension/dom-ops.js`
**Action:** CREATE NEW FILE

**Code to write:**
```javascript
/**
 * GVP Bridge - DOM Operations
 * Handles prompt injection and submit actions
 * Reference: gvp-tiptap-prosemirror-injection KI, REFERENCE_ReactAutomation.md
 */

import { findPromptEditor, findSubmitButton } from './selectors.js';

/**
 * Inject text into the prompt editor
 * Uses synthetic events for React/TipTap compatibility
 * @param {string} text
 * @returns {boolean} success
 */
export function injectPrompt(text) {
  const editor = findPromptEditor();

  if (!editor) {
    console.error('[GVP Bridge] Prompt editor not found');
    return false;
  }

  try {
    // Focus the editor first
    editor.focus();

    // Clear existing content
    editor.textContent = '';

    // Create input event for React
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    });

    // Set the text content
    editor.textContent = text;

    // Dispatch input event to trigger React re-render
    editor.dispatchEvent(inputEvent);

    // Also dispatch a change event for good measure
    const changeEvent = new Event('change', { bubbles: true });
    editor.dispatchEvent(changeEvent);

    console.log('[GVP Bridge] Prompt injected:', text.substring(0, 50) + '...');
    return true;
  } catch (error) {
    console.error('[GVP Bridge] Failed to inject prompt:', error);
    return false;
  }
}

/**
 * Alternative injection using document.execCommand
 * Fallback for some React versions
 * @param {string} text
 * @returns {boolean} success
 */
export function injectPromptFallback(text) {
  const editor = findPromptEditor();

  if (!editor) {
    return false;
  }

  try {
    editor.focus();

    // Select all and delete
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    // Insert new text
    document.execCommand('insertText', false, text);

    return true;
  } catch (error) {
    console.error('[GVP Bridge] Fallback injection failed:', error);
    return false;
  }
}

/**
 * Press Enter key in the editor
 * @returns {boolean} success
 */
export function pressEnter() {
  const editor = findPromptEditor();

  if (!editor) {
    return false;
  }

  try {
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    editor.dispatchEvent(enterEvent);

    // Also dispatch keyup for completeness
    const enterUpEvent = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    editor.dispatchEvent(enterUpEvent);

    console.log('[GVP Bridge] Enter key pressed');
    return true;
  } catch (error) {
    console.error('[GVP Bridge] Failed to press Enter:', error);
    return false;
  }
}

/**
 * Click the submit/send button
 * @returns {boolean} success
 */
export function clickSubmit() {
  const button = findSubmitButton();

  if (!button) {
    console.error('[GVP Bridge] Submit button not found');
    return false;
  }

  try {
    // Try native click first
    button.click();

    console.log('[GVP Bridge] Submit button clicked');
    return true;
  } catch (error) {
    console.error('[GVP Bridge] Failed to click submit:', error);
    return false;
  }
}

/**
 * Submit the prompt (try Enter first, then button click)
 * @returns {boolean} success
 */
export function submitPrompt() {
  // Try Enter key first
  if (pressEnter()) {
    return true;
  }

  // Fallback to button click
  return clickSubmit();
}

/**
 * Full flow: inject prompt and submit
 * @param {string} text
 * @returns {Object} result
 */
export function injectAndSubmit(text) {
  const result = {
    injected: false,
    submitted: false,
    error: null
  };

  // Inject prompt
  result.injected = injectPrompt(text);

  if (!result.injected) {
    result.injected = injectPromptFallback(text);
  }

  if (!result.injected) {
    result.error = 'Failed to inject prompt';
    return result;
  }

  // Small delay before submitting
  setTimeout(() => {
    result.submitted = submitPrompt();

    if (!result.submitted) {
      result.error = 'Failed to submit prompt';
    }
  }, 100);

  return result;
}
```

---

## STEP 4 — Create content.js

**File:** `src-extension/content.js`
**Action:** CREATE NEW FILE

**Code to write:**
```javascript
/**
 * GVP Bridge - Content Script
 * Main entry point for the extension
 */

import { wsClient } from './ws-client.js';
import { injectPrompt, submitPrompt, injectAndSubmit } from './dom-ops.js';
import { isOnGrok, isOnPostView, extractImageIdFromUrl } from './selectors.js';

// Track last URL to detect changes
let lastUrl = window.location.href;
let urlCheckInterval = null;

/**
 * Initialize the extension
 */
async function init() {
  console.log('[GVP Bridge] Initializing...');

  // Only run on Grok
  if (!isOnGrok()) {
    console.log('[GVP Bridge] Not on Grok, skipping');
    return;
  }

  // Connect to desktop app
  const connected = await wsClient.connect();

  if (connected) {
    console.log('[GVP Bridge] Connected to desktop app');
    wsClient.sendStatus('ready', { url: window.location.href });
  } else {
    console.log('[GVP Bridge] Failed to connect to desktop app, will retry...');
  }

  // Set up message handler
  wsClient.onMessage(handleMessage);

  // Start URL monitoring
  startUrlMonitoring();

  // Check current URL state
  checkCurrentUrl();

  console.log('[GVP Bridge] Ready');
}

/**
 * Handle messages from desktop app
 * @param {Object} message
 */
function handleMessage(message) {
  console.log('[GVP Bridge] Handling message:', message.type);

  switch (message.type) {
    case 'prompt_response':
      // Desktop app sent the prompt
      handlePromptResponse(message.payload);
      break;

    case 'ping':
      wsClient.sendStatus('pong');
      break;

    default:
      console.log('[GVP Bridge] Unknown message type:', message.type);
  }
}

/**
 * Handle prompt response from desktop app
 * @param {Object} payload
 */
function handlePromptResponse(payload) {
  const { prompt, imageId } = payload;

  if (!prompt) {
    console.error('[GVP Bridge] No prompt in response');
    return;
  }

  console.log('[GVP Bridge] Received prompt for image:', imageId);

  // Inject and submit
  const result = injectAndSubmit(prompt);

  // Report result back to desktop app
  wsClient.sendStatus('injected', {
    success: result.injected && result.submitted,
    imageId,
    error: result.error
  });
}

/**
 * Start monitoring URL for changes
 */
function startUrlMonitoring() {
  // Check URL every 500ms
  urlCheckInterval = setInterval(() => {
    const currentUrl = window.location.href;

    if (currentUrl !== lastUrl) {
      console.log('[GVP Bridge] URL changed:', currentUrl);
      lastUrl = currentUrl;
      handleUrlChange(currentUrl);
    }
  }, 500);

  // Also listen for popstate (back/forward navigation)
  window.addEventListener('popstate', () => {
    handleUrlChange(window.location.href);
  });

  // And pushState/replaceState (SPA navigation)
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

/**
 * Handle URL change
 * @param {string} url
 */
function handleUrlChange(url) {
  // Notify desktop app of URL change
  const imageId = extractImageIdFromUrl();
  wsClient.notifyUrlChange(url, imageId);

  // If we're on a post view, request prompt
  if (isOnPostView() && imageId) {
    console.log('[GVP Bridge] On post view, requesting prompt for:', imageId);
    wsClient.requestPrompt(imageId);
  }
}

/**
 * Check current URL state on load
 */
function checkCurrentUrl() {
  const imageId = extractImageIdFromUrl();

  if (imageId) {
    console.log('[GVP Bridge] Already on post view:', imageId);
    wsClient.notifyUrlChange(window.location.href, imageId);
    // Don't auto-request on load - wait for user action
  }
}

/**
 * Cleanup on unload
 */
function cleanup() {
  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
  }
  wsClient.disconnect();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Export for testing
export { init, handleUrlChange, handleMessage };
```

---

## STEP 5 — Create manifest.json

**File:** `src-extension/manifest.json`
**Action:** CREATE NEW FILE

**Code to write:**
```json
{
  "manifest_version": 3,
  "name": "GVP Bridge",
  "version": "0.1.0",
  "description": "Bridge extension for GVP Desktop - connects to desktop app via WebSocket",
  "permissions": [
    "activeTab"
  ],
  "host_permissions": [
    "https://x.com/*",
    "https://*.x.com/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://x.com/i/grok*",
        "https://*.x.com/i/grok*"
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
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## STEP 6 — Create icons folder and placeholder

**File:** `src-extension/icons/icon16.png`
**Action:** CREATE FOLDER, placeholder icons (can use any 16x16, 48x48, 128x128 PNG)

For now, create the folder structure:
```
src-extension/
└── icons/
    ├── icon16.png   (placeholder)
    ├── icon48.png   (placeholder)
    └── icon128.png  (placeholder)
```

---

## STEP 7 — Create README for extension

**File:** `src-extension/README.md`
**Action:** CREATE NEW FILE

**Code to write:**
```markdown
# GVP Bridge - Chrome Extension

Minimal Chrome extension that bridges Grok to the GVP Desktop app.

## What It Does

1. Monitors URL changes on Grok (x.com/i/grok)
2. When user navigates to `/imagine/post/{imageId}`:
   - Notifies desktop app via WebSocket
   - Requests prompt from desktop app
   - Injects prompt into Grok's editor
   - Presses Enter to submit

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select this `src-extension` folder

## Configuration

The extension connects to the desktop app on `ws://localhost:8765`.

Make sure the desktop app is running before using the extension.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration (MV3) |
| `content.js` | Main content script |
| `ws-client.js` | WebSocket client |
| `dom-ops.js` | DOM operations (inject, click) |
| `selectors.js` | Grok DOM selectors |

## Development

This extension is intentionally minimal. All business logic lives in the desktop app.

Do NOT add:
- Complex state management
- UI components
- Settings pages
- Background scripts

The extension is a dumb bridge. Keep it that way.
```

---

## STEP 8 — Update HANDOVER.md

**File:** `.agents/HANDOVER.md`
**Action:** UPDATE EXISTING FILE

**Find this exact block:**
```markdown
## Priority Order for Next Session

1. **Create/Extract Knowledge Items**
   - Why: LLM needs reference material for implementation
   - Files to load: Original GVP KIs from `C:\Users\Greepo\.gemini\antigravity\knowledge\grok_video_prompter\artifacts\`

2. **Draft First Implementation Plan**
   - Why: Start with minimal extension - URL detection + WebSocket client
   - Files to load: KI-03 React Automation, KI-12 DOM Selectors
```

**Replace with:**
```markdown
## Priority Order for Next Session

1. **Implement Extension MVP** (PLAN-001)
   - Why: Core functionality needed before desktop app
   - Files: `src-extension/` (5 new files)
   - Status: Plan created, awaiting implementation

2. **Create Desktop App WebSocket Server**
   - Why: Extension needs something to connect to
   - Files: `src-desktop/`
   - Status: Not started, depends on Extension MVP
```

---

## VERIFICATION CHECKLIST

After completing all steps, verify:

| Check | Expected |
|-------|----------|
| `src-extension/manifest.json` exists | YES |
| `src-extension/content.js` exists | YES |
| `src-extension/ws-client.js` exists | YES |
| `src-extension/dom-ops.js` exists | YES |
| `src-extension/selectors.js` exists | YES |
| `src-extension/README.md` exists | YES |
| `src-extension/icons/` folder exists | YES |
| `.agents/HANDOVER.md` updated | YES |

---

## END OF PLAN

**STOP after completing all 8 steps.**
**Produce Work Report as specified in `/implement` workflow.**
