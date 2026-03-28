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
  const originalPopState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function(...args) {
    originalPopState.apply(history, args);
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
