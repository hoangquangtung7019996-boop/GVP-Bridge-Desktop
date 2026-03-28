# Implementation Plan — Integration Robustness & Error Handling

**Plan ID:** PLAN-003
**Feature:** Integration Robustness
**Target:** `src-extension/` and `src-tauri/`
**Date:** 2025-03-28
**Depends On:** PLAN-001 (Extension MVP) ✅, PLAN-002 (Desktop App) ✅

---

## Overview

Improve the robustness of the Extension ↔ Desktop integration by adding:

1. **Editor Wait Logic** - Poll for TipTap editor before injection
2. **Retry Mechanism** - Retry injection up to 3 times on failure
3. **Proper Async Flow** - Convert `injectAndSubmit` to async Promise
4. **Connection Heartbeat** - Ping/pong to detect stale connections
5. **Connection Timeout** - Fail fast if WebSocket won't connect
6. **Enhanced Selectors** - More comprehensive TipTap/ProseMirror selectors

**Total Steps:** 8
**Estimated Files:** 4 files modified

---

## Problem Statements

| Issue | Current Behavior | Desired Behavior |
|-------|------------------|------------------|
| Editor not found | Returns `false` immediately | Waits up to 5s for editor to appear |
| Injection fails | Single attempt, then gives up | Retry up to 3 times with delays |
| Async timing | `injectAndSubmit` returns sync, submit happens async | Proper Promise-based flow |
| Stale connection | No detection until next message fails | Heartbeat ping every 30s |
| Connection slow | Hangs indefinitely | Timeout after 10s |

---

## Target Files

| File | Action | Purpose |
|------|--------|---------|
| `src-extension/selectors.js` | MODIFY | Add `waitForEditor()` function |
| `src-extension/dom-ops.js` | MODIFY | Add retry logic, async flow |
| `src-extension/ws-client.js` | MODIFY | Add heartbeat, connection timeout |
| `src-extension/content.js` | MODIFY | Use async flow, handle retries |
| `.agents/HANDOVER.md` | MODIFY | Update project status |

---

## STEP 1 — Add waitForEditor to selectors.js

**File:** `src-extension/selectors.js`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```javascript
/**
 * Check if we're on Grok at all
 * @returns {boolean}
 */
export function isOnGrok() {
  return URL_PATTERNS.GROK_BASE.test(window.location.href);
}
```

**Replace with:**
```javascript
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
```

⚠️ DO NOT modify any line outside this block.

---

## STEP 2 — Update dom-ops.js with retry and async flow

**File:** `src-extension/dom-ops.js`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```javascript
/**
 * GVP Bridge - DOM Operations
 * Handles prompt injection and submit actions
 * Reference: gvp-tiptap-prosemirror-injection KI, REFERENCE_ReactAutomation.md
 */

import { findPromptEditor, findSubmitButton } from './selectors.js';
```

**Replace with:**
```javascript
/**
 * GVP Bridge - DOM Operations
 * Handles prompt injection and submit actions
 * Reference: gvp-tiptap-prosemirror-injection KI, REFERENCE_ReactAutomation.md
 */

import { findPromptEditor, findSubmitButton, waitForEditor, waitForSubmitButton } from './selectors.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 200,
  SUBMIT_DELAY_MS: 150,
  EDITOR_WAIT_TIMEOUT_MS: 5000
};
```

⚠️ DO NOT modify any line outside this block.

---

## STEP 3 — Add retry injection function to dom-ops.js

**File:** `src-extension/dom-ops.js`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```javascript
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
```

**Replace with:**
```javascript
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
 * Inject with TipTap paragraph wrapping
 * For ProseMirror editors that need <p> tags
 * @param {string} text
 * @returns {boolean} success
 */
export function injectPromptWithParagraphs(text) {
  const editor = findPromptEditor();
  if (!editor) return false;

  try {
    editor.focus();
    
    // Wrap lines in <p> tags for TipTap
    const pWrapped = text
      .split('\n')
      .map(line => `<p>${line || '<br>'}</p>`)
      .join('');
    
    editor.innerHTML = pWrapped;
    
    // Dispatch input event
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    }));
    
    return true;
  } catch (error) {
    console.error('[GVP Bridge] Paragraph injection failed:', error);
    return false;
  }
}

/**
 * Sleep utility
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Inject with retry logic
 * @param {string} text
 * @param {number} maxAttempts
 * @returns {Promise<{success: boolean, attempts: number, error: string|null}>}
 */
export async function injectWithRetry(text, maxAttempts = CONFIG.MAX_RETRY_ATTEMPTS) {
  const result = {
    success: false,
    attempts: 0,
    error: null
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result.attempts = attempt;
    console.log(`[GVP Bridge] Injection attempt ${attempt}/${maxAttempts}`);

    // Wait for editor on each attempt
    const editor = await waitForEditor(CONFIG.EDITOR_WAIT_TIMEOUT_MS);
    
    if (!editor) {
      result.error = 'Editor not found';
      await sleep(CONFIG.RETRY_DELAY_MS * attempt);
      continue;
    }

    // Try primary method
    if (injectPrompt(text)) {
      result.success = true;
      console.log('[GVP Bridge] Primary injection successful');
      return result;
    }

    // Try fallback method
    if (injectPromptFallback(text)) {
      result.success = true;
      console.log('[GVP Bridge] Fallback injection successful');
      return result;
    }

    // Try paragraph method
    if (injectPromptWithParagraphs(text)) {
      result.success = true;
      console.log('[GVP Bridge] Paragraph injection successful');
      return result;
    }

    console.warn(`[GVP Bridge] Attempt ${attempt} failed`);
    await sleep(CONFIG.RETRY_DELAY_MS * attempt);
  }

  result.error = `Failed after ${maxAttempts} attempts`;
  return result;
}
```

