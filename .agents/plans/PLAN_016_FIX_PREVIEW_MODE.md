# PLAN_016: Fix Preview Mode - Wrong ImageId & Missing Tracing Headers

## Problem Statement

Preview Mode is failing with 403 Forbidden due to:
1. **Wrong imageId** - The account UUID is being used instead of the actual image UUID
2. **Missing tracing headers** - Grok expects `baggage`, `sentry-trace`, `traceparent` headers

### Root Cause Analysis

**Issue 1: Click Handler Bug**

The click handler matches too broadly:
```javascript
const card = event.target.closest('[class*="masonry"], [class*="gallery"], a[href*="/imagine/post/"]');
```

If the user clicks on an element inside the masonry CONTAINER (not a card), `card` becomes the container. Then:
```javascript
const link = card.closest('a[href*="/imagine/post/"]');
```
`closest()` searches UP, finding a random link (possibly user profile) instead of the clicked card's link.

**Issue 2: Missing Tracing Headers**

Normal Grok requests include Sentry/W3C tracing headers that we're not generating:
- `baggage` - Sentry distributed tracing metadata
- `sentry-trace` - Sentry trace ID and span ID
- `traceparent` - W3C Trace Context standard

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `src-extension/content.bundle.js` | MODIFY | Fix click handler, add tracing headers |

---

## Implementation Details

### STEP 1 — Fix Gallery Card Click Handler

**File:** `src-extension/content.bundle.js`
**Action:** REPLACE the `setupGalleryCardClickHandler` function

**Find this EXACT block (lines 556-613):**
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

**Replace with:**
```javascript
  /**
   * Set up click handler for gallery cards in Preview Mode
   * Extracts imageId from clicked card and sends to desktop
   * 
   * CRITICAL: Must find the ACTUAL gallery card link, not parent containers
   */
  function setupGalleryCardClickHandler() {
    document.addEventListener('click', (event) => {
      if (!interceptGenerations) return;
      
      // Extract imageId - start from the clicked element and work up/down
      let imageId = null;
      let targetElement = event.target;
      
      // Method 1: Check if clicked element (or parent) is a gallery card link
      // Look for: a[href*="/imagine/post/"] - this is the most reliable selector
      let cardLink = targetElement.closest('a[href*="/imagine/post/"]');
      
      if (cardLink) {
        const href = cardLink.getAttribute('href');
        const match = href.match(/\/imagine\/post\/([a-f0-9-]{36})/i);
        if (match) {
          imageId = match[1];
          debug('[Gallery Click] Found imageId from card link:', imageId);
        }
      }
      
      // Method 2: Check for data attributes on the card element
      if (!imageId) {
        // Look for common gallery card containers
        const cardContainer = targetElement.closest('[class*="masonry-item"], [class*="gallery-item"], [data-image-id], [data-id]');
        if (cardContainer) {
          imageId = cardContainer.dataset.imageId || cardContainer.dataset.id;
          if (imageId) {
            debug('[Gallery Click] Found imageId from data attribute:', imageId);
          }
        }
      }
      
      // Method 3: Extract from img src URL (assets.grok.com contains the UUID)
      if (!imageId) {
        const img = targetElement.closest('img') || targetElement.querySelector('img');
        if (img && img.src) {
          // Try to match UUID in the URL path
          const srcMatch = img.src.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
          if (srcMatch) {
            imageId = srcMatch[1];
            debug('[Gallery Click] Found imageId from img src:', imageId);
          }
        }
      }
      
      // Method 4: Check background-image of the clicked element
      if (!imageId) {
        const elementWithBg = targetElement.closest('[style*="background-image"]');
        if (elementWithBg) {
          const bgStyle = elementWithBg.style.backgroundImage || '';
          const bgMatch = bgStyle.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
          if (bgMatch) {
            imageId = bgMatch[1];
            debug('[Gallery Click] Found imageId from background-image:', imageId);
          }
        }
      }
      
      if (imageId) {
        // VALIDATE: Ensure this looks like a valid image UUID (not account ID or other)
        // Image IDs should match the pattern and NOT be the user's account ID
        const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
        if (!uuidPattern.test(imageId)) {
          debug('[Gallery Click] WARNING: imageId does not match UUID pattern:', imageId);
          return;
        }
        
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

---

### STEP 2 — Add Tracing Header Generation

**File:** `src-extension/content.bundle.js`
**Action:** ADD helper function for tracing headers, then UPDATE `sendDirectGenerationRequest`

**Find this EXACT block (line 826):**
```javascript
  /**
   * Send direct generation request for Preview Mode
   * Uses the CORRECT Grok API: /rest/app-chat/conversations/new
   */
  async function sendDirectGenerationRequest(imageId, prompt) {
```

**Insert BEFORE it:**
```javascript
  /**
   * Generate W3C Trace Context traceparent header
   * Format: 00-{trace-id}-{parent-id}-{flags}
   */
  function generateTraceparent() {
    const traceId = crypto.randomUUID?.().replace(/-/g, '') || 
      Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const parentId = crypto.randomUUID?.().replace(/-/g, '').substring(0, 16) ||
      Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `00-${traceId}-${parentId}-00`;
  }

  /**
   * Generate Sentry trace header
   * Format: {trace-id}-{span-id}-{sampled}
   */
  function generateSentryTrace() {
    const traceId = crypto.randomUUID?.().replace(/-/g, '') ||
      Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const spanId = crypto.randomUUID?.().replace(/-/g, '').substring(0, 16) ||
      Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${traceId}-${spanId}-0`;
  }

  /**
   * Generate Sentry baggage header
   * Contains tracing metadata for distributed tracing
   */
  function generateBaggage() {
    const traceId = crypto.randomUUID?.().replace(/-/g, '') ||
      Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `sentry-environment=production,sentry-release=75e6c8571451414ca5f1b05a61f7ce291aac10c4,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c,sentry-trace_id=${traceId},sentry-org_id=4508179396558848,sentry-transaction=%2F%3Aslug*%3F,sentry-sampled=false,sentry-sample_rand=0.30345577121147616,sentry-sample_rate=0`;
  }

```

---

### STEP 3 — Add Tracing Headers to Direct API Request

**File:** `src-extension/content.bundle.js`
**Action:** ADD tracing headers to the headers object in `sendDirectGenerationRequest`

**Find this EXACT block (lines 876-900):**
```javascript
    // Build anti-bot headers to match browser's normal request
    const headers = {
      'accept': '*/*',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'origin': 'https://grok.com',
      'priority': 'u=1, i',
      'referer': window.location.href,
      'sec-ch-ua': `"Google Chrome";v="${chromeVersion.split('.')[0]}", "Not.A/Brand";v="8", "Chromium";v="${chromeVersion.split('.')[0]}"`,
      'sec-ch-ua-arch': '"x86"',
      'sec-ch-ua-bitness': '"64"',
      'sec-Ch-ua-full-version': `"${chromeVersion}"`,
      'sec-ch-ua-full-version-list': `"Google Chrome";v="${chromeVersion}", "Not.A/Brand";v="8.0.0.0", "Chromium";v="${chromeVersion}"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-model': '""',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-platform-version': '"10.0.0"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': navigator.userAgent,
      'x-trace-id': traceId,
      'x-xai-request-id': requestId
    };
```

**Replace with:**
```javascript
    // Build anti-bot headers to match browser's normal request
    const headers = {
      'accept': '*/*',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'accept-language': 'en-US,en;q=0.9',
      'baggage': generateBaggage(),
      'content-type': 'application/json',
      'origin': 'https://grok.com',
      'priority': 'u=1, i',
      'referer': window.location.href,
      'sec-ch-ua': `"Google Chrome";v="${chromeVersion.split('.')[0]}", "Not.A/Brand";v="8", "Chromium";v="${chromeVersion.split('.')[0]}"`,
      'sec-ch-ua-arch': '"x86"',
      'sec-ch-ua-bitness': '"64"',
      'sec-Ch-ua-full-version': `"${chromeVersion}"`,
      'sec-ch-ua-full-version-list': `"Google Chrome";v="${chromeVersion}", "Not.A/Brand";v="8.0.0.0", "Chromium";v="${chromeVersion}"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-model': '""',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-platform-version': '"10.0.0"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sentry-trace': generateSentryTrace(),
      'traceparent': generateTraceparent(),
      'user-agent': navigator.userAgent,
      'x-xai-request-id': requestId
    };
```

⚠️ **NOTE:** Removed `x-trace-id` (not present in correct requests) and added `baggage`, `sentry-trace`, `traceparent`.

---

## VERIFICATION CHECKLIST

| Check | Expected |
|-------|----------|
| `setupGalleryCardClickHandler` rewritten | YES |
| `generateTraceparent()` function added | YES |
| `generateSentryTrace()` function added | YES |
| `generateBaggage()` function added | YES |
| Headers include `baggage` | YES |
| Headers include `sentry-trace` | YES |
| Headers include `traceparent` | YES |
| Headers do NOT include `x-trace-id` | YES |
| No other code modified | YES |

---

## Testing After Implementation

1. Reload extension in Chrome
2. Navigate to Grok gallery
3. Enable Preview Mode in desktop app
4. Click a gallery card
5. Check console for: `[Gallery Click] Found imageId from card link: {UUID}`
6. Verify the UUID is NOT the account UUID
7. Check request headers include `baggage`, `sentry-trace`, `traceparent`
8. Verify generation succeeds (200 response)

---

## END OF PLAN

**STOP after completing all steps.**
**Produce Work Report as specified in /implement workflow.**
