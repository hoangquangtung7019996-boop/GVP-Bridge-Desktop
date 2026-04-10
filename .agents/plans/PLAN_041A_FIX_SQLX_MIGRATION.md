# /flash-implement
# PLAN_041A_FIX: Migrate rusqlite → sqlx (resolve libsqlite3-sys conflict)

## Problem
`tauri-plugin-sql` and `rusqlite` both link `libsqlite3-sys`. Cargo forbids two crates declaring the same `links` value. Solution: drop `rusqlite`, use `sqlx` (already a transitive dep of `tauri-plugin-sql`).

## PREREQUISITE COMMANDS
```powershell
cd "a:\Tools n Programs\GVP-Desktop\src-tauri"
cargo remove rusqlite
cargo add sqlx --features sqlite,runtime-tokio
```

---

## Step 1: Replace import
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
use rusqlite::params;
```

**Replace With:**
```rust
use sqlx::SqlitePool;
```

---

## Step 2: Replace AppState db_conn with db_pool
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
    /// SQLite connection for gallery data (UVH store)
    pub db_conn: Option<rusqlite::Connection>,
```

**Replace With:**
```rust
    /// SQLite pool for gallery data — SqlitePool is Clone (Arc internally)
    pub db_pool: Option<SqlitePool>,
```

---

## Step 3: Replace AppState::new() db_conn init
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
            db_conn: None,
```

**Replace With:**
```rust
            db_pool: None,
```

---

## Step 4: Rewrite init_gallery_db to async sqlx
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
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
```

**Replace With:**
```rust
/// Initialize the SQLite schema for gallery storage (async, sqlx).
async fn init_gallery_db(pool: &SqlitePool) {
    sqlx::query("PRAGMA journal_mode=WAL").execute(pool).await.ok();
    sqlx::query("PRAGMA foreign_keys=ON").execute(pool).await.ok();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS posts (
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
        )"
    ).execute(pool).await.expect("Failed to create posts table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS edited_images (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            url TEXT NOT NULL,
            thumbnail_url TEXT,
            prompt TEXT DEFAULT '',
            created_at INTEGER DEFAULT 0,
            original_post_id TEXT,
            is_root INTEGER DEFAULT 0
        )"
    ).execute(pool).await.expect("Failed to create edited_images table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            url TEXT NOT NULL,
            thumbnail_url TEXT,
            prompt TEXT DEFAULT '',
            duration INTEGER,
            resolution TEXT,
            created_at INTEGER DEFAULT 0,
            original_post_id TEXT
        )"
    ).execute(pool).await.expect("Failed to create videos table");

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_edited_images_post ON edited_images(post_id)")
        .execute(pool).await.ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_videos_post ON videos(post_id)")
        .execute(pool).await.ok();

    println!("[GVP Desktop] 💾 Gallery SQLite schema initialized");
}
```

---

