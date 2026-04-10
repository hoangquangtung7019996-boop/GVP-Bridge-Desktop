// GVP Bridge - Desktop App Backend (Tauri v2)
// WebSocket server + Tauri commands

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{Manager, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use sqlx::SqlitePool;

// ============================================================================
// SHARED STATE
// ============================================================================

/// Global state shared between WebSocket server and Tauri commands
pub struct AppState {
    pub current_prompt: String,
    /// WebSocket connection count
    pub connection_count: u32,
    pub last_status: String,
    pub last_url: String,
    pub last_image_id: String,
    pub preview_mode: bool,
    /// Broadcast channel for pushing messages FROM Tauri commands TO the WS handler
    pub ws_push_tx: broadcast::Sender<String>,
    /// SQLite pool for gallery data — SqlitePool is Clone (Arc internally)
    pub db_pool: Option<SqlitePool>,
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
            db_pool: None,
            sync_total_ingested: 0,
        }
    }
}

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

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Set the current prompt (called from frontend)
#[tauri::command]
fn set_prompt(prompt: String, state: tauri::State<Arc<Mutex<AppState>>>) -> Result<String, String> {
    let mut s = state.lock();
    s.current_prompt = prompt.clone();
    s.last_status = "Prompt set".to_string();
    println!("[GVP Desktop] Prompt set: {} chars", prompt.len());
    Ok(prompt)
}

