# PLAN_015: Hijack OG Extension's Fetch Interceptor for Statsig Capture

## Problem Statement

The current `proxyFetch()` in `content.bundle.js` runs in the content script's isolated world. It intercepts `window.fetch` BEFORE Grok's own interceptor adds the `x-statsig-id` header. This means statsig-id is never captured, causing Preview Mode direct API calls to fail with 403 Forbidden.

The OG extension already has a page-context fetch interceptor (`gvpFetchInterceptor.js`) that:
1. Runs in the same world as Grok's code
2. Captures ALL headers including `x-statsig-id`
3. Broadcasts them via `window.postMessage` with source `'gvp-fetch-interceptor'`

We can simply listen for OG's broadcasts instead of implementing our own interception.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `src-extension/content.bundle.js` | MODIFY | Remove broken proxyFetch, add OG message listener |

---

## Implementation Details

### STEP 1 — Remove Broken `proxyFetch()` Function

**File:** `src-extension/content.bundle.js`
**Action:** DELETE entire function and its helpers

**Find this EXACT block (lines 1011-1084):**
```javascript
  /**
   * Proxy the global fetch function to intercept generation responses
   */
  function proxyFetch() {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].href : (args[0] && args[0].url));
      
      // CAPTURE: Steal x-statsig-id from Grok requests only
      try {
        const options = args[1] || {};
        const headers = options.headers;
        
        // Only capture from Grok domain
        if (headers && url && url.includes('grok.com')) {
          let sid = null;
          if (headers instanceof Headers) {
            sid = headers.get('x-statsig-id');
          } else if (typeof headers === 'object') {
            sid = headers['x-statsig-id'] || headers['X-Statsig-Id'];
          }
          
          if (sid && sid !== capturedStatsigId) {
            capturedStatsigId = sid;
            debug('Captured x-statsig-id:', sid.substring(0, 20) + '...');
            
            // Notify desktop that statsig is ready
            wsClient.send({
              type: 'statsig_captured',
              payload: { success: true },
              timestamp: Date.now()
            });
          }
        }
      } catch (e) {
        // Silently fail capture
      }

      const response = await originalFetch.apply(this, args);
      
      if (interceptGenerations && isGenerationUrl(url)) {
        // Clone response to read body without consuming it
        const cloned = response.clone();
        cloned.json().then(data => {
          handleGenerationResponse(url, data);
        }).catch(e => debug('Failed to parse generation JSON:', e));
      }
      
      return response;
    };
    debug('Fetch proxy installed');
  }

  function isGenerationUrl(url) {
    if (!url) return false;
    // Grok's generation endpoints
    return url.includes('/rest/app-chat/conversations/new') ||
           url.includes('/rest/app/grok/upscale') || 
           url.includes('/rest/app/grok/generate') ||
           url.includes('/rest/app/grok/get_video_generation_result');
  }

  function handleGenerationResponse(url, data) {
    debug('Intercepted generation response from:', url);
    // Send to desktop via WS
    wsClient.send({
      type: 'generation_result',
      payload: {
        url,
        data,
        timestamp: Date.now()
      }
    });
  }
```

**Replace with:** (DELETE - replace with empty string, but keep the final lines)

```javascript
  debug('Content script loaded');
```

⚠️ **DO NOT modify any other lines. The file should end with the IIFE closing.**

---

### STEP 2 — Remove `proxyFetch()` Call from `init()`

**File:** `src-extension/content.bundle.js`
**Action:** REMOVE the proxyFetch() call and ADD the OG listener setup

**Find this EXACT block (lines 640-652):**
```javascript
    // Set up message handler
    wsClient.onMessage(handleMessage);

    // Start URL monitoring
    startUrlMonitoring();

    // Start Fetch Interception (Proxy)
    proxyFetch();

    // Set up gallery card click handler for Preview Mode
    setupGalleryCardClickHandler();

    // Check current URL state
    checkCurrentUrl();

    debug('Ready');
```

**Replace with:**
```javascript
    // Set up message handler
    wsClient.onMessage(handleMessage);

    // Start URL monitoring
    startUrlMonitoring();

    // Set up OG Extension interceptor listener (captures statsig-id + generation results)
    setupOGInterceptorListener();

    // Set up gallery card click handler for Preview Mode
    setupGalleryCardClickHandler();

    // Check current URL state
    checkCurrentUrl();

    debug('Ready');
```

---

### STEP 3 — Add `setupOGInterceptorListener()` Function

**File:** `src-extension/content.bundle.js`
**Action:** ADD new function BEFORE the `init()` function

**Find this EXACT block (line 615):**
```javascript
  async function init() {
```

