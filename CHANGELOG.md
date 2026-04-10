# GVP Bridge Changelog

All notable changes to the GVP Bridge project will be documented in this file.

---

## [0.7.0] - 2026-04-07

### Session Summary
- Completed: PLAN_040 — Stripped Ghost Window Implementation
- Plans executed: PLAN_040
- Files modified: 7 (3 replaced, 4 modified)
- Architecture: Ghost Window DOM automation live; all harvester code removed

### PLAN_040: Ghost Window Implementation
- **content.bundle.js**: Rewritten from 1321→545 lines. Pure WS client + DOM automation + CSS cloak + passive interceptor listener. Zero harvester, zero statsig, zero direct API calls.
- **gvpFetchInterceptor.js**: Gutted from 58KB→75 lines. Passive read-only SSE response observer. Monitors `/conversations/new` and `/get_video_generation_result` for video/image URLs. Zero request modification.
- **background.js**: Rewritten from 68→203 lines. Ghost tab detection via `onCreated`/`onUpdated`/`query`. `declarativeNetRequest` session rules block images, media, fonts, sentry, statsig, analytics on ghost tab only. NO `chrome.windows.create()` — Desktop App owns window lifecycle.
- **manifest.json**: `webRequest` → `declarativeNetRequest` + `tabs`. `web_accessible_resources` preserved for interceptor injection.
- **main.rs**: `harvester_mode` field removed from `AppState`. `set_harvester_mode`/`get_harvester_mode` commands deleted. `harvesterMode` stripped from all WS payloads (`prompt_response`, `mode_sync`). Harvester WS handlers replaced with `fire_result` handler.
- **PromptInput.tsx**: `harvesterMode` signal, `handleToggleHarvester`, and 🎯 Harvester toggle removed. `onMount` simplified to 2 invocations. Fire button tooltip updated.
- **App.tsx**: Three harvester event listeners replaced with single `fire-result` listener.

### Line Count Verification
| File | Before | After |
|------|--------|-------|
| content.bundle.js | 1321 | 545 |
| gvpFetchInterceptor.js | ~1500 | 75 |
| background.js | 68 | 203 |
| manifest.json | 69 | 70 |
| main.rs | 511 | 476 |
| PromptInput.tsx | 208 | 173 |
| App.tsx | 188 | 180 |

### Post-Implementation Fixes (Architect)
- Removed stale `{/* Harvester Toggle Removed in PLAN_040 */}` comment from PromptInput.tsx
- Updated Fire button tooltip from "Fire the harvester" to "Send prompt to Ghost Window for DOM automation"

---



### Session Summary
- Completed: 8 tasks (Push Infrastructure, Cooldown Cleanup, Gallery Automation, Architecture Pivot)
- Plans executed: PLAN_038 (stabilization), PLAN_039 (push engine)
- Files modified: 5
- Architecture: Locked "Stripped Ghost Window" — DOM automation via Chrome PWA

### ARCHITECTURAL PIVOT — API Replay → Ghost Window (DOM Automation)

**Decision**: The Fetch Harvester / API replay approach (PLAN_037 → PLAN_039) is officially abandoned. Grok's Cloudflare WAF detects programmatic replays via TLS fingerprinting and behavioral analysis, regardless of header parity. All future video generation will use physical DOM manipulation (TipTap injection + button clicking) via a hidden Chrome window ("Ghost Window").

### Added — PLAN_039: Desktop→Extension Push Infrastructure
- **main.rs**: Added `tokio::sync::broadcast` channel to `AppState` for pushing messages from Tauri commands to WS clients
- **main.rs**: Added `trigger_fire` Tauri command — saves prompt, constructs `trigger_remote_fetch` message, pushes via broadcast
- **main.rs**: Refactored WS handler to `tokio::select!` loop — concurrent handling of push channel and incoming WS messages
- **main.rs**: Added `mode_sync` reply when extension reports 'ready' (bootstraps mode state on connection)
- **content.bundle.js**: Added `trigger_remote_fetch` message handler — dispatches `GVP_HARVESTER_FIRE` to injected context
- **content.bundle.js**: Added `mode_sync` message handler — sets `previewMode` and `harvesterModeActive` on connection
- **PromptInput.tsx**: Added `handleFire()` function and "🚀 Fire" button with status feedback display
- **App.tsx**: Added event listeners for `harvester-fire-result`, `harvester-error`, `harvester-template-ready`

