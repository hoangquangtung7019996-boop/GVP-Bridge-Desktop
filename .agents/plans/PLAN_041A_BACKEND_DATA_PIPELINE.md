# /flash-implement
# PLAN_041A: Backend Data Pipeline + SQLite Infrastructure

## Problem/Goal
The Desktop App is currently "blind" — it has no gallery data. The Ghost Window cannot navigate to specific posts because the Desktop has no UUIDs to send. This plan adds: SQLite database, Rust normalization engine (ported from legacy `_normalizeGalleryPost`), WS gallery sync protocol, and all dependency/config wiring.

## PREREQUISITE COMMANDS
Run these in order before starting file edits:

```powershell
# 1. In project root — install frontend SQL plugin
cd "a:\Tools n Programs\GVP-Desktop"
npm install @tauri-apps/plugin-sql

# 2. In src-tauri — add Rust dependencies
cd "a:\Tools n Programs\GVP-Desktop\src-tauri"
cargo add tauri-plugin-sql --features sqlite
cargo add rusqlite --features bundled
cargo add chrono
```

---

## Step 1: Add SQL plugin permissions
**File:** `src-tauri/capabilities/default.json`
**Action:** CREATE_NEW

```json
{
  "identifier": "default",
  "description": "Default capability for main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    "sql:default",
    "sql:allow-execute",
    "sql:allow-select"
  ]
}
```

---

