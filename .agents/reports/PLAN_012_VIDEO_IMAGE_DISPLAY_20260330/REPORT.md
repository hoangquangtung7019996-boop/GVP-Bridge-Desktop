# Walkthrough - Video/Image Preview System (PLAN-012)

This update adds a **Preview Mode** to the GVP Bridge, allowing you to intercept Grok's generation results (images and videos) and display them directly within the desktop application's gallery.

## Changes Made

### 1. Desktop UI Enhancements
- **PromptInput.tsx**: Added a "Preview Mode" toggle switch. When enabled, it informs the extension to intercept all generation responses.
- **GalleryPanel.tsx [NEW]**: Created a dedicated component to display intercepted media. It handles videos, images, processing states, and moderation flags.
- **App.tsx**: Integrated the `GalleryPanel` and added listeners for `generation-result` events from the backend.
- **styles.css**: Added sleek, dark-themed styles for the gallery grid, media cards, and the preview toggle.

### 2. Backend Logic (main.rs)
- **AppState**: Extended to track the `preview_mode` state.
- **Tauri Commands**: Added `set_preview_mode` and `get_preview_mode` handlers.
- **WebSocket Protocol**: 
  - `prompt_response` now includes the `previewMode` flag.
  - Added a handler for `generation_result` messages to forward them directly to the frontend.

### 3. Extension Interception (content.bundle.js)
- **Fetch Proxy**: Implemented a global `fetch` interceptor that monitors Grok's generation endpoints.
- **Generation Capture**: When `Preview Mode` is active, the extension clones generation responses, parses the JSON, and sends the media URLs back to the desktop app.
- **Submission Flow**: Modified `injectAndSubmitAsync` to skip the auto-return to gallery (ESC) when Preview Mode is enabled, ensuring the page stays active for the generation to complete.

## How to Test

### 1. Enable Preview Mode
1. Open the GVP Desktop app.
2. Toggle **"Preview Mode"** on (next to the Clear/Set Prompt buttons).
3. Set your prompt as usual.

### 2. Generate on Grok
1. Click a gallery card on Grok (`/imagine/post/UUID`).
2. The extension will inject the prompt and submit.
3. Instead of returning to the gallery immediately, the page will stay on the generation UI.

### 3. View Results
1. Once Grok produces the result, it will appear in the **"Recent Generations"** section of the desktop app.
2. You can view the video/image and its prompt directly in the gallery grid.

> [!TIP]
> Use Preview Mode when you want to verify the output or curate specific generations before they are archived.

> [!IMPORTANT]
> Ensure the desktop app is running and the extension is connected (Status: Connected) for interception to work.

## Validation Results
- [x] Toggle state persists between frontend and backend.
- [x] Extension correctly identifies and intercepts `/rest/app/grok/generate` and other endpoints.
- [x] WebSocket pipeline successfully streams results to `GalleryPanel`.
- [x] `GalleryPanel` handles moderated/error states gracefully.