**Insert BEFORE it:**
```javascript
  /**
   * Listen for OG Extension's fetch interceptor broadcasts
   * OG's gvpFetchInterceptor.js runs in page context and broadcasts:
   * - GVP_FETCH_CONVERSATION_REQUEST: Contains headers including x-statsig-id
   * - GVP_FETCH_VIDEO_PROMPT: Generation completed with video/image URL
   * - GVP_FETCH_PROGRESS: Generation progress updates
   * - GVP_FETCH_ERROR: Error responses
   */
  function setupOGInterceptorListener() {
    window.addEventListener('message', (event) => {
      // Only accept messages from the page context
      if (event.source !== window) return;
      
      // Only accept messages from OG's interceptor
      if (event.data?.source !== 'gvp-fetch-interceptor') return;
      
      const { type, payload } = event.data;
      
      switch (type) {
        // Capture x-statsig-id from outgoing Grok requests
        case 'GVP_FETCH_CONVERSATION_REQUEST': {
          const headers = payload?.headers;
          if (headers) {
            // Headers are serialized as lowercase keys
            const statsigId = headers['x-statsig-id'];
            if (statsigId && statsigId !== capturedStatsigId) {
              capturedStatsigId = statsigId;
              debug('[OG Interceptor] Captured x-statsig-id:', statsigId.substring(0, 20) + '...');
              
              // Notify desktop that statsig is ready
              wsClient.send({
                type: 'statsig_captured',
                payload: { success: true },
                timestamp: Date.now()
              });
            }
          }
          break;
        }
        
        // Forward generation results to desktop app
        case 'GVP_FETCH_VIDEO_PROMPT': {
          debug('[OG Interceptor] Generation completed:', payload?.videoUrl || payload?.imageUrl);
          wsClient.send({
            type: 'generation_result',
            payload: {
              url: payload?.videoUrl || payload?.imageUrl || '',
              data: payload,
              timestamp: Date.now()
            }
          });
          break;
        }
        
        // Forward progress updates (optional, for future UI)
        case 'GVP_FETCH_PROGRESS': {
          debug('[OG Interceptor] Progress:', payload?.progress + '%');
          // Optionally forward to desktop for progress bar
          // wsClient.send({ type: 'progress', payload });
          break;
        }
        
        // Forward error responses
        case 'GVP_FETCH_ERROR': {
          debug('[OG Interceptor] Error:', payload?.error);
          wsClient.send({
            type: 'generation_result',
            payload: {
              url: 'error',
              data: { error: payload?.error, status: payload?.status },
              timestamp: Date.now()
            }
          });
          break;
        }
        
        // Interceptor ready signal
        case 'GVP_FETCH_READY': {
          debug('[OG Interceptor] Fetch interceptor is ready');
          break;
        }
        
        default:
          // Ignore other message types
          break;
      }
    });
    
    debug('OG Interceptor listener installed');
  }

```

⚠️ **DO NOT modify the `init()` function itself - just insert before it.**

---

## VERIFICATION CHECKLIST

| Check | Expected |
|-------|----------|
| `proxyFetch()` function removed | YES |
| `isGenerationUrl()` function removed | YES |
| `handleGenerationResponse()` function removed | YES |
| `setupOGInterceptorListener()` function added | YES |
| `init()` calls `setupOGInterceptorListener()` instead of `proxyFetch()` | YES |
| No other code modified | YES |

---

## Testing After Implementation

1. Open Grok with OG extension enabled
2. Open DevTools Console (F12)
3. Navigate around (scroll gallery, click tabs)
4. Look for: `[GVP Bridge] [OG Interceptor] Captured x-statsig-id: xxx...`
5. Enable Preview Mode in desktop app
6. Click a gallery card
7. Look for: `[GVP Bridge] Adding captured x-statsig-id: xxx...`
8. Verify generation succeeds (no 403 error)

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PAGE CONTEXT (Grok's World)                  │
│                                                                     │
│  Grok's JavaScript                                                  │
│       │                                                             │
│       ▼                                                             │
│  Grok adds x-statsig-id to headers                                  │
│       │                                                             │
│       ▼                                                             │
│  OG's gvpFetchInterceptor.js intercepts                             │
│       │                                                             │
│       ▼                                                             │
│  OG broadcasts: window.postMessage({                                 │
│    source: 'gvp-fetch-interceptor',                                 │
│    type: 'GVP_FETCH_CONVERSATION_REQUEST',                          │
│    payload: { headers: { 'x-statsig-id': 'xxx...' } }               │
│  })                                                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ window.postMessage crosses worlds
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CONTENT SCRIPT (Our World)                       │
│                                                                     │
│  Our setupOGInterceptorListener() receives message                  │
│       │                                                             │
│       ▼                                                             │
│  We extract x-statsig-id → capturedStatsigId                        │
│       │                                                             │
│       ▼                                                             │
│  We send to desktop: wsClient.send({ type: 'statsig_captured' })   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## END OF PLAN

**STOP after completing all steps.**
**Produce Work Report as specified in /implement workflow.**
