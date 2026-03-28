# PLAN-010: Fix DOM Selectors and UI Status Updates

## Problem Statement
1. Content script selectors don't match Grok's actual DOM structure, causing "Max attempts reached" errors
2. Desktop app UI shows "Disconnected" even when connected (event timing issue)

## Files to Modify
1. `src-extension/content.bundle.js` - Update selectors to match Grok
2. `src-desktop/components/StatusBar.tsx` - Fix initial state to check backend status
3. `src-desktop/App.tsx` - Fetch initial connection status on mount

## Implementation Details

### 1. Update Selectors in content.bundle.js

Replace the SELECTORS object (lines 18-27) with selectors from the working GVP extension:

```javascript
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
```

### 2. Update findPromptEditor() function

Replace lines 29-35 with:

```javascript
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
```

### 3. Add utility functions

Add these helper functions before the selector functions (around line 28):

```javascript
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
```

### 4. Update findSubmitButton() function

Replace lines 37-43 with:

```javascript
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
```

### 5. Fix StatusBar.tsx Initial State

The StatusBar should fetch initial status from backend instead of assuming "Disconnected".

Add this to onMount in StatusBar.tsx (before the event listeners):

```typescript
import { invoke } from '@tauri-apps/api/core';

// In onMount, add at the start:
onMount(async () => {
    // Fetch initial connection status from backend
    try {
        const status = await invoke<{ [key: string]: string }>('get_status');
        const connCount = parseInt(status.connections || '0');
        if (connCount > 0) {
            setConnectionStatus(`Connected (${connCount})`);
        }
        if (status.status) {
            setLastStatus(status.status);
        }
        if (status.url) {
            setLastUrl(status.url);
        }
        if (status.imageId) {
            setLastImageId(status.imageId);
        }
    } catch (e) {
        console.error('[StatusBar] Failed to get initial status:', e);
    }
    
    // ... rest of the existing listeners
});
```

### 6. Add debug logging to injectAndSubmitAsync

Add more detailed logging to understand what's happening during injection:

```javascript
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
    
    return { injected, submitted, attempt };
  }
  
  return { injected: false, submitted: false, error: 'Max attempts reached', attempts: maxAttempts };
}
```

## Testing
1. Start desktop app: `npm run tauri dev`
2. Load extension in Chrome
3. Navigate to grok.com/imagine/post/[uuid]
4. Verify console logs show correct selectors finding elements
5. Verify prompt injection succeeds

## Success Criteria
- No more "Max attempts reached" errors
- UI shows "Connected (N)" when WebSocket is connected
- Prompt injection succeeds and shows in Grok editor
