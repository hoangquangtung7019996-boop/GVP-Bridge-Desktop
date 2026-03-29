# PLAN 011b: Fix Multiple API Calls (Complete Overhaul)

## Issue
When clicking a card, **4+ API calls** are made:
- 2 `/new` calls when clicking card
- 2-3 more `/new` calls after returning to gallery

Error: `"Cannot generate response to empty conversation."`

## Root Causes (Multiple)

### Cause 1: Double Click in `clickSubmit()`
```javascript
button.click();                          // Native click #1
button.dispatchEvent(new MouseEvent...); // Synthetic click #2
```

### Cause 2: Quadruple URL Monitoring
`handleUrlChange` is triggered by **FOUR sources**:
1. `setInterval` polling (every 500ms)
2. `popstate` event listener
3. `history.pushState` monkey patch
4. `history.replaceState` monkey patch

All four can fire for a SINGLE navigation event!

### Cause 3: No Deduplication
Every call to `handleUrlChange` sends `prompt_request` without checking if one was already sent for this image.

### Cause 4: No Processing Lock
While a prompt is being processed, new requests aren't blocked.

---

## Reference: OG Extension's Approach

The OG extension has these protections:

1. **Navigation lock**: `_isNavigating` flag prevents cascade
2. **Processed set**: `_completedEdits` tracks already-processed images
3. **Debounce**: Coalesces rapid URL changes
4. **Payload system**: Uses sessionStorage to track intent

---

## Implementation Steps

### Step 1: Add State Variables for Deduplication

**File:** `src-extension/content.bundle.js`

**Find:**
```javascript
  let lastUrl = window.location.href;
  let urlCheckInterval = null;
  let lastAction = 'None';
```

**Replace with:**
```javascript
  let lastUrl = window.location.href;
  let urlCheckInterval = null;
  let lastAction = 'None';
  
  // === DEDUPLICATION & LOCKING (Fix for multiple API calls) ===
  let lastPromptedImageId = null;        // Last imageId we requested prompt for
  let isProcessingPrompt = false;        // Lock while processing
  let lastPromptRequestTime = 0;         // Timestamp of last request
  const PROMPT_REQUEST_COOLDOWN = 2000;  // 2 second cooldown between requests
```

### Step 2: Replace clickSubmit() with reactClick()

**Find:**
```javascript
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
```

**Replace with:**
```javascript
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
```

### Step 3: Fix URL Monitoring with Deduplication

**Find:**
```javascript
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
```

**Replace with:**
```javascript
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

    // DEDUPLICATION CHECK: Only request prompt if:
    // 1. We're on a post view with an imageId
    // 2. We're not already processing a prompt
    // 3. This imageId is different from the last one we requested
    // 4. Enough time has passed since last request (cooldown)
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
```

### Step 4: Add Locking to handlePromptResponse()

**Find:**
```javascript
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
```

**Replace with:**
```javascript
  async function handlePromptResponse(payload) {
    const { prompt, imageId } = payload;

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
```

### Step 5: Release Lock After Processing

**Find:**
```javascript
    wsClient.sendStatus('injected', {
      success: result.injected && result.submitted,
      returnedToGallery: result.returnedToGallery,
      imageId,
      error: result.error,
      attempts: result.attempts
    });
  }
```

**Replace with:**
```javascript
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
```

### Step 6: Update injectAndSubmitAsync() to use sync clickSubmit

**Find:**
```javascript
      // Submit
      const submitted = await clickSubmit(button);
```

**Replace with:**
```javascript
      // Submit (using reactClick - NO native .click(), sync call)
      debug('[injectAndSubmitAsync] About to click submit button...');
      const submitted = clickSubmit(button);
      debug('[injectAndSubmitAsync] Submit clicked, result:', submitted);
```

---

## Summary of Changes

| Issue | Before | After |
|-------|--------|-------|
| Click method | Double click (native + synthetic) | Single synthetic event sequence |
| URL monitoring | 4 sources all trigger handleUrlChange | Debounced, single entry point |
| Deduplication | None | imageId tracking + cooldown |
| Processing lock | None | `isProcessingPrompt` flag |
| Cooldown | None | 2 second minimum between requests |

## Testing
1. Reload extension in Chrome
2. Navigate to Grok /imagine/saved
3. Click on an image to open post view
4. **Expected**: Only ONE console log showing `[handleUrlChange] Requesting prompt for: <imageId>`
5. Send prompt from desktop app
6. **Expected**: Only ONE API call with correct prompt
7. Check server logs - should show single `/new` call

---

## DO NOT DEVIATE
- Do NOT add `button.click()` anywhere
- Do NOT remove the debouncing
- Do NOT reduce the cooldown below 2000ms
- Do NOT remove the isProcessingPrompt lock
- Follow the OG extension's patterns EXACTLY
