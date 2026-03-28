# Reference: React Automation Patterns

This file contains the key patterns from the original GVP extension's ReactAutomation.js. Copy these approaches when implementing prompt injection and submission.

## TipTap/ProseMirror Injection Pattern

The Grok editor is a TipTap ProseMirror contenteditable div, NOT a textarea.

### Selectors to Find Editor
```javascript
// Primary selector
const editor = document.querySelector('div[contenteditable="true"].ProseMirror');

// Alternative selectors (try in order)
const selectors = [
    'div.tiptap.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][translate="no"].ProseMirror',
    'div.ProseMirror[contenteditable="true"]'
];
```

### Injection Method
```javascript
function injectPrompt(element, text) {
    // 1. Focus the element first (required for ProseMirror)
    element.focus();
    
    // 2. Select all existing content
    document.execCommand('selectAll', false, null);
    
    // 3. Insert text (transaction-aware, preserves undo stack)
    const success = document.execCommand('insertText', false, text);
    
    if (!success) {
        // Fallback: innerHTML with paragraph wrapping
        const pWrapped = text.split('\n')
            .map(line => `<p>${line || '<br>'}</p>`)
            .join('');
        element.innerHTML = pWrapped;
        
        // Dispatch input event for React
        element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            data: text,
            inputType: 'insertText'
        }));
    }
    
    return true;
}
```

### Why execCommand?
- ProseMirror monitors execCommand for undo/redo
- Direct innerHTML assignment breaks the transaction history
- React's ProseMirror listener ignores changes without proper InputEvent

## Submit Methods

### Method 1: Enter Key
```javascript
function submitWithEnter(element) {
    element.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
    }));
}
```

### Method 2: Click Submit Button
```javascript
function findSubmitButton() {
    // Look for submit button with these selectors
    const selectors = [
        'button[aria-label="Make video"]',
        'button[aria-label="Submit"]',
        'button[aria-label="Edit"]',
        'button[type="submit"]'
    ];
    
    for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) return btn;
    }
    
    // Look for button with upward arrow SVG
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
        const svg = btn.querySelector('svg path[d*="M6 11L12 5"]');
        if (svg) return btn;
    }
    
    return null;
}

function clickSubmit(button) {
    // React-compatible click sequence
    button.focus({ preventScroll: true });
    
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
        button.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window
        }));
    });
}
```

### Method 3: Keyboard Shortcut
```javascript
function simulateCtrlEnter() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
    }));
}
```

## Wait for Editor Pattern

The editor may not exist immediately after navigation. Use a polling pattern:

```javascript
async function waitForEditor(timeout = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        const editor = document.querySelector('div[contenteditable="true"].ProseMirror');
        if (editor && editor.offsetParent !== null) { // Check visibility
            return editor;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    throw new Error('Editor not found within timeout');
}
```

## URL Detection Pattern

```javascript
// Option 1: Polling
let lastUrl = location.href;
setInterval(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        onUrlChange(lastUrl);
    }
}, 200);

// Option 2: MutationObserver on body
const observer = new MutationObserver(() => {
    // Check if URL changed
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        onUrlChange(lastUrl);
    }
});
observer.observe(document.body, { childList: true, subtree: true });

// Option 3: History API override
const originalPushState = history.pushState;
history.pushState = function(...args) {
    originalPushState.apply(this, args);
    onUrlChange(location.href);
};
```

## Extract ImageId from URL

```javascript
function extractImageId(url) {
    // URL patterns:
    // /imagine/post/abc-123-def-456
    // /imagine/post/abc-123-def-456?param=value
    
    const match = url.match(/\/imagine\/post\/([a-f0-9-]{36})/i);
    return match ? match[1] : null;
}
```

## Full Flow Implementation

```javascript
async function quickRawFlow(prompt) {
    // 1. Wait for editor
    const editor = await waitForEditor(5000);
    
    // 2. Inject prompt
    injectPrompt(editor, prompt);
    
    // 3. Small delay for React to process
    await new Promise(r => setTimeout(r, 200));
    
    // 4. Find and click submit
    const submitBtn = findSubmitButton();
    if (submitBtn) {
        clickSubmit(submitBtn);
    } else {
        // Fallback to Enter key
        submitWithEnter(editor);
    }
    
    return { success: true };
}
```

## Error Handling

```javascript
async function safeQuickRaw(prompt) {
    try {
        const editor = await waitForEditor(5000);
        
        if (!editor) {
            return { success: false, error: 'Editor not found' };
        }
        
        injectPrompt(editor, prompt);
        
        await new Promise(r => setTimeout(r, 200));
        
        const submitBtn = findSubmitButton();
        if (submitBtn) {
            clickSubmit(submitBtn);
        } else {
            submitWithEnter(editor);
        }
        
        return { success: true };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}
```
