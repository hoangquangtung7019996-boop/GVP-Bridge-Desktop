# Reference: Grok UI Selectors

This file contains the CSS selectors for Grok's UI elements. These may need updates if Grok changes their UI.

## Editor Selectors

```javascript
const EDITOR_SELECTORS = [
    // TipTap ProseMirror (primary)
    'div.tiptap.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][translate="no"].ProseMirror',
    'div.ProseMirror[contenteditable="true"]',
    
    // Legacy textarea (fallback)
    'textarea[aria-label*="prompt"]',
    'textarea[placeholder*="prompt"]'
];
```

## Submit Button Selectors

```javascript
const SUBMIT_BUTTONS = [
    // ARIA labeled
    'button[aria-label="Make video"]',
    'button[aria-label="Submit"]',
    'button[aria-label="Edit"]',
    'button[aria-label="Send"]',
    
    // Type attribute
    'button[type="submit"]',
    
    // Contains specific SVG path (upward arrow)
    // button:has(svg path[d*="M6 11L12 5"])
];
```

## Gallery Card Selectors

```javascript
const GALLERY_CARD_SELECTORS = [
    // Masonry card
    '[class*="media-post-masonry-card"]',
    'div.group\\/media-post-masonry-card',
    '[role="listitem"]',
    
    // Container
    'div[class*="media-post"]',
    'a[href*="/imagine/post/"]'
];
```

## Settings/Mode Selectors

```javascript
const SETTINGS_BUTTON = 'button[aria-label="Settings"]';
const RADIX_MENU = '[data-radix-menu-content]';
const MODE_TOGGLE_CONTAINER = 'div[aria-label="Media type selection"]';

// Menu items found by text
// Use: findElementByText('div[role="menuitem"]', 'Make Video')
```

## Modal/Dialog Selectors

```javascript
const MODAL_SELECTORS = [
    'div[role="dialog"]',
    '[data-radix-dialog-content]',
    '.grok-edit-modal'
];
```

## Progress/Status Selectors

```javascript
// Generation progress (if visible in DOM)
const PROGRESS_BAR = '[class*="progress"]';
const PROGRESS_TEXT = '[class*="progress-text"]';

// Generation complete indicators
const VIDEO_ELEMENT = 'video[src*="grok.com"]';
const IMAGE_RESULT = 'img[src*="grok.com"]';
```

## Utility: Find Element by Text

```javascript
function findElementByText(selector, text, root = document) {
    const elements = root.querySelectorAll(selector);
    for (const el of elements) {
        // Check direct text content
        if (el.textContent?.trim() === text) return el;
        
        // Check sr-only spans inside
        const sr = el.querySelector('.sr-only');
        if (sr?.textContent?.trim() === text) return el;
        
        // Check for partial match
        if (el.textContent?.includes(text)) return el;
    }
    return null;
}
```

## Utility: Find First Matching

```javascript
function findFirst(selectors) {
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return null;
}
```

## Utility: Wait for Element

```javascript
function waitForElement(selectors, timeout = 5000, root = document) {
    return new Promise((resolve, reject) => {
        const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
        
        // Check immediately
        for (const sel of selectorArray) {
            const el = root.querySelector(sel);
            if (el) return resolve(el);
        }
        
        const startTime = Date.now();
        
        const interval = setInterval(() => {
            // Timeout check
            if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                reject(new Error(`Element not found: ${selectors}`));
                return;
            }
            
            // Poll check
            for (const sel of selectorArray) {
                const el = root.querySelector(sel);
                if (el) {
                    clearInterval(interval);
                    resolve(el);
                    return;
                }
            }
        }, 100);
    });
}
```

## URL Patterns

```javascript
const URL_PATTERNS = {
    // Post page (where we inject prompts)
    POST_PAGE: /\/imagine\/post\/([a-f0-9-]{36})/i,
    
    // Gallery pages
    GALLERY: /\/imagine(\/saved)?$/i,
    
    // Create page
    CREATE: /\/imagine$/i,
    
    // Extract UUID
    EXTRACT_UUID: /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
};
```

## Theme Colors (for desktop app matching)

```css
:root {
    --bg-primary: #141414;
    --bg-secondary: #212121;
    --bg-hover: #262626;
    --border-color: #48494b;
    --text-primary: #f4f4f5;
    --text-secondary: #a3a3a3;
    --accent: #ef4444;
}
```
