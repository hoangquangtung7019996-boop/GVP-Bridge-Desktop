---
trigger: always_on
glob: 
description: Global context and non-negotiable rules for the GVP Bridge project migration.
---

# IDE & LLM Rules for GVP Bridge Project

## 1. PROJECT_CORE_CONTEXT
```json
{
  "project": "GVP-Bridge-Desktop",
  "goal": "Translate Grok Imagine Video Prompter from Chrome Extension to Tauri/SolidJS Desktop App with a minimal extension bridge.",
  "architecture": {
    "desktop": "The Brain. Hosts WS server (:8765), full UI, state management, prompt storage, ALL logic.",
    "extension": "Dumb Bridge. ZERO business logic. Monitors URLs, asks desktop for prompts, interacts with Grok DOM/API, reports back."
  },
  "url_target": "x.com/i/grok"
}
```

## 2. REPO_MAPPING
```json
{
  "legacy_reference": {
    "core_injection": "src/content/managers/ReactAutomation.js",
    "core_selectors": "src/content/constants/selectors.js",
    "core_network": "public/injected/gvpFetchInterceptor.js"
  },
  "target_desktop": {
    "rust_backend_ws": "src-tauri/src/main.rs",
    "solidjs_frontend": "src-desktop/App.tsx",
    "extension_bridge_content": "src-extension/content.js",
    "extension_bridge_ws": "src-extension/ws-client.js"
  }
}
```

## 3. WORKSPACE_ASSETS (Project Memory)
```json
{
  "state_tracking": {
    "changelog": ".agents/CHANGELOG.md",
    "handover": ".agents/HANDOVER.md",
    "past_plans": ".agents/plans/ (History up to PLAN_037)",
    "past_reports": ".agents/reports/"
  },
  "deep_reference": {
    "architecture_map": ".agents/ARCHITECTURE.md",
    "legacy_knowledge": ".agents/knowledge_items/"
  }
}
```

## 4. Architecture Decisions (NON-NEGOTIABLE)
1. **Extension is a Dumb Bridge:** It only monitors changes, receives instructions, executes them, and reports back. NO STATE MANAGEMENT.
2. **Desktop App is the Brain:** All logic lives in the desktop app.
3. **File Size Constraints:** Keep extension files under 200 lines each.
4. **LLM Division of Labor:** Claude/Pro is the Architect. Gemini Flash is the Implementer. **The Architect is READ-ONLY for primary development**, but may use MCP write-tools for minor post-implementation bug fixes (<= 3 minor bugs, <= 1 major bug). All major implementation goes through Flash via Find/Replace plans.

## 5. What NOT To Do (Scope Limiters)
- **DO NOT** build the video queue system, batch processing, or prompt library yet.
- **DO NOT** use multiple content scripts or background script message passing chains.
- **DO NOT** reimplement features from the original extension unless explicitly told to.