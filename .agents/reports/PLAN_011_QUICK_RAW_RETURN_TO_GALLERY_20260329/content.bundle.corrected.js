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
    // Grok uses TipTap ProseMirror editor
    PROMPT_EDITORS: [
      'div.tiptap.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][translate="no"].ProseMirror',
      'div.ProseMirror[contenteditable="true"]',
      'textarea[aria-label="Make a video"]',
      'textarea[placeholder="Type to customize video..."]',
      '[contenteditable="true"]'  // fallback
    ],
    // Submit buttons - DIFFERENT depending on page context!
    // On /imagine (create): aria-label="Make video"
    // On /imagine/post/UUID (edit): aria-label="Edit" or "Make video" pill
    SUBMIT_BUTTONS: [
      // Primary video submit (up arrow icon)
      'button[aria-label="Make video"]:has(svg path[d*="M6 11L12 5"])',
      'button[aria-label="Make video"]:has(.bg-button-filled)',
      // Edit mode submit (on post view)
      'button[aria-label="Edit"]:has(svg path[d^="M6 11L12 5"])',
      'button[aria-label="Edit"]',
      // Pill button (promptless video)
      'button[aria-label="Make video"]:has(svg path[d^="M12 4C"])',
      // Fallbacks
      'button[aria-label="Make video"]',
      'button[type="submit"]'
    ],
    VIDEO_MODE_BUTTON: '[data-testid="video-mode-button"]',
    IMAGE_IN_POST: 'img[src*="/imagine/"]'
  };

  // Utility: Find element by text content
  function findByText(selector, text, root = document) {
    const elements = root.querySelectorAll(selector);
    for (const el of elements) {
      // Check direct text
      if (el.textContent?.trim() === text) return el;
      // Check sr-only spans
      const sr = el.querySelector('.sr-only');
      if (sr?.textContent?.trim() === text) return el;
      // Check partial match
      if (el.textContent?.includes(text)) return el;
    }
    return null;
  }

  // Utility: Try each selector, including function selectors
  function findFirst(selectors, root = document) {
    for (const selector of selectors) {
      try {
        if (typeof selector === 'function') {
          const el = selector();
          if (el) return el;
        } else {
          const el = root.querySelector(selector);
          if (el) return el;
        }
      } catch (e) { /* ignore invalid selectors */ }
    }
    return null;
  }

  function findPromptEditor() {
    for (const selector of SELECTORS.PROMPT_EDITORS) {
      const el = document.querySelector(selector);
      if (el && el.isContentEditable) {
        debug('Found editor with selector:', selector);
        return el;
      }
    }
    // Last resort: find any visible contenteditable
    const allEditors = document.querySelectorAll('[contenteditable="true"]');
    for (const el of allEditors) {
      if (el.offsetParent !== null && el.isContentEditable) {
        debug('Found editor via fallback scan');
        return el;
      }
    }
    return null;
  }

  function findSubmitButton() {
    // Try selector-based finding first
    for (const selector of SELECTORS.SUBMIT_BUTTONS) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          debug('Found submit button with selector:', selector);
          return el;
        }
      } catch (e) { /* :has() might not be supported */ }
    }

    // Fallback: find by text content
    const editTexts = ['Edit', 'Make video', 'Submit'];
    for (const text of editTexts) {
      const btn = findByText('button', text);
      if (btn) {
        debug('Found submit button by text:', text);
        return btn;
      }
    }

    // Last resort: any button with submit-like attributes
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const label = btn.getAttribute('aria-label') || '';
      if (label.includes('Edit') || label.includes('Submit') || label.includes('Make video')) {
        debug('Found submit button by aria-label fallback:', label);
        return btn;
      }
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

  /**
   * Simulate ESC key press to return to gallery
   * Grok uses ESC to close post view and return to /imagine/saved
   * 
   * CRITICAL: Only dispatch to document, and only keydown+keyup ONCE.
   * Dispatching to multiple targets (window, body, activeElement) causes
   * multiple ESC events which can escape out of Grok entirely.
   * This matches the OG extension's behavior exactly.
   */
  function simulateEscape() {
    debug('Simulating ESC key to return to gallery');
    
    // Match OG extension exactly: only dispatch to document, keydown then keyup
    ['keydown', 'keyup'].forEach(type => {
      const evt = new KeyboardEvent(type, {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true
        // NOTE: No 'composed: true' - that can cross shadow DOM boundaries
      });
      document.dispatchEvent(evt);
    });
    
    debug('ESC key events dispatched (keydown + keyup to document only)');
    return true;
  }

  /**
   * Return to gallery by pressing ESC
   * Waits briefly after submit, then simulates ESC
   * @param {number} delayMs - Delay before pressing ESC (default 500ms to match OG extension)
   */
  async function returnToGallery(delayMs = 500) {
    debug('Will return to gallery after', delayMs, 'ms');
    
    // Wait for submit to process (OG extension uses 500ms)
    await new Promise(r => setTimeout(r, delayMs));
    
    // Press ESC - single dispatch to document only
    simulateEscape();
    
    // Wait for navigation
    await new Promise(r => setTimeout(r, 300));
    
    // Verify we left the post view
    const leftPostView = !isOnPostView();
    debug('Left post view:', leftPostView);
    
    return leftPostView;
  }

  async function injectAndSubmitAsync(prompt, maxAttempts = 3) {
    debug('injectAndSubmitAsync called with prompt length:', prompt?.length || 0);
    debug('Current URL:', window.location.href);
    debug('Is on post view:', isOnPostView());
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      debug(`Attempt ${attempt}/${maxAttempts}`);
      
      // Log all contenteditable elements on page
      const allEditable = document.querySelectorAll('[contenteditable="true"]');
      debug(`Found ${allEditable.length} contenteditable elements on page`);
      allEditable.forEach((el, i) => {
        debug(`  [${i}] ${el.tagName}.${el.className.substring(0, 50)}`);
      });
      
      const editor = await waitForEditor(3000);
      if (!editor) {
        debug('Editor not found after 3s, retrying...');
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      debug('Editor found:', editor.tagName, editor.className);
      
      const button = await waitForSubmitButton(2000);
      if (!button) {
        debug('Submit button not found after 2s, retrying...');
        // Log all buttons for debugging
        const allButtons = document.querySelectorAll('button');
        debug(`Found ${allButtons.length} buttons on page`);
        allButtons.forEach((btn, i) => {
          const label = btn.getAttribute('aria-label') || btn.textContent?.substring(0, 30) || 'no-label';
          debug(`  [${i}] button aria-label="${label}"`);
        });
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      debug('Submit button found:', button.getAttribute('aria-label') || 'no-label');
      
      // Inject prompt
      const injected = await injectPrompt(editor, prompt);
      
      // Wait for React to process
      await new Promise(r => setTimeout(r, 100));
      
      // Submit
      const submitted = await clickSubmit(button);
      
      // Return to gallery after submit (500ms delay to match OG extension)
      let returnedToGallery = false;
      if (submitted) {
        returnedToGallery = await returnToGallery();
      }
      
      return { injected, submitted, returnedToGallery, attempt };
    }
    
    return { injected: false, submitted: false, returnedToGallery: false, error: 'Max attempts reached', attempts: maxAttempts };
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

    lastAction = result.submitted 
      ? (result.returnedToGallery ? 'Submitted, returned to gallery!' : 'Submitted (stayed on post)')
      : `Error: ${result.error || 'Unknown'}`;

    wsClient.sendStatus('injected', {
      success: result.injected && result.submitted,
      returnedToGallery: result.returnedToGallery,
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
