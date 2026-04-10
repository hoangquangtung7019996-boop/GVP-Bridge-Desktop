# GVP Quick Raw - Workspace

This workspace contains everything needed to build a minimal desktop app + extension for Grok video automation.

## Quick Start

1. Open this folder in Antigravity IDE
2. Point Gemini Flash to `PROJECT_CONTEXT.md` to understand the project
3. Point Gemini Flash to `REFERENCE_*.md` files for implementation patterns
4. Ask Gemini Flash to implement the TODO items in each file

## File Overview

| File | Purpose | Status |
|------|---------|--------|
| `PROJECT_CONTEXT.md` | Full project spec and flow | Ready to read |
| `REFERENCE_ReactAutomation.md` | Prompt injection patterns | Ready to read |
| `REFERENCE_Selectors.md` | CSS selectors for Grok UI | Ready to read |
| `package.json` | NPM dependencies | Ready |
| `src-tauri/src/main.rs` | Rust WebSocket server | TODO items |
| `src-tauri/Cargo.toml` | Rust dependencies | Ready |
| `src-tauri/tauri.conf.json` | Tauri config | Ready |
| `src-desktop/App.tsx` | SolidJS UI | TODO items |
| `src-desktop/styles.css` | Dark theme CSS | Partial |
| `src-extension/manifest.json` | Chrome extension config | Ready |
| `src-extension/content.js` | Main bridge logic | TODO items |
| `src-extension/background.js` | Service worker | Ready |

## Implementation Order

1. **Desktop App (Tauri)**
   - `src-tauri/src/main.rs` - WebSocket server
   - `src-desktop/App.tsx` - Prompt input UI

2. **Extension Bridge**
   - `src-extension/content.js` - WebSocket client, URL detection, injection

3. **Test**
   - Run Tauri app
   - Load extension in Chrome
   - Navigate to Grok
   - Type prompt, click card, verify injection

## Notes for Gemini Flash

- Read `PROJECT_CONTEXT.md` first for the big picture
- Use `REFERENCE_ReactAutomation.md` for exact code patterns
- Use `REFERENCE_Selectors.md` for CSS selectors
- All files with `// TODO` comments need implementation
- Keep implementations minimal - this is MVP
- Test incrementally after each component
