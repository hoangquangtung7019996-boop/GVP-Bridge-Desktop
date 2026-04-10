# /flash-implement
# PLAN_042: DB Path Fix + API Limit Bump

## Context
The backend SQLite pool opens `gallery.db` in CWD (`src-tauri/`), but the frontend plugin resolves `sqlite:gallery.db` to `%APPDATA%/com.gvp.bridge/`. Fix: move DB init into `.setup()` where `app.path().app_data_dir()` is available. Also bump API page limit from 50 to 400.

---

## Step 1: Move DB init from main() into .setup()
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
#[tokio::main]
async fn main() {
    // Initialize shared state (with push channel)
    let state = Arc::new(Mutex::new(AppState::new()));

    // PLAN_041A_FIX: Initialize SQLite pool via sqlx (shared with tauri-plugin-sql)
    let pool = SqlitePool::connect("sqlite:gallery.db?mode=rwc")
        .await
        .expect("Failed to open gallery.db");
    init_gallery_db(&pool).await;
    {
        let mut s = state.lock();
        s.db_pool = Some(pool);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(state.clone())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state_handle = app.state::<Arc<Mutex<AppState>>>();
            let state_clone = state_handle.inner().clone();

            // Start WebSocket server in background
            tokio::spawn(async move {
                start_server(state_clone, app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_prompt,
            get_prompt,
            get_status,
            clear_prompt,
            set_preview_mode,
            get_preview_mode,
            trigger_fire,
            force_gallery_sync,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Replace With:**
```rust
#[tokio::main]
async fn main() {
    // Initialize shared state (with push channel)
    let state = Arc::new(Mutex::new(AppState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(state.clone())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state_handle = app.state::<Arc<Mutex<AppState>>>();
            let state_clone = state_handle.inner().clone();

            // PLAN_042: Initialize SQLite in app data dir (same location as tauri-plugin-sql)
            let db_dir = app.path().app_data_dir()
                .expect("Failed to resolve app data dir");
            std::fs::create_dir_all(&db_dir).ok();
            let db_path = db_dir.join("gallery.db");
            let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

            // block_on is safe here: tokio runtime is already active via #[tokio::main]
            let rt = tokio::runtime::Handle::current();
            let pool = rt.block_on(async {
                let pool = SqlitePool::connect(&db_url).await
                    .expect("Failed to open gallery.db");
                init_gallery_db(&pool).await;
                pool
            });

            {
                let mut s = state_clone.lock();
                s.db_pool = Some(pool);
            }

            println!("[GVP Desktop] 💾 DB at: {}", db_path.display());

            // Start WebSocket server in background
            tokio::spawn(async move {
                start_server(state_clone, app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_prompt,
            get_prompt,
            get_status,
            clear_prompt,
            set_preview_mode,
            get_preview_mode,
            trigger_fire,
            force_gallery_sync,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## Step 2: Bump API page limit from 50 to 400
**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```javascript
      const body = {
        limit: 50,
        filter: { source: "MEDIA_POST_SOURCE_LIKED" }
      };
```

**Replace With:**
```javascript
      const body = {
        limit: 400,
        filter: { source: "MEDIA_POST_SOURCE_LIKED" }
      };
```

---

## Step 3: Delete stale CWD database files
**Action:** TERMINAL

```powershell
Remove-Item "a:\Tools n Programs\GVP-Desktop\src-tauri\gallery.db" -ErrorAction SilentlyContinue
Remove-Item "a:\Tools n Programs\GVP-Desktop\src-tauri\gallery.db-shm" -ErrorAction SilentlyContinue
Remove-Item "a:\Tools n Programs\GVP-Desktop\src-tauri\gallery.db-wal" -ErrorAction SilentlyContinue
```

---

## VERIFICATION
```powershell
cd "a:\Tools n Programs\GVP-Desktop\src-tauri"
cargo check
```
Must compile with **zero errors**.

Then run `npm run tauri dev` and confirm the log prints:
```
[GVP Desktop] 💾 DB at: C:\Users\Greepo\AppData\Roaming\com.gvp.bridge\gallery.db
```
NOT `src-tauri\gallery.db`.
