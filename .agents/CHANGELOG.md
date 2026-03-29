# GVP Bridge Changelog

All notable changes to the GVP Bridge project will be documented in this file.

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

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.3.0 | 2026-03-29 | Automation Overhaul & Developer Launcher |
| 0.2.0 | 2026-03-28 | Tauri v2 Migration & Extension Modernization |
| 0.0.1 | 2025-03-28 | Initial project setup, workflow system created |
