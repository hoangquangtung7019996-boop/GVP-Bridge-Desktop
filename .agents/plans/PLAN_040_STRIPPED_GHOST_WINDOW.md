# PLAN_040: Stripped Ghost Window Implementation

## Problem/Goal
Transition the GVP Bridge from the dead Fetch Harvester / API replay architecture to the approved "Stripped Ghost Window" approach. The Ghost Window is a Chrome window launched by the Desktop App (Tauri `std::process::Command`) running `grok.com/imagine/saved` with all media blocked at the network layer, CSS-cloaked, consuming ~50-80MB RAM. The extension's content script becomes a pure WS client + DOM automation worker. The `trigger_remote_fetch` handler switches from dispatching `GVP_HARVESTER_FIRE` (dead fetch replay) to calling `injectAndSubmitAsync()` directly (proven DOM automation).

## Architecture After This Plan
```
Desktop UI "🚀 Fire" click
  → Tauri command trigger_fire (EXISTING, keep)
  → broadcast push → WS handler sends trigger_remote_fetch (EXISTING, keep)
  → Ghost Window content script receives trigger_remote_fetch
  → Navigate to /imagine/post/{imageId} (click first gallery card)
  → waitForEditor() → injectPrompt() → clickSubmit() → returnToGallery()
  → Passive SSE parser reads /conversations/new response stream
  → Extracts videoUrl/imageUrl → CustomEvent → content script → WS → Desktop
  → Desktop displays result in Gallery panel
```

## Key Decisions
1. **Ghost Window Spawning**: Owned by Desktop App (Tauri Rust backend) via `std::process::Command` with `--user-data-dir` isolation. Extension does NOT create windows. Extension is a Dumb Bridge.
2. **Passive SSE Parser**: `gvpFetchInterceptor.js` is kept as a read-only response observer. It monitors `/conversations/new` and `/get_video_generation_result` responses, extracts video/image URLs via regex, and broadcasts them to the content script via `CustomEvent`. Zero request modification.
3. **CSS Cloaking**: Uses `opacity: 0.01` only. NO `pointer-events: none` (breaks React). NO `visibility: hidden` (breaks some React lifecycle checks).

## ⚠️ CRITICAL TRAPS — DO NOT VIOLATE
1. **CSS Cloak Trap**: Do NOT use `pointer-events: none` on `body`. It breaks React event delegation and synthetic clicks. Use ONLY `opacity: 0.01` and/or `filter: blur(10px)`.
2. **Virtualized List Trap**: Do NOT search DOM for a specific imageId `<a>` tag. Grok uses React Virtualized — old items don't exist in DOM. Target the FIRST available card: `document.querySelector('a[href*="/imagine/post/"]').click()`.
3. **Zombie Process Trap**: When Desktop spawns the Ghost Window via Tauri, it MUST use `--user-data-dir="C:\temp\grok-ghost-profile"` to isolate the PID. (Not in scope for this plan — future Rust work.)

## Scope
- **7 files modified**, **0 files created**, **0 files deleted**
- content.bundle.js: Strip to ~320 lines (WS client + DOM automation + CSS cloak + passive interceptor listener)
- gvpFetchInterceptor.js: Gut to passive read-only SSE/URL parser (~55 lines)
- background.js: Replace with declarativeNetRequest media blocking + ghost tab detection (NO window creation)
- manifest.json: Replace `webRequest` with `declarativeNetRequest` + `tabs`
- main.rs: Strip harvester state, strip harvester WS handlers, add `fire_result` handler
- PromptInput.tsx: Strip harvester toggle
- App.tsx: Strip harvester event listeners, add `fire-result` listener

---

## Step 1: Rewrite content.bundle.js
**File:** `src-extension/content.bundle.js`
**Action:** REPLACE_ENTIRE_FILE

**Rationale:** The current file is 1321 lines. Over 900 lines are harvester code, statsig panel, interceptor-harvester listeners, direct API calls, and dead mode logic. A clean rewrite to ~320 lines is cleaner than 15+ surgical find/replace blocks.

