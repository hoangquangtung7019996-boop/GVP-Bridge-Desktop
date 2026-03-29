# PLAN-011: Quick Raw — Submit and Return to Gallery

## Problem Statement
After the extension injects a prompt and clicks "Make video", it should immediately press ESC to return to the gallery (/imagine/saved). Currently, the extension stays on the post view after submission. This is the core "beach and flow" pattern: inject → submit → ESC → return to gallery.

## Files to Modify
| File | Action | Purpose |
|------|--------|---------|
| `src-extension/content.bundle.js` | MODIFY | Add ESC key simulation after submit, return to gallery logic |

---

## Implementation Details

### STEP 1 — Add `simulateEscape()` Function

**File:** `src-extension/content.bundle.js`
**Action:** MODIFY EXISTING FILE

**Find this EXACT block:**
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

⚠️ **DO NOT modify any line outside this block.**

---

### STEP 2 — Modify `injectAndSubmitAsync` to Call `returnToGallery`

**File:** `src-extension/content.bundle.js`
**Action:** MODIFY EXISTING FILE

**Find this EXACT block:**
```javascript
      // Inject prompt
      const injected = await injectPrompt(editor, prompt);
      
      // Wait for React to process
      await new Promise(r => setTimeout(r, 100));
      
      // Submit
      const submitted = await clickSubmit(button);
      
      return { injected, submitted, attempt };
    }
    
    return { injected: false, submitted: false, error: 'Max attempts reached', attempts: maxAttempts };
  }
```

**Replace with:**
```javascript
      // Inject prompt
      const injected = await injectPrompt(editor, prompt);
      
      // Wait for React to process
      await new Promise(r => setTimeout(r, 100));
      
      // Submit
      const submitted = await clickSubmit(button);
      
      // Return to gallery after submit
      let returnedToGallery = false;
      if (submitted) {
        returnedToGallery = await returnToGallery(300);
      }
      
      return { injected, submitted, returnedToGallery, attempt };
    }
    
    return { injected: false, submitted: false, returnedToGallery: false, error: 'Max attempts reached', attempts: maxAttempts };
  }
```

⚠️ **DO NOT modify any line outside this block.**

---

### STEP 3 — Update `handlePromptResponse` to Report Gallery Return Status

**File:** `src-extension/content.bundle.js`
**Action:** MODIFY EXISTING FILE

**Find this EXACT block:**
```javascript
    debug('Received prompt for image:', imageId);
    lastAction = `Injecting prompt (${prompt.length} chars)`;

    const result = await injectAndSubmitAsync(prompt);

    lastAction = result.submitted ? 'Prompt submitted!' : `Error: ${result.error || 'Unknown'}`;

    wsClient.sendStatus('injected', {
      success: result.injected && result.submitted,
      imageId,
      error: result.error,
      attempts: result.attempts
    });
  }
```

**Replace with:**
```javascript
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
```

⚠️ **DO NOT modify any line outside this block.**

---

## VERIFICATION CHECKLIST

| Check | Expected |
|-------|----------|
| `simulateEscape()` function exists after `clickSubmit()` | YES |
| `returnToGallery()` function exists after `simulateEscape()` | YES |
| `injectAndSubmitAsync` calls `returnToGallery()` after submit | YES |
| `injectAndSubmitAsync` returns `returnedToGallery` property | YES |
| `handlePromptResponse` reports `returnedToGallery` status | YES |
| No other lines modified | YES |

## TESTING

1. Load extension in Chrome
2. Start desktop app
3. Navigate to grok.com/imagine/saved
4. Click a gallery card to go to post view
5. Verify prompt gets injected
6. Verify "Make video" button is clicked
7. **VERIFY: ESC is pressed and you return to gallery within ~500ms**

## SUCCESS CRITERIA

- Prompt injected ✅
- Submit button clicked ✅
- ESC key simulated ✅
- User returned to gallery (/imagine/saved) ✅
- Status reports `returnedToGallery: true` ✅

## END OF PLAN

**STOP after completing all steps.**
**Produce Work Report as specified in /implement workflow.**
