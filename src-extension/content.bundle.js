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
   * Instant Teleport — soft-navigate to a post view using pushState + popstate.
   * NO hard reloads (preserves WS). NO DOM card clicking (virtualized list unreliable).
   * React's router listens for popstate and re-renders the post view.
   */
  async function teleportToPost(imageId) {
    if (!imageId) {
      debug('teleportToPost: no imageId provided');
      return false;
    }

    const currentId = window.location.pathname.match(URL_PATTERNS.POST_VIEW)?.[1];
    if (currentId === imageId) {
      debug('Already on target post:', imageId);
      return true;
    }

    debug('🚀 Teleporting to /imagine/post/' + imageId);
    window.history.pushState({}, '', '/imagine/post/' + imageId);
    window.dispatchEvent(new PopStateEvent('popstate'));

    // Wait for React to re-render and TipTap editor to mount
    const editor = await waitForEditor(8000);
    if (editor) {
      debug('Teleport successful — editor found');
      return true;
    }

    debug('Teleport: editor not found after timeout');
    return false;
  }

  /**
   * Full automation pipeline: navigate → inject → submit → return
   */
  async function injectAndSubmitAsync(prompt, imageId, maxAttempts = 3) {
    debug('injectAndSubmitAsync called:', prompt?.length, 'chars, imageId:', imageId);

    const navigated = await teleportToPost(imageId);
    if (!navigated) {
      return { success: false, error: 'Teleport failed — no editor found for imageId: ' + (imageId || 'none') };
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
      /* GHOST WINDOW CSS CLOAK — PLAN_041 (Softened) */
      /* declarativeNetRequest blocks media at network layer. */
      /* Body is near-invisible but fully interactive for TipTap + React. */
      /* NO display:none — breaks React Virtual DOM reconciliation. */
      * {
        animation: none !important;
        transition: none !important;
        background-image: none !important;
      }
      body {
        opacity: 0.01 !important;
        pointer-events: auto !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    debug('CSS cloak injected (soft — PLAN_041)');
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
  // GALLERY FETCH PROXY (authenticated via page cookies)
  // ============================================================================

  async function fetchGalleryPage(cursor = null) {
    debug('📥 Fetching gallery page, cursor:', cursor ? cursor.substring(0, 20) + '...' : 'null');
    try {
      const body = {
        limit: 400,
        filter: { source: "MEDIA_POST_SOURCE_LIKED" }
      };
      if (cursor) body.cursor = cursor;

      const response = await fetch('https://grok.com/rest/media/post/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include'
      });

      if (!response.ok) {
        debug('Gallery fetch failed:', response.status);
        return { posts: [], cursor: null, error: 'HTTP ' + response.status };
      }

      const data = await response.json();

      // Extract posts from various response shapes
      const posts = data?.result?.posts || data?.posts || data?.data?.posts || [];
      const nextCursor = data?.result?.cursor || data?.cursor || null;

      debug('Gallery fetch OK:', posts.length, 'posts, nextCursor:', nextCursor ? 'yes' : 'no');
      return { posts, cursor: nextCursor, error: null };
    } catch (err) {
      debug('Gallery fetch error:', err.message);
      return { posts: [], cursor: null, error: err.message };
    }
  }

  // ============================================================================
  // LEGACY IDB MIGRATION (GVP-IDB-V2 → Desktop SQLite)
  // ============================================================================

  /**
   * Reads all records from the legacy extension's IndexedDB (GVP-IDB-V2)
   * and sends them to the Desktop app via WebSocket in batches.
   * Data is already in nested UVH format (root + editedImages[] + videos[]).
   * Rust does NOT run ingest_gallery_batch — it inserts directly.
   */
  async function migrateLegacyIDB() {
    debug('🔄 Starting legacy IDB migration...');

    return new Promise((resolve) => {
      const openReq = indexedDB.open('GVP-IDB-V2');

      openReq.onerror = () => {
        debug('❌ Legacy IDB not found or access denied');
        resolve({ migrated: 0, error: 'IDB open failed' });
      };

      openReq.onsuccess = (event) => {
        const db = event.target.result;

        // Check if the store exists
        if (!db.objectStoreNames.contains('UVH_unifiedVideoHistory')) {
          debug('❌ UVH_unifiedVideoHistory store not found in GVP-IDB-V2');
          db.close();
          resolve({ migrated: 0, error: 'Store not found' });
          return;
        }

        const tx = db.transaction('UVH_unifiedVideoHistory', 'readonly');
        const store = tx.objectStore('UVH_unifiedVideoHistory');
        const getAllReq = store.getAll();

        getAllReq.onsuccess = () => {
          const records = getAllReq.result || [];
          debug(`📦 Found ${records.length} legacy UVH records`);

          if (records.length === 0) {
            db.close();
            resolve({ migrated: 0, error: null });
            return;
          }

          // Send in batches of 50 to avoid WS message size limits
          const BATCH_SIZE = 50;
          let sent = 0;

          for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            wsClient.send({
              type: 'legacy_idb_migration',
              payload: {
                records: batch,
                batchIndex: Math.floor(i / BATCH_SIZE),
                totalRecords: records.length,
                isFinal: (i + BATCH_SIZE) >= records.length
              },
              timestamp: Date.now()
            });
            sent += batch.length;
          }

          debug(`✅ Legacy migration: sent ${sent} records in ${Math.ceil(records.length / BATCH_SIZE)} batches`);
          db.close();
          resolve({ migrated: sent, error: null });
        };

        getAllReq.onerror = () => {
          debug('❌ Failed to read UVH store');
          db.close();
          resolve({ migrated: 0, error: 'getAll failed' });
        };
      };

      openReq.onupgradeneeded = () => {
        // DB doesn't exist — close and abort
        debug('Legacy IDB does not exist (onupgradeneeded fired)');
        openReq.transaction?.abort();
        resolve({ migrated: 0, error: 'IDB does not exist' });
      };
    });
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

      case 'fetch_gallery': {
        // Desktop requests gallery data. Fetch from Grok API and send back.
        const { cursor, force } = message.payload || {};
        debug('🔄 fetch_gallery — cursor:', cursor ? 'yes' : 'first page', 'force:', force);
        lastAction = 'Gallery sync...';

        fetchGalleryPage(cursor || null).then(result => {
          if (result.error) {
            debug('Gallery sync error:', result.error);
            wsClient.send({
              type: 'gallery_data',
              payload: { posts: [], cursor: null, error: result.error, force: !!force },
              timestamp: Date.now()
            });
          } else {
            debug('Sending', result.posts.length, 'posts to Desktop');
            wsClient.send({
              type: 'gallery_data',
              payload: { posts: result.posts, cursor: result.cursor, force: !!force },
              timestamp: Date.now()
            });
          }
          lastAction = `Synced ${result.posts?.length || 0} posts`;
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

      // PLAN_045: Extract and sync cookies to bypass WAF on Desktop Media Proxy
      chrome.runtime.sendMessage({ type: 'get_cookies' }, (response) => {
        if (response && response.cookies) {
          debug('Extracted grok.com cookies, syncing to desktop...');
          wsClient.send({ 
            type: 'sync_cookies', 
            payload: { cookies: response.cookies }, 
            timestamp: Date.now() 
          });
        }
      });

      // PLAN_042: Attempt legacy IDB migration on first connect
      migrateLegacyIDB().then(result => {
        debug('IDB migration result:', JSON.stringify(result));
      });
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