**Replace entire file with:**
```javascript
/**
 * GVP Bridge — Ghost Window Content Script
 * PLAN_040: Stripped to WS client + DOM automation + passive interceptor listener
 * 
 * This script runs in the Ghost Window (Chrome on /imagine/saved).
 * It receives commands from Desktop via WS, automates Grok's DOM, and reports back.
 * It also listens for video/image URLs from the passive fetch interceptor.
 * NO harvester. NO statsig. NO direct API calls. NO mode management.
 */

(function() {
  'use strict';

  // ============================================================================
  // CONSTANTS
  // ============================================================================

  const WS_URL = 'ws://127.0.0.1:8765';
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_DELAY = 3000;

  const URL_PATTERNS = {
    POST_VIEW: /\/imagine\/post\/([a-f0-9-]+)/,
    GROK_BASE: /grok\.com/
  };

  const SELECTORS = {
    PROMPT_EDITORS: [
      'div.tiptap.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][translate="no"].ProseMirror',
      'div.ProseMirror[contenteditable="true"]',
      'textarea[aria-label="Make a video"]',
      'textarea[placeholder="Type to customize video..."]',
      '[contenteditable="true"]'
    ],
    SUBMIT_BUTTONS: [
      'button[aria-label="Make video"]:has(svg path[d*="M6 11L12 5"])',
      'button[aria-label="Make video"]:has(.bg-button-filled)',
      'button[aria-label="Edit"]:has(svg path[d^="M6 11L12 5"])',
      'button[aria-label="Edit"]',
      'button[aria-label="Make video"]:has(svg path[d^="M12 4C"])',
      'button[aria-label="Make video"]',
      'button[type="submit"]'
    ]
  };

  // ============================================================================
  // UTILITY
  // ============================================================================

  function debug(...args) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] [GVP Ghost]`, ...args);
  }

  function findByText(selector, text, root = document) {
    const elements = root.querySelectorAll(selector);
    for (const el of elements) {
      if (el.textContent?.trim() === text) return el;
      const sr = el.querySelector('.sr-only');
      if (sr?.textContent?.trim() === text) return el;
      if (el.textContent?.includes(text)) return el;
    }
    return null;
  }

  // ============================================================================
  // DOM FINDERS
  // ============================================================================

  function findPromptEditor() {
    for (const selector of SELECTORS.PROMPT_EDITORS) {
      const el = document.querySelector(selector);
      if (el && el.isContentEditable) return el;
    }
    const allEditors = document.querySelectorAll('[contenteditable="true"]');
    for (const el of allEditors) {
      if (el.offsetParent !== null && el.isContentEditable) return el;
    }
    return null;
  }

  function findSubmitButton() {
    for (const selector of SELECTORS.SUBMIT_BUTTONS) {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch (e) { /* :has() might not be supported */ }
    }
    const editTexts = ['Edit', 'Make video', 'Submit'];
    for (const text of editTexts) {
      const btn = findByText('button', text);
      if (btn) return btn;
    }
    return null;
  }

  function isOnPostView() {
    return URL_PATTERNS.POST_VIEW.test(window.location.pathname);
  }

  function isOnGrok() {
    return URL_PATTERNS.GROK_BASE.test(window.location.href);
  }

  // ============================================================================
  // DOM AUTOMATION (PROVEN — copied verbatim from v0.5/v0.6)
  // ============================================================================

  function waitForEditor(timeout = 5000, interval = 100) {
    return new Promise((resolve) => {
      const editor = findPromptEditor();
      if (editor) { resolve(editor); return; }
      const startTime = Date.now();
      const poll = setInterval(() => {
        if (Date.now() - startTime > timeout) {
          clearInterval(poll);
          resolve(null);
          return;
        }
        const ed = findPromptEditor();
        if (ed && ed.offsetParent !== null) {
          clearInterval(poll);
          resolve(ed);
        }
      }, interval);
    });
  }

  function waitForSubmitButton(timeout = 5000) {
    return new Promise((resolve) => {
      const button = findSubmitButton();
      if (button) { resolve(button); return; }
      const startTime = Date.now();
      const poll = setInterval(() => {
        if (Date.now() - startTime > timeout) {
          clearInterval(poll);
          resolve(null);
          return;
        }
        const btn = findSubmitButton();
        if (btn) { clearInterval(poll); resolve(btn); }
      }, 100);
    });
  }

  async function injectPrompt(editor, text) {
    debug('Injecting prompt:', text.substring(0, 50) + '...');
    editor.focus();
    editor.textContent = '';
    const inputEvent = new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: text
    });
    editor.textContent = text;
    editor.dispatchEvent(inputEvent);
    editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    debug('Prompt injected');
    return true;
  }

  /**
   * React-compatible synthetic click. NO native .click() — causes double-fire.
   */
  function reactClick(element, elementName = 'element') {
    if (!element) return false;
    debug(`[reactClick] Clicking ${elementName}...`);
    try { element.focus({ preventScroll: true }); } catch (_) {}
    const dispatch = (type, Ctor = MouseEvent, extra = {}) => {
      element.dispatchEvent(new Ctor(type, {
        bubbles: true, cancelable: true, view: window, button: 0, ...extra
      }));
    };
    if (typeof PointerEvent === 'function') dispatch('pointerdown', PointerEvent);
    dispatch('mousedown');
    if (typeof PointerEvent === 'function') dispatch('pointerup', PointerEvent);
    dispatch('mouseup');
    dispatch('click');
    return true;
  }

  function clickSubmit(button) {
    return reactClick(button, 'Submit Button');
  }

  function simulateEscape() {
    ['keydown', 'keyup'].forEach(type => {
      document.dispatchEvent(new KeyboardEvent(type, {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
        bubbles: true, cancelable: true
      }));
    });
    return true;
  }

  async function returnToGallery(delayMs = 500) {
    await new Promise(r => setTimeout(r, delayMs));
    simulateEscape();
    await new Promise(r => setTimeout(r, 300));
    return !isOnPostView();
  }

  /**
   * Navigate to a post view by clicking the first gallery card.
   * CRITICAL: Do NOT search for a specific imageId — virtualized list won't have it.
   */
  async function navigateToPost(imageId) {
    if (isOnPostView()) {
      const currentId = window.location.pathname.match(URL_PATTERNS.POST_VIEW)?.[1];
      if (!imageId || currentId === imageId) {
        debug('Already on target post view');
        return true;
      }
      await returnToGallery(200);
    }

    const cardLink = document.querySelector('a[href*="/imagine/post/"]');
    if (!cardLink) {
      debug('No gallery card found to click');
      return false;
    }

    debug('Clicking first gallery card:', cardLink.getAttribute('href'));
    reactClick(cardLink, 'Gallery Card');
    await new Promise(r => setTimeout(r, 1500));
    
    const arrived = isOnPostView();
    debug('Arrived at post view:', arrived);
    return arrived;
  }

  /**
   * Full automation pipeline: navigate → inject → submit → return
   */
  async function injectAndSubmitAsync(prompt, imageId, maxAttempts = 3) {
    debug('injectAndSubmitAsync called:', prompt?.length, 'chars, imageId:', imageId);

    const navigated = await navigateToPost(imageId);
    if (!navigated) {
      return { success: false, error: 'Failed to navigate to post view' };
    }

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

      await injectPrompt(editor, prompt);
      await new Promise(r => setTimeout(r, 100));

      const submitted = clickSubmit(button);
      debug('Submit clicked:', submitted);

      const returned = await returnToGallery();
      
      return { success: submitted, returned, attempt };
    }
    
    return { success: false, error: 'Max attempts reached', attempts: maxAttempts };
  }

  // ============================================================================
  // CSS CLOAKING (Tier 2 — GPU savings)
  // ============================================================================

  function injectCSSCloak() {
    const style = document.createElement('style');
    style.id = 'gvp-ghost-cloak';
    style.textContent = `
      /* GHOST WINDOW CSS CLOAK — PLAN_040 */
      /* CRITICAL: Do NOT use pointer-events:none — breaks React event delegation */
      img, video, picture, canvas, svg:not([class*="icon"]), iframe {
        display: none !important;
      }
      * {
        animation: none !important;
        transition: none !important;
        background-image: none !important;
      }
      body {
        opacity: 0.01 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    debug('CSS cloak injected');
  }

  // ============================================================================
  // PASSIVE INTERCEPTOR LISTENER
  // Receives video/image URLs from gvpFetchInterceptor.js (page context)
  // and forwards them to Desktop via WebSocket
  // ============================================================================

  function setupPassiveInterceptorListener() {
    window.addEventListener('GVP_INTERCEPTOR_EVENT', (event) => {
      const { type, payload } = event.detail || {};
      if (!type) return;

      switch (type) {
        case 'GVP_FETCH_VIDEO_PROMPT': {
          debug('[Passive] Generation URL captured:', payload?.videoUrl || payload?.imageUrl);
          wsClient.send({
            type: 'generation_result',
            payload: {
              url: payload?.videoUrl || payload?.imageUrl || '',
              data: payload,
              timestamp: Date.now()
            }
          });
          break;
        }
        case 'GVP_FETCH_ERROR': {
          debug('[Passive] Generation error:', payload?.error);
          wsClient.send({
            type: 'generation_result',
            payload: {
              url: 'error',
              data: { error: payload?.error, status: payload?.status },
              timestamp: Date.now()
            }
          });
          break;
        }
        case 'GVP_FETCH_READY':
          debug('[Passive] Fetch interceptor ready');
          break;
        default:
          break;
      }
    });
    debug('Passive interceptor listener installed');
  }

  // ============================================================================
  // WEBSOCKET CLIENT
  // ============================================================================

  let ws = null;
  let reconnectAttempts = 0;
  let lastAction = 'None';

  const wsClient = {
    connect() {
      return new Promise((resolve) => {
        if (ws && ws.readyState === WebSocket.OPEN) { resolve(true); return; }
        debug('Connecting to', WS_URL);
        try { ws = new WebSocket(WS_URL); } catch (e) { resolve(false); return; }

        ws.onopen = () => {
          debug('Connected!');
          reconnectAttempts = 0;
          resolve(true);
        };
        ws.onclose = () => {
          debug('Disconnected');
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            setTimeout(() => wsClient.connect(), RECONNECT_DELAY);
          }
        };
        ws.onerror = () => { resolve(false); };
        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            handleMessage(message);
          } catch (e) { debug('Parse error:', e); }
        };
      });
    },
    send(message) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const json = typeof message === 'string' ? message : JSON.stringify(message);
        ws.send(json);
        return true;
      }
      return false;
    },
    disconnect() { if (ws) { ws.close(); ws = null; } },
    isConnected() { return ws && ws.readyState === WebSocket.OPEN; }
  };

  // ============================================================================
  // MESSAGE HANDLER
  // ============================================================================

  function handleMessage(message) {
    debug('Handling:', message.type);

    switch (message.type) {
      case 'trigger_remote_fetch': {
        // *** THE CORE HANDLER — Desktop pushes "fire now" ***
        const { prompt, imageId } = message.payload || {};
        debug('🚀 TRIGGER received — prompt:', prompt?.substring(0, 50), 'imageId:', imageId);
        lastAction = `Fire: ${prompt ? prompt.substring(0, 30) + '...' : 'no prompt'}`;

        if (!prompt) {
          wsClient.send({ type: 'fire_result', payload: { success: false, error: 'No prompt' }, timestamp: Date.now() });
          return;
        }

        injectAndSubmitAsync(prompt, imageId).then(result => {
          debug('Fire result:', JSON.stringify(result));
          wsClient.send({ type: 'fire_result', payload: result, timestamp: Date.now() });
        }).catch(err => {
          debug('Fire error:', err);
          wsClient.send({ type: 'fire_result', payload: { success: false, error: String(err) }, timestamp: Date.now() });
        });
        break;
      }

      case 'prompt_response': {
        const { prompt } = message.payload || {};
        if (!prompt) return;
        lastAction = `Injecting prompt (${prompt.length} chars)`;
        injectAndSubmitAsync(prompt, null).then(result => {
          wsClient.send({ type: 'status', payload: { status: 'injected', success: result.success, ...result }, timestamp: Date.now() });
        });
        break;
      }

      case 'mode_sync':
        debug('[mode_sync] Received (ghost window ignores modes)');
        break;

      case 'ping':
        wsClient.send({ type: 'status', payload: { status: 'pong', success: true }, timestamp: Date.now() });
        break;

      default:
        debug('Unknown message type:', message.type);
    }
  }

  // ============================================================================
  // URL MONITORING (simplified — just reports changes)
  // ============================================================================

  let lastUrl = window.location.href;

  function startUrlMonitoring() {
    setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        wsClient.send({
          type: 'url_changed',
          payload: { url: currentUrl, imageId: window.location.pathname.match(URL_PATTERNS.POST_VIEW)?.[1] || null },
          timestamp: Date.now()
        });
      }
    }, 500);
  }

  // ============================================================================
  // POPUP / BACKGROUND MESSAGE LISTENER
  // ============================================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'get_status':
        sendResponse({
          connected: wsClient.isConnected(),
          lastAction: lastAction,
          url: window.location.href,
          mode: 'ghost'
        });
        break;
      case 'force_connect':
        wsClient.connect();
        sendResponse({ received: true });
        break;
      case 'activate':
        sendResponse({ received: true });
        break;
      default:
        sendResponse({ unknown: true });
    }
    return true;
  });

  // ============================================================================
  // INIT
  // ============================================================================

  async function init() {
    debug('=== GHOST WINDOW INITIALIZING ===');
    debug('URL:', window.location.href);

    if (!isOnGrok()) { debug('Not on Grok, skipping'); return; }

    // Inject CSS cloak (Tier 2: hide all media, kill animations)
    injectCSSCloak();

    // Inject the passive fetch interceptor into page context
    try {
      const scriptId = 'gvp-interceptor-script';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = chrome.runtime.getURL('injected/gvpFetchInterceptor.js');
        (document.head || document.documentElement).appendChild(script);
        debug('Passive fetch interceptor injection started');
      }
    } catch (e) {
      debug('Error injecting interceptor:', e.message);
    }

    // Set up listener for video/image URLs from the passive interceptor
    setupPassiveInterceptorListener();

    // Connect to desktop
    const connected = await wsClient.connect();
    if (connected) {
      debug('Connected to desktop');
      wsClient.send({ type: 'status', payload: { status: 'ready', success: true, url: window.location.href }, timestamp: Date.now() });
    } else {
      debug('Failed to connect, will retry...');
    }

    startUrlMonitoring();
    debug('Ghost window ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeunload', () => wsClient.disconnect());
  debug('Ghost content script loaded');
})();
```

---

## Step 2: Gut gvpFetchInterceptor.js to Passive SSE Parser
**File:** `src-extension/injected/gvpFetchInterceptor.js`
**Action:** REPLACE_ENTIRE_FILE

**Rationale:** The current file is ~59KB of harvester/skeleton/replay code. All dead. Replace with a minimal passive observer that reads response streams from `/conversations/new` and `/get_video_generation_result`, extracts video/image URLs, and broadcasts them to the content script via `CustomEvent`. ZERO request modification.

**Replace entire file with:**
```javascript
/**
 * GVP Bridge — Passive Response Observer (PLAN_040)
 * 
 * READ-ONLY. Does NOT modify any requests or headers.
 * Monitors Grok API responses for video/image URLs and broadcasts them
 * to the content script context via CustomEvent('GVP_INTERCEPTOR_EVENT').
 * 
 * Events emitted:
 * - GVP_FETCH_VIDEO_PROMPT: { videoUrl, imageUrl, sourceUrl }
 * - GVP_FETCH_ERROR: { error, status }
 * - GVP_FETCH_READY: {}
 */

(function() {
  'use strict';

  const ORIGINAL_FETCH = window.fetch;

  /**
   * Broadcast event to content script (isolated world) via CustomEvent.
   */
  function broadcast(type, payload) {
    window.dispatchEvent(new CustomEvent('GVP_INTERCEPTOR_EVENT', {
      detail: { type, payload }
    }));
  }

  window.fetch = function(...args) {
    const request = new Request(...args);
    const url = request.url;

    // Only monitor generation-related endpoints
    const isConversationNew = url.includes('/rest/app-chat/conversations/new');
    const isVideoResult = url.includes('/get_video_generation_result');

    if (!isConversationNew && !isVideoResult) {
      return ORIGINAL_FETCH.apply(this, args);
    }

    return ORIGINAL_FETCH.apply(this, args).then(response => {
      // Clone to avoid consuming the body
      const clone = response.clone();
      
      clone.text().then(text => {
        try {
          // Extract video/image URLs from the response body via regex
          const videoMatch = text.match(/"videoUrl"\s*:\s*"([^"]+)"/);
          const imageMatch = text.match(/"imageUrl"\s*:\s*"([^"]+)"/);
          
          if (videoMatch || imageMatch) {
            broadcast('GVP_FETCH_VIDEO_PROMPT', {
              videoUrl: videoMatch ? videoMatch[1] : null,
              imageUrl: imageMatch ? imageMatch[1] : null,
              sourceUrl: url
            });
          }
        } catch (e) {
          // Silent — passive observer should never break the page
        }
      }).catch(() => {});

      return response;
    }).catch(err => {
      broadcast('GVP_FETCH_ERROR', {
        error: err.message || 'fetch_failed',
        status: 0
      });
      throw err; // Re-throw so the page's own error handling works
    });
  };

  broadcast('GVP_FETCH_READY', {});
  console.log('[GVP] Passive response observer loaded (PLAN_040)');
})();
```

---

## Step 3: Rewrite background.js (Ghost Tab Detection + Media Blocking ONLY)
**File:** `src-extension/background.js`
**Action:** REPLACE_ENTIRE_FILE

**Key Decision:** NO `chrome.windows.create()`. The extension is a Dumb Bridge. Ghost Window spawning is owned by the Desktop App (Tauri Rust backend, future `std::process::Command`). The background script simply detects ghost tabs and applies `declarativeNetRequest` session rules.

**Replace entire file with:**
```javascript
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
```

---

## Step 4: Update manifest.json — Replace Permissions
**File:** `src-extension/manifest.json`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```json
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "webRequest"
  ],
```

**Replace With:**
```json
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "declarativeNetRequest",
    "tabs"
  ],
```

---

## Step 5: Strip Harvester State from main.rs
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

### Step 5a: Remove harvester_mode from AppState

**Find Exact Block:**
```rust
pub struct AppState {
    pub current_prompt: String,
    pub connection_count: u32,
    pub last_status: String,
    pub last_url: String,
    pub last_image_id: String,
    pub preview_mode: bool,
    pub harvester_mode: bool,
    /// Broadcast channel for pushing messages FROM Tauri commands TO the WS handler
    pub ws_push_tx: broadcast::Sender<String>,
}

impl AppState {
    fn new() -> Self {
        let (tx, _) = broadcast::channel::<String>(16);
        Self {
            current_prompt: String::new(),
            connection_count: 0,
            last_status: "Ready".to_string(),
            last_url: String::new(),
            last_image_id: String::new(),
            preview_mode: false,
            harvester_mode: true,
            ws_push_tx: tx,
        }
    }
}
```

**Replace With:**
```rust
pub struct AppState {
    pub current_prompt: String,
    pub connection_count: u32,
    pub last_status: String,
    pub last_url: String,
    pub last_image_id: String,
    pub preview_mode: bool,
    /// Broadcast channel for pushing messages FROM Tauri commands TO the WS handler
    pub ws_push_tx: broadcast::Sender<String>,
}

impl AppState {
    fn new() -> Self {
        let (tx, _) = broadcast::channel::<String>(16);
        Self {
            current_prompt: String::new(),
            connection_count: 0,
            last_status: "Ready".to_string(),
            last_url: String::new(),
            last_image_id: String::new(),
            preview_mode: false,
            ws_push_tx: tx,
        }
    }
}
```

### Step 5b: Remove set/get_harvester_mode commands

**Find Exact Block:**
```rust
/// Set harvester mode
#[tauri::command]
fn set_harvester_mode(enabled: bool, state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let mut s = state.lock();
    s.harvester_mode = enabled;
    println!("[GVP Desktop] Harvester mode: {}", enabled);
    Ok(enabled)
}

/// Get harvester mode
#[tauri::command]
fn get_harvester_mode(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let s = state.lock();
    Ok(s.harvester_mode)
}
```

**Replace With:**
```rust
// Harvester commands removed in PLAN_040 (Ghost Window architecture)
```

### Step 5c: Remove harvesterMode from preview_card_clicked handler

**Find Exact Block:**
```rust
                            "preview_card_clicked" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");
                                println!("[GVP Desktop] Preview card clicked: {}", image_id);
                                
                                // Get current prompt, preview mode, and harvester mode
                                let (prompt, preview_mode, harvester_mode) = {
                                    let s = state.lock();
                                    (s.current_prompt.clone(), s.preview_mode, s.harvester_mode)
                                };
                                
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode,
                                        "harvesterMode": harvester_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });
                                
                                if let Err(e) = ws_sender.send(Message::Text(response.to_string())).await {
                                    println!("[GVP Desktop] Send error: {}", e);
                                    break;
                                }
                            }
```

**Replace With:**
```rust
                            "preview_card_clicked" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");
                                println!("[GVP Desktop] Preview card clicked: {}", image_id);
                                
                                let (prompt, preview_mode) = {
                                    let s = state.lock();
                                    (s.current_prompt.clone(), s.preview_mode)
                                };
                                
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });
                                
                                if let Err(e) = ws_sender.send(Message::Text(response.to_string())).await {
                                    println!("[GVP Desktop] Send error: {}", e);
                                    break;
                                }
                            }
```

### Step 5d: Remove harvesterMode from prompt_request handler

**Find Exact Block:**
```rust
                            // Extension requests prompt
                            "prompt_request" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");

                                // Store image ID
                                {
                                     let mut s = state.lock();
                                     s.last_image_id = image_id.to_string();
                                }

                                // Get current prompt, preview mode, and harvester mode
                                let (prompt, preview_mode, harvester_mode) = {
                                    let s = state.lock();
                                    (s.current_prompt.clone(), s.preview_mode, s.harvester_mode)
                                };

                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode,
                                        "harvesterMode": harvester_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });

                                if let Err(e) = ws_sender.send(Message::Text(response.to_string())).await {
                                    println!("[GVP Desktop] Send error: {}", e);
                                    break;
                                }

                                // Emit to frontend
                                let _ = app_handle.emit("prompt-sent", image_id);
                            }
```

**Replace With:**
```rust
                            // Extension requests prompt
                            "prompt_request" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");

                                {
                                     let mut s = state.lock();
                                     s.last_image_id = image_id.to_string();
                                }

                                let (prompt, preview_mode) = {
                                    let s = state.lock();
                                    (s.current_prompt.clone(), s.preview_mode)
                                };

                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });

                                if let Err(e) = ws_sender.send(Message::Text(response.to_string())).await {
                                    println!("[GVP Desktop] Send error: {}", e);
                                    break;
                                }

                                let _ = app_handle.emit("prompt-sent", image_id);
                            }
```

### Step 5e: Remove harvesterMode from mode_sync

**Find Exact Block:**
```rust
                                // When extension reports "ready", sync mode state
                                if status == "ready" {
                                    let (preview_mode, harvester_mode) = {
                                        let s = state.lock();
                                        (s.preview_mode, s.harvester_mode)
                                    };
                                    let mode_sync = serde_json::json!({
                                        "type": "mode_sync",
                                        "payload": {
                                            "previewMode": preview_mode,
                                            "harvesterMode": harvester_mode
                                        },
                                        "timestamp": chrono_timestamp()
                                    });
                                    if let Err(e) = ws_sender.send(Message::Text(mode_sync.to_string())).await {
                                        println!("[GVP Desktop] Mode sync send error: {}", e);
                                    } else {
                                        println!("[GVP Desktop] Sent mode_sync to extension (harvester={}, preview={})", harvester_mode, preview_mode);
                                    }
                                }
```

**Replace With:**
```rust
                                // When extension reports "ready", sync mode state
                                if status == "ready" {
                                    let preview_mode = {
                                        let s = state.lock();
                                        s.preview_mode
                                    };
                                    let mode_sync = serde_json::json!({
                                        "type": "mode_sync",
                                        "payload": {
                                            "previewMode": preview_mode
                                        },
                                        "timestamp": chrono_timestamp()
                                    });
                                    if let Err(e) = ws_sender.send(Message::Text(mode_sync.to_string())).await {
                                        println!("[GVP Desktop] Mode sync send error: {}", e);
                                    } else {
                                        println!("[GVP Desktop] Sent mode_sync to extension (preview={})", preview_mode);
                                    }
                                }
```

### Step 5f: Replace harvester WS handlers with fire_result handler

**Find Exact Block:**
```rust
                            // PLAN-038: HARVESTER WEB-BRIDGE EVENTS
                            "harvester_template_ready" => {
                                println!("[GVP Desktop] 🎯 Harvester Skeleton Ready!");
                                let _ = app_handle.emit("harvester-template-ready", payload);
                            }

                            "harvester_fire_result" => {
                                println!("[GVP Desktop] 🚀 Harvester Fire Completed!");
                                let _ = app_handle.emit("harvester-fire-result", payload);
                            }

                            "harvester_error" => {
                                eprintln!("[GVP Desktop] ❌ Harvester Error: {:?}", payload);
                                let _ = app_handle.emit("harvester-error", payload);
                            }
```

**Replace With:**
```rust
                            // PLAN_040: Ghost Window fire result
                            "fire_result" => {
                                println!("[GVP Desktop] 🚀 Fire result: {:?}", payload);
                                let _ = app_handle.emit("fire-result", payload);
                            }
```

### Step 5g: Remove harvester commands from invoke_handler

**Find Exact Block:**
```rust
        .invoke_handler(tauri::generate_handler![
            set_prompt,
            get_prompt,
            get_status,
            clear_prompt,
            set_preview_mode,
            get_preview_mode,
            set_harvester_mode,
            get_harvester_mode,
            trigger_fire,
        ])
```

**Replace With:**
```rust
        .invoke_handler(tauri::generate_handler![
            set_prompt,
            get_prompt,
            get_status,
            clear_prompt,
            set_preview_mode,
            get_preview_mode,
            trigger_fire,
        ])
```

---

## Step 6: Strip Harvester Toggle from PromptInput.tsx
**File:** `src-desktop/components/PromptInput.tsx`
**Action:** MODIFY_EXISTING

### Step 6a: Remove harvesterMode signal

**Find Exact Block:**
```tsx
    const [prompt, setPrompt] = createSignal('');
    const [isLoading, setIsLoading] = createSignal(false);
    const [previewMode, setPreviewMode] = createSignal(false);
    const [harvesterMode, setHarvesterMode] = createSignal(true);
    const [fireStatus, setFireStatus] = createSignal<string | null>(null);
    let textareaRef: HTMLTextAreaElement | undefined;
```

**Replace With:**
```tsx
    const [prompt, setPrompt] = createSignal('');
    const [isLoading, setIsLoading] = createSignal(false);
    const [previewMode, setPreviewMode] = createSignal(false);
    const [fireStatus, setFireStatus] = createSignal<string | null>(null);
    let textareaRef: HTMLTextAreaElement | undefined;
```

### Step 6b: Replace handleTogglePreview + handleToggleHarvester

**Find Exact Block:**
```tsx
    const handleTogglePreview = async () => {
        const newState = !previewMode();
        
        // Mutual exclusivity: Harvester and Preview cannot both be on
        if (newState && harvesterMode()) {
            await handleToggleHarvester();
        }

        setPreviewMode(newState);
        try {
            await invoke('set_preview_mode', { enabled: newState });
        } catch (error) {
            console.error('Failed to toggle preview mode:', error);
            setPreviewMode(!newState);
        }
    };

    const handleToggleHarvester = async () => {
        const newState = !harvesterMode();
        
        // Mutual exclusivity
        if (newState && previewMode()) {
            await handleTogglePreview();
        }

        setHarvesterMode(newState);
        try {
            await invoke('set_harvester_mode', { enabled: newState });
        } catch (error) {
            console.error('Failed to toggle harvester mode:', error);
            setHarvesterMode(!newState);
        }
    };
```

**Replace With:**
```tsx
    const handleTogglePreview = async () => {
        const newState = !previewMode();
        setPreviewMode(newState);
        try {
            await invoke('set_preview_mode', { enabled: newState });
        } catch (error) {
            console.error('Failed to toggle preview mode:', error);
            setPreviewMode(!newState);
        }
    };
```

### Step 6c: Update onMount

**Find Exact Block:**
```tsx
    onMount(() => {
        // Load existing state on mount
        Promise.all([
            invoke<string>('get_prompt'),
            invoke<boolean>('get_preview_mode'),
            invoke<boolean>('get_harvester_mode')
        ]).then(([savedPrompt, savedPreviewMode, savedHarvesterMode]) => {
            if (savedPrompt) {
                setPrompt(savedPrompt);
                adjustHeight();
            }
            setPreviewMode(savedPreviewMode);
            setHarvesterMode(savedHarvesterMode);
        }).catch(console.error);
    });
```

**Replace With:**
```tsx
    onMount(() => {
        Promise.all([
            invoke<string>('get_prompt'),
            invoke<boolean>('get_preview_mode')
        ]).then(([savedPrompt, savedPreviewMode]) => {
            if (savedPrompt) {
                setPrompt(savedPrompt);
                adjustHeight();
            }
            setPreviewMode(savedPreviewMode);
        }).catch(console.error);
    });
```

### Step 6d: Remove Harvester toggle from button row

**Find Exact Block:**
```tsx
                <div class="prompt-buttons">
                    <label class="preview-toggle" title="CAPTURES legitimate user fetches and replays them with new prompts. 99% reliable.">
                        <input 
                            type="checkbox" 
                            checked={harvesterMode()} 
                            onChange={handleToggleHarvester} 
                        />
                        <span style={{ color: '#646cff', fontWeight: 'bold' }}>🎯 Harvester</span>
                    </label>
                    <label class="preview-toggle" title="Intercept and display generations instead of auto-submitting">
```

**Replace With:**
```tsx
                <div class="prompt-buttons">
                    <label class="preview-toggle" title="Intercept and display generations instead of auto-submitting">
```

---

## Step 7: Strip Harvester Event Listeners from App.tsx
**File:** `src-desktop/App.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
            // Listen for harvester fire results
            await listen<any>('harvester-fire-result', (event) => {
                console.log('[GVP Desktop] 🚀 Harvester fire result:', event.payload);
            });

            await listen<any>('harvester-error', (event) => {
                console.error('[GVP Desktop] ❌ Harvester error:', event.payload);
            });

            await listen<any>('harvester-template-ready', (event) => {
                console.log('[GVP Desktop] 🎯 Skeleton template captured:', event.payload);
            });
```

**Replace With:**
```tsx
            // Listen for ghost window fire results (PLAN_040)
            await listen<any>('fire-result', (event) => {
                console.log('[GVP Desktop] 🚀 Fire result:', event.payload);
            });
```

---

## Verification Plan

### Build Verification
1. Run `npm run tauri dev` — confirm Rust compiles (no reference to `harvester_mode`)
2. Confirm SolidJS frontend compiles (no reference to `get_harvester_mode` or `handleToggleHarvester`)
3. Load extension in Chrome → no manifest errors, no console errors

### Manual Testing Sequence
1. Open `grok.com/imagine/saved` in Chrome (manually or via Desktop-spawned window later)
2. Verify background console: `[GVP BG] Ghost tab detected: {tabId}`
3. Verify background console: `Media block rules applied for ghost tab {tabId}`
4. In ghost tab's Network panel, confirm images/videos/fonts show `(blocked:other)`
5. Verify ghost tab content console: `[GVP Ghost] CSS cloak injected`
6. Verify ghost tab content console: `[GVP Ghost] Passive fetch interceptor injection started`
7. Start Desktop: `npm run tauri dev` → verify `[GVP Ghost] Connected to desktop`
8. Type prompt in Desktop → click "🚀 Fire"
9. Verify ghost console: `🚀 TRIGGER received`
10. Verify ghost navigates to first gallery card → injects prompt → clicks submit → returns
11. Verify ghost console: `Fire result: {"success":true,...}`
12. Verify Desktop shows `✅ Fire triggered`
13. After generation completes, verify `[Passive] Generation URL captured:` in ghost console
14. Verify Desktop Gallery panel shows the intercepted video/image URL

### Console Log Tags
- `[GVP Ghost]` — content script
- `[GVP BG]` — background service worker
- `[GVP Desktop]` — Rust backend
- `[GVP]` — passive fetch interceptor (page context)
- `[Passive]` — interceptor event listener (content script)
