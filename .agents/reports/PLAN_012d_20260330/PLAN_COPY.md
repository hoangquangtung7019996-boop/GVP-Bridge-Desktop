# PLAN 012d: Fix Anti-Bot Headers for Direct API Calls

## Problem
Preview Mode direct API calls return 403:
```
{"error":{"code":7,"message":"Request rejected by anti-bot rules.","details":[]}}
```

## Root Cause
Content script `fetch()` doesn't include standard browser headers. Grok's Cloudflare protection requires:

1. `sec-ch-ua` series (Chrome fingerprinting)
2. `sec-fetch-*` series (CORS metadata)
3. `origin` and `referer`
4. `accept`, `accept-encoding`, `accept-language`
5. `user-agent`
6. `priority`

## Headers Comparison

### Failed Request (Content Script)
```
content-type: application/json
x-trace-id: {uuid}
x-xai-request-id: {uuid}
```

### Successful Request (Manual)
```
accept: */*
accept-encoding: gzip, deflate, br, zstd
accept-language: en-US,en;q=0.9
content-type: application/json
origin: https://grok.com
priority: u=1, i
referer: https://grok.com/imagine/saved
sec-ch-ua: "Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"
sec-ch-ua-arch: "x86"
sec-ch-ua-bitness: "64"
sec-ch-ua-full-version: "147.0.7727.24"
sec-ch-ua-full-version-list: "Google Chrome";v="147.0.7727.24", "Not.A/Brand";v="8.0.0.0", "Chromium";v="147.0.7727.24"
sec-ch-ua-mobile: ?0
sec-ch-ua-model: ""
sec-ch-ua-platform: "Windows"
sec-ch-ua-platform-version: "10.0.0"
sec-fetch-dest: empty
sec-fetch-mode: cors
sec-fetch-site: same-origin
user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36
x-trace-id: {uuid}
x-xai-request-id: {uuid}
```

## Implementation

### File: `src-extension/content.bundle.js`

**Find `sendDirectGenerationRequest()` and replace the fetch call:**

```javascript
  async function sendDirectGenerationRequest(imageId, prompt) {
    debug('[sendDirectGenerationRequest] Starting direct API call for imageId:', imageId);
    debug('[sendDirectGenerationRequest] Prompt:', prompt?.substring(0, 50) || '(none)');
    
    // Generate trace IDs
    const traceId = crypto.randomUUID?.() || 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.random().toString(16)[2]);
    const requestId = crypto.randomUUID?.() || traceId;
    
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
    
    debug('[sendDirectGenerationRequest] Payload:', JSON.stringify(payload, null, 2));
    
    // Get Chrome version from navigator
    const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '147.0.7727.24';
    
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
    
    debug('[sendDirectGenerationRequest] Headers:', JSON.stringify(headers, null, 2));
    
    try {
      const response = await fetch('https://grok.com/rest/app-chat/conversations/new', {
        method: 'POST',
        headers: headers,
        credentials: 'include',  // Include cookies for auth
        body: JSON.stringify(payload)
      });
      
      debug('[sendDirectGenerationRequest] Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API returned ${response.status}: ${errorText}`);
      }
      
      // The response is a stream - the fetch proxy will intercept it
      debug('[sendDirectGenerationRequest] Request sent successfully, stream will be intercepted');
      lastAction = 'Preview: Generation started';
      
    } catch (error) {
      debug('[sendDirectGenerationRequest] Error:', error);
      lastAction = `Preview error: ${error.message}`;
      
      // Send error to desktop
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
```

## Key Changes

| Header | Value | Purpose |
|--------|-------|---------|
| `accept` | `*/*` | Standard accept header |
| `accept-encoding` | `gzip, deflate, br, zstd` | Compression support |
| `accept-language` | `en-US,en;q=0.9` | Language preference |
| `origin` | `https://grok.com` | CORS origin |
| `referer` | Current page URL | Request source |
| `sec-ch-ua` | Chrome version | Browser fingerprint |
| `sec-ch-ua-*` | Platform info | Anti-bot fingerprinting |
| `sec-fetch-*` | CORS metadata | Request context |
| `user-agent` | `navigator.userAgent` | Browser identity |
| `priority` | `u=1, i` | Resource priority |

## DO NOT DEVIATE
- All headers must match exactly what the browser sends
- Chrome version is extracted from `navigator.userAgent`
- Referer should be current page URL
- Origin must be `https://grok.com`