### Added — Gallery Card Click Automation
- **content.bundle.js**: Extended `setupGalleryCardClickHandler` to support Harvester Mode (extracts imageId, triggers prompt request)
- **content.bundle.js**: Added `harvesterModeActive` state variable

### Fixed — Dead Cooldown Code Cleanup
- **gvpFetchInterceptor.js**: Removed dead references to `consecutive403Count`, `BASE_COOLDOWN_MS`, `inCooldown`, `cooldownUntil` in `cloneAndFire()` response handler (would have caused `ReferenceError` at runtime)
- **gvpFetchInterceptor.js**: Simplified 403 handling to log-only (no backoff)
- **gvpFetchInterceptor.js**: Reduced fire spacing to 2-second flat interval (`MIN_FIRE_INTERVAL_MS = 2000`)

---

---

## [0.6.0] - 2026-04-06

### ARCHITECTURAL PIVOT: Network-Layer WAF Constraints
The Fetch Harvester / API replay approach was officially abandoned after extensive testing revealed that Grok's Cloudflare WAF correlates TLS session signatures and Sentry APM trace lifecycles (`sentry-trace`, `baggage`). These metrics are generated below the JavaScript injection layer, making 100% header parity insufficient for long-term automation.

### Technical Discovery: Header Lifecycle
- **Sentry Trace Stale-ness**: Discovered that Grok's headers are transactionally bound to the page's Sentry SDK instance. Replaying intercepted headers fails as soon as the browser-side Sentry transaction expires.
- **TLS Fingerprinting**: Confirmed Cloudflare identifies programmatic `fetch` vs. native browser navigation regardless of header matching.
- **Decision**: Shifted all generation logic to **"Ghost Window" DOM Automation**.

---

## [0.5.1] - 2026-04-06

### Added — PLAN_038: Fetch Harvester (Skeleton Template Capture & Replay)
- **gvpFetchInterceptor.js**: Added `harvestSkeleton()` to capture full request data (URL, method, headers, body, referrer, mode, credentials) from successful `/conversations/new` POST responses
- **gvpFetchInterceptor.js**: Added `cloneAndFire()` to deep-clone the skeleton template, swap prompt/imageId, strip forbidden headers, and fire via `ORIGINAL_FETCH`
- **gvpFetchInterceptor.js**: Added `GVP_HARVESTER_FIRE` and `GVP_HARVESTER_STATUS` CustomEvent listeners
- **content.bundle.js**: Added harvester event forwarding (template_ready, fire_result, error, status) via `wsClient.send()`
- **content.bundle.js**: Added `harvesterMode` routing in `handlePromptResponse()` (checked before previewMode)
- **main.rs**: Added `harvester_mode` to `AppState`, `set/get_harvester_mode` Tauri commands, `harvesterMode` in both `prompt_response` payloads, and harvester WS event handlers
- **PromptInput.tsx**: Added 🎯 Harvester toggle with bidirectional mutual exclusivity with Preview Mode

### Fixed — Architect Review Corrections
- **main.rs**: Removed dead code (duplicate prompt/preview_mode variables shadowed by tuple destructure) in `preview_card_clicked` and `prompt_request` handlers
- **content.bundle.js**: Replaced 5 non-existent `sendToBackend()` calls (would have caused `ReferenceError` at runtime) with proper `wsClient.send()` calls

---

## [0.0.1] - 2025-03-28

### Added
- Created project structure with `.agents/` folder
- Created `rules.md` with project constraints and guidelines
- Copied `ARCHITECTURE.md` from original GVP for reference
- Copied `metadata.json` for Knowledge Item mapping
- Created workflow system:
  - `start.md` - Session bootstrap workflow
  - `implement.md` - Implementation execution workflow
  - `report.md` - Report generation workflow
  - `correction.md` - Correction handling workflow
  - `close-and-prepare.md` - Session close and handover workflow
- Created initial `HANDOVER.md`
- Created this `CHANGELOG.md`

---

## [0.2.0] - 2026-03-28

### Session Summary
- Completed: 8 tasks (Extension fix, Tauri v2 migration)
- Artifacts: 1 folder in .agents/reports/ (PLAN_008)
- Files modified: 12

