---
description: Machine-readable core context for GVP Bridge migration.
version: 3.0.0
---

# GVP_CORE_CONTEXT

## 1. PROJECT_META
```json
{
  "project": "GVP-Bridge-Desktop",
  "goal": "Translate Grok Imagine Video Prompter from complex Chrome Extension to Tauri/SolidJS Desktop App with a minimal ('dumb') extension bridge.",
  "state": "Translating logic to Desktop. Bridge extension monitors URLs, asks Desktop for prompts, injects to Grok DOM, triggers 'Make Video'.",
  "critical_note": "Exact method for DOM injection/button clicking is currently being explored and developed. Do not assume legacy methods work perfectly without testing."
}
```

## 2. REPO_MAPPING
```json
{
  "legacy_reference": {
    "path": "https://github.com/hoangquangtung7019996-boop/GVP",
    "core_injection": "src/content/managers/ReactAutomation.js",
    "core_selectors": "src/content/constants/selectors.js",
    "core_network": "public/injected/gvpFetchInterceptor.js"
  },
  "target_desktop": {
    "rust_backend_ws": "src-tauri/src/main.rs",
    "solidjs_frontend": "src-desktop/App.tsx",
    "extension_bridge": "src-extension/content.bundle.js",
    "extension_config": "src-extension/manifest.json"
  }
}
```

## 3. DOM_SELECTORS_REFERENCE
```json
{
  "editor": [
    "div.tiptap.ProseMirror[contenteditable='true']",
    "div[contenteditable='true'][translate='no'].ProseMirror"
  ],
  "submit_button": [
    "button[aria-label='Make video']",
    "button[aria-label='Submit']"
  ],
  "url_patterns": {
    "post": "\\/imagine\\/post\\/([a-f0-9-]{36})",
    "gallery": "\\/imagine(\\/saved)?$"
  }
}
```

## 4. ARCHITECTURE_FLOW
```json
{
  "flow": "Desktop App (Brain/State/WebSocket Server :8765) <--> Chrome Extension (Dumb Bridge/WebSocket Client)",
  "ws_messages": {
    "ext_to_app": ["url_changed", "prompt_requested", "injected_status", "submitted_status", "error"],
    "app_to_ext": ["prompt_data", "status_update"]
  }
}
```