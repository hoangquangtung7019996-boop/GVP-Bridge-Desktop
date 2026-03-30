# PLAN 012c: Preview Mode - CORRECT Direct API Calls

## Previous Mistake
PLAN_012b used a made-up endpoint `https://grok.com/rest/app/grok/generate` which does not exist.

## Correct API (from network capture)

**Endpoint**: `https://grok.com/rest/app-chat/conversations/new`

**Method**: POST

**Required Headers**:
```
content-type: application/json
x-trace-id: {UUID}
x-xai-request-id: {UUID}
```

**Cookies**: Sent automatically with `credentials: 'include'`

---

## Correct Payload Structure

```javascript
{
  "temporary": true,
  "modelName": "grok-3",
  "enableSideBySide": true,
  "message": "https://imagine-public.x.ai/imagine-public/share-images/{imageId}.png {prompt} --mode=custom",
  "responseMetadata": {
    "experiments": [],
    "modelConfigOverride": {
      "modelMap": {
        "videoGenModelConfig": {
          "parentPostId": "{imageId}",
          "aspectRatio": "1:1",
          "videoLength": 10,
          "resolutionName": "480p",
          "isRootCelebrity": false,
          "isRootChild": false,
          "isRootRRated": false,
          "isRootUserUploaded": false
        }
      }
    }
  },
  "toolOverrides": {
    "videoGen": true
  }
}
```

### Key Fields:

| Field | Description | Value |
|-------|-------------|-------|
| `message` | Image URL + prompt + mode flag | `https://imagine-public.x.ai/imagine-public/share-images/{imageId}.png {prompt} --mode=custom` |
| `parentPostId` | The image UUID | `{imageId}` |
| `modelName` | Grok model | `"grok-3"` |
| `toolOverrides.videoGen` | Enable video generation | `true` |

### Message Format:
- **No prompt (promptless)**: `https://imagine-public.x.ai/imagine-public/share-images/{imageId}.png --mode=normal`
- **With prompt**: `https://imagine-public.x.ai/imagine-public/share-images/{imageId}.png {your prompt text} --mode=custom`

---

## Implementation Fix

### File: `src-extension/content.bundle.js`

**Find the incorrect `sendDirectGenerationRequest()` function:**
```javascript
  async function sendDirectGenerationRequest(imageId, prompt) {
    debug('[sendDirectGenerationRequest] Starting direct API call for imageId:', imageId);
    
    try {
      // Call Grok's generate API directly
      const response = await fetch('https://grok.com/rest/app/grok/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          imageId: imageId,
          prompt: prompt,
        })
      });
      // ... rest of function
```

**Replace with CORRECT implementation:**
```javascript
  /**
   * Send direct generation request for Preview Mode
   * Uses the CORRECT Grok API: /rest/app-chat/conversations/new
   */
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
    
    try {
      const response = await fetch('https://grok.com/rest/app-chat/conversations/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trace-id': traceId,
          'x-xai-request-id': requestId
        },
        credentials: 'include',  // Include cookies for auth
        body: JSON.stringify(payload)
      });
      
      debug('[sendDirectGenerationRequest] Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API returned ${response.status}: ${errorText}`);
      }
      
      // The response is a stream - the fetch proxy will intercept it
      // But we also need to handle the initial response
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

---

## Response Handling

The response from `/conversations/new` is an **NDJSON stream** (Newline Delimited JSON).

The existing `proxyFetch()` function already intercepts responses from `isGenerationUrl()`.

**Update `isGenerationUrl()` to include this endpoint:**
```javascript
  function isGenerationUrl(url) {
    if (!url) return false;
    // Grok's generation endpoints
    return url.includes('/rest/app-chat/conversations/new') ||
           url.includes('/rest/app/grok/upscale') || 
           url.includes('/rest/app/grok/generate') ||
           url.includes('/rest/app/grok/get_video_generation_result');
  }
```

---

## Stream Response Structure

The NDJSON stream contains progress updates like:
```json
{"result":{"response":{"streamingVideoGenerationResponse":{"progress":25,"videoId":"...","moderated":false}}}}
{"result":{"response":{"streamingVideoGenerationResponse":{"progress":50,"videoId":"..."}}}}
{"result":{"response":{"streamingVideoGenerationResponse":{"progress":100,"videoUrl":"https://..."}}}}
```

The existing `processResponseBody()` in `gvpFetchInterceptor.js` handles this.

---

## Testing

1. Enable Preview Mode toggle in desktop app
2. Click a gallery card on Grok
3. Should see:
   - `preview_card_clicked` sent to desktop
   - `prompt_response` received with previewMode=true
   - `sendDirectGenerationRequest()` called
   - POST to `/rest/app-chat/conversations/new`
   - Stream intercepted and sent to desktop
   - Video displayed in GalleryPanel

---

## DO NOT DEVIATE

1. Endpoint is `/rest/app-chat/conversations/new` NOT `/rest/app/grok/generate`
2. Message format is `{imageUrl} {prompt} --mode=custom`
3. `parentPostId` goes in `videoGenModelConfig`
4. Must include `toolOverrides: { videoGen: true }`
5. Must include trace IDs in headers