/// Get the current prompt
#[tauri::command]
fn get_prompt(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<String, String> {
    let s = state.lock();
    Ok(s.current_prompt.clone())
}

/// Get current status
#[tauri::command]
fn get_status(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<HashMap<String, String>, String> {
    let s = state.lock();
    let mut status = HashMap::new();
    status.insert("status".to_string(), s.last_status.clone());
    status.insert("url".to_string(), s.last_url.clone());
    status.insert("imageId".to_string(), s.last_image_id.clone());
    status.insert("connections".to_string(), s.connection_count.to_string());
    Ok(status)
}

/// Clear the current prompt
#[tauri::command]
fn clear_prompt(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<(), String> {
    let mut s = state.lock();
    s.current_prompt.clear();
    s.last_status = "Prompt cleared".to_string();
    Ok(())
}

/// Set preview mode
#[tauri::command]
fn set_preview_mode(enabled: bool, state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let mut s = state.lock();
    s.preview_mode = enabled;
    println!("[GVP Desktop] Preview mode: {}", enabled);
    Ok(enabled)
}

/// Get preview mode
#[tauri::command]
fn get_preview_mode(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let s = state.lock();
    Ok(s.preview_mode)
}

// Harvester commands removed in PLAN_040 (Ghost Window architecture)

/// Force a gallery sync from the Desktop (broadcasts fetch_gallery to extension)
#[tauri::command]
fn force_gallery_sync(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<String, String> {
    let s = state.lock();
    let msg = serde_json::json!({
        "type": "fetch_gallery",
        "payload": { "cursor": null },
        "timestamp": chrono_timestamp()
    });
    match s.ws_push_tx.send(msg.to_string()) {
        Ok(_) => Ok("Gallery sync triggered".to_string()),
        Err(_) => Err("No extension connected".to_string())
    }
}

/// Trigger a remote fetch fire — pushes a message to the extension WS
/// This is the Desktop→Extension "fire now" command
#[tauri::command]
fn trigger_fire(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<String, String> {
    let s = state.lock();
    let prompt = s.current_prompt.clone();
    let image_id = s.last_image_id.clone();
    
    if prompt.is_empty() {
        return Err("No prompt set. Enter a prompt first.".to_string());
    }
    
    let msg = serde_json::json!({
        "type": "trigger_remote_fetch",
        "payload": {
            "prompt": prompt,
            "imageId": image_id,
        },
        "timestamp": chrono_timestamp()
    });
    
    let msg_str = msg.to_string();
    
    match s.ws_push_tx.send(msg_str.clone()) {
        Ok(n) => {
            println!("[GVP Desktop] \u{1F680} trigger_fire pushed to {} WS subscribers", n);
            Ok(format!("Fire triggered for imageId: {}", image_id))
        }
        Err(_) => {
            println!("[GVP Desktop] \u{26A0}\u{FE0F} trigger_fire: No active WS connections to receive");
            Err("No extension connected. Open Grok in Chrome first.".to_string())
        }
    }
}

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

/// Handle a single WebSocket connection
async fn handle_connection(
    raw_stream: TcpStream,
    addr: SocketAddr,
    state: Arc<Mutex<AppState>>,
    app_handle: tauri::AppHandle,
) {
    println!("[GVP Desktop] New connection from: {}", addr);

    // Increment connection count
    {
        let mut s = state.lock();
        s.connection_count += 1;
        s.last_status = format!("Connected ({})", s.connection_count);
    }

    // Emit connection event to frontend (Tauri v2 uses .emit)
    let _ = app_handle.emit("ws-connection", {
        let s = state.lock();
        format!("Connected ({})", s.connection_count)
    });

    // Accept WebSocket connection
    let ws_stream = match accept_async(raw_stream).await {
        Ok(stream) => stream,
        Err(e) => {
            println!("[GVP Desktop] WebSocket accept error: {}", e);
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Subscribe to push channel for Desktop→Extension messages
    let mut push_rx = {
        let s = state.lock();
        s.ws_push_tx.subscribe()
    };

    // Handle incoming WS messages AND push channel messages concurrently
    loop {
        tokio::select! {
            // Push channel: Desktop command wants to send a message to the extension
            push_msg = push_rx.recv() => {
                match push_msg {
                    Ok(msg_str) => {
                        println!("[GVP Desktop] \u{1F4E4} Pushing message to extension: {}", &msg_str[..msg_str.len().min(120)]);
                        if let Err(e) = ws_sender.send(Message::Text(msg_str)).await {
                            println!("[GVP Desktop] Push send error: {}", e);
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        println!("[GVP Desktop] Push channel lagged by {} messages", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        println!("[GVP Desktop] Push channel closed");
                        break;
                    }
                }
            }
            // Incoming WS message from the extension
            msg_result = ws_receiver.next() => {
        let Some(msg_result) = msg_result else { break };
        match msg_result {
            Ok(msg) => {
                if msg.is_text() || msg.is_binary() {
                    let text = msg.to_text().unwrap_or("");
                    println!("[GVP Desktop] Received: {}", text);

                    // Parse message
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(text) {
                        let msg_type = json["type"].as_str().unwrap_or("");
                        let payload = &json["payload"];

                        match msg_type {
                            // Preview mode: card clicked in gallery
                            "preview_card_clicked" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");
                                println!("[GVP Desktop] Preview card clicked: {}", image_id);
                                
                                let (prompt, preview_mode) = {
                                    let s = state.lock();
                                    (s.current_prompt.clone(), s.preview_mode)
                                };
                                
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });
                                
                                if let Err(e) = ws_sender.send(Message::Text(response.to_string())).await {
                                    println!("[GVP Desktop] Send error: {}", e);
                                    break;
                                }
                            }

                            // Extension requests prompt
                            "prompt_request" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");

                                {
                                     let mut s = state.lock();
                                     s.last_image_id = image_id.to_string();
                                }

                                let (prompt, preview_mode) = {
                                    let s = state.lock();
                                    (s.current_prompt.clone(), s.preview_mode)
                                };

                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });

                                if let Err(e) = ws_sender.send(Message::Text(response.to_string())).await {
                                    println!("[GVP Desktop] Send error: {}", e);
                                    break;
                                }

                                let _ = app_handle.emit("prompt-sent", image_id);
                            }

                            // Extension reports URL change
                            "url_changed" => {
                                let url = payload["url"].as_str().unwrap_or("");
                                let image_id = payload["imageId"].as_str().unwrap_or("");

                                {
                                    let mut s = state.lock();
                                    s.last_url = url.to_string();
                                    if !image_id.is_empty() {
                                        s.last_image_id = image_id.to_string();
                                    }
                                }

                                // Emit to frontend
                                let _ = app_handle.emit("url-changed", serde_json::json!({
                                    "url": url,
                                    "imageId": image_id
                                }));
                            }

                            // Extension reports status
                            "status" => {
                                let status = payload["status"].as_str().unwrap_or("");
                                let success = payload["success"].as_bool().unwrap_or(false);

                                let status_msg = if success {
                                    format!("\u{2713} {}", status)
                                } else {
                                    let error = payload["error"].as_str().unwrap_or("Unknown error");
                                    format!("\u{2717} {} - {}", status, error)
                                };

                                {
                                    let mut s = state.lock();
                                    s.last_status = status_msg.clone();
                                }

                                // Emit to frontend
                                let _ = app_handle.emit("status-update", serde_json::json!({
                                    "status": status,
                                    "success": success,
                                    "message": status_msg
                                }));

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
                                    let _ = ws_sender.send(Message::Text(mode_sync.to_string())).await;

                                    // PLAN_041A: Trigger auto-sync on first connection
                                    {
                                        let mut s = state.lock();
                                        s.sync_total_ingested = 0;
                                    }
                                    let sync_req = serde_json::json!({
                                        "type": "fetch_gallery",
                                        "payload": { "cursor": null },
                                        "timestamp": chrono_timestamp()
                                    });
                                    let _ = ws_sender.send(Message::Text(sync_req.to_string())).await;
                                    println!("[GVP Desktop] \u{1F504} Auto-sync triggered on 'ready'");
                                }
                            }

                            // Pong response
                            "pong" => {
                                println!("[GVP Desktop] Received pong");
                            }

                            // Extension reports generation result
                            "generation_result" => {
                                println!("[GVP Desktop] Received generation_result");
                                // Forward directly to frontend
                                let _ = app_handle.emit("generation-result", payload);
                            }

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
                                        println!("[GVP Desktop] \u{1F4E5} Ingested {}/{} posts (total: {}). Sentinel? {}", count, posts.len(), total, sentinel);

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

                            // PLAN_042: Legacy IDB migration \u{2014} pre-normalized UVH records
                            "legacy_idb_migration" => {
                                if let Some(records) = payload["records"].as_array() {
                                    let pool_opt = {
                                        let s = state.lock();
                                        s.db_pool.clone()
                                    };

                                    if let Some(ref pool) = pool_opt {
                                        let batch_idx = payload["batchIndex"].as_u64().unwrap_or(0);
                                        let total = payload["totalRecords"].as_u64().unwrap_or(0);
                                        let is_final = payload["isFinal"].as_bool().unwrap_or(false);
                                        let mut migrated: u32 = 0;

                                        for record in records {
                                            let image_id = match record["imageId"].as_str() {
                                                Some(id) if !id.is_empty() => id,
                                                _ => continue,
                                            };

                                            // --- Insert root post ---
                                            let account_id = record["accountId"].as_str().unwrap_or("");
                                            let image_url = record["imageUrl"].as_str().unwrap_or("");
                                            let thumbnail_url = record["thumbnailUrl"].as_str().unwrap_or(image_url);
                                            let created_at = record["createdAt"].as_i64().unwrap_or(0);
                                            let updated_at = record["updatedAt"].as_str().unwrap_or("");
                                            let like_status = record["likeStatus"].as_bool().unwrap_or(false) as i32;
                                            let moderated = record["moderated"].as_bool().unwrap_or(false) as i32;
                                            let title = record["title"].as_str().unwrap_or("");
                                            let original_post_id = record["originalPostId"].as_str();
                                            let json_count = record["jsonCount"].as_i64().unwrap_or(0);

                                            sqlx::query(
                                                "INSERT OR IGNORE INTO posts (image_id, account_id, image_url, thumbnail_url, created_at, updated_at, like_status, moderated, title, original_post_id, json_count)
                                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                                                .bind(image_id).bind(account_id).bind(image_url).bind(thumbnail_url)
                                                .bind(created_at).bind(updated_at).bind(like_status).bind(moderated)
                                                .bind(title).bind(original_post_id).bind(json_count)
                                                .execute(pool).await.ok();

                                            // --- Insert editedImages[] ---
                                            if let Some(images) = record["editedImages"].as_array() {
                                                for img in images {
                                                    let id = img["id"].as_str().unwrap_or("");
                                                    if id.is_empty() { continue; }
                                                    let url = img["url"].as_str().unwrap_or("");
                                                    if url.is_empty() { continue; }
                                                    let thumb = img["thumbnailUrl"].as_str();
                                                    let prompt = img["prompt"].as_str().unwrap_or("");
                                                    let cat = img["createdAt"].as_i64().unwrap_or(0);
                                                    let opid = img["originalPostId"].as_str();
                                                    let is_root = img["isRoot"].as_bool().unwrap_or(false) as i32;

                                                    sqlx::query(
                                                        "INSERT OR IGNORE INTO edited_images (id, post_id, url, thumbnail_url, prompt, created_at, original_post_id, is_root)
                                                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                                                        .bind(id).bind(image_id).bind(url).bind(thumb)
                                                        .bind(prompt).bind(cat).bind(opid).bind(is_root)
                                                        .execute(pool).await.ok();
                                                }
                                            }

                                            // --- Insert videos[] ---
                                            if let Some(vids) = record["videos"].as_array() {
                                                for vid in vids {
                                                    let id = vid["id"].as_str().unwrap_or("");
                                                    if id.is_empty() { continue; }
                                                    let url = vid["url"].as_str().unwrap_or("");
                                                    if url.is_empty() { continue; }
                                                    let prompt = vid["prompt"].as_str().unwrap_or("");
                                                    let thumb = vid["thumbnailUrl"].as_str();
                                                    let dur = vid["duration"].as_i64();
                                                    let res = vid["resolution"].as_str();
                                                    let cat = vid["createdAt"].as_i64().unwrap_or(0);
                                                    let opid = vid["originalPostId"].as_str().unwrap_or(image_id);

                                                    sqlx::query(
                                                        "INSERT OR IGNORE INTO videos (id, post_id, url, thumbnail_url, prompt, duration, resolution, created_at, original_post_id)
                                                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                                                        .bind(id).bind(image_id).bind(url).bind(thumb)
                                                        .bind(prompt).bind(dur).bind(res).bind(cat).bind(opid)
                                                        .execute(pool).await.ok();
                                                }
                                            }

                                            migrated += 1;
                                        }

                                        println!("[GVP Desktop] \u{1F4E6} IDB Migration batch {}: {}/{} records", batch_idx, migrated, records.len());

                                        if is_final {
                                            println!("[GVP Desktop] \u{2705} IDB Migration complete ({} total records)", total);
                                            let _ = app_handle.emit("gallery-updated", serde_json::json!({
                                                "source": "idb_migration",
                                                "total": total
                                            }));
                                        }
                                    }
                                }
                            }

                            // PLAN_040: Ghost Window fire result
                            "fire_result" => {
                                println!("[GVP Desktop] \u{1F680} Fire result: {:?}", payload);
                                let _ = app_handle.emit("fire-result", payload);
                            }

                            _ => {
                                println!("[GVP Desktop] Unknown message type: {}", msg_type);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                println!("[GVP Desktop] WebSocket error: {}", e);
                break;
            }
        }
            } // close tokio::select! second arm
        } // close tokio::select!
    } // close loop

    // Decrement connection count
    {
        let mut s = state.lock();
        s.connection_count = s.connection_count.saturating_sub(1);
        s.last_status = if s.connection_count > 0 {
            format!("Connected ({})", s.connection_count)
        } else {
            "Disconnected".to_string()
        };
    }

    // Emit disconnection event
    let _ = app_handle.emit("ws-connection", "Disconnected");

    println!("[GVP Desktop] Connection closed: {}", addr);
}

/// Start WebSocket server
async fn start_server(state: Arc<Mutex<AppState>>, app_handle: tauri::AppHandle) {
    let addr = "127.0.0.1:8765";

    let listener = match TcpListener::bind(addr).await {
        Ok(l) => {
            println!("[GVP Desktop] WebSocket server started on {}", addr);
            l
        }
        Err(e) => {
            eprintln!("[GVP Desktop] Failed to bind to {}: {}", addr, e);
            return;
        }
    };

    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                let state_clone = state.clone();
                let app_handle_clone = app_handle.clone();

                tokio::spawn(async move {
                    handle_connection(stream, addr, state_clone, app_handle_clone).await;
                });
            }
            Err(e) => {
                eprintln!("[GVP Desktop] Accept error: {}", e);
            }
        }
    }
}

/// Get current timestamp in milliseconds
fn chrono_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

// ============================================================================
// MAIN (Tauri v2 style)
// ============================================================================

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

            println!("[GVP Desktop] \u{1F4BE} DB at: {}", db_path.display());

            // 2. Init DB and 3. Start WS server (Together in one async task)
            tokio::spawn(async move {
                let pool = SqlitePool::connect(&db_url).await
                    .expect("Failed to open gallery.db");

                init_gallery_db(&pool).await;

                {
                    // Lock state to save the db pool
                    let mut s = state_clone.lock();
                    s.db_pool = Some(pool);
                }

                start_server(state_clone.clone(), app_handle).await;
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
