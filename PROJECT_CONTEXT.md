# GVP Quick Raw - Project Overview

## What This Is

A minimal desktop app + Chrome extension bridge that automates Grok video generation. The user types a prompt in the desktop app, browses Grok, and when they click a gallery card, the extension auto-injects the prompt and submits it for video generation.

## Architecture

```
┌──────────────────────┐         WebSocket          ┌──────────────────────┐
│   DESKTOP APP        │◄──────────────────────────▶│   CHROME EXTENSION   │
│   (Tauri + SolidJS)  │         ws://localhost:3001 │   (Manifest V3)      │
│                      │                             │                      │
│   - Prompt input     │                             │   - URL change watch │
│   - Status display   │                             │   - Prompt injection │
│   - WebSocket server │                             │   - Submit trigger   │
└──────────────────────┘                             └──────────────────────┘
```

## User Flow

1. User types prompt in desktop app
2. Desktop app stores prompt, ready to send
3. User clicks gallery card on Grok (normal browsing)
4. Grok navigates to `/imagine/post/{imageId}` URL
5. Extension detects URL change
6. Extension requests prompt from desktop app via WebSocket
7. Extension waits for TipTap editor to appear
8. Extension injects prompt into TipTap
9. Extension presses Enter or clicks Send button
10. Video generation starts
11. Extension reports success back to desktop app
12. Desktop app shows "Sent ✓" status

## Tech Stack

- **Desktop**: Tauri (Rust) + SolidJS (TypeScript)
- **Extension**: Chrome Extension Manifest V3
- **Communication**: WebSocket on localhost:3001

## Key Technical Details

### Grok's TipTap Editor
- Selector: `div[contenteditable="true"].ProseMirror` or `div.tiptap`
- Injection: Use `document.execCommand('insertText', false, text)` for React reconciliation
- Must focus element first with `element.focus()`

### Submit Methods
1. Press Enter key on the editor
2. Click button with `aria-label="Submit"` or `aria-label="Make video"`
3. Look for SVG with upward arrow path

### URL Detection
- Use `MutationObserver` on `<body>` to detect URL changes
- Or use `setInterval` polling for `window.location.href`
- Target URL pattern: `/imagine/post/{uuid}` where uuid is 36 chars

### WebSocket Protocol

**Desktop → Extension:**
```json
{ "type": "prompt", "data": "A cinematic video of..." }
```

**Extension → Desktop:**
```json
{ "type": "url_changed", "url": "/imagine/post/abc-123", "imageId": "abc-123" }
{ "type": "prompt_requested" }
{ "type": "injected", "success": true }
{ "type": "submitted", "success": true }
{ "type": "error", "message": "Editor not found" }
```

## File Structure

```
gvp-quick-workspace/
├── PROJECT_CONTEXT.md          (this file)
├── REFERENCE_ReacAutomation.md (patterns from original extension)
├── REFERENCE_Selectors.md      (CSS selectors for Grok UI)
│
├── src-tauri/                  (Rust backend)
│   ├── src/
│   │   └── main.rs            (WebSocket server, Tauri commands)
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── src-desktop/                (SolidJS frontend)
│   ├── App.tsx                 (Main UI component)
│   ├── index.tsx               (Entry point)
│   └── styles.css              (Dark theme matching Grok)
│
└── src-extension/              (Chrome extension)
    ├── manifest.json           (MV3 config)
    ├── content.js              (Main content script)
    ├── background.js           (Service worker)
    └── injected.js             (Page context script for fetch intercept)
```

## Implementation Order

### Phase 1: Desktop App (Tauri)
1. Initialize Tauri project
2. Create WebSocket server in Rust
3. Create SolidJS UI with prompt input
4. Wire UI to WebSocket (store/retrieve prompt)

### Phase 2: Extension Bridge
1. Create manifest.json
2. Create content script with WebSocket client
3. Implement URL change detection
4. Implement prompt injection
5. Implement submit trigger

### Phase 3: Integration
1. Test end-to-end flow
2. Handle edge cases (editor not found, slow load)
3. Add status feedback
4. Polish UI

## Success Criteria

Minimal working version:
- [ ] Desktop app shows prompt input
- [ ] Desktop app runs WebSocket server
- [ ] Extension connects to WebSocket
- [ ] Extension detects when user lands on /imagine/post/{id}
- [ ] Extension injects prompt into TipTap editor
- [ ] Extension triggers submit
- [ ] Desktop app shows "Sent" status
