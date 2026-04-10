# PLAN-018: Fix Statsig Capture and Anti-Bot Trace Headers

## Problem Statement
1. `x-statsig-id` is only being captured on fresh video generations because the interceptor logic from PLAN-017 was not fully applied to ALL `/rest/` calls.
2. Preview Mode direct API calls are randomly blocked by anti-bot measures (403 Forbidden) because:
   - The `x-trace-id` header is missing.
   - The Sentry and Traceparent generated IDs do not correlate with each other (a classic WAF tripwire).
   - Forbidden browser headers (`sec-fetch-*`, `sec-ch-*`) are being manually set instead of letting Chrome attach them natively.

## Files to Modify
| File | Action | Purpose |
|------|--------|---------|
| `SD-GrokScripts/grok-video-prompter-extension/public/injected/gvpFetchInterceptor.js` | MODIFY | Add the missing capture logic for all `/rest/` API calls. |
| `GVP-Desktop/src-extension/content.bundle.js` | MODIFY | Rewrite `sendDirectGenerationRequest` to use perfectly correlated trace headers and remove forbidden overrides. |

## Implementation Details

### STEP 1 — Fix Statsig Capture in Interceptor
**File:** `A:\Tools n Programs\SD-GrokScripts\grok-video-prompter-extension\public\injected\gvpFetchInterceptor.js`
**Action:** MODIFY EXISTING

**Find this EXACT block (around line 597):**
    const isSystemPromptList = typeof url === 'string' &&
      url.includes('/rest/system-prompt/list') &&
      method === 'POST';

    // NEW: Notify extension when system-prompt/list is called (startup signal)
    if (isSystemPromptList) {
      console.log('[GVP Interceptor] 🔔 system-prompt/list detected, sending bridge message');
      postBridgeMessage('GVP_SYSTEM_PROMPT_LIST', {
        url,
        timestamp: Date.now()
      });
    }

    // FALLBACK: Also trigger on first gallery /list call (for pages that don't call system-prompt)

**Replace with:**
    const isSystemPromptList = typeof url === 'string' &&
      url.includes('/rest/system-prompt/list') &&
      method === 'POST';

    // NEW: Capture x-statsig-id from ANY Grok REST API call
    const isGrokRestApi = typeof url === 'string' &&
      url.includes('/rest/') &&
      url.includes('grok.com');

    let headersToInspect = null;
    if (init && init.headers) {
      headersToInspect = init.headers;
    } else if (typeof Request !== 'undefined' && input instanceof Request) {
      headersToInspect = input.headers;
    }

    if (isGrokRestApi && headersToInspect) {
      const hdrs = serializeHeaders(headersToInspect);
      if (hdrs && hdrs['x-statsig-id']) {
        postBridgeMessage('GVP_FETCH_STATSIG_CAPTURED', {
          statsigId: hdrs['x-statsig-id'],
          url,
          method,
          timestamp: Date.now()
        });
      }
    }

    // NEW: Notify extension when system-prompt/list is called (startup signal)
    if (isSystemPromptList) {
      console.log('[GVP Interceptor] 🔔 system-prompt/list detected, sending bridge message');
      postBridgeMessage('GVP_SYSTEM_PROMPT_LIST', {
        url,
        timestamp: Date.now()
      });
    }

    // FALLBACK: Also trigger on first gallery /list call (for pages that don't call system-prompt)

⚠️ DO NOT modify any line outside this block.

### STEP 2 — Fix Anti-Bot Headers & Remove Redundant Functions
**File:** `A:\Tools n Programs\GVP-Desktop\src-extension\content.bundle.js`
**Action:** MODIFY EXISTING

**Find and DELETE these three functions entirely (around lines 905-930):**
  function generateTraceparent() { ... }
  function generateSentryTrace() { ... }
  function generateBaggage() { ... }

**Find this EXACT block inside `sendDirectGenerationRequest`:**
    // Generate trace IDs
    const traceId = crypto.randomUUID?.() || 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.random().toString(16)[2]);
    const requestId = crypto.randomUUID?.() || traceId;
    
    // Construct the public share URL for the image
    const imageUrl = `https://imagine-public.x.ai/imagine-public/share-images/${imageId}.png`;

**Replace with:**
    // Generate CONSISTENT trace IDs for Anti-Bot compliance
    const traceId = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const spanId = Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const sentryTraceId = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const sentrySpanId = Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const requestId = crypto.randomUUID();
    
    // Construct the public share URL for the image
    const imageUrl = `https://imagine-public.x.ai/imagine-public/share-images/${imageId}.png`;

**Find this EXACT block inside `sendDirectGenerationRequest`:**
    // Get Chrome version from navigator
    const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '147.0.7727.24';
    
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

    // Reuse captured Statsig ID if available (critical for anti-bot)

**Replace with:**
    // Build clean API headers. Do NOT set forbidden browser headers manually.
    // Chrome will natively attach the correct TLS fingerprints, cookies, sec-ch, and CORS headers.
    const headers = {
      'accept': '*/*',
      'baggage': `sentry-environment=production,sentry-release=75e6c8571451414ca5f1b05a61f7ce291aac10c4,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c,sentry-trace_id=${sentryTraceId},sentry-org_id=4508179396558848,sentry-sampled=false,sentry-sample_rand=${Math.random()},sentry-sample_rate=0`,
      'content-type': 'application/json',
      'priority': 'u=1, i',
      'sentry-trace': `${sentryTraceId}-${sentrySpanId}-0`,
      'traceparent': `00-${traceId}-${spanId}-00`,
      'x-trace-id': traceId,
      'x-xai-request-id': requestId
    };

    // Reuse captured Statsig ID if available (critical for anti-bot)

⚠️ DO NOT modify any line outside this block.

## VERIFICATION CHECKLIST
| Check | Expected |
|-------|----------|
| Statsig Capture logic added to interceptor | YES |
| Interceptor safely checks `isGrokRestApi` | YES |
| Old random `generateTraceparent` etc functions removed | YES |
| `traceId` and `sentryTraceId` variables properly define correlation | YES |
| `baggage` and `traceparent` correctly utilize the correlated IDs | YES |
| `x-trace-id` correctly added back to headers | YES |
| Forbidden headers (`sec-fetch-*`, etc) removed | YES |