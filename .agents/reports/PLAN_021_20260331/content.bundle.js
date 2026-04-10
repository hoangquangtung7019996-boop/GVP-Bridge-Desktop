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

  /**
   * React-compatible click that fires synthetic pointer/mouse events WITHOUT native .click()
   * Copied from OG extension's ReactAutomation.reactClick()
   * CRITICAL: Do NOT call button.click() - it causes double-fire with synthetic events!
   */
  function reactClick(element, elementName = 'element') {
    if (!element) {
      debug(`[reactClick] Cannot click ${elementName} - element not found`);
      return false;
    }

    debug(`[reactClick] Clicking ${elementName}...`);

    // Focus element first
    try {
      if (typeof element.focus === 'function') {
        element.focus({ preventScroll: true });
      }
    } catch (_) {
      // Ignore focus errors
    }

    // Event dispatcher helper
    const dispatch = (type, EventCtor = MouseEvent, extraInit = {}) => {
      const init = {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        ...extraInit
      };
      element.dispatchEvent(new EventCtor(type, init));
    };

    // Full pointer event sequence (matches OG extension exactly)
    if (typeof PointerEvent === 'function') {
      dispatch('pointerdown', PointerEvent);
    }
    dispatch('mousedown');
    if (typeof PointerEvent === 'function') {
      dispatch('pointerup', PointerEvent);
    }
    dispatch('mouseup');
    dispatch('click');  // SINGLE synthetic click - NO native .click()!

    debug(`[reactClick] Clicked ${elementName}`);
    return true;
  }

  /**
   * Submit button click wrapper using reactClick
   */
  function clickSubmit(button) {
    debug('[clickSubmit] Calling reactClick on submit button');
    return reactClick(button, 'Submit Button');
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
      
      // Submit (using reactClick - NO native .click(), sync call)
      debug('[injectAndSubmitAsync] About to click submit button...');
      const submitted = clickSubmit(button);
      debug('[injectAndSubmitAsync] Submit clicked, result:', submitted);
      
      // Return to gallery after submit (500ms delay to match OG extension)
      // BUT ONLY IF we are NOT in Preview Mode (intercepting)
      // In preview mode, we stay on the page to watch the generation
      let returnedToGallery = false;
      if (submitted && !interceptGenerations) {
        returnedToGallery = await returnToGallery();
      } else if (submitted && interceptGenerations) {
        debug('[injectAndSubmitAsync] Preview Mode active - skipping return to gallery');
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
  
  // === DEDUPLICATION & LOCKING (Fix for multiple API calls) ===
  let lastPromptedImageId = null;        // Last imageId we requested prompt for
  let isProcessingPrompt = false;        // Lock while processing
  let lastPromptRequestTime = 0;         // Timestamp of last request
  const PROMPT_REQUEST_COOLDOWN = 2000;  // 2 second cooldown between requests
  let interceptGenerations = false;      // Whether to intercept and preview generations
  let capturedStatsigId = null;          // Captured Statsig ID for direct API calls
  let statsigStatusPanel = null;      // UI panel element
  let previewModeActive = false;       // Preview mode state

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

  function createStatsigPanel() {
    if (statsigStatusPanel) {
      document.body.removeChild(statsigStatusPanel);
    }
    
    statsigStatusPanel = document.createElement('div');
    statsigStatusPanel.id = 'gvp-statsig-panel';
    statsigStatusPanel.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      min-width: 200px;
      background: #1a1a1a;
      border-radius: 12px;
      padding: 12px 16px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      color: white;
      z-index: 2147483647;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.1);
    `;
    
    updateStatsigPanel();
    document.body.appendChild(statsigStatusPanel);
    
    debug('[Statsig Panel] Created UI panel');
  }

  function updateStatsigPanel() {
    if (!statsigStatusPanel) return;
    
    const hasStatsig = !!capturedStatsigId;
    const statusColor = hasStatsig ? '#22c55e' : '#ef4444';
    const statusIcon = hasStatsig ? '🟢' : '🔴';
    const statusText = hasStatsig ? 'GVP Ready' : 'No Statsig';
    const statsigDisplay = hasStatsig 
      ? capturedStatsigId.substring(0, 24) + '...' 
      : 'Navigate to capture';
    
    statsigStatusPanel.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
        <span style="font-size: 16px;">${statusIcon}</span>
        <span style="font-weight: 600; color: ${statusColor};">${statusText}</span>
      </div>
      <div style="font-size: 11px; color: #888; margin-bottom: 4px;">Statsig:</div>
      <div style="font-family: monospace; font-size: 11px; color: #ccc; margin-bottom: 12px; word-break: break-all;">
        ${statsigDisplay}
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="gvp-toggle-preview" style="
          flex: 1;
          padding: 8px 12px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: ${hasStatsig ? 'pointer' : 'not-allowed'};
          background: ${previewModeActive ? '#22c55e' : '#374151'};
          color: white;
          opacity: ${hasStatsig ? 1 : 0.5};
        ">
          Preview: ${previewModeActive ? 'ON' : 'OFF'}
        </button>
        <button id="gvp-refresh-statsig" style="
          padding: 8px 12px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          background: #3b82f6;
          color: white;
        ">
          ↻ Refresh
        </button>
      </div>
    `;
    
    // Add button handlers
    const toggleBtn = document.getElementById('gvp-toggle-preview');
    const refreshBtn = document.getElementById('gvp-refresh-statsig');
    
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (!capturedStatsigId) return;
        previewModeActive = !previewModeActive;
        updateStatsigPanel();
        wsClient.send({
          type: 'preview_mode_changed',
          payload: { active: previewModeActive },
          timestamp: Date.now()
        });
        debug('[Statsig Panel] Preview mode:', previewModeActive ? 'ON' : 'OFF');
      });
    }
    
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        debug('[Statsig Panel] Manual statsig refresh requested');
        // Clear current statsig to show we're looking
        capturedStatsigId = null;
        updateStatsigPanel();
        // The next API call will capture it automatically
      });
    }
  }

  /**
   * Set up click handler for gallery cards in Preview Mode
   * Extracts imageId from clicked card and sends to desktop
   * 
   * CRITICAL: Must find the ACTUAL gallery card link, not parent containers
   */
  function setupGalleryCardClickHandler() {
    document.addEventListener('click', (event) => {
      if (!interceptGenerations) return;
      
      // Extract imageId - start from the clicked element and work up/down
      let imageId = null;
      let targetElement = event.target;
      
      // Method 1: Check if clicked element (or parent) is a gallery card link
      // Look for: a[href*="/imagine/post/"] - this is the most reliable selector
      let cardLink = targetElement.closest('a[href*="/imagine/post/"]');
      
      if (cardLink) {
        const href = cardLink.getAttribute('href');
        const match = href.match(/\/imagine\/post\/([a-f0-9-]{36})/i);
        if (match) {
          imageId = match[1];
          debug('[Gallery Click] Found imageId from card link:', imageId);
        }
      }
      
      // Method 2: Check for data attributes on the card element
      if (!imageId) {
        // Look for common gallery card containers
        const cardContainer = targetElement.closest('[class*="masonry-item"], [class*="gallery-item"], [data-image-id], [data-id]');
        if (cardContainer) {
          imageId = cardContainer.dataset.imageId || cardContainer.dataset.id;
          if (imageId) {
            debug('[Gallery Click] Found imageId from data attribute:', imageId);
          }
        }
      }
      
      // Method 3: Extract from img src URL (assets.grok.com contains the UUID)
      if (!imageId) {
        const img = targetElement.closest('img') || targetElement.querySelector('img');
        if (img && img.src) {
          // Try to match UUID in the URL path
          const srcMatch = img.src.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
          if (srcMatch) {
            imageId = srcMatch[1];
            debug('[Gallery Click] Found imageId from img src:', imageId);
          }
        }
      }
      
      // Method 4: Check background-image of the clicked element
      if (!imageId) {
        const elementWithBg = targetElement.closest('[style*="background-image"]');
        if (elementWithBg) {
          const bgStyle = elementWithBg.style.backgroundImage || '';
          const bgMatch = bgStyle.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
          if (bgMatch) {
            imageId = bgMatch[1];
            debug('[Gallery Click] Found imageId from background-image:', imageId);
          }
        }
      }
      
      if (imageId) {
        // VALIDATE: Ensure this looks like a valid image UUID (not account ID or other)
        // Image IDs should match the pattern and NOT be the user's account ID
        const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
        if (!uuidPattern.test(imageId)) {
          debug('[Gallery Click] WARNING: imageId does not match UUID pattern:', imageId);
          return;
        }
        
        debug('[Gallery Click] Preview Mode card clicked, imageId:', imageId);
        event.preventDefault();
        event.stopPropagation();
        
        // Send to desktop - desktop will respond with prompt_response
        wsClient.send({
          type: 'preview_card_clicked',
          payload: { imageId },
          timestamp: Date.now()
        });
        
        lastAction = `Preview: Card selected (${imageId.substring(0, 8)}...)`;
      }
    }, true); // Use capture phase to catch before navigation
  }

  /**
   * Listen for OG Extension's fetch interceptor broadcasts
   * OG's gvpFetchInterceptor.js runs in page context and broadcasts:
   * - GVP_FETCH_CONVERSATION_REQUEST: Contains headers including x-statsig-id
   * - GVP_FETCH_VIDEO_PROMPT: Generation completed with video/image URL
   * - GVP_FETCH_PROGRESS: Generation progress updates
   * - GVP_FETCH_ERROR: Error responses
   */
  function setupOGInterceptorListener() {
    window.addEventListener('message', (event) => {
      // Only accept messages from the page context
      if (event.source !== window) return;
      
      // Only accept messages from OG's interceptor
      if (event.data?.source !== 'gvp-fetch-interceptor') return;
      
      const { type, payload } = event.data;
      
      switch (type) {
        // Capture x-statsig-id from outgoing Grok requests
        case 'GVP_FETCH_CONVERSATION_REQUEST': {
          const headers = payload?.headers;
          if (headers) {
            // Headers are serialized as lowercase keys
            const statsigId = headers['x-statsig-id'];
            if (statsigId && statsigId !== capturedStatsigId) {
              capturedStatsigId = statsigId;
              debug('[OG Interceptor] Captured x-statsig-id:', statsigId.substring(0, 20) + '...');
              updateStatsigPanel();
              
              // Notify desktop that statsig is ready
              wsClient.send({
                type: 'statsig_captured',
                payload: { success: true },
                timestamp: Date.now()
              });
            }
          }
          break;
        }

        case 'GVP_FETCH_STATSIG_CAPTURED': {
          const statsigId = payload?.statsigId;
          if (statsigId && statsigId !== capturedStatsigId) {
            capturedStatsigId = statsigId;
            debug('[OG Interceptor] Captured x-statsig-id from', payload?.url);
            updateStatsigPanel();
            wsClient.send({
              type: 'statsig_captured',
              payload: { success: true },
              timestamp: Date.now()
            });
          }
          break;
        }
        
        // Forward generation results to desktop app
        case 'GVP_FETCH_VIDEO_PROMPT': {
          debug('[OG Interceptor] Generation completed:', payload?.videoUrl || payload?.imageUrl);
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
        
        // Forward progress updates (optional, for future UI)
        case 'GVP_FETCH_PROGRESS': {
          debug('[OG Interceptor] Progress:', payload?.progress + '%');
          // Optionally forward to desktop for progress bar
          // wsClient.send({ type: 'progress', payload });
          break;
        }
        
        // Forward error responses
        case 'GVP_FETCH_ERROR': {
          debug('[OG Interceptor] Error:', payload?.error);
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
        
        // Interceptor ready signal
        case 'GVP_FETCH_READY': {
          debug('[OG Interceptor] Fetch interceptor is ready');
          break;
        }
        
        default:
          // Ignore other message types
          break;
      }
    });
    
    debug('OG Interceptor listener installed');
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

    // Set up OG Extension interceptor listener (captures statsig-id + generation results)
    setupOGInterceptorListener();

    // Set up gallery card click handler for Preview Mode
    setupGalleryCardClickHandler();

    // Check current URL state
    checkCurrentUrl();

    // Create full status panel
    createStatsigPanel();

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
    const { prompt, imageId, previewMode } = payload;

    // Update interception state from desktop
    interceptGenerations = !!previewMode;
    debug('[handlePromptResponse] Intercept generations:', interceptGenerations);

    // PREVIEW MODE: Direct API call instead of UI interaction
    if (interceptGenerations) {
      debug('[handlePromptResponse] PREVIEW MODE - sending direct generation request');
      lastAction = 'Preview: Direct API request';
      sendDirectGenerationRequest(imageId, prompt);
      return;
    }

    // NORMAL MODE: UI injection and submission
    if (!prompt) {
      debug('[handlePromptResponse] No prompt in response');
      lastAction = 'Error: No prompt';
      return;
    }

    // LOCKING: Prevent multiple concurrent prompt processing
    if (isProcessingPrompt) {
      debug('[handlePromptResponse] BLOCKED - already processing another prompt');
      return;
    }
    
    isProcessingPrompt = true;
    debug('[handlePromptResponse] LOCK ACQUIRED for image:', imageId);
    lastAction = `Injecting prompt (${prompt.length} chars)`;

    try {
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
    } finally {
      // Always release lock
      isProcessingPrompt = false;
      debug('[handlePromptResponse] LOCK RELEASED');
      
      // Clear lastPromptedImageId after a delay (allow re-processing if user navigates back)
      setTimeout(() => {
        if (lastPromptedImageId === imageId) {
          lastPromptedImageId = null;
          debug('[handlePromptResponse] Cleared lastPromptedImageId');
        }
      }, 1000);
    }
  }

  /**
   * Send direct generation request for Preview Mode
   * Uses the CORRECT Grok API: /rest/app-chat/conversations/new
   */
  async function sendDirectGenerationRequest(imageId, prompt) {
    debug('[sendDirectGenerationRequest] Starting direct API call for imageId:', imageId);
    debug('[sendDirectGenerationRequest] Prompt:', prompt?.substring(0, 50) || '(none)');
    
    // Generate CONSISTENT trace IDs for Anti-Bot compliance
    const traceId = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const spanId = Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const sentryTraceId = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const sentrySpanId = Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const requestId = crypto.randomUUID();
    
    // Construct the public share URL for the image
    const imageUrl = `https://imagine-public.x.ai/imagine-public/share-images/${imageId}.png`;
    
    // Build message: image URL + prompt + mode flag
    const modeFlag = prompt ? '--mode=custom' : '--mode=normal';
    const message = prompt 
      ? `${imageUrl} ${prompt} ${modeFlag}`
      : `${imageUrl} ${modeFlag}`;
    
    // Build the payload matching Grok's expected structure
    const payload = {
      temporary: true,
      modelName: "grok-3",
      enableSideBySide: true,
      message: message,
      responseMetadata: {
        experiments: [],
        modelConfigOverride: {
          modelMap: {
            videoGenModelConfig: {
              parentPostId: imageId,
              aspectRatio: "1:1",
              videoLength: 10,
              resolutionName: "480p",
              isRootCelebrity: false,
              isRootChild: false,
              isRootRRated: false,
              isRootUserUploaded: false
            }
          }
        }
      },
      toolOverrides: {
        videoGen: true
      }
    };
    
    debug('[sendDirectGenerationRequest] Payload:', JSON.stringify(payload, null, 2));
    
    // Get Chrome version from navigator
    const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '147.0.7727.24';
    
    // Build clean API headers. Do NOT set forbidden browser headers manually.
    // Chrome will natively attach the correct TLS fingerprints, cookies, sec-ch, and CORS headers.
    const headers = {
      'accept': '*/*',
      'baggage': `sentry-environment=production,sentry-release=75e6c8571451414ca5f1b05a61f7ce291aac10c4,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c,sentry-trace_id=${sentryTraceId},sentry-org_id=4508179396558848,sentry-sampled=false,sentry-sample_rand=${Math.random()},sentry-sample_rate=0`,
      'content-type': 'application/json',
      'priority': 'u=1, i',
      'sentry-trace': `${sentryTraceId}-${sentrySpanId}-0`,
      'traceparent': `00-${traceId}-${spanId}-00`,
      'x-trace-id': traceId,
      'x-xai-request-id': requestId
    };

    // Reuse captured Statsig ID if available (critical for anti-bot)
    if (capturedStatsigId) {
      debug('[sendDirectGenerationRequest] Adding captured x-statsig-id:', capturedStatsigId);
      headers['x-statsig-id'] = capturedStatsigId;
    } else {
      debug('[WARN] No statsig-id captured - Preview Mode may trigger anti-bot!');
      debug('[WARN] Navigate around Grok first to capture a statsig-id');
      // Still proceed, but will likely fail
    }

    // Also send warning to desktop app
    wsClient.send({
      type: 'generation_result',
      payload: {
        url: 'preview-mode-warning',
        data: { 
          warning: capturedStatsigId ? null : 'No statsig-id captured - may trigger anti-bot',
          hasStatsig: !!capturedStatsigId
        },
        timestamp: Date.now()
      }
    });

    debug('[sendDirectGenerationRequest] Headers:', JSON.stringify(headers, null, 2));
    
    try {
      const response = await fetch('https://grok.com/rest/app-chat/conversations/new', {
        method: 'POST',
        headers: headers,
        credentials: 'include',  // Include cookies for auth
        body: JSON.stringify(payload)
      });
      
      debug('[sendDirectGenerationRequest] Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API returned ${response.status}: ${errorText}`);
      }
      
      // The response is a stream - the fetch proxy will intercept it
      debug('[sendDirectGenerationRequest] Request sent successfully, stream will be intercepted');
      lastAction = 'Preview: Generation started';
      
    } catch (error) {
      debug('[sendDirectGenerationRequest] Error:', error);
      lastAction = `Preview error: ${error.message}`;
      
      // Send error to desktop
      wsClient.send({
        type: 'generation_result',
        payload: {
          url: 'https://grok.com/rest/app-chat/conversations/new',
          data: { error: error.message },
          timestamp: Date.now()
        }
      });
    }
  }

  /**
   * Debounced URL change handler to prevent multiple rapid calls
   * Uses timestamp-based debouncing at entry point
   */
  let urlChangeDebounceTimer = null;
  
  function startUrlMonitoring() {
    // Only use setInterval polling - it's the most reliable
    // Remove duplicate listeners from popstate/pushState/replaceState
    urlCheckInterval = setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        debug('[URL Monitor] URL changed:', currentUrl);
        lastUrl = currentUrl;
        debouncedHandleUrlChange(currentUrl);
      }
    }, 200);  // Faster polling (200ms) but with debounce protection

    // Keep popstate for browser back/forward, but debounced
    window.addEventListener('popstate', () => {
      debug('[URL Monitor] popstate event');
      debouncedHandleUrlChange(window.location.href);
    });
  }

  /**
   * Debounce wrapper for handleUrlChange
   * Prevents multiple calls within 300ms window
   */
  function debouncedHandleUrlChange(url) {
    clearTimeout(urlChangeDebounceTimer);
    urlChangeDebounceTimer = setTimeout(() => {
      handleUrlChange(url);
    }, 100);  // 100ms debounce
  }

  /**
   * Handle URL change with deduplication and locking
   */
  function handleUrlChange(url) {
    const imageId = extractImageIdFromUrl();
    
    // Always notify desktop of URL change (for status display)
    wsClient.notifyUrlChange(url, imageId);

    // In Preview Mode, don't trigger prompt requests via URL navigation
    if (interceptGenerations) {
      debug('[handleUrlChange] PREVIEW MODE - skipping prompt request');
      return;
    }

    // DEDUPLICATION CHECK: Only request prompt if:
    const now = Date.now();
    
    if (isOnPostView() && imageId) {
      // Check all deduplication conditions
      if (isProcessingPrompt) {
        debug('[handleUrlChange] BLOCKED - already processing prompt');
        return;
      }
      
      if (imageId === lastPromptedImageId) {
        debug('[handleUrlChange] BLOCKED - already requested this imageId:', imageId);
        return;
      }
      
      if (now - lastPromptRequestTime < PROMPT_REQUEST_COOLDOWN) {
        debug('[handleUrlChange] BLOCKED - cooldown active, ms since last:', now - lastPromptRequestTime);
        return;
      }
      
      // All checks passed - request the prompt
      debug('[handleUrlChange] Requesting prompt for:', imageId);
      lastAction = `Requesting prompt for ${imageId}`;
      lastPromptedImageId = imageId;
      lastPromptRequestTime = now;
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
