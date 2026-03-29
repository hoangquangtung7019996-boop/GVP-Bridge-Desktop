# PLAN 012: Video/Image Display System

## Overview

Add a toggle to intercept API responses and display generated videos/images in the desktop app instead of auto-submitting to Grok.

**Goal:** Allow users to preview and manage generations directly in the desktop app.

---

## Note: PLAN_011 May Need Revisiting

**IMPORTANT:** Stress testing is ongoing for PLAN_011 (double click/multiprompt fix). If edge cases are discovered during testing, PLAN_011 may require additional corrections. Check `.agents/reports/PLAN_011_QUICK_RAW_RETURN_TO_GALLERY_20260329/` for the latest status before implementing this plan.

---

## Feature Description

### Current Flow
```
User clicks card → Extension injects prompt → Clicks submit → Video generates on Grok
```

### New Flow (When Toggle Enabled)
```
User clicks card → Extension intercepts API response → Desktop app displays video/image
```

### Benefits
- Preview generations without leaving desktop app
- View moderated generation info
- Access successful video/image URLs
- Build a local gallery of generations

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                     DESKTOP APP (Tauri)                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │   Toggle    │    │  Response    │    │   Display     │  │
│  │   Switch    │───▶│  Interceptor │───▶│   Gallery     │  │
│  │  "Preview"  │    │              │    │   Panel       │  │
│  └─────────────┘    └──────────────┘    └───────────────┘  │
│                            │                                │
│                            ▼                                │
│                    ┌──────────────┐                        │
│                    │  WebSocket   │                        │
│                    │  Message     │                        │
│                    └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  CONTENT SCRIPT (Chrome)                     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Fetch/XHR  │    │   Response   │    │   WebSocket  │  │
│  │   Intercept  │───▶│   Parser     │───▶│   Sender     │  │
│  │              │    │              │    │              │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Desktop App UI

#### Step 1: Add Toggle Switch

**File:** `src-desktop/components/PromptInput.tsx` (or equivalent)

**Add:**
```tsx
// State for preview mode
const [previewMode, setPreviewMode] = createSignal(false);

// Toggle component
<div class="flex items-center gap-2">
  <Switch
    checked={previewMode()}
    onChange={(checked) => setPreviewMode(checked)}
  />
  <span class="text-sm">Preview Mode</span>
</div>
```

#### Step 2: Add Gallery Display Panel

**File:** `src-desktop/components/GalleryPanel.tsx` (new file)

**Create:**
```tsx
import { createSignal, For } from 'solid-js';

interface Generation {
  id: string;
  type: 'video' | 'image';
  url: string;
  thumbnailUrl?: string;
  prompt: string;
  status: 'success' | 'moderated' | 'processing';
  createdAt: number;
}

export function GalleryPanel() {
  const [generations, setGenerations] = createSignal<Generation[]>([]);
  
  // Add generation from WebSocket message
  const addGeneration = (gen: Generation) => {
    setGenerations(prev => [gen, ...prev].slice(0, 50)); // Keep last 50
  };
  
  return (
    <div class="gallery-panel">
      <h3>Generations</h3>
      <div class="grid grid-cols-2 gap-2">
        <For each={generations()}>
          {(gen) => (
            <div class="generation-card">
              {gen.type === 'video' ? (
                <video src={gen.url} controls class="w-full" />
              ) : (
                <img src={gen.url} class="w-full" />
              )}
              <p class="text-xs truncate">{gen.prompt}</p>
              <span class={`status ${gen.status}`}>{gen.status}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
```

### Phase 2: WebSocket Protocol Extension

#### Step 3: Add New Message Types

**File:** `src-tauri/src/websocket.rs` (or equivalent)

**Add message types:**
```rust
// Incoming from content script
#[derive(Deserialize)]
#[serde(tag = "type")]
enum Message {
    // Existing
    #[serde(rename = "status")]
    Status { payload: StatusPayload },
    #[serde(rename = "url_changed")]
    UrlChanged { payload: UrlChangedPayload },
    #[serde(rename = "prompt_request")]
    PromptRequest { payload: PromptRequestPayload },
    
    // NEW: Generation response
    #[serde(rename = "generation_result")]
    GenerationResult { payload: GenerationPayload },
}

#[derive(Deserialize)]
struct GenerationPayload {
    generation_id: String,
    generation_type: String, // "video" | "image"
    url: Option<String>,
    thumbnail_url: Option<String>,
    prompt: String,
    status: String, // "success" | "moderated" | "error"
    moderated_reason: Option<String>,
}
```

#### Step 4: Add Preview Mode Flag to Prompt Response

**Modify:** `prompt_response` message to include `previewMode`

```json
{
  "type": "prompt_response",
  "payload": {
    "prompt": "...",
    "imageId": "...",
    "previewMode": true
  }
}
```

### Phase 3: Content Script Interception

#### Step 5: Add Fetch/XHR Interceptor

**File:** `src-extension/content.bundle.js`

