# Implementation Plan — Frontend Entry Point Fix

**Plan ID:** PLAN-007
**Feature:** Fix missing frontend entry files for Tauri v2
**Target:** `GVP-Bridge-Desktop/`
**Date:** 2025-03-28
**Depends On:** PLAN-006
**Priority:** HIGH - Required for app to render

---

## Overview

The Tauri v2 backend works but the frontend shows 404 because:
1. Missing `index.html` entry point
2. Missing `vite.config.ts` configuration
3. Using old Tauri v1 API import paths

**Total Steps:** 3
**Estimated Time:** 5 minutes

---

## Problem

Current error: `http://localhost:5173/` returns 404

Cause:
- Vite has no `index.html` to serve
- No Vite config for SolidJS plugin
- Components use `@tauri-apps/api/tauri` (v1) instead of `@tauri-apps/api/core` (v2)

---

## STEP 1 — Create index.html

**File:** `index.html` (project root)
**Action:** CREATE NEW FILE

**Code to write:**
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GVP Bridge</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        background: #1a1a1a;
        color: #f4f4f5;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src-desktop/index.tsx"></script>
  </body>
</html>
```

---

## STEP 2 — Create vite.config.ts

**File:** `vite.config.ts` (project root)
**Action:** CREATE NEW FILE

**Code to write:**
```typescript
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
```

---

## STEP 3 — Fix Tauri API Imports

**Files:** `src-desktop/App.tsx`, `src-desktop/components/PromptInput.tsx`
**Action:** EDIT EXISTING FILES

### 3a — Fix App.tsx

**File:** `src-desktop/App.tsx`
**Find:**
```typescript
import { invoke } from '@tauri-apps/api/tauri';
```

**Replace with:**
```typescript
import { invoke } from '@tauri-apps/api/core';
```

### 3b — Fix PromptInput.tsx

**File:** `src-desktop/components/PromptInput.tsx`
**Find:**
```typescript
import { invoke } from '@tauri-apps/api/tauri';
```

**Replace with:**
```typescript
import { invoke } from '@tauri-apps/api/core';
```

---

## VERIFICATION CHECKLIST

| Check | Expected |
|-------|----------|
| `index.html` exists at root | YES |
| `vite.config.ts` exists at root | YES |
| `App.tsx` uses `@tauri-apps/api/core` | YES |
| `PromptInput.tsx` uses `@tauri-apps/api/core` | YES |
| `npm run tauri dev` shows UI | YES |
| No 404 error | YES |

---

## TESTING

After completing all steps:

```powershell
cd "A:\Tools n Programs\GVP-Desktop"
npm run tauri dev
```

**Expected result:**
- GVP Bridge window opens
- Shows "GVP Bridge" header
- Prompt input textarea visible
- Status bar shows "Ready"
- Footer shows "WebSocket: ws://localhost:8765"

---

## END OF PLAN

**STOP after completing all 3 steps.**
**Produce Work Report as specified in `/report` workflow.**
