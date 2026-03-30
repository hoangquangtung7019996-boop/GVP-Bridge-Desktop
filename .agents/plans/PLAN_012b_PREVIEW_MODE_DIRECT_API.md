# PLAN 012b: Preview Mode - Direct API Calls

## Issue
Preview Mode currently:
- ✅ Skips return to gallery
- ❌ Still injects prompts via UI
- ❌ Still clicks submit buttons
- ❌ Navigates to post pages

**Preview Mode SHOULD:**
- NOT navigate
- NOT inject prompts
- NOT click submit buttons
- Use direct fetch API calls only
- Stay on gallery page
- Display results in desktop gallery panel

---

## Current vs Expected Flow

### Current (Wrong)
```
Click gallery card → Navigate to post page → Inject prompt → Click submit → Intercept response
```

### Expected (Correct)
```
Click gallery card → Extract UUID → Direct fetch to /generate API → Intercept response → Display in gallery
```

---

## Implementation Steps

### Step 1: Branch handlePromptResponse() for Preview Mode

**File:** `src-extension/content.bundle.js`

**Find:**
```javascript
  async function handlePromptResponse(payload) {
    const { prompt, imageId, previewMode } = payload;

    // Update interception state from desktop
    interceptGenerations = !!previewMode;
    debug('[handlePromptResponse] Intercept generations:', interceptGenerations);

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

**Replace with:**
```javascript
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
```

### Step 2: Add sendDirectGenerationRequest() Function

**File:** `src-extension/content.bundle.js`

**Add after handlePromptResponse() (before startUrlMonitoring):**
```javascript
  /**
   * Send direct generation request for Preview Mode
   * Bypasses UI completely - calls Grok API directly
   */
  async function sendDirectGenerationRequest(imageId, prompt) {
    debug('[sendDirectGenerationRequest] Starting direct API call for imageId:', imageId);
    
    try {
      // Call Grok's generate API directly
      const response = await fetch('https://grok.com/rest/app/grok/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for auth
        body: JSON.stringify({
          imageId: imageId,
          prompt: prompt,
          // Note: Additional fields may be needed based on Grok's actual API
        })
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data = await response.json();
      debug('[sendDirectGenerationRequest] Response received:', data);
      
      // The fetch proxy will intercept this, but also handle directly
      handleGenerationResponse('https://grok.com/rest/app/grok/generate', data);
      
      lastAction = 'Preview: Generation requested';
    } catch (error) {
      debug('[sendDirectGenerationRequest] Error:', error);
      lastAction = `Preview error: ${error.message}`;
    }
  }
```

### Step 3: Skip Prompt Requests in handleUrlChange() During Preview Mode

**File:** `src-extension/content.bundle.js`

**Find:**
```javascript
  function handleUrlChange(url) {
    const imageId = extractImageIdFromUrl();
    
    // Always notify desktop of URL change (for status display)
    wsClient.notifyUrlChange(url, imageId);

    const now = Date.now();
    
    if (isOnPostView() && imageId) {
      // Check all deduplication conditions
      if (isProcessingPrompt) {
```

**Replace with:**
```javascript
  function handleUrlChange(url) {
    const imageId = extractImageIdFromUrl();
    
    // Always notify desktop of URL change (for status display)
    wsClient.notifyUrlChange(url, imageId);

    // In Preview Mode, don't trigger prompt requests via URL navigation
    if (interceptGenerations) {
      debug('[handleUrlChange] PREVIEW MODE - skipping prompt request');
      return;
    }

    const now = Date.now();
    
    if (isOnPostView() && imageId) {
      // Check all deduplication conditions
      if (isProcessingPrompt) {
```

### Step 4: Add Gallery Card Click Handler for Preview Mode

**File:** `src-extension/content.bundle.js`

**Add to init() function, after proxyFetch():**
```javascript
    // Set up gallery card click handler for Preview Mode
    setupGalleryCardClickHandler();
```

**Add new function (before init()):**
```javascript
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
```

### Step 5: Handle preview_card_clicked Message in main.rs

**File:** `src-tauri/src/main.rs`

**Find:**
```rust
                            "prompt_request" => {
```

**Add BEFORE that case:**
```rust
                            // Preview mode: card clicked in gallery
                            "preview_card_clicked" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");
                                println!("[GVP Desktop] Preview card clicked: {}", image_id);
                                
                                // Get current prompt and preview mode
                                let prompt = {
                                    let s = state.lock();
                                    s.current_prompt.clone()
                                };
                                let preview_mode = {
                                    let s = state.lock();
                                    s.preview_mode
                                };
                                
                                // Send prompt response (will trigger direct API call in extension)
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });
                                
                                if let Err(e) = ws_sender.send(Message::Text(response.to_string())).await {
                                    println!("[GVP Desktop] Send error: {}", e);
                                    break;
                                }
                            }
```

---

## Summary of Changes

| Component | Change |
|-----------|--------|
| `handlePromptResponse()` | Branch: Preview → direct API, Normal → UI injection |
| `sendDirectGenerationRequest()` | NEW: Direct fetch to /generate |
| `handleUrlChange()` | Skip prompt requests in Preview Mode |
| `setupGalleryCardClickHandler()` | NEW: Click handler for gallery cards |
| `main.rs` | NEW: Handle `preview_card_clicked` message |

---

## Flow Diagram

### Preview Mode Flow
```
User clicks gallery card
       ↓
setupGalleryCardClickHandler() extracts UUID
       ↓
Sends "preview_card_clicked" to desktop
       ↓
Desktop responds with prompt_response (previewMode=true)
       ↓
handlePromptResponse() branches to sendDirectGenerationRequest()
       ↓
Direct fetch to /rest/app/grok/generate
       ↓
Response intercepted by fetch proxy
       ↓
handleGenerationResponse() sends to desktop
       ↓
Desktop displays in GalleryPanel
```

### Normal Mode Flow (Unchanged)
```
User clicks gallery card
       ↓
Page navigates to /imagine/post/UUID
       ↓
handleUrlChange() sends prompt_request
       ↓
Desktop responds with prompt_response (previewMode=false)
       ↓
handlePromptResponse() calls injectAndSubmitAsync()
       ↓
UI injection + submit + return to gallery
```

---

## DO NOT DEVIATE
- Preview Mode does NOT navigate
- Preview Mode does NOT inject prompts via UI
- Preview Mode does NOT click submit buttons
- Preview Mode uses direct fetch API calls only
- Gallery card click uses capture phase (third parameter = true)
