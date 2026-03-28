# Implementation Plan — Rust Closure Ownership Fix

**Plan ID:** PLAN-005
**Feature:** Fix Rust compilation error in main.rs
**Target:** `src-tauri/src/main.rs`
**Date:** 2025-03-28
**Depends On:** PLAN-004

---

## Overview

Fix the Rust compilation error:
```
error[E0373]: closure may outlive the current function, but it borrows `state`, which is owned by the current function
```

The fix requires adding the `move` keyword to transfer ownership of `state` into the closure.

**Total Steps:** 2
**Estimated Time:** 1 minute

---

## STEP 1 — Fix the Closure in main.rs

**File:** `src-tauri/src/main.rs`
**Action:** EDIT EXISTING FILE

**Find this code (around line 303):**
```rust
        .setup(|app| {
```

**Replace with:**
```rust
        .setup(move |app| {
```

---

## STEP 2 — Verify Build

**Action:** RUN TERMINAL COMMAND

Run the following command to verify the fix works:
```powershell
cd "A:\Tools n Programs\GVP-Desktop"
npm run tauri dev
```

**Expected Result:**
- No compilation errors
- Application window opens
- WebSocket server starts on port 8765
- Console shows: `[GVP Desktop] WebSocket server started on 127.0.0.1:8765`

---

## VERIFICATION CHECKLIST

| Check | Expected |
|-------|----------|
| `main.rs` has `move \|app\|` on line 303 | YES |
| `cargo build` completes without errors | YES |
| `npm run tauri dev` launches app | YES |
| WebSocket server starts on :8765 | YES |

---

## TECHNICAL EXPLANATION

### Why This Error Occurred

In Rust, closures capture variables by reference by default. The `.setup()` closure needs to outlive the current function scope because Tauri stores it and calls it later. Since `state` is an `Arc<Mutex<AppState>>` created in `main()`, the closure borrows it temporarily.

### Why `move` Fixes It

The `move` keyword forces the closure to take ownership of captured variables. Since `state` is an `Arc` (Atomic Reference Counted), cloning it is cheap (just increments the reference count). The closure then owns its own reference to `state`, allowing it to live as long as needed.

### Before vs After

```rust
// BEFORE - Borrows state (error)
.setup(|app| {
    let state_clone = state.clone();  // Borrows state
    ...
})

// AFTER - Owns state (works)
.setup(move |app| {
    let state_clone = state.clone();  // Owns its Arc clone
    ...
})
```

---

## END OF PLAN

**STOP after completing both steps.**
**Produce Work Report as specified in `/implement` workflow.**