**Add:**
```javascript
// === GENERATION INTERCEPTION ===
let interceptGenerations = false;

// Listen for preview mode toggle from desktop
wsClient.onPreviewModeChange((enabled) => {
  interceptGenerations = enabled;
  debug('[Interception] Preview mode:', enabled);
});

// Intercept fetch
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch.apply(this, args);
  
  if (!interceptGenerations) {
    return response;
  }
  
  // Clone for reading
  const clone = response.clone();
  
  // Check if this is a generation response
  const url = args[0];
  if (typeof url === 'string' && isGenerationUrl(url)) {
    clone.json().then(data => {
      handleGenerationResponse(url, data);
    }).catch(() => {});
  }
  
  return response;
};

function isGenerationUrl(url) {
  // Grok generation endpoints
  return url.includes('/api/generate') || 
         url.includes('/api/video') ||
         url.includes('/conversations') && url.includes('/messages');
}

function handleGenerationResponse(url, data) {
  debug('[Interception] Generation response:', url, data);
  
  // Parse response based on type
  const result = parseGenerationData(data);
  
  if (result) {
    // Send to desktop app
    wsClient.send({
      type: 'generation_result',
      payload: result
    });
  }
}

function parseGenerationData(data) {
  // Extract video/image URL from response
  // Handle both success and moderated cases
  
  if (data.video_url || data.videoUrl) {
    return {
      generation_id: data.id || crypto.randomUUID(),
      generation_type: 'video',
      url: data.video_url || data.videoUrl,
      thumbnail_url: data.thumbnail_url || null,
      prompt: data.prompt || '',
      status: 'success'
    };
  }
  
  if (data.image_url || data.imageUrl) {
    return {
      generation_id: data.id || crypto.randomUUID(),
      generation_type: 'image',
      url: data.image_url || data.imageUrl,
      thumbnail_url: null,
      prompt: data.prompt || '',
      status: 'success'
    };
  }
  
  // Handle moderated content
  if (data.moderated || data.error?.includes('moderat')) {
    return {
      generation_id: data.id || crypto.randomUUID(),
      generation_type: data.type || 'image',
      url: null,
      thumbnail_url: null,
      prompt: data.prompt || '',
      status: 'moderated',
      moderated_reason: data.error || data.reason || 'Content moderated'
    };
  }
  
  return null;
}
```

#### Step 6: Modify Submit Behavior in Preview Mode

**Add to injectAndSubmitAsync():**
```javascript
// Check if preview mode is enabled
if (interceptGenerations) {
  debug('[injectAndSubmitAsync] Preview mode - skipping auto-submit');
  // Still inject prompt but don't click submit
  // OR: Click submit but intercept response instead of navigating away
}
```

### Phase 4: Desktop App Handler

#### Step 7: Handle Generation Results

**File:** `src-tauri/src/main.rs` (or WebSocket handler)

**Add:**
```rust
fn handle_generation_result(payload: GenerationPayload, app_handle: &AppHandle) {
    // Emit to frontend via Tauri event
    app_handle.emit_all("generation-result", payload).ok();
}
```

#### Step 8: Frontend Event Listener

**File:** `src-desktop/App.tsx` (or equivalent)

**Add:**
```tsx
import { listen } from '@tauri-apps/api/event';

// Listen for generation results
listen('generation-result', (event) => {
  const gen = event.payload as Generation;
  addGeneration(gen);
});
```

---

## Response Parsing Details

### Grok API Response Formats (Estimated)

#### Successful Video Generation
```json
{
  "id": "uuid",
  "video_url": "https://assets.grok.com/.../video.mp4",
  "thumbnail_url": "https://assets.grok.com/.../thumb.jpg",
  "prompt": "user prompt text",
  "status": "completed"
}
```

#### Successful Image Generation
```json
{
  "id": "uuid", 
  "image_url": "https://assets.grok.com/.../image.jpg",
  "prompt": "user prompt text",
  "status": "completed"
}
```

#### Moderated Content
```json
{
  "id": "uuid",
  "error": "Content violates policy",
  "reason": "nsfw",
  "status": "moderated"
}
```

---

## UI Mockup

```
┌─────────────────────────────────────────────────────────────┐
│  GVP Bridge Desktop                                    [X]  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Prompt Input                                        │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │ [Enter prompt...]                      [Send]│    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  │  [✓] Preview Mode (Intercept generations)            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Generations Gallery                                 │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐│   │
│  │  │ [Video]  │ │ [Image]  │ │ [Video]  │ │ [MOD]    ││   │
│  │  │ ▶️      │ │ 🖼️      │ │ ▶️      │ │ ⚠️       ││   │
│  │  │ prompt.. │ │ prompt.. │ │ prompt.. │ │ moderated ││   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘│   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing Checklist

- [ ] Toggle switch enables/disables interception
- [ ] Fetch interceptor captures generation responses
- [ ] Video URLs are correctly parsed
- [ ] Image URLs are correctly parsed
- [ ] Moderated content is handled
- [ ] Gallery displays generations correctly
- [ ] Click on generation opens full view
- [ ] Non-generation requests pass through normally
- [ ] Preview mode doesn't affect normal operation when disabled

---

## Potential Issues

1. **CORS**: Video/image URLs may need special handling
2. **Auth**: Generation URLs may require Grok session cookies
3. **Rate Limits**: Grok may have limits on direct asset access
4. **Response Format**: Grok API may change without notice

---

## Implementation Order

1. ✅ PLAN_011 - Double click fix (COMPLETE, stress testing)
2. ⬜ **PLAN_012 Phase 1** - Desktop UI (toggle + gallery)
3. ⬜ **PLAN_012 Phase 2** - WebSocket protocol extension
4. ⬜ **PLAN_012 Phase 3** - Content script interception
5. ⬜ **PLAN_012 Phase 4** - Integration and testing

---

## Dependencies

- PLAN_011 must be stable before implementing
- Requires understanding of Grok's API response formats
- May need adjustment based on actual API responses

---

## Rollback Plan

If interception causes issues:
1. Toggle can be immediately disabled
2. All original functionality preserved when toggle is off
3. No permanent changes to submission logic
