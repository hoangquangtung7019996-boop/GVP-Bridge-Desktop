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
    pub grok_cookies: String,
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
            grok_cookies: String::new(),
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
            title TEXT DEFAULT '',
            imagine_prompt TEXT DEFAULT '',
            created_at INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT '',
            last_accessed TEXT DEFAULT '',
            last_moderated_at TEXT DEFAULT '',
            last_successful_at TEXT DEFAULT ''
        )"
    ).execute(pool).await.expect("Failed to create posts table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS edited_images (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            original_post_id TEXT,
            url TEXT NOT NULL,
            thumbnail_url TEXT,
            prompt TEXT DEFAULT '',
            created_at INTEGER DEFAULT 0
        )"
    ).execute(pool).await.expect("Failed to create edited_images table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            original_post_id TEXT,
            url TEXT NOT NULL,
            thumbnail_url TEXT,
            prompt TEXT DEFAULT '',
            duration INTEGER,
            resolution TEXT,
            is_extension INTEGER DEFAULT 0,
            extension_true_id TEXT DEFAULT '',
            created_at INTEGER DEFAULT 0
        )"
    ).execute(pool).await.expect("Failed to create videos table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS hmr (
            moderated_id TEXT PRIMARY KEY,
            account_id TEXT,
            image_id TEXT NOT NULL,
            original_post_id TEXT,
            image_url TEXT,
            thumbnail_url TEXT,
            webapp_url TEXT,
            generation_type TEXT,
            title TEXT,
            prompt TEXT,
            mode TEXT,
            moderated INTEGER DEFAULT 1,
            last_clean_progress INTEGER,
            last_moderated_at TEXT,
            last_accessed TEXT,
            created_at TEXT,
            updated_at TEXT
        )"
    ).execute(pool).await.expect("Failed to create hmr table");

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_edited_images_post ON edited_images(post_id)")
        .execute(pool).await.ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_videos_post ON videos(post_id)")
        .execute(pool).await.ok();
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_hmr_image ON hmr(image_id)")
        .execute(pool).await.ok();

    println!("[GVP Desktop] 💾 UVH & HMR SQLite schema initialized");
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

        let account_id = post["userId"].as_str().or_else(|| post["accountId"].as_str()).unwrap_or("");
        let image_url = post["mediaUrl"].as_str().or_else(|| post["imageUrl"].as_str()).unwrap_or("");
        let thumbnail_url = post["thumbnailImageUrl"].as_str().or_else(|| post["thumbnailUrl"].as_str()).unwrap_or(image_url);
        let created_at = iso_to_epoch_ms(post["createTime"].as_str().or_else(|| post["createdAt"].as_str()).unwrap_or(""));
        let updated_at = post["updatedAt"].as_str().or_else(|| post["lastUpdated"].as_str()).unwrap_or("");
        let imagine_prompt = if image_url.starts_with("https://imagine-public.x.ai/imagine-public/images/") {
            post["originalPrompt"].as_str().or_else(|| post["prompt"].as_str()).unwrap_or("")
        } else {
            "" // User uploaded or fallback
        };
        let title = post["title"].as_str().unwrap_or("");

        // Upsert root post
        if let Err(e) = sqlx::query(
            "INSERT OR REPLACE INTO posts (image_id, account_id, image_url, thumbnail_url, title, imagine_prompt, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(image_id).bind(account_id).bind(image_url).bind(thumbnail_url)
            .bind(title).bind(imagine_prompt).bind(created_at).bind(updated_at)
            .execute(pool).await
        {
            println!("[GVP Desktop] DB insert error: {}", e);
        }

        // --- Extract children and HMR ---
        let mut seen_img: HashSet<String> = HashSet::new();
        let mut seen_vid: HashSet<String> = HashSet::new();

        let mut all_items: Vec<&serde_json::Value> = Vec::new();
        if let Some(images) = post["images"].as_array() { for img in images { all_items.push(img); } }
        if let Some(vids) = post["videos"].as_array() { for vid in vids { all_items.push(vid); } }
        if let Some(children) = post["childPosts"].as_array() { for child in children { all_items.push(child); } }

        for item in all_items {
            let id = item["id"].as_str().unwrap_or("");
            if id.is_empty() { continue; }
            let opid = item["originalPostId"].as_str().or_else(|| item["parentId"].as_str());

            // Catch Moderated Items -> HMR
            if item["moderated"].as_bool().unwrap_or(false) {
                let gen_type = if item["mediaType"].as_str() == Some("MEDIA_POST_TYPE_VIDEO") { "Video" } else { "Image-Edit" };
                let m_url = item["mediaUrl"].as_str().unwrap_or("");
                let m_thumb = item["thumbnailImageUrl"].as_str().unwrap_or(m_url);
                let m_prompt = item["originalPrompt"].as_str().or_else(|| item["prompt"].as_str()).unwrap_or("");
                
                sqlx::query(
                    "INSERT OR REPLACE INTO hmr (moderated_id, account_id, image_id, original_post_id, image_url, thumbnail_url, generation_type, prompt, moderated, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(id).bind(account_id).bind(image_id).bind(opid)
                    .bind(m_url).bind(m_thumb).bind(gen_type).bind(m_prompt)
                    .bind(1).bind(item["createTime"].as_str().unwrap_or(""))
                    .execute(pool).await.ok();
                continue; // Do not insert moderated items into standard UVH
            }

            if id == image_id && item["originalPostId"].is_null() { continue; } // Skip root self-refs
            let url = item["mediaUrl"].as_str().or_else(|| item["videoUrl"].as_str()).or_else(|| item["url"].as_str()).unwrap_or("");
            if url.is_empty() { continue; }
            let prompt = item["originalPrompt"].as_str().or_else(|| item["prompt"].as_str()).unwrap_or("");
            let thumb = item["thumbnailImageUrl"].as_str().or_else(|| item["thumbnailUrl"].as_str());
            let cat = iso_to_epoch_ms(item["createTime"].as_str().or_else(|| item["createdAt"].as_str()).unwrap_or(""));

            let is_video = item["mediaType"].as_str() == Some("MEDIA_POST_TYPE_VIDEO") || item["videoDuration"].is_number();

            if is_video && seen_vid.insert(id.to_string()) {
                let is_ext = item["originalRefType"].as_str() == Some("ORIGINAL_REF_TYPE_VIDEO_EXTENSION");
                let ext_id = if is_ext { opid.unwrap_or("") } else { "" };
                let dur = item["videoDuration"].as_i64();
                let res = item["resolutionName"].as_str();

                sqlx::query(
                    "INSERT OR REPLACE INTO videos (id, post_id, original_post_id, url, thumbnail_url, prompt, duration, resolution, is_extension, extension_true_id, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(id).bind(image_id).bind(opid).bind(url).bind(thumb)
                    .bind(prompt).bind(dur).bind(res).bind(is_ext as i32).bind(ext_id).bind(cat)
                    .execute(pool).await.ok();
            } else if !is_video && seen_img.insert(id.to_string()) {
                sqlx::query(
                    "INSERT OR REPLACE INTO edited_images (id, post_id, original_post_id, url, thumbnail_url, prompt, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)")
                    .bind(id).bind(image_id).bind(opid).bind(url).bind(thumb)
                    .bind(prompt).bind(cat)
                    .execute(pool).await.ok();
            }
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
async fn get_uvh_tree(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let pool = {
        let s = state.lock();
        if let Some(ref p) = s.db_pool {
            p.clone()
        } else {
            return Err("DB not initialized".into());
        }
    };

    let roots = sqlx::query_as::<_, (String, String, String, String, String, String, i64, String, String, String, String)>(
        "SELECT image_id, account_id, image_url, thumbnail_url, title, imagine_prompt, created_at, updated_at, last_accessed, last_moderated_at, last_successful_at 
         FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(limit).bind(offset)
    .fetch_all(&pool).await.map_err(|e| e.to_string())?;

    let mut tree = Vec::new();

    for r in roots {
        let root_id = &r.0;

        let videos = sqlx::query_as::<_, (String, String, Option<String>, String, Option<String>, String, Option<i64>, Option<String>, i32, Option<String>, i64)>(
            "SELECT id, post_id, original_post_id, url, thumbnail_url, prompt, duration, resolution, is_extension, extension_true_id, created_at FROM videos WHERE post_id = ?"
        ).bind(root_id).fetch_all(&pool).await.unwrap_or_default();

        let edited = sqlx::query_as::<_, (String, String, Option<String>, String, Option<String>, String, i64)>(
            "SELECT id, post_id, original_post_id, url, thumbnail_url, prompt, created_at FROM edited_images WHERE post_id = ?"
        ).bind(root_id).fetch_all(&pool).await.unwrap_or_default();

        let hmr = sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT moderated_id, prompt FROM hmr WHERE image_id = ?"
        ).bind(root_id).fetch_all(&pool).await.unwrap_or_default();

        let mut v_arr = Vec::new();
        for v in &videos {
            v_arr.push(serde_json::json!({
                "id": v.0, "originalPostId": v.2, "url": v.3, "thumbnailUrl": v.4, "prompt": v.5, 
                "duration": v.6, "resolution": v.7, "extension": if v.8 == 1 { "true" } else { "false" }, 
                "extensionTrueId": v.9, "createdAt": v.10
            }));
        }

        let mut e_arr = Vec::new();
        for e in &edited {
            e_arr.push(serde_json::json!({
                "id": e.0, "originalPostId": e.2, "url": e.3, "thumbnailUrl": e.4, "prompt": e.5, "createdAt": e.6
            }));
        }

        let mut failure_prompts = Vec::new();
        for h in &hmr {
            if let Some(prompt) = &h.1 {
                failure_prompts.push(serde_json::json!({ "id": h.0, "prompt": prompt }));
            }
        }

        tree.push(serde_json::json!({
            "accountId": r.1,
            "imageId": r.0,
            "imageUrl": r.2,
            "thumbnailUrl": r.3,
            "title": r.4,
            "imaginePrompt": r.5,
            "videos": v_arr,
            "editedImages": e_arr,
            "successCount": videos.len() + edited.len(),
            "failCount": hmr.len(),
            "failurePrompts": failure_prompts,
            "createdAt": r.6,
            "updatedAt": r.7
        }));
    }

    Ok(tree)
}

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
            println!("[GVP Desktop] 🚀 trigger_fire pushed to {} WS subscribers", n);
            Ok(format!("Fire triggered for imageId: {}", image_id))
        }
        Err(_) => {
            println!("[GVP Desktop] ⚠️ trigger_fire: No active WS connections to receive");
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
                        println!("[GVP Desktop] 📤 Pushing message to extension: {}", &msg_str[..msg_str.len().min(120)]);
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
                                    format!("✓ {}", status)
                                } else {
                                    let error = payload["error"].as_str().unwrap_or("Unknown error");
                                    format!("✗ {} - {}", status, error)
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
                                    println!("[GVP Desktop] 🔄 Auto-sync triggered on 'ready'");
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
                                        
                                        // PLAN_043 Reactivity: Emit immediately after ingestion
                                        let _ = app_handle.emit("db-updated", ());

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

                            // PLAN_042: Legacy IDB migration — pre-normalized UVH records
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
                                            let title = record["title"].as_str().unwrap_or("");
                                            let imagine_prompt = record["imaginePrompt"].as_str().unwrap_or("");

                                            sqlx::query(
                                                "INSERT OR IGNORE INTO posts (image_id, account_id, image_url, thumbnail_url, title, imagine_prompt, created_at, updated_at)
                                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                                                .bind(image_id).bind(account_id).bind(image_url).bind(thumbnail_url)
                                                .bind(title).bind(imagine_prompt).bind(created_at).bind(updated_at)
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

                                                    sqlx::query(
                                                        "INSERT OR IGNORE INTO edited_images (id, post_id, original_post_id, url, thumbnail_url, prompt, created_at)
                                                         VALUES (?, ?, ?, ?, ?, ?, ?)")
                                                        .bind(id).bind(image_id).bind(opid).bind(url).bind(thumb)
                                                        .bind(prompt).bind(cat)
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
                                                    let is_ext = if vid["extension"].as_str() == Some("true") { 1 } else { 0 };
                                                    let ext_id = vid["extensionTrueId"].as_str().unwrap_or("");

                                                    sqlx::query(
                                                        "INSERT OR IGNORE INTO videos (id, post_id, original_post_id, url, thumbnail_url, prompt, duration, resolution, is_extension, extension_true_id, created_at)
                                                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                                                        .bind(id).bind(image_id).bind(opid).bind(url).bind(thumb)
                                                        .bind(prompt).bind(dur).bind(res).bind(is_ext).bind(ext_id).bind(cat)
                                                        .execute(pool).await.ok();
                                                }
                                            }

                                            migrated += 1;
                                        }

                                        println!("[GVP Desktop] 📦 IDB Migration batch {}: {}/{} records", batch_idx, migrated, records.len());

                                        if is_final {
                                            println!("[GVP Desktop] ✅ IDB Migration complete ({} total records)", total);
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
                                println!("[GVP Desktop] 🚀 Fire result: {:?}", payload);
                                let _ = app_handle.emit("fire-result", payload);
                            }

                            // PLAN_045: Sync Auth Cookies
                            "sync_cookies" => {
                                if let Some(cookies) = payload["cookies"].as_str() {
                                    println!("[GVP Desktop] 🍪 Received grok.com cookies ({} chars)", cookies.len());
                                    let mut s = state.lock();
                                    s.grok_cookies = cookies.to_string();
                                }
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
// MEDIA PROXY — percent-decode helper for URI query parameters
// ============================================================================

/// Decode percent-encoded URI query values (e.g. `%3A` → `:`, `%2F` → `/`)
fn percent_decode(input: &str) -> String {
    let mut output = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""),
                16,
            ) {
                output.push(val);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            output.push(b' ');
            i += 1;
            continue;
        }
        output.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(output).unwrap_or_default()
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
        .register_uri_scheme_protocol("gvp", |_app, request| {
            // Extract the 'url' query parameter from the request URI
            let query = request.uri().query().unwrap_or("");
            let target_encoded = query
                .split("url=")
                .nth(1)
                .unwrap_or("")
                .split('&')
                .next()
                .unwrap_or("");

            if target_encoded.is_empty() {
                return tauri::http::Response::builder()
                    .status(400)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(b"Missing 'url' query parameter".to_vec())
                    .unwrap();
            }

            let target_url = percent_decode(target_encoded);
            println!("[GVP Proxy] Fetching: {}", &target_url[..target_url.len().min(120)]);

            let state_handle = _app.app_handle().state::<Arc<Mutex<AppState>>>();
            let cookies = {
                let s = state_handle.inner().lock();
                s.grok_cookies.clone()
            };

            // Spawn a std::thread to avoid tokio runtime conflict
            // (Tauri's main thread runs inside #[tokio::main], so reqwest::blocking
            //  would panic if called directly — it tries to create its own runtime)
            let fetch_result = std::thread::spawn(move || -> Result<(Vec<u8>, String), String> {
                // CRITICAL: Build a Client with a real Chrome User-Agent.
                // Grok's CDN (assets.grok.com) is behind Cloudflare.
                // A bare reqwest::blocking::get() sends "reqwest/0.12.x" as UA,
                // which Cloudflare instantly 403s as bot traffic.
                let client = reqwest::blocking::Client::builder()
                    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36")
                    .build()
                    .map_err(|e| format!("Client build failed: {}", e))?;

                let mut req = client
                    .get(&target_url)
                    .header("Accept", "*/*")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("Referer", "https://grok.com/")
                    .header("Origin", "https://grok.com")
                    .header("Range", "bytes=0-"); // CRITICAL: Video CDNs require Range headers

                if !cookies.is_empty() {
                    req = req.header("Cookie", cookies);
                }

                let resp = req.send()
                    .map_err(|e| format!("Fetch failed: {}", e))?;

                let status = resp.status();
                let content_len = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).unwrap_or("unknown");
                println!("[GVP Proxy] Upstream Response: {} (Content-Length: {})", status, content_len);

                if !status.is_success() {
                    return Err(format!("Upstream returned HTTP {}", status));
                }

                // Detect content type: prefer upstream header, fallback to extension
                let content_type = resp
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or_else(|| {
                        if target_url.contains(".mp4") {
                            "video/mp4"
                        } else if target_url.contains(".webm") {
                            "video/webm"
                        } else if target_url.contains(".jpg") || target_url.contains(".jpeg") {
                            "image/jpeg"
                        } else if target_url.contains(".png") {
                            "image/png"
                        } else if target_url.contains(".webp") {
                            "image/webp"
                        } else {
                            "application/octet-stream"
                        }
                    })
                    .to_string();

                let bytes = resp
                    .bytes()
                    .map_err(|e| format!("Body read failed: {}", e))?;
                Ok((bytes.to_vec(), content_type))
            })
            .join()
            .unwrap_or_else(|_| Err("Proxy thread panicked".to_string()));

            match fetch_result {
                Ok((bytes, content_type)) => {
                    println!("[GVP Proxy] ✅ {} bytes ({})", bytes.len(), content_type);
                    tauri::http::Response::builder()
                        .status(200)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Content-Type", &content_type)
                        .body(bytes)
                        .unwrap()
                }
                Err(e) => {
                    println!("[GVP Proxy] ❌ {}", e);
                    tauri::http::Response::builder()
                        .status(502)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(format!("Proxy error: {}", e).into_bytes())
                        .unwrap()
                }
            }
        })
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

            println!("[GVP Desktop] 💾 DB at: {}", db_path.display());

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
            get_uvh_tree,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