⚠️ DO NOT modify any line outside this block.

---

## STEP 4 — Convert injectAndSubmit to async in dom-ops.js

**File:** `src-extension/dom-ops.js`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```javascript
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

**Replace with:**
```javascript
/**
 * Full flow: inject prompt and submit (async version)
 * @param {string} text
 * @returns {Promise<{injected: boolean, submitted: boolean, error: string|null, attempts: number}>}
 */
export async function injectAndSubmitAsync(text) {
  const result = {
    injected: false,
    submitted: false,
    error: null,
    attempts: 0
  };

  // Inject with retry
  const injectResult = await injectWithRetry(text);
  result.attempts = injectResult.attempts;

  if (!injectResult.success) {
    result.error = injectResult.error;
    return result;
  }

  result.injected = true;
  console.log('[GVP Bridge] Prompt injected successfully');

  // Wait before submitting
  await sleep(CONFIG.SUBMIT_DELAY_MS);

  // Wait for submit button
  const submitButton = await waitForSubmitButton(2000);
  
  if (submitButton) {
    result.submitted = clickSubmit();
  } else {
    // Try Enter key as fallback
    result.submitted = pressEnter();
  }

  if (!result.submitted) {
    result.error = 'Failed to submit prompt';
  } else {
    console.log('[GVP Bridge] Prompt submitted successfully');
  }

  return result;
}

/**
 * Full flow: inject prompt and submit (legacy sync version)
 * @param {string} text
 * @returns {Object} result
 * @deprecated Use injectAndSubmitAsync instead
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

⚠️ DO NOT modify any line outside this block.

---

## STEP 5 — Add heartbeat to ws-client.js

**File:** `src-extension/ws-client.js`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```javascript
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
```

**Replace with:**
```javascript
class WSClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.connectionTimeout = 10000; // 10s connection timeout
    this.messageQueue = [];
    this.onMessageCallback = null;
    this.heartbeatInterval = null;
    this.heartbeatMs = 30000; // 30s heartbeat
    this.lastPongTime = 0;
    this.missedHeartbeats = 0;
    this.maxMissedHeartbeats = 3;
  }
```

⚠️ DO NOT modify any line outside this block.

---

## STEP 6 — Add heartbeat methods to ws-client.js

**File:** `src-extension/ws-client.js`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```javascript
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
```

**Replace with:**
```javascript
  /**
   * Disconnect WebSocket
   */
  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Start heartbeat to detect stale connections
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.lastPongTime = Date.now();
    this.missedHeartbeats = 0;

    this.heartbeatInterval = setInterval(() => {
      if (!this.connected) {
        return;
      }

      // Check if we've missed too many heartbeats
      if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
        console.warn('[GVP Bridge] Connection stale, reconnecting...');
        this.missedHeartbeats = 0;
        this.ws.close();
        return;
      }

      // Send ping
      this.missedHeartbeats++;
      this.send({ type: 'ping', payload: {} });
      console.log('[GVP Bridge] Ping sent (missed:', this.missedHeartbeats, ')');
    }, this.heartbeatMs);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Handle pong response
   */
  handlePong() {
    this.lastPongTime = Date.now();
    this.missedHeartbeats = 0;
    console.log('[GVP Bridge] Pong received, connection healthy');
  }
}
```

⚠️ DO NOT modify any line outside this block.

---

## STEP 7 — Update ws-client.js connect method with timeout

**File:** `src-extension/ws-client.js`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```javascript
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
```

**Replace with:**
```javascript
  /**
   * Connect to desktop app WebSocket server
   * @returns {Promise<boolean>}
   */
  connect() {
    return new Promise((resolve) => {
      // Create timeout
      const timeoutId = setTimeout(() => {
        console.warn('[GVP Bridge] Connection timeout');
        if (this.ws) {
          this.ws.close();
        }
        resolve(false);
      }, this.connectionTimeout);

      try {
        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
          clearTimeout(timeoutId);
          console.log('[GVP Bridge] WebSocket connected');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.flushMessageQueue();
          this.startHeartbeat();
          resolve(true);
        };

        this.ws.onclose = () => {
          clearTimeout(timeoutId);
          console.log('[GVP Bridge] WebSocket disconnected');
          this.connected = false;
          this.stopHeartbeat();
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          clearTimeout(timeoutId);
          console.error('[GVP Bridge] WebSocket error:', error);
          this.connected = false;
          resolve(false);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        clearTimeout(timeoutId);
        console.error('[GVP Bridge] Failed to create WebSocket:', error);
        resolve(false);
      }
    });
  }
