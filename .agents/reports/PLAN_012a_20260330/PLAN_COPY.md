# PLAN 012a: Rust Macro Compilation Fix

## Issue
Compilation error in `main.rs` - the `serde_json::json!` macro cannot contain block statements.

```
error: unexpected end of macro invocation
   --> src\main.rs:171:48
    |
171 |   ...                   let response = serde_json::json!({
    |  ______________________________________^
172 | | ...                       "type": "prompt_response",
...   |
181 | | ...                   });
    | |________________________^ missing tokens in macro arguments
```

## Root Cause
The `json!` macro was given a block statement directly inside its values:

```rust
// BROKEN - block statement inside macro
let response = serde_json::json!({
    "type": "prompt_response",
    "payload": {
        "prompt": prompt,
        "imageId": image_id,
        "previewMode": {
            let s = state.lock();  // ❌ This is a block statement!
            s.preview_mode
        }
    },
    "timestamp": chrono_timestamp()
});
```

The `json!` macro expects expressions, not statements.

## Fix
Extract `preview_mode` before the macro, same pattern as `prompt`:

```rust
// FIXED - extract value before macro
let prompt = {
    let s = state.lock();
    s.current_prompt.clone()
};

// Get preview mode
let preview_mode = {
    let s = state.lock();
    s.preview_mode
};

// Now use simple expressions in macro
let response = serde_json::json!({
    "type": "prompt_response",
    "payload": {
        "prompt": prompt,
        "imageId": image_id,
        "previewMode": preview_mode  // ✅ Simple expression
    },
    "timestamp": chrono_timestamp()
});
```

---

## Implementation Steps

### Step 1: Extract preview_mode before json! macro

**File:** `src-tauri/src/main.rs`

**Find:**
```rust
                                let prompt = {
                                    let s = state.lock();
                                    s.current_prompt.clone()
                                };

                                // Send prompt response
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": {
                                            let s = state.lock();
                                            s.preview_mode
                                        }
                                    },
                                    "timestamp": chrono_timestamp()
                                });
```

**Replace with:**
```rust
                                let prompt = {
                                    let s = state.lock();
                                    s.current_prompt.clone()
                                };

                                // Get preview mode
                                let preview_mode = {
                                    let s = state.lock();
                                    s.preview_mode
                                };

                                // Send prompt response
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });
```

---

## Summary

| Change | Location | Action |
|--------|----------|--------|
| Extract `preview_mode` | Line ~170 | Add before json! macro |
| Use simple expression | Line ~182 | Replace block with variable |

---

## DO NOT DEVIATE
- Only modify the specific lines shown
- Follow the same pattern as `prompt` extraction
- Do not change any other logic