### Added
- **Tauri v2 Migration**: 
  - Upgraded backend to tauri@2.0.0 and tauri-plugin-shell.
  - Implemented `tauri::Emitter` for v2 event broadcasting.
  - Added `#[tokio::main]` async runtime for WebSocket server stability.
- **Extension Modernization**:
  - Migrated host permissions and matches to `https://grok.com/*`.
  - Created **Popup UI** for real-time status monitoring and WebSocket info.
  - Added **Keyboard Shortcuts**: `Ctrl+Shift+B` (Activate), `Ctrl+Shift+F` (Reload).
  - Integrated timestamped `debug()` utility in content script.

### Changed
- Updated frontend API imports to `@tauri-apps/api/core`.
- Modernized `content.js` with status reporting to Popup UI.

## [0.3.0] - 2026-03-29

### Session Summary
- Completed: 3 tasks (Automation Fixes, Developer Experience)
- Artifacts: 1 folder in .agents/reports/ (PLAN_011)
- Files modified: 4

### Added
- **Developer Launcher**: Created `START_DEV.bat` for one-click development with instant hot-reloading (Vite HMR).
- **Automation States**: Added `isProcessingPrompt` and `lastPromptedImageId` for deduplication and locking.
- **Synthetic Click Logic**: Implemented `reactClick` with a full mouse/pointer event sequence to avoid double-triggers in React/TipTap.

### Changed
- **URL Monitoring**: Overhauled `startUrlMonitoring` to use debounced polling/popstate instead of history API monkey patches.
- **Submission Workflow**: Updated `injectAndSubmitAsync` to use synchronous synthetic clicks.
- **Navigation Automation**: Fixed `simulateEscape` to dispatch only once to the document, preventing "double-esc" app exits.

---

## [0.5.0] - 2026-03-31

### Session Summary
- Completed: 4 tasks (WAF Bypass, Header Parity, Trace Synchronization)
- Artifacts: 1 folder in .agents/reports/ (PLAN_037)
- Files modified: 3

### Added
- **Trace Synchronization**:
  - Implemented `lastTraceparent` and `lastBaggage` global trackers in `gvpFetchInterceptor.js`.
  - Automatic capture of Sentry headers from any Grok REST API call.
- **Header Parity**:
  - Achieved 31/31 header match with native Grok requests.
  - Implemented fresh UUIDv4 generation for `x-xai-request-id`.
  - Passed captured `x-statsig-id` through the main-world bridge.
- **Request Delegation**:
  - Created `GVP_EXECUTE_DIRECT_GEN` CustomEvent for main-world fetch execution from isolated content scripts.

### Changed
- **Grok-3 Payload**: Standardized generation payload to use `modelMap` and flattened `toolOverrides` to match Grok-3 native schema.
- **Injection Strategy**: Migrated interceptor to `web_accessible_resources` for stable main-world injection.

---

## [0.4.0] - 2026-03-30

### Session Summary
- Completed: 9 tasks (Video/Image Preview System)
- Artifacts: 1 folder in .agents/reports/ (PLAN_012)
- Files modified: 5

### Added
- **Preview Mode**: 
  - Implementation of `previewMode` toggle in `PromptInput.tsx` with backend state persistence.
  - New `GalleryPanel.tsx` component for displaying intercepted generations with support for videos and images.
  - Integrated `GalleryPanel` into `App.tsx` with real-time event listeners.
- **Fetch Interception**:
  - Global `fetch` proxy in `content.bundle.js` to capture Grok API responses.
  - Capture logic for `/upscale`, `/generate`, and `/get_video_generation_result` endpoints.
  - Automatic streaming of captured media to the desktop app via WebSocket.

### Changed
- **Submission Workflow**: Modified `injectAndSubmitAsync` to skip the auto-return to gallery (ESC) when Preview Mode is active, ensuring the page stays visible for generation.
- **WebSocket Protocol**: Extended `prompt_response` payload to include the active `previewMode` state.
- **Desktop Styles**: Added comprehensive styling for the gallery grid and preview toggle.

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.3.0 | 2026-03-29 | Automation Overhaul & Developer Launcher |
| 0.2.0 | 2026-03-28 | Tauri v2 Migration & Extension Modernization |
| 0.0.1 | 2025-03-28 | Initial project setup, workflow system created |
