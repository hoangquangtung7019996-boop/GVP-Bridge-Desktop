# /flash-implement
# PLAN_042_FIX: Runtime Panic Fix

## Context
Solving the issue where `rt.block_on` was called inside an already active tokio runtime, causing a panic.

## Step 1: Fix src-tauri/src/main.rs
- Remove `rt.block_on` from `setup` block.
- Move `SqlitePool::connect` and `init_gallery_db` inside the `tokio::spawn` used for the WS server.
- Ensure the Database Pool is still correctly saved to the `AppState`.
