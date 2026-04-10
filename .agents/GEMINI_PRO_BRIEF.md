# GVP Bridge — Ghost Window Architecture Brief

**For: Gemini Pro (AI Studio) — Architecture Review**
**Date:** 2026-04-06
**Author:** GVP Architect Session

---

## What This Project Is

**GVP Bridge** is a desktop application (Tauri/SolidJS) that automates video generation on Grok (x.com/i/grok's "Imagine" feature). The desktop app is the user's only interface. A Chrome extension acts as a "dumb bridge" — it runs on the Grok website and does what the desktop tells it.

## What We Tried and Why It Failed

### The API Replay Approach (Abandoned)

Over 3 plans and 6 iterations, we tried to:
1. Intercept a legitimate user-initiated `POST /rest/app-chat/conversations/new` request
2. Deep-clone all 31 headers, the full JSON body, and the Sentry APM trace headers
3. Replay the fetch with a swapped prompt to generate new videos programmatically

**It failed because Grok's Cloudflare WAF detects programmatic replays**. The WAF correlates:
- TLS session fingerprints (below JavaScript's control)
- Request timing patterns
- Sentry trace lifecycle (transactions expire, new traces get flagged)

Even with perfect 31/31 header matching, injecting fresh Sentry traces from `Sentry.getTraceData()`, and using the original `ORIGINAL_FETCH` reference — it gets 403'd after 2-3 replays. The TLS layer is unforgeable from an extension.

### The DOM-Click Approach (100% Reliable)

The original GVP extension used physical DOM manipulation:
1. Navigate to the image's detail page (`/imagine/post/{UUID}`)
2. Find the TipTap/ProseMirror editor (contenteditable div)
3. Inject text using React-compatible synthetic events
4. Click the submit button using synthetic mouse/pointer events

This has **never been blocked** in 6 months of production use because it's indistinguishable from a real human typing and clicking.

---

## The New Architecture: "Stripped Ghost Window"

### Core Concept

A Chrome PWA of Grok (`grok.com/imagine/saved`), minimized and stripped of all visual rendering, acting as a **headless authenticated DOM robot**. The Desktop App sends prompts via WebSocket, the ghost browser performs DOM clicks, and sends back the resulting video/image URLs.

### Why a Chrome PWA

| Requirement | Chrome PWA | Tauri WebView2 |
|-------------|-----------|----------------|
| Share Grok login cookies | ✅ Same Chrome profile | ❌ Separate cookie jar |
| Run Chrome extension content scripts | ✅ Auto-inject | ❌ Cannot |
| Persist across restarts | ✅ OS-level app | ❌ Must recreate |
| Resource efficiency | ✅ With media blocking | ⚠️ No extension control |

### Resource Stripping (3 Tiers)

**Tier 1 — Block all media at network layer** (~90% savings):
- `chrome.declarativeNetRequest` blocks images, videos, fonts, analytics (Sentry, Statsig)
- Page loads as ~2MB DOM skeleton instead of 50MB+ with gallery thumbnails

**Tier 2 — CSS kill sheet** (GPU savings):
```css
img, video, canvas, svg { display: none !important; }
* { animation: none; transition: none; background-image: none; }
body { visibility: hidden !important; }
```
- `visibility: hidden` (NOT `display: none`) because ProseMirror needs `getBoundingClientRect()` and `Selection` APIs

**Tier 3 — Code removal**:
- Delete the entire 1400-line fetch interceptor
- Strip content script to: WS client + DOM automation (~200 lines total)
- Remove analytics header sniffing from background script

**Result: ~50-80MB RAM** (React DOM skeleton only) vs ~400-600MB fully rendered.

### System Architecture

```
┌─────────────────────────┐
│   DESKTOP APP (Tauri)   │  ← User's ONLY interface
│  SolidJS frontend       │
│  • Prompt textarea      │
│  • "🚀 Fire" button     │
│  • Gallery (loads media │
│    from CDN URLs)       │
│  Rust backend           │
│  • WS server :8765      │
│  • broadcast channel    │
│    (push to extension)  │
└───────────┬─────────────┘
            │ WebSocket
            ▼
┌─────────────────────────────────────────┐
│  GHOST BROWSER (Chrome PWA, minimized)  │
│  URL: grok.com/imagine/saved            │
│                                          │
│  Network: images/video/fonts BLOCKED     │
│  CSS: all rendering killed               │
│  RAM: ~50-80MB                           │
│                                          │
│  Content script:                         │
│  ├── WS client (receive commands)        │
│  ├── Navigate to /imagine/post/{UUID}    │
│  ├── Find TipTap editor                  │
│  ├── Inject prompt text                  │
│  ├── Click submit button                 │
│  ├── ESC → back to /imagine/saved        │
│  ├── Extract result URLs from DOM        │
│  └── Report back via WS                  │
└─────────────────────────────────────────┘
```

### Generation Flow

```
1. User types prompt in Desktop App
2. Clicks "🚀 Fire" → Tauri command → broadcast channel → WS push
3. Ghost browser receives "trigger_remote_fetch" { prompt, imageId }
4. Content script clicks gallery card for imageId (or navigates to /imagine/post/{UUID})
5. Waits for TipTap editor to appear (existing waitForEditor, max 5s)
6. Injects prompt into TipTap (existing injectPrompt — synthetic input events)
7. Clicks submit button (existing clickSubmit — synthetic React click)
8. Waits 500ms → presses ESC → back to /imagine/saved
9. Sends success/error report back via WS
10. Desktop App displays results
```

### What Already Exists (Reusable)

From the current codebase:
- `waitForEditor()` — finds TipTap/ProseMirror contenteditable ✅
- `injectPrompt(editor, text)` — types into TipTap with React-compatible events ✅
- `clickSubmit(button)` — synthetic mouse/pointer event sequence ✅
- `returnToGallery()` — ESC dispatch → back to saved gallery ✅
- `trigger_fire` Tauri command + broadcast channel ✅
- `trigger_remote_fetch` WS message type ✅
- WS client in content script ✅

### What Needs to Be Built

1. Ghost window lifecycle management in `background.js` (create/detect/reconnect)
2. `chrome.declarativeNetRequest` rules for media blocking
3. CSS cloaking injection in content script
4. Modified `trigger_remote_fetch` handler (call `injectAndSubmitAsync()` instead of dispatching harvester events)
5. Result extraction: how to capture generated video/image URLs from the DOM after submission

---

## Questions for Gemini Pro Review

1. **Is the PWA + declarativeNetRequest combo the lightest approach?** Are there Chrome flags or settings we're missing that could reduce memory further?

2. **Result URL extraction**: After submitting a generation, how should we capture the resulting video/image URL? Options:
   - (a) Keep a minimal fetch response interceptor (just reads responses, doesn't replay)
   - (b) Poll the DOM for new media elements after generation
   - (c) Use a MutationObserver on the page's React tree

3. **Gallery card navigation**: The ghost window needs to navigate from `/imagine/saved` to `/imagine/post/{UUID}`. Should we:
   - (a) Physically click the gallery card in the DOM
   - (b) Use `window.location.href` to navigate directly (simpler but may not trigger React routing properly)
   - (c) Use `history.pushState` to match how React Router navigates

4. **Session cookie expiry**: If the Grok session expires (e.g., user hasn't logged into Chrome Grok in weeks), should the Desktop App detect this and prompt re-auth?

5. **Anything we're overcomplicating?** Is there a simpler path we're not seeing?