## Step 2: Register SQL plugin in main.rs builder
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{Manager, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
```

**Replace With:**
```rust
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{Manager, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use rusqlite::params;
```

---

## Step 3: Add DB connection to AppState
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
pub struct AppState {
    pub current_prompt: String,
    pub connection_count: u32,
    pub last_status: String,
    pub last_url: String,
    pub last_image_id: String,
    pub preview_mode: bool,
    /// Broadcast channel for pushing messages FROM Tauri commands TO the WS handler
    pub ws_push_tx: broadcast::Sender<String>,
}

impl AppState {
    fn new() -> Self {
        let (tx, _) = broadcast::channel::<String>(16);
        Self {
            current_prompt: String::new(),
            connection_count: 0,
            last_status: "Ready".to_string(),
            last_url: String::new(),
            last_image_id: String::new(),
            preview_mode: false,
            ws_push_tx: tx,
        }
    }
}
```

**Replace With:**
```rust
pub struct AppState {
    pub current_prompt: String,
    pub connection_count: u32,
    pub last_status: String,
    pub last_url: String,
    pub last_image_id: String,
    pub preview_mode: bool,
    /// Broadcast channel for pushing messages FROM Tauri commands TO the WS handler
    pub ws_push_tx: broadcast::Sender<String>,
    /// SQLite connection for gallery data (UVH store)
    pub db_conn: Option<rusqlite::Connection>,
    /// Tracks total posts ingested during current sync cycle
    pub sync_total_ingested: u32,
}

impl AppState {
    fn new() -> Self {
        let (tx, _) = broadcast::channel::<String>(16);
        Self {
            current_prompt: String::new(),
            connection_count: 0,
            last_status: "Ready".to_string(),
            last_url: String::new(),
            last_image_id: String::new(),
            preview_mode: false,
            ws_push_tx: tx,
            db_conn: None,
            sync_total_ingested: 0,
        }
    }
}
```

---

## Step 4: Add normalization + DB helpers ABOVE the Tauri commands section
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
// ============================================================================
// TAURI COMMANDS
// ============================================================================
```

**Replace With:**
```rust
// ============================================================================
// GALLERY NORMALIZATION ENGINE (ported from legacy _normalizeGalleryPost)
// ============================================================================

/// Parse ISO-8601 timestamp to epoch milliseconds. Returns 0 on failure.
fn iso_to_epoch_ms(iso: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(iso)
        .or_else(|_| chrono::DateTime::parse_from_rfc3339(&format!("{}Z", iso.trim_end_matches('Z'))))
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

/// Initialize the SQLite schema for gallery storage.
fn init_gallery_db(conn: &rusqlite::Connection) {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").unwrap();
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS posts (
            image_id TEXT PRIMARY KEY,
            account_id TEXT DEFAULT '',
            image_url TEXT,
            thumbnail_url TEXT,
            created_at INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT '',
            like_status INTEGER DEFAULT 0,
            moderated INTEGER DEFAULT 0,
            title TEXT DEFAULT '',
            original_post_id TEXT,
            json_count INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS edited_images (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            url TEXT NOT NULL,
            thumbnail_url TEXT,
            prompt TEXT DEFAULT '',
            created_at INTEGER DEFAULT 0,
            original_post_id TEXT,
            is_root INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            url TEXT NOT NULL,
            thumbnail_url TEXT,
            prompt TEXT DEFAULT '',
            duration INTEGER,
            resolution TEXT,
            created_at INTEGER DEFAULT 0,
            original_post_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_edited_images_post ON edited_images(post_id);
        CREATE INDEX IF NOT EXISTS idx_videos_post ON videos(post_id);
    ").unwrap();
    println!("[GVP Desktop] 💾 Gallery SQLite schema initialized");
}

/// Normalize and upsert a batch of raw /list API posts into SQLite.
/// Returns (ingested_count, any_sentinel_hit).
fn ingest_gallery_batch(
    conn: &rusqlite::Connection,
    posts: &[serde_json::Value],
) -> (u32, bool) {
    let mut ingested: u32 = 0;
    let mut sentinel_hit = false;

    for post in posts {
        let image_id = match post["id"].as_str() {
            Some(id) if !id.is_empty() => id,
            _ => continue,
        };

        // Sentinel check: does this UUID already exist?
        let exists: bool = conn
            .query_row("SELECT 1 FROM posts WHERE image_id = ?1", params![image_id], |_| Ok(true))
            .unwrap_or(false);
        if exists {
            sentinel_hit = true;
        }

        // Extract fields with fallback chains (mirrors legacy _normalizeGalleryPost)
        let account_id = post["userId"].as_str()
            .or_else(|| post["accountId"].as_str())
            .unwrap_or("");
        let image_url = post["mediaUrl"].as_str()
            .or_else(|| post["imageUrl"].as_str())
            .unwrap_or("");
        let thumbnail_url = post["thumbnailImageUrl"].as_str()
            .or_else(|| post["thumbnailUrl"].as_str())
            .unwrap_or(image_url);
        let created_at = iso_to_epoch_ms(post["createTime"].as_str()
            .or_else(|| post["createdAt"].as_str())
            .unwrap_or(""));
        let updated_at = post["updatedAt"].as_str()
            .or_else(|| post["lastUpdated"].as_str())
            .unwrap_or("");
        let title = post["originalPrompt"].as_str()
            .or_else(|| post["prompt"].as_str())
            .or_else(|| post["title"].as_str())
            .unwrap_or("");
        let original_post_id = post["originalPostId"].as_str();
        let moderated = post["moderated"].as_bool().unwrap_or(false);
        let like_status = post["likeStatus"].as_bool().unwrap_or(false);
        let child_count = post["childPostsCount"].as_u64()
            .or_else(|| post["childPosts"].as_array().map(|a| a.len() as u64))
            .unwrap_or(0) as i64;

        // Upsert post
        conn.execute(
            "INSERT OR REPLACE INTO posts (image_id, account_id, image_url, thumbnail_url, created_at, updated_at, like_status, moderated, title, original_post_id, json_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![image_id, account_id, image_url, thumbnail_url, created_at, updated_at,
                    like_status as i32, moderated as i32, title, original_post_id, child_count],
        ).unwrap_or_else(|e| { println!("[GVP Desktop] DB insert error: {}", e); 0 });

        // --- Extract edited images (from images[] + childPosts[] where IMAGE) ---
        let mut seen_img: HashSet<String> = HashSet::new();
        let mut seen_vid: HashSet<String> = HashSet::new();

        let process_image = |img: &serde_json::Value, conn: &rusqlite::Connection, seen: &mut HashSet<String>| {
            let id = img["id"].as_str().unwrap_or("");
            if id.is_empty() || !seen.insert(id.to_string()) { return; }
            // Skip non-root self-duplicates
            if id == image_id && img["originalPostId"].is_string() { return; }
            let url = img["mediaUrl"].as_str().or_else(|| img["imageUrl"].as_str()).or_else(|| img["url"].as_str()).unwrap_or("");
            if url.is_empty() { return; }
            let is_root = id == image_id && !img["originalPostId"].is_string();
            let prompt = img["originalPrompt"].as_str().or_else(|| img["prompt"].as_str()).unwrap_or("");
            let thumb = img["thumbnailImageUrl"].as_str().or_else(|| img["thumbnailUrl"].as_str());
            let cat = iso_to_epoch_ms(img["createTime"].as_str().or_else(|| img["createdAt"].as_str()).unwrap_or(""));
            let opid = img["originalPostId"].as_str().or_else(|| img["parentId"].as_str());
            conn.execute(
                "INSERT OR REPLACE INTO edited_images (id, post_id, url, thumbnail_url, prompt, created_at, original_post_id, is_root)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, image_id, url, thumb, prompt, cat, opid, is_root as i32],
            ).ok();
        };

        let process_video = |vid: &serde_json::Value, conn: &rusqlite::Connection, seen: &mut HashSet<String>| {
            let id = vid["id"].as_str().unwrap_or("");
            if id.is_empty() || !seen.insert(id.to_string()) { return; }
            let url = vid["mediaUrl"].as_str().or_else(|| vid["videoUrl"].as_str()).unwrap_or("");
            if url.is_empty() { return; }
            let prompt = vid["originalPrompt"].as_str().or_else(|| vid["prompt"].as_str()).unwrap_or("");
            let thumb = vid["thumbnailImageUrl"].as_str().or_else(|| vid["thumbnailUrl"].as_str());
            let dur = vid["videoDuration"].as_i64();
            let res = vid["resolutionName"].as_str();
            let cat = iso_to_epoch_ms(vid["createTime"].as_str().or_else(|| vid["createdAt"].as_str()).unwrap_or(""));
            let opid = vid["originalPostId"].as_str().or_else(|| vid["parentId"].as_str()).unwrap_or(image_id);
            conn.execute(
                "INSERT OR REPLACE INTO videos (id, post_id, url, thumbnail_url, prompt, duration, resolution, created_at, original_post_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![id, image_id, url, thumb, prompt, dur, res, cat, opid],
            ).ok();
        };

        // 1. post.images[]
        if let Some(images) = post["images"].as_array() {
            for img in images { process_image(img, conn, &mut seen_img); }
        }
        // 2. post.videos[]
        if let Some(vids) = post["videos"].as_array() {
            for vid in vids { process_video(vid, conn, &mut seen_vid); }
        }
        // 3. post.childPosts[] (mixed — classify by mediaType or videoUrl presence)
        if let Some(children) = post["childPosts"].as_array() {
            for child in children {
                let cid = child["id"].as_str().unwrap_or("");
                if cid.is_empty() || cid == image_id { continue; }
                let is_video = child["mediaType"].as_str() == Some("MEDIA_POST_TYPE_VIDEO")
                    || child["videoUrl"].is_string()
                    || child["videoDuration"].is_number();
                if is_video {
                    process_video(child, conn, &mut seen_vid);
                } else {
                    process_image(child, conn, &mut seen_img);
                }
            }
        }

        ingested += 1;
    }

    (ingested, sentinel_hit)
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================
```

---

## Step 5: Add Tauri command for manual force-sync
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
// Harvester commands removed in PLAN_040 (Ghost Window architecture)
```

**Replace With:**
```rust
// Harvester commands removed in PLAN_040 (Ghost Window architecture)

/// Force a full gallery sync (ignores sentinel, clears sync counter)
#[tauri::command]
fn force_gallery_sync(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<String, String> {
    let s = state.lock();
    let msg = serde_json::json!({
        "type": "sync_gallery",
        "payload": { "cursor": serde_json::Value::Null, "force": true },
        "timestamp": chrono_timestamp()
    });
    match s.ws_push_tx.send(msg.to_string()) {
        Ok(n) => {
            println!("[GVP Desktop] 🔄 Force sync pushed to {} subscribers", n);
            Ok(format!("Force sync triggered ({} subscribers)", n))
        }
        Err(_) => Err("No extension connected".to_string())
    }
}
```

---

## Step 6: Add `gallery_data` WS handler + auto-sync trigger
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
                            // PLAN_040: Ghost Window fire result
                            "fire_result" => {
                                println!("[GVP Desktop] 🚀 Fire result: {:?}", payload);
                                let _ = app_handle.emit("fire-result", payload);
                            }

                            _ => {
                                println!("[GVP Desktop] Unknown message type: {}", msg_type);
                            }
```

**Replace With:**
```rust
                            // PLAN_040: Ghost Window fire result
                            "fire_result" => {
                                println!("[GVP Desktop] 🚀 Fire result: {:?}", payload);
                                let _ = app_handle.emit("fire-result", payload);
                            }

                            // PLAN_041: Gallery data batch from extension
                            "gallery_data" => {
                                let posts = payload["posts"].as_array();
                                let cursor = payload["cursor"].as_str().map(|s| s.to_string());
                                let force = payload["force"].as_bool().unwrap_or(false);

                                if let Some(posts) = posts {
                                    println!("[GVP Desktop] 📥 Gallery batch: {} posts, cursor: {:?}", posts.len(), cursor);

                                    let (ingested, sentinel_hit) = {
                                        let s = state.lock();
                                        if let Some(ref conn) = s.db_conn {
                                            ingest_gallery_batch(conn, posts)
                                        } else {
                                            println!("[GVP Desktop] ⚠️ No DB connection");
                                            (0, false)
                                        }
                                    };

                                    // Update sync counter
                                    let total = {
                                        let mut s = state.lock();
                                        s.sync_total_ingested += ingested;
                                        s.sync_total_ingested
                                    };

                                    println!("[GVP Desktop] 📊 Ingested: {}, Total: {}, Sentinel: {}", ingested, total, sentinel_hit);

                                    // Emit gallery-updated to frontend
                                    let _ = app_handle.emit("gallery-updated", serde_json::json!({
                                        "ingested": ingested,
                                        "total": total,
                                        "sentinel_hit": sentinel_hit
                                    }));

                                    // Smart Auto-Sync: continue if no sentinel, has cursor, under cap
                                    let should_continue = !sentinel_hit && cursor.is_some() && total < 500 || force;
                                    if should_continue {
                                        if let Some(ref next_cursor) = cursor {
                                            let sync_msg = serde_json::json!({
                                                "type": "sync_gallery",
                                                "payload": { "cursor": next_cursor, "force": force },
                                                "timestamp": chrono_timestamp()
                                            });
                                            if let Err(e) = ws_sender.send(Message::Text(sync_msg.to_string())).await {
                                                println!("[GVP Desktop] Sync continue error: {}", e);
                                            } else {
                                                println!("[GVP Desktop] 🔄 Requesting next page (cursor: {})", &next_cursor[..next_cursor.len().min(20)]);
                                            }
                                        }
                                    } else {
                                        // Sync complete — reset counter
                                        let mut s = state.lock();
                                        println!("[GVP Desktop] ✅ Gallery sync complete. Total: {}", s.sync_total_ingested);
                                        s.sync_total_ingested = 0;
                                    }
                                }
                            }

                            _ => {
                                println!("[GVP Desktop] Unknown message type: {}", msg_type);
                            }
```

---

## Step 7: Trigger auto-sync on extension "ready" status
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
                                // When extension reports "ready", sync mode state
                                if status == "ready" {
                                    let preview_mode = {
                                        let s = state.lock();
                                        s.preview_mode
                                    };
                                    let mode_sync = serde_json::json!({
                                        "type": "mode_sync",
                                        "payload": {
                                            "previewMode": preview_mode
                                        },
                                        "timestamp": chrono_timestamp()
                                    });
                                    if let Err(e) = ws_sender.send(Message::Text(mode_sync.to_string())).await {
                                        println!("[GVP Desktop] Mode sync send error: {}", e);
                                    } else {
                                        println!("[GVP Desktop] Sent mode_sync to extension (preview={})", preview_mode);
                                    }
                                }
```

**Replace With:**
```rust
                                // When extension reports "ready", sync mode state + trigger gallery sync
                                if status == "ready" {
                                    let preview_mode = {
                                        let s = state.lock();
                                        s.preview_mode
                                    };
                                    let mode_sync = serde_json::json!({
                                        "type": "mode_sync",
                                        "payload": {
                                            "previewMode": preview_mode
                                        },
                                        "timestamp": chrono_timestamp()
                                    });
                                    if let Err(e) = ws_sender.send(Message::Text(mode_sync.to_string())).await {
                                        println!("[GVP Desktop] Mode sync send error: {}", e);
                                    } else {
                                        println!("[GVP Desktop] Sent mode_sync to extension (preview={})", preview_mode);
                                    }

                                    // PLAN_041: Auto-trigger gallery sync on connection
                                    {
                                        let mut s = state.lock();
                                        s.sync_total_ingested = 0; // Reset counter for new sync cycle
                                    }
                                    let sync_msg = serde_json::json!({
                                        "type": "sync_gallery",
                                        "payload": { "cursor": serde_json::Value::Null, "force": false },
                                        "timestamp": chrono_timestamp()
                                    });
                                    if let Err(e) = ws_sender.send(Message::Text(sync_msg.to_string())).await {
                                        println!("[GVP Desktop] Gallery sync trigger error: {}", e);
                                    } else {
                                        println!("[GVP Desktop] 🔄 Auto-triggered gallery sync");
                                    }
                                }
```

---

## Step 8: Initialize DB in setup + register plugins + add force_gallery_sync command
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state.clone())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<Arc<Mutex<AppState>>>();
            let state_clone = state.inner().clone();

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```

**Replace With:**
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(state.clone())
        .setup(|app| {
            // Initialize SQLite gallery database
            let db_dir = app.path().app_config_dir().expect("Failed to get app config dir");
            std::fs::create_dir_all(&db_dir).expect("Failed to create app config dir");
            let db_path = db_dir.join("gallery.db");
            println!("[GVP Desktop] 💾 Opening gallery DB at: {:?}", db_path);

            let conn = rusqlite::Connection::open(&db_path)
                .expect("Failed to open gallery.db");
            init_gallery_db(&conn);

            {
                let state = app.state::<Arc<Mutex<AppState>>>();
                let mut s = state.lock();
                s.db_conn = Some(conn);
            }

            let app_handle = app.handle().clone();
            let state = app.state::<Arc<Mutex<AppState>>>();
            let state_clone = state.inner().clone();

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
```

---

## VERIFICATION
After all steps, run:
```powershell
cd "a:\Tools n Programs\GVP-Desktop\src-tauri"
cargo check
```
This must compile with zero errors. If `cargo check` passes, PLAN_041A is complete.

**DO NOT** attempt to run `cargo tauri dev` yet — PLAN_041B (extension + frontend) must be applied first.
