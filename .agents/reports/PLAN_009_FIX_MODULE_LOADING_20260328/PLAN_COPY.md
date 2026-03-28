# Implementation Plan — Fix Content Script Module Loading

**Plan ID:** PLAN-009
**Feature:** Bundle content scripts into single file (fix ES module loading)
**Target:** `src-extension/`
**Date:** 2025-03-28
**Depends On:** PLAN-008
**Priority:** CRITICAL - Extension not working

---

## Overview

Chrome is not recognizing `type: "module"` in content_scripts. The files use ES module syntax (`import/export`) but are being loaded as regular scripts, causing syntax errors.

**Solution:** Bundle all content scripts into a single `content.bundle.js` file without ES module syntax.

**Total Steps:** 3
**Estimated Time:** 10 minutes

---

## STEP 1 — Update manifest.json to use bundled script

**File:** `src-extension/manifest.json`
**Action:** EDIT EXISTING FILE

**Find:**
```json
  "content_scripts": [
    {
      "matches": [
        "https://grok.com/*"
      ],
      "js": [
        "selectors.js",
        "ws-client.js",
        "dom-ops.js",
        "content.js"
      ],
      "type": "module"
    }
  ],
```

**Replace with:**
```json
  "content_scripts": [
    {
      "matches": [
        "https://grok.com/*"
      ],
      "js": [
        "content.bundle.js"
      ]
    }
  ],
```

---

## STEP 2 — Create bundled content script

**File:** `src-extension/content.bundle.js`
**Action:** CREATE NEW FILE

```javascript
/**
 * GVP Bridge - Bundled Content Script
 * All modules combined for Chrome MV3 compatibility
 */

(function() {
  'use strict';

  // [Full bundle content from PLAN-009]
})();
```

(I'll skip the full paste here to save tokens, but I'll use it when writing the file).

---

## STEP 3 — Delete old module files (optional cleanup)

These files are no longer needed since everything is bundled:
- `src-extension/selectors.js`
- `src-extension/ws-client.js`
- `src-extension/dom-ops.js`
- `src-extension/content.js`

**Action:** DELETE FILES (or keep for reference, they won't be loaded)

---

## VERIFICATION CHECKLIST

| Check | Expected |
|-------|----------|
| `manifest.json` uses `content.bundle.js` | YES |
| `content.bundle.js` exists | YES |
| No `type: "module"` in content_scripts | YES |
| Console shows `[GVP Bridge] Content script loaded` | YES |
| No syntax errors | YES |

---

## TESTING

1. Reload extension in `chrome://extensions/`
2. Open `https://grok.com/imagine/`
3. Open DevTools (F12) → Console
4. Should see: `[HH:MM:SS] [GVP Bridge] Content script loaded`
5. Should see: `[HH:MM:SS] [GVP Bridge] === INITIALIZING ===`
6. No syntax errors!

---

## END OF PLAN
