# Implementation Plan — Fix DOM Selectors and UI Status Updates

**Plan ID:** PLAN-010
**Feature:** Update content script selectors and fix desktop status
**Target:** `src-extension/`, `src-desktop/`
**Date:** 2026-03-28
**Priority:** HIGH - Injection failing on some pages

---

## Overview

Selectors in `content.bundle.js` are outdated for the latest Grok. Additionally, the desktop app doesn't fetch initial status on mount.

**Solution:**
1. Update selectors to match Grok's TipTap/ProseMirror editor.
2. Add utility functions for finding buttons by text.
3. Enhance logging to help debug future selector changes.
4. Fetch initial connection status in `StatusBar.tsx`.

---

## STEP-BY-STEP EXECUTION

### Task 1: Update selectors and utility functions in content.bundle.js
- Replace `SELECTORS` object with modern version.
- Add `findByText` and `findFirst` utilities.

### Task 2: Update findPromptEditor() and findSubmitButton() in content.bundle.js
- Implement more robust finding logic using the new selectors and utilities.

### Task 3: Enhance injectAndSubmitAsync() with debug logging
- Add detailed logging of all buttons and contenteditables on page.

### Task 4: Fix StatusBar.tsx initial state and status fetching
- Call `get_status` on mount to sync UI with backend.

---

## VERIFICATION CHECKLIST

| Check | Expected |
|-------|----------|
| Editor found for Grok | ✅ YES |
| Submit button found for Grok | ✅ YES |
| "Connected (1)" shows on start | ✅ YES |
| Injection succeeds | ✅ YES |

---

## END OF PLAN
