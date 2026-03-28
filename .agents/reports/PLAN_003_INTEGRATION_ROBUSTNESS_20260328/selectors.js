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

/**
 * Wait for the prompt editor to appear in DOM
 * @param {number} timeout - Max wait time in ms (default: 5000)
 * @param {number} interval - Poll interval in ms (default: 100)
 * @returns {Promise<HTMLElement|null>}
 */
export function waitForEditor(timeout = 5000, interval = 100) {
  return new Promise((resolve) => {
    // Check immediately
    const editor = findPromptEditor();
    if (editor) {
      resolve(editor);
      return;
    }

    const startTime = Date.now();
    
    const pollInterval = setInterval(() => {
      // Check timeout
      if (Date.now() - startTime > timeout) {
        clearInterval(pollInterval);
        console.warn('[GVP Bridge] Editor wait timeout');
        resolve(null);
        return;
      }

      // Try to find editor
      const editor = findPromptEditor();
      if (editor && editor.offsetParent !== null) { // Check visibility
        clearInterval(pollInterval);
        console.log('[GVP Bridge] Editor found after', Date.now() - startTime, 'ms');
        resolve(editor);
      }
    }, interval);
  });
}

/**
 * Wait for submit button to appear in DOM
 * @param {number} timeout - Max wait time in ms (default: 5000)
 * @returns {Promise<HTMLElement|null>}
 */
export function waitForSubmitButton(timeout = 5000) {
  return new Promise((resolve) => {
    const button = findSubmitButton();
    if (button) {
      resolve(button);
      return;
    }

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
