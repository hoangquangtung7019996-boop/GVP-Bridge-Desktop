# PLAN-025: Fix Sentry Correlation (WAF Bypass)

## Problem Statement
The standalone fetch in `content.bundle.js` is failing with X.ai's `Request rejected by anti-bot rules` (Code 7) because the `sentry-trace` ID and the `sentry-trace_id` inside the `baggage` header were mathematically uncorrelated. Sentry clients naturally use the exact same ID for both. Mismatched IDs instantly flag the request as a synthetic bot payload.

## Files to Modify
| File | Action | Purpose |
|------|--------|---------|
| `GVP-Desktop/src-extension/content.bundle.js` | MODIFY | Correlate the Sentry IDs in `sendDirectGenerationRequest` to perfectly match native browser behavior. |

## Implementation Details

### STEP 1 — Correlate Sentry IDs in Standalone Fetch
**File:** `A:\Tools n Programs\GVP-Desktop\src-extension\content.bundle.js`
**Action:** MODIFY EXISTING

**Find this EXACT block (around line 1030 inside `sendDirectGenerationRequest`):**
    // Generate distinct trace correlation IDs (Matching Grok's un-correlated native behavior)
    const traceparentHex = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const traceparentSpan = Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const sentryHex = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const sentrySpan = Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const sentryBaggageHex = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const requestId = crypto.randomUUID();
    
    const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '147.0.7727.24';
    const majorVersion = chromeVersion.split('.')[0];
    
    // 1:1 match of Grok's explicit JS headers to prove JS execution to Cloudflare WAF
    // CRITICAL: We DO NOT include x-trace-id here, as that is appended downstream by the Service Worker.
    const headers = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'baggage': `sentry-environment=production,sentry-release=75e6c8571451414ca5f1b05a61f7ce291aac10c4,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c,sentry-trace_id=${sentryBaggageHex},sentry-org_id=4508179396558848,sentry-sampled=false,sentry-sample_rand=${Math.random()},sentry-sample_rate=0`,
      'content-type': 'application/json',
      'priority': 'u=1, i',
      'sec-ch-ua': `"Google Chrome";v="${majorVersion}", "Not.A/Brand";v="8", "Chromium";v="${majorVersion}"`,
      'sec-ch-ua-arch': '"x86"',
      'sec-ch-ua-bitness': '"64"',
      'sec-ch-ua-full-version': `"${chromeVersion}"`,
      'sec-ch-ua-full-version-list': `"Google Chrome";v="${chromeVersion}", "Not.A/Brand";v="8.0.0.0", "Chromium";v="${chromeVersion}"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-model': '""',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-platform-version': '"10.0.0"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sentry-trace': `${sentryHex}-${sentrySpan}-0`,
      'traceparent': `00-${traceparentHex}-${traceparentSpan}-00`,
      'x-xai-request-id': requestId
    };

**Replace with:**
    // Generate mathematically correlated trace IDs (Matching Grok's native Sentry behavior)
    const traceparentHex = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const traceparentSpan = Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    
    // CRITICAL FIX: sentryHex MUST be identical across both Sentry headers
    const sentryHex = Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const sentrySpan = Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const requestId = crypto.randomUUID();
    
    const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '147.0.7727.24';
    const majorVersion = chromeVersion.split('.')[0];
    
    // 1:1 match of Grok's explicit JS headers to prove JS execution to Cloudflare WAF
    // CRITICAL: We DO NOT include x-trace-id here, as that is appended downstream by the Service Worker.
    const headers = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'baggage': `sentry-environment=production,sentry-release=75e6c8571451414ca5f1b05a61f7ce291aac10c4,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c,sentry-trace_id=${sentryHex},sentry-org_id=4508179396558848,sentry-sampled=false,sentry-sample_rand=${Math.random()},sentry-sample_rate=0`,
      'content-type': 'application/json',
      'priority': 'u=1, i',
      'sec-ch-ua': `"Google Chrome";v="${majorVersion}", "Not.A/Brand";v="8", "Chromium";v="${majorVersion}"`,
      'sec-ch-ua-arch': '"x86"',
      'sec-ch-ua-bitness': '"64"',
      'sec-ch-ua-full-version': `"${chromeVersion}"`,
      'sec-ch-ua-full-version-list': `"Google Chrome";v="${chromeVersion}", "Not.A/Brand";v="8.0.0.0", "Chromium";v="${chromeVersion}"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-model': '""',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-platform-version': '"10.0.0"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sentry-trace': `${sentryHex}-${sentrySpan}-0`,
      'traceparent': `00-${traceparentHex}-${traceparentSpan}-00`,
      'x-xai-request-id': requestId
    };

⚠️ DO NOT modify any line outside this block.

## VERIFICATION CHECKLIST
| Check | Expected |
|-------|----------|
| `sentryBaggageHex` variable completely removed | YES |
| Both Sentry headers use the exact same `sentryHex` string | YES |