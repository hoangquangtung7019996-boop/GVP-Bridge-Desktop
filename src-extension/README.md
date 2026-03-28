# GVP Bridge - Chrome Extension

Minimal Chrome extension that bridges Grok to the GVP Desktop app.

## What It Does

1. Monitors URL changes on Grok (x.com/i/grok)
2. When user navigates to `/imagine/post/{imageId}`:
   - Notifies desktop app via WebSocket
   - Requests prompt from desktop app
   - Injects prompt into Grok's editor
   - Presses Enter to submit

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select this `src-extension` folder

## Configuration

The extension connects to the desktop app on `ws://localhost:8765`.

Make sure the desktop app is running before using the extension.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration (MV3) |
| `content.js` | Main content script |
| `ws-client.js` | WebSocket client |
| `dom-ops.js` | DOM operations (inject, click) |
| `selectors.js` | Grok DOM selectors |

## Development

This extension is intentionally minimal. All business logic lives in the desktop app.

Do NOT add:
- Complex state management
- UI components
- Settings pages
- Background scripts

The extension is a dumb bridge. Keep it that way.