```

⚠️ DO NOT modify any line outside this block.

---

## STEP 8 — Update content.js to use async flow

**File:** `src-extension/content.js`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```javascript
import { wsClient } from './ws-client.js';
import { injectPrompt, submitPrompt, injectAndSubmit } from './dom-ops.js';
import { isOnGrok, isOnPostView, extractImageIdFromUrl } from './selectors.js';
```

**Replace with:**
```javascript
import { wsClient } from './ws-client.js';
import { injectAndSubmitAsync } from './dom-ops.js';
import { isOnGrok, isOnPostView, extractImageIdFromUrl } from './selectors.js';
```

⚠️ DO NOT modify any line outside this block.

---

## STEP 9 — Update handlePromptResponse in content.js

**File:** `src-extension/content.js`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```javascript
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
```

**Replace with:**
```javascript
/**
 * Handle prompt response from desktop app
 * @param {Object} payload
 */
async function handlePromptResponse(payload) {
  const { prompt, imageId } = payload;

  if (!prompt) {
    console.error('[GVP Bridge] No prompt in response');
    wsClient.sendStatus('injected', {
      success: false,
      imageId,
      error: 'No prompt in response'
    });
    return;
  }

  console.log('[GVP Bridge] Received prompt for image:', imageId);
  console.log('[GVP Bridge] Prompt length:', prompt.length, 'chars');

  // Inject and submit with retry
  const result = await injectAndSubmitAsync(prompt);

  console.log('[GVP Bridge] Injection result:', result);

  // Report result back to desktop app
  wsClient.sendStatus('injected', {
    success: result.injected && result.submitted,
    imageId,
    error: result.error,
    attempts: result.attempts
  });
}
```

⚠️ DO NOT modify any line outside this block.

---

## STEP 10 — Update HANDOVER.md

**File:** `.agents/HANDOVER.md`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```markdown
## Priority Order for Next Session

1. **End-to-End Integration Testing**
   - Why: Verify that Extension ↔ Desktop communication works for real prompt injection
   - Steps: Build extension, start Tauri dev, click Grok gallery card
   - Status: Ready for testing

2. **UI Refinement & Polish**
   - Why: Improve desktop app aesthetics and usability
   - Files: `src-desktop/styles.css`, `src-desktop/components/`
   - Status: Pending verification
```

**Replace with:**
```markdown
## Priority Order for Next Session

1. **End-to-End Integration Testing**
   - Why: Verify that Extension ↔ Desktop communication works with robustness improvements
   - Steps: Build extension, start Tauri dev, click Grok gallery card
   - Files to test: `src-extension/dom-ops.js`, `src-extension/ws-client.js`
   - Status: Ready for testing with retry logic and heartbeat

2. **Edge Case Testing**
   - Why: Verify retry logic works for slow editor loads
   - Cases: Slow network, rapid navigation, multiple tabs
   - Status: Not started

3. **UI Refinement & Polish**
   - Why: Improve desktop app aesthetics and usability
   - Files: `src-desktop/styles.css`, `src-desktop/components/`
   - Status: Pending verification
```

⚠️ DO NOT modify any line outside this block.

---

## VERIFICATION CHECKLIST

After completing all steps, verify:

| Check | Expected |
|-------|----------|
| `waitForEditor()` function exists in selectors.js | YES |
| `injectWithRetry()` function exists in dom-ops.js | YES |
| `injectAndSubmitAsync()` function exists in dom-ops.js | YES |
| Heartbeat methods exist in ws-client.js | YES |
| Connection timeout exists in ws-client.js | YES |
| `handlePromptResponse` uses async/await | YES |
| HANDOVER.md updated | YES |

---

## TESTING GUIDE

### Test 1: Editor Wait Logic
1. Navigate to Grok gallery
2. Click a gallery card
3. Observe console: "Editor found after X ms"
4. Verify prompt injection succeeds

### Test 2: Retry Logic
1. Set a prompt in desktop app
2. Navigate to Grok post view
3. If editor is slow, observe: "Injection attempt 1/3", "2/3", etc.
4. Verify eventual success or clear error message

### Test 3: Heartbeat
1. Start desktop app
2. Load extension
3. Wait 30+ seconds
4. Observe console: "Ping sent", "Pong received"
5. Kill desktop app → extension should detect stale connection

### Test 4: Connection Timeout
1. Start extension without desktop app running
2. Observe console: "Connection timeout" after 10s
3. Start desktop app → extension should reconnect

---

## END OF PLAN

**STOP after completing all 10 steps.**
**Produce Work Report as specified in `/implement` workflow.**
