# Task List — PLAN-003: Integration Robustness & Error Handling

Implementation of error handling, retries, and connection heartbeats in the GVP Bridge extension.

## Tasks

- [x] Task 1: Add `waitForEditor` and `waitForSubmitButton` to `selectors.js` — COMPLETE
- [x] Task 2: Update `dom-ops.js` with retry constants and paragraph injection — COMPLETE
- [x] Task 3: Implement `injectWithRetry` and `injectAndSubmitAsync` in `dom-ops.js` — COMPLETE
- [x] Task 4: Add heartbeat state and connection timeout to `ws-client.js` — COMPLETE
- [x] Task 5: Implement `startHeartbeat` and `handlePong` in `ws-client.js` — COMPLETE
- [x] Task 6: Update `connect` method in `ws-client.js` with timeout and heartbeat start — COMPLETE
- [x] Task 7: Update `content.js` to use `injectAndSubmitAsync` and handle retries — COMPLETE
- [x] Task 8: Final manual verification and report — COMPLETE

---

**Progress:** 8/8 (100%)
**Last Updated:** 2026-03-28 17:16
