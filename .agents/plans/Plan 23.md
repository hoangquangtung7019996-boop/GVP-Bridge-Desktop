# PLAN-023: Standalone Perfect WAF Spoofing

## Problem Statement
Delegating the execution to the page context failed because of strict event loop isolation. However, analysis of a successful native Grok fetch proves that Cloudflare's WAF demands explicitly calculated high-entropy `sec-ch-ua` headers within the Javascript execution payload, and explicitly rejects requests that manually spoof the `x-trace-id` (which is reserved for the Service Worker). We must construct a perfect, standalone synthetic payload using the cleanly sniffed Statsig ID.

## Files to Modify
| File | Action | Purpose |
|------|--------|---------|
| `GVP-Desktop/src-extension/content.bundle.js` | MODIFY | Revert delegation and implement the perfect 1:1 clone of Grok's native high-entropy fetch signature. |

## Implementation Details

### STEP 1 — Implement Perfect Standalone Fetch
**File:** `A:\Tools n Programs\GVP-Desktop\src-extension\content.bundle.js`
**Action:** MODIFY EXISTING

**Find this EXACT block (around line 1008 down to the closing brace):**
  /**
   * Send direct generation request for Preview Mode
   * Delegates the execution to the page context to perfectly spoof anti-bot headers
   */
  async function sendDirectGenerationRequest(imageId, prompt) {
    debug('[sendDirectGenerationRequest] Starting direct API call for imageId:', imageId);
    debug('[sendDirectGenerationRequest] Prompt:', prompt?.substring(0, 50) || '(none)');
    
    // Construct the public share URL for the image
    const imageUrl = `https://imagine-public.x.ai/imagine-public/share-images/${imageId}.png`;
    
    // Build message: image URL + prompt + mode flag
    const modeFlag = prompt ? '--mode=custom' : '--mode=normal';
    const message = prompt 
      ? `${imageUrl} ${prompt} ${modeFlag}`
      : `${imageUrl} ${modeFlag}`;
    
    // Build the payload matching Grok's expected structure
    const payload = {
      temporary: true,
      modelName: "grok-3",
      enableSideBySide: true,
      message: message,
      responseMetadata: {
        experiments: [],
        modelConfigOverride: {
          modelMap: {
            videoGenModelConfig: {
              parentPostId: imageId,
              aspectRatio: "1:1",
              videoLength: 10,
              resolutionName: "480p",
              isRootCelebrity: false,
              isRootChild: false,
              isRootRRated: false,
              isRootUserUploaded: false
            }
          }
        }
      },
      toolOverrides: {
        videoGen: true
      }
    };
    
    debug('[sendDirectGenerationRequest] Delegating fetch to page context (GVP_EXECUTE_DIRECT_GEN)');
    lastAction = 'Preview: Generation delegated to page';
    
    // Send payload to page context to be executed by Grok's native fetch wrapper
    window.postMessage({
      source: 'gvp-extension',
      type: 'GVP_EXECUTE_DIRECT_GEN',
      payload: payload
    }, '*');
  }

**Replace with:**
  /**
   * Send direct generation request for Preview Mode
   * Executes a standalone fetch with a perfect 1:1 replication of Grok's native WAF signature.
   */
  async function sendDirectGenerationRequest(imageId, prompt) {
    debug('[sendDirectGenerationRequest] Starting direct API call for imageId:', imageId);
    debug('[sendDirectGenerationRequest] Prompt:', prompt?.substring(0, 50) || '(none)');
    
    // Construct the public share URL for the image
    const imageUrl = `https://imagine-public.x.ai/imagine-public/share-images/${imageId}.png`;
    
    // Build message: image URL + prompt + mode flag
    const modeFlag = prompt ? '--mode=custom' : '--mode=normal';
    const message = prompt 
      ? `${imageUrl} ${prompt} ${modeFlag}`
      : `${imageUrl} ${modeFlag}`;
    
    const payload = {
      temporary: true,
      modelName: "grok-3",
      enableSideBySide: true,
      message: message,
      responseMetadata: {
        experiments: [],
        modelConfigOverride: {
          modelMap: {
            videoGenModelConfig: {
              parentPostId: imageId,
              aspectRatio: "1:1",
              videoLength: 10,
              resolutionName: "480p",
              isRootCelebrity: false,
              isRootChild: false,
              isRootRRated: false,
              isRootUserUploaded: false
            }
          }
        }
      },
      toolOverrides: {
        videoGen: true
      }
    };
    
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
      'baggage': `sentry-environment=production,sentry-release=75e6c8571451414ca5f1b05a61f7ce291aac10c4,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c,sentry-trace_id=${sentryBaggageHex},sentry-org_id=4508179396558848,sentry-transaction=%2F%3Aslug*%3F,sentry-sampled=false,sentry-sample_rand=${Math.random()},sentry-sample_rate=0`,
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

    if (capturedStatsigId) {
      headers['x-statsig-id'] = capturedStatsigId;
    } else {
      debug('[WARN] No statsig-id captured - Preview Mode will likely trigger anti-bot');
    }

    debug('[sendDirectGenerationRequest] Executing standalone fetch with WAF signature');
    lastAction = 'Preview: Executing standalone fetch';
    
    try {
      const response = await fetch('https://grok.com/rest/app-chat/conversations/new', {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      
      debug('[sendDirectGenerationRequest] Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API returned ${response.status}: ${errorText}`);
      }
      
      debug('[sendDirectGenerationRequest] Stream opened, waiting for interceptor');
    } catch (error) {
      debug('[sendDirectGenerationRequest] Error:', error);
      wsClient.send({
        type: 'generation_result',
        payload: {
          url: 'https://grok.com/rest/app-chat/conversations/new',
          data: { error: error.message },
          timestamp: Date.now()
        }
      });
    }
  }

⚠️ DO NOT modify any line outside this block.