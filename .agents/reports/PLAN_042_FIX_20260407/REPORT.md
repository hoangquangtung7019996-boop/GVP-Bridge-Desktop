# Implementation Report: PLAN_042_FIX
**Date:** 2026-04-07
**Task:** Resolve Tauri Runtime Panic in `main()`.

## Summary of Changes
- **Modified File:** `src-tauri/src/main.rs`
- **Issue:** The Tauri `.setup()` block was using `tokio::runtime::Handle::current().block_on(...)` to initialize the database. Since `main` is decorated with `#[tokio::main]`, this caused a "Cannot start a runtime from within a runtime" panic.
- **Fix:** Removed the `block_on` call. Combined the database initialization (`SqlitePool::connect` and `init_gallery_db`) and the WebSocket server startup (`start_server`) into a single `tokio::spawn` task.
- **Result:** The database is initialized asynchronously within the existing runtime, and the pool is stored in the shared `AppState` before the server starts accepting connections.

## Diffs
```diff
-            // block_on is safe here: tokio runtime is already active via #[tokio::main]
-            let rt = tokio::runtime::Handle::current();
-            let pool = rt.block_on(async {
-                let pool = SqlitePool::connect(&db_url).await
-                    .expect("Failed to open gallery.db");
-                init_gallery_db(&pool).await;
-                pool
-            });
-
-            {
-                let mut s = state_clone.lock();
-                s.db_pool = Some(pool);
-            }
-
             println!("[GVP Desktop] 💾 DB at: {}", db_path.display());
 
-            // Start WebSocket server in background
-            tokio::spawn(async move {
-                start_server(state_clone, app_handle).await;
+            // 2. Init DB and 3. Start WS server (Together in one async task)
+            tokio::spawn(async move {
+                let pool = SqlitePool::connect(&db_url).await
+                    .expect("Failed to open gallery.db");
+
+                init_gallery_db(&pool).await;
+
+                {
+                    // Lock state to save the db pool
+                    let mut s = state_clone.lock();
+                    s.db_pool = Some(pool);
+                }
+
+                start_server(state_clone.clone(), app_handle).await;
             });
```

## Verification Steps
1. Run `npm run tauri dev`.
2. Observe the terminal.
3. **Pass Condition:** The app starts without a panic, and you see:
   - `[GVP Desktop] 💾 DB at: ...`
   - `[GVP Desktop] 💾 Gallery SQLite schema initialized`
   - `[GVP Desktop] WebSocket server started on 127.0.0.1:8765`
