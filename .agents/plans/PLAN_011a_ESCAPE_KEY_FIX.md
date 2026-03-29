# PLAN 011a: ESC Key Fix (Correction for PLAN_011)

## Issue
After PLAN_011 implementation, the ESC key is being pressed too many times, causing Grok to "escape out of Grok entirely" (exit the whole app/view instead of just closing the post view).

## Root Cause
The `simulateEscape()` function in `src-extension/content.bundle.js` dispatches ESC events to **multiple targets**:
- `document` (keydown + keyup)
- `window` (keydown)
- `document.body` (keydown)
- `activeElement` (keydown + keyup)

That's **6 dispatches** instead of 2! The OG extension only dispatches to `document` once with keydown + keyup.

## Reference: OG Extension Implementation
From `GVP/src/content/content.js` lines 653-671:

```javascript
_simulateEscape() {
    try {
        ['keydown', 'keyup'].forEach(type => {
            const evt = new KeyboardEvent(type, {
                key: 'Escape',
                code: 'Escape',
                keyCode: 27,
                which: 27,
                bubbles: true,
                cancelable: true
            });
            document.dispatchEvent(evt);
        });
        window.Logger.debug('QuickLaunch', '⎋ Sent Escape key to navigate back');
        return true;
    } catch (error) {
        window.Logger.warn('QuickLaunch', 'Failed to dispatch Escape key', error);
        return false;
    }
}
```

**Key observations:**
1. Only dispatches to `document`
2. Only `keydown` and `keyup` (once each)
3. NO `composed: true` property
4. Returns a boolean, not async

---

## Implementation Steps

### Step 1: Replace `simulateEscape()` function

**File:** `src-extension/content.bundle.js`

**Find:**
```javascript
  /**
   * Simulate ESC key press to return to gallery
   * Grok uses ESC to close post view and return to /imagine/saved
   */
  async function simulateEscape() {
    debug('Simulating ESC key to return to gallery');
    
    // Method 1: KeyboardEvent on document
    const escKeyDown = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    
    const escKeyUp = new KeyboardEvent('keyup', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    
    document.dispatchEvent(escKeyDown);
    document.dispatchEvent(escKeyUp);
    
    // Method 2: Also try on window and body
    window.dispatchEvent(escKeyDown);
    document.body.dispatchEvent(escKeyDown);
    
    // Method 3: Try on any focused element
    const activeElement = document.activeElement;
    if (activeElement) {
      activeElement.dispatchEvent(escKeyDown);
      activeElement.dispatchEvent(escKeyUp);
    }
    
    debug('ESC key events dispatched');
    return true;
  }
```

**Replace with:**
```javascript
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
```

### Step 2: Update `returnToGallery()` function

**Find:**
```javascript
  /**
   * Return to gallery by pressing ESC
   * Waits briefly after submit, then simulates ESC
   * @param {number} delayMs - Delay before pressing ESC (default 300ms)
   */
  async function returnToGallery(delayMs = 300) {
    debug('Will return to gallery after', delayMs, 'ms');
    
    // Wait for submit to process
    await new Promise(r => setTimeout(r, delayMs));
    
    // Press ESC
    await simulateEscape();
    
    // Wait for navigation
    await new Promise(r => setTimeout(r, 200));
    
    // Verify we left the post view
    const leftPostView = !isOnPostView();
    debug('Left post view:', leftPostView);
    
    return leftPostView;
  }
```

**Replace with:**
```javascript
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
```

### Step 3: Update call in `injectAndSubmitAsync()`

**Find:**
```javascript
      // Return to gallery after submit
      let returnedToGallery = false;
      if (submitted) {
        returnedToGallery = await returnToGallery(300);
      }
```

**Replace with:**
```javascript
      // Return to gallery after submit (500ms delay to match OG extension)
      let returnedToGallery = false;
      if (submitted) {
        returnedToGallery = await returnToGallery();
      }
```

---

## Summary of Changes

| Change | Before | After |
|--------|--------|-------|
| Function signature | `async function simulateEscape()` | `function simulateEscape()` |
| ESC dispatches | 6 events to 4 targets | 2 events to 1 target |
| `composed: true` | Present | Removed |
| Delay before ESC | 300ms | 500ms (matches OG) |
| Delay after ESC | 200ms | 300ms |

## Testing
1. Reload extension in Chrome
2. Navigate to Grok /imagine/saved
3. Click on an image to open post view
4. Send a prompt from desktop app
5. Verify: prompt injects, submits, then returns to gallery cleanly without escaping out of Grok

---

## DO NOT DEVIATE
- Do not add extra ESC dispatches
- Do not add `composed: true`
- Do not change the delay values
- Follow the OG extension pattern exactly
