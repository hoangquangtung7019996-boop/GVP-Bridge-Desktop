# Implementation Plan — PLAN_012: Video/Image Display System

Add a toggle to intercept Grok API responses and display generated videos/images in the desktop app gallery instead of auto-submitting.

## User Review Required

> [!IMPORTANT]
> **Fetch Interception Safety:** Intercepting `window.fetch` is a global change in the Grok tab. We must ensure it's robust and doesn't break Grok's normal operation.
> 
> **Preview Mode Behavior:** When Preview Mode is ON, I propose we still inject the prompt but we might want to *wait* for the user to manually click "Submit" on Grok, OR click it automatically but stay on the page to intercept the result. The plan suggests "intercept and display". I will implement it such that when Preview Mode is ON, we click submit, intercept the response, and show it in the desktop app.

## Proposed Changes

### Component: Backend (Rust)

#### [MODIFY] [main.rs](file:///A:/Tools n Programs/GVP-Desktop/src-tauri/src/main.rs)
- Update `AppState` struct to include `preview_mode: bool`.
- Implement `set_preview_mode` and `get_preview_mode` Tauri commands.
- Update `handle_connection` WebSocket loop:
  - In `prompt_request` case: include `"previewMode": s.preview_mode` in the JSON response.
  - Add `generation_result` case: parse the payload and emit a `generation-result` event to the frontend.
- Register new commands in `invoke_handler`.

---

### Component: Frontend (SolidJS)

#### [MODIFY] [PromptInput.tsx](file:///A:/Tools n Programs/GVP-Desktop/src-desktop/components/PromptInput.tsx)
- Use `createSignal` for `previewMode`.
- Add a checkbox toggle for Preview Mode (since no generic `Switch` component exists in the project).
- Sync toggle state with backend via `set_preview_mode` command.
- Load initial state on mount via `get_preview_mode`.

#### [NEW] [GalleryPanel.tsx](file:///A:/Tools n Programs/GVP-Desktop/src-desktop/components/GalleryPanel.tsx)
- Create a scrollable container for "Generations".
- Display video thumbnails/videos and images with their prompts.
- Handle different statuses: success, moderated, error.

#### [MODIFY] [App.tsx](file:///A:/Tools n Programs/GVP-Desktop/src-desktop/App.tsx)
- Import and render `GalleryPanel`.
- Set up a listener for `generation-result` events from Tauri.
- Manage an array of generation objects.

#### [MODIFY] [styles.css](file:///A:/Tools n Programs/GVP-Desktop/src-desktop/styles.css)
- Add styles for the toggle switch and the gallery grid/cards.

---

### Component: Extension (JavaScript)

#### [MODIFY] [content.bundle.js](file:///A:/Tools n Programs/GVP-Desktop/src-extension/content.bundle.js)
- Add `interceptGenerations` global flag.
- Implement `window.fetch` proxy to watch for generation API calls.
- In `handlePromptResponse`, update `interceptGenerations` based on the `previewMode` flag in the payload.
- Update `injectAndSubmitAsync`: if `interceptGenerations` is true, we still submit but we know we're watching for the response.

## Open Questions

1. **Grok API Endpoint Accuracy:** Do we know the exact URLs for Grok generations? The plan mentions `/api/generate`, `/api/video`, etc. I'll use regex/includes for broad matching but might need to refine after testing.
2. **Submissions in Preview Mode:** Should we skip the `returnToGallery` workflow when in Preview Mode? Probably yes, to stay on the page and see the result.
3. **Switch Component:** No `Switch` component was found in the codebase. I will implement the toggle as a styled checkbox to match the plan's visual intent without introducing new dependencies.

## Verification Plan

### Automated Tests
- N/A (Manual UI and integration testing required)

### Manual Verification
1. Open Grok and GVP Desktop.
2. Enable "Preview Mode" in GVP Desktop.
3. Click a gallery card on Grok.
4. Verify prompt is injected and "Submit" is clicked.
5. Watch the "Network" tab in DevTools to see the generation response.
6. Verify the video/image appears in the GVP Desktop Gallery Panel.
7. Disable "Preview Mode" and verify normal operation (Return to Gallery) resumes.
