# PLAN_016: Fix Preview Mode - Wrong ImageId & Missing Tracing Headers

## Problem Statement

Preview Mode is failing with 403 Forbidden due to:
1. **Wrong imageId** - The account UUID is being used instead of the actual image UUID
2. **Missing tracing headers** - Grok expects `baggage`, `sentry-trace`, `traceparent` headers

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `src-extension/content.bundle.js` | MODIFY | Fix click handler, add tracing headers |

---

## Implementation Details

### STEP 1 — Fix Gallery Card Click Handler

**File:** `src-extension/content.bundle.js`
**Action:** REPLACE the `setupGalleryCardClickHandler` function

### STEP 2 — Add Tracing Header Generation

**File:** `src-extension/content.bundle.js`
**Action:** ADD helper function for tracing headers, then UPDATE `sendDirectGenerationRequest`

### STEP 3 — Add Tracing Headers to Direct API Request

**File:** `src-extension/content.bundle.js`
**Action:** ADD tracing headers to the headers object in `sendDirectGenerationRequest`