## Step 5: Rewrite ingest_gallery_batch to async sqlx
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
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
```

**Replace With:**
```rust
/// Normalize and upsert a batch of raw /list API posts into SQLite (async, sqlx).
/// Returns (ingested_count, any_sentinel_hit).
async fn ingest_gallery_batch(
    pool: &SqlitePool,
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
        let exists = sqlx::query_scalar::<_, i32>("SELECT 1 FROM posts WHERE image_id = ?")
            .bind(image_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None)
            .is_some();
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
        let moderated = post["moderated"].as_bool().unwrap_or(false) as i32;
        let like_status = post["likeStatus"].as_bool().unwrap_or(false) as i32;
        let child_count = post["childPostsCount"].as_u64()
            .or_else(|| post["childPosts"].as_array().map(|a| a.len() as u64))
            .unwrap_or(0) as i64;

        // Upsert post
        if let Err(e) = sqlx::query(
            "INSERT OR REPLACE INTO posts (image_id, account_id, image_url, thumbnail_url, created_at, updated_at, like_status, moderated, title, original_post_id, json_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(image_id).bind(account_id).bind(image_url).bind(thumbnail_url)
            .bind(created_at).bind(updated_at).bind(like_status).bind(moderated)
            .bind(title).bind(original_post_id).bind(child_count)
            .execute(pool).await
        {
            println!("[GVP Desktop] DB insert error: {}", e);
        }

        // --- Extract children (images, videos, childPosts) ---
        let mut seen_img: HashSet<String> = HashSet::new();
        let mut seen_vid: HashSet<String> = HashSet::new();

        // Helper: collect image-like items into a vec for processing
        let mut img_items: Vec<&serde_json::Value> = Vec::new();
        let mut vid_items: Vec<&serde_json::Value> = Vec::new();

        if let Some(images) = post["images"].as_array() {
            for img in images { img_items.push(img); }
        }
        if let Some(vids) = post["videos"].as_array() {
            for vid in vids { vid_items.push(vid); }
        }
        if let Some(children) = post["childPosts"].as_array() {
            for child in children {
                let cid = child["id"].as_str().unwrap_or("");
                if cid.is_empty() || cid == image_id { continue; }
                let is_video = child["mediaType"].as_str() == Some("MEDIA_POST_TYPE_VIDEO")
                    || child["videoUrl"].is_string()
                    || child["videoDuration"].is_number();
                if is_video { vid_items.push(child); } else { img_items.push(child); }
            }
        }

        // Process images
        for img in &img_items {
            let id = img["id"].as_str().unwrap_or("");
            if id.is_empty() || !seen_img.insert(id.to_string()) { continue; }
            if id == image_id && img["originalPostId"].is_string() { continue; }
            let url = img["mediaUrl"].as_str().or_else(|| img["imageUrl"].as_str()).or_else(|| img["url"].as_str()).unwrap_or("");
            if url.is_empty() { continue; }
            let is_root = (id == image_id && !img["originalPostId"].is_string()) as i32;
            let prompt = img["originalPrompt"].as_str().or_else(|| img["prompt"].as_str()).unwrap_or("");
            let thumb = img["thumbnailImageUrl"].as_str().or_else(|| img["thumbnailUrl"].as_str());
            let cat = iso_to_epoch_ms(img["createTime"].as_str().or_else(|| img["createdAt"].as_str()).unwrap_or(""));
            let opid = img["originalPostId"].as_str().or_else(|| img["parentId"].as_str());
            sqlx::query(
                "INSERT OR REPLACE INTO edited_images (id, post_id, url, thumbnail_url, prompt, created_at, original_post_id, is_root)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(id).bind(image_id).bind(url).bind(thumb)
                .bind(prompt).bind(cat).bind(opid).bind(is_root)
                .execute(pool).await.ok();
        }

        // Process videos
        for vid in &vid_items {
            let id = vid["id"].as_str().unwrap_or("");
            if id.is_empty() || !seen_vid.insert(id.to_string()) { continue; }
            let url = vid["mediaUrl"].as_str().or_else(|| vid["videoUrl"].as_str()).unwrap_or("");
            if url.is_empty() { continue; }
            let prompt = vid["originalPrompt"].as_str().or_else(|| vid["prompt"].as_str()).unwrap_or("");
            let thumb = vid["thumbnailImageUrl"].as_str().or_else(|| vid["thumbnailUrl"].as_str());
            let dur = vid["videoDuration"].as_i64();
            let res = vid["resolutionName"].as_str();
            let cat = iso_to_epoch_ms(vid["createTime"].as_str().or_else(|| vid["createdAt"].as_str()).unwrap_or(""));
            let opid = vid["originalPostId"].as_str().or_else(|| vid["parentId"].as_str()).unwrap_or(image_id);
            sqlx::query(
                "INSERT OR REPLACE INTO videos (id, post_id, url, thumbnail_url, prompt, duration, resolution, created_at, original_post_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(id).bind(image_id).bind(url).bind(thumb)
                .bind(prompt).bind(dur).bind(res).bind(cat).bind(opid)
                .execute(pool).await.ok();
        }

        ingested += 1;
    }

    (ingested, sentinel_hit)
}
```

---

## Step 6: Rewrite gallery_data WS handler (clone pool BEFORE lock, await outside lock)
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**CRITICAL:** The old code held `state.lock()` across the sync `ingest_gallery_batch` call. With async sqlx, we CANNOT hold a `parking_lot::Mutex` across `.await`. We must clone the pool out, drop the lock, then await.

**Find Exact Block:**
```rust
                            // PLAN_041A: Extension sends a raw batch of gallery posts
                            "gallery_data" => {
                                if let Some(posts) = payload["posts"].as_array() {
                                    let mut s = state.lock();
                                    if let Some(ref conn) = s.db_conn {
                                        let (count, sentinel) = ingest_gallery_batch(conn, posts);
                                        s.sync_total_ingested += count;
                                        println!("[GVP Desktop] 📥 Ingested {}/{} posts. Sentinel? {}", count, posts.len(), sentinel);
                                        
                                        // Forward progress to frontend
                                        let _ = app_handle.emit("sync-progress", serde_json::json!({
                                            "ingested": s.sync_total_ingested,
                                            "sentinel": sentinel
                                        }));

                                        // If no sentinel and we have a cursor, ask for more
                                        if !sentinel && payload["cursor"].is_string() {
                                            let next_msg = serde_json::json!({
                                                "type": "fetch_gallery",
                                                "payload": { "cursor": payload["cursor"] },
                                                "timestamp": chrono_timestamp()
                                            });
                                            let _ = ws_sender.send(Message::Text(next_msg.to_string())).await;
                                        } else {
                                            s.last_status = format!("Sync Complete: {} posts", s.sync_total_ingested);
                                            let _ = app_handle.emit("status-update", s.last_status.clone());
                                        }
                                    }
                                }
                            }
```

**Replace With:**
```rust
                            // PLAN_041A: Extension sends a raw batch of gallery posts
                            "gallery_data" => {
                                if let Some(posts) = payload["posts"].as_array() {
                                    // Clone pool out of state BEFORE any .await
                                    let pool_opt = {
                                        let s = state.lock();
                                        s.db_pool.clone()
                                    };

                                    if let Some(ref pool) = pool_opt {
                                        let (count, sentinel) = ingest_gallery_batch(pool, posts).await;

                                        // Re-acquire lock to update counters
                                        let total = {
                                            let mut s = state.lock();
                                            s.sync_total_ingested += count;
                                            s.sync_total_ingested
                                        };
                                        println!("[GVP Desktop] 📥 Ingested {}/{} posts (total: {}). Sentinel? {}", count, posts.len(), total, sentinel);

                                        let _ = app_handle.emit("sync-progress", serde_json::json!({
                                            "ingested": total,
                                            "sentinel": sentinel
                                        }));

                                        // Smart Auto-Sync: continue if no sentinel, has cursor, under 500 cap
                                        if !sentinel && payload["cursor"].is_string() && total < 500 {
                                            let next_msg = serde_json::json!({
                                                "type": "fetch_gallery",
                                                "payload": { "cursor": payload["cursor"] },
                                                "timestamp": chrono_timestamp()
                                            });
                                            let _ = ws_sender.send(Message::Text(next_msg.to_string())).await;
                                        } else {
                                            let mut s = state.lock();
                                            s.last_status = format!("Sync Complete: {} posts", s.sync_total_ingested);
                                            s.sync_total_ingested = 0;
                                            let _ = app_handle.emit("gallery-updated", serde_json::json!({ "total": total }));
                                        }
                                    }
                                }
                            }
```

---

## Step 7: Rewrite main() DB init — sqlx pool replaces rusqlite connection
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
    // PLAN_041A: Initialize SQLite connection
    let db_path = "gallery.db";
    let conn = rusqlite::Connection::open(db_path).expect("Failed to open SQLite");
    init_gallery_db(&conn);
    {
        let mut s = state.lock();
        s.db_conn = Some(conn);
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
```

**Replace With:**
```rust
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
```

---

## VERIFICATION
```powershell
cd "a:\Tools n Programs\GVP-Desktop\src-tauri"
cargo check
```
Must compile with **zero errors**. If it passes, this fix plan is complete and PLAN_041B (extension + frontend) can proceed.
