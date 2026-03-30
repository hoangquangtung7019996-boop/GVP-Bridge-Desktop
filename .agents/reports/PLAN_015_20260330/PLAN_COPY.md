# PLAN_015: Hijack OG Extension's Fetch Interceptor for Statsig Capture

## Problem Statement

The current `proxyFetch()` in `content.bundle.js` runs in the content script's isolated world. It intercepts `window.fetch` BEFORE Grok's own interceptor adds the `x-statsig-id` header. This means statsig-id is never captured, causing Preview Mode direct API calls to fail with 403 Forbidden.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `src-extension/content.bundle.js` | MODIFY | Remove broken proxyFetch, add OG message listener |

---

## Implementation Details

### STEP 1 — Remove Broken `proxyFetch()` Function

**File:** `src-extension/content.bundle.js`
**Action:** DELETE entire function and its helpers

### STEP 2 — Remove `proxyFetch()` Call from `init()`

**File:** `src-extension/content.bundle.js`
**Action:** REMOVE the proxyFetch() call and ADD the OG listener setup

### STEP 3 — Add `setupOGInterceptorListener()` Function

**File:** `src-extension/content.bundle.js`
**Action:** ADD new function BEFORE the `init()` function
