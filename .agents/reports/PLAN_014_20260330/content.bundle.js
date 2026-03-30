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

  /**
   * Set up click handler for gallery cards in Preview Mode
   * Extracts imageId from clicked card and sends to desktop
   */
  function setupGalleryCardClickHandler() {
    document.addEventListener('click', (event) => {
      if (!interceptGenerations) return;
      
      // Find clicked gallery card - Grok uses masonry layout
      const card = event.target.closest('[class*="masonry"], [class*="gallery"], a[href*="/imagine/post/"]');
      if (!card) return;
      
      // Extract imageId from href or data attribute
      let imageId = null;
      
      // Method 1: From href
      const link = card.closest('a[href*="/imagine/post/"]');
      if (link) {
        const href = link.getAttribute('href');
        const match = href.match(/\/imagine\/post\/([a-f0-9-]{36})/);
        if (match) {
          imageId = match[1];
        }
      }
      
      // Method 2: From data attribute
      if (!imageId) {
        imageId = card.dataset.imageId || card.dataset.id;
      }
      
      // Method 3: From img src (assets.grok.com URLs contain UUID)
      if (!imageId) {
        const img = card.querySelector('img[src*="assets.grok.com"]');
        if (img) {
          const src = img.src;
          const match = src.match(/\/([a-f0-9-]{36})\//);
          if (match) {
            imageId = match[1];
          }
        }
      }
      
      if (imageId) {
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

    // Start Fetch Interception (Proxy)
    proxyFetch();

    // Set up gallery card click handler for Preview Mode
    setupGalleryCardClickHandler();

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
    
    // Generate trace IDs
    const traceId = crypto.randomUUID?.() || 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.random().toString(16)[2]);
    const requestId = crypto.randomUUID?.() || traceId;
    
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
    
    // Build anti-bot headers to match browser's normal request
    const headers = {
      'accept': '*/*',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'origin': 'https://grok.com',
      'priority': 'u=1, i',
      'referer': window.location.href,
      'sec-ch-ua': `"Google Chrome";v="${chromeVersion.split('.')[0]}", "Not.A/Brand";v="8", "Chromium";v="${chromeVersion.split('.')[0]}"`,
      'sec-ch-ua-arch': '"x86"',
      'sec-ch-ua-bitness': '"64"',
      'sec-Ch-ua-full-version': `"${chromeVersion}"`,
      'sec-ch-ua-full-version-list': `"Google Chrome";v="${chromeVersion}", "Not.A/Brand";v="8.0.0.0", "Chromium";v="${chromeVersion}"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-model': '""',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-platform-version': '"10.0.0"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': navigator.userAgent,
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

  /**
   * Proxy the global fetch function to intercept generation responses
   */
  function proxyFetch() {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].href : (args[0] && args[0].url));
      
      // CAPTURE: Steal x-statsig-id from Grok requests only
      try {
        const options = args[1] || {};
        const headers = options.headers;
        
        // Only capture from Grok domain
        if (headers && url && url.includes('grok.com')) {
          let sid = null;
          if (headers instanceof Headers) {
            sid = headers.get('x-statsig-id');
          } else if (typeof headers === 'object') {
            sid = headers['x-statsig-id'] || headers['X-Statsig-Id'];
          }
          
          if (sid && sid !== capturedStatsigId) {
            capturedStatsigId = sid;
            debug('Captured x-statsig-id:', sid.substring(0, 20) + '...');
            
            // Notify desktop that statsig is ready
            wsClient.send({
              type: 'statsig_captured',
              payload: { success: true },
              timestamp: Date.now()
            });
          }
        }
      } catch (e) {
        // Silently fail capture
      }

      const response = await originalFetch.apply(this, args);
      
      if (interceptGenerations && isGenerationUrl(url)) {
        // Clone response to read body without consuming it
        const cloned = response.clone();
        cloned.json().then(data => {
          handleGenerationResponse(url, data);
        }).catch(e => debug('Failed to parse generation JSON:', e));
      }
      
      return response;
    };
    debug('Fetch proxy installed');
  }

  function isGenerationUrl(url) {
    if (!url) return false;
    // Grok's generation endpoints
    return url.includes('/rest/app-chat/conversations/new') ||
           url.includes('/rest/app/grok/upscale') || 
           url.includes('/rest/app/grok/generate') ||
           url.includes('/rest/app/grok/get_video_generation_result');
  }

  function handleGenerationResponse(url, data) {
    debug('Intercepted generation response from:', url);
    // Send to desktop via WS
    wsClient.send({
      type: 'generation_result',
      payload: {
        url,
        data,
        timestamp: Date.now()
      }
    });
  }

  debug('Content script loaded');

})();
