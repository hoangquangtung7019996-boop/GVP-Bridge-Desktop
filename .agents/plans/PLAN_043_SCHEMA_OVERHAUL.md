# /flash-implement
# PLAN_043: THE UVH & HMR SCHEMA OVERHAUL

## Context
The user has mandated a strict relational schema for Gallery data, mapping perfectly to the `UVH` and `HMR` JSON structures. Data must be joined and constructed in Rust via a `get_uvh_tree` command, rather than via frontend SQL queries. The UI must transition to a detailed split view when a root image is clicked.

---

## STEP 1: Rewrite SQLite Schema
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find:**
```rust
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

**Replace With:**
```rust
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
```

---

## STEP 2: Rewrite Gallery Normalizer
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
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
```

**Replace With:**
```rust
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
```

---

## STEP 3: Add `get_uvh_tree` Tauri Command
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find:**
```rust
#[tauri::command]
fn force_gallery_sync(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<String, String> {
```
**Insert BEFORE:**
```rust
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

        let hmr = sqlx::query_as::<_, (String, Option<String>, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, i32, Option<i64>, Option<String>, Option<String>, Option<String>, Option<String>)>(
            "SELECT moderated_id, account_id, image_id, original_post_id, image_url, thumbnail_url, webapp_url, generation_type, title, prompt, mode, moderated, last_clean_progress, last_moderated_at, last_accessed, created_at, updated_at FROM hmr WHERE image_id = ?"
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
            if let Some(prompt) = &h.9 {
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

```

---

## STEP 4: Register command
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find:**
```rust
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
```
**Replace With:**
```rust
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
```

---

## STEP 5: Add Reactivity Event Emits
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find:**
```rust
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
```

**Replace With:**
```rust
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
```

---

## STEP 6: UI Refactor for UVH Nested Structure
**File:** `src-desktop/components/GalleryPanel.tsx`
**Action:** REPLACE_ENTIRE_FILE

**Replace With:**
```tsx
/**
 * GVP Bridge - Detailed Gallery Panel Component (PLAN_043)
 * Maps strictly to the UVH / HMR Schema via get_uvh_tree
 */

import { createSignal, onMount, onCleanup, For, Show } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface UVHNode {
    accountId: string;
    imageId: string;
    imageUrl: string;
    thumbnailUrl: string;
    title: string;
    imaginePrompt: string;
    videos: any[];
    editedImages: any[];
    successCount: number;
    failCount: number;
    failurePrompts: any[];
    createdAt: number;
    updatedAt: string;
}

export default function GalleryPanel(props: { refreshTrigger?: number }) {
    const [posts, setPosts] = createSignal<UVHNode[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [syncing, setSyncing] = createSignal(false);
    const [error, setError] = createSignal('');
    const [selectedNode, setSelectedNode] = createSignal<UVHNode | null>(null);

    async function loadGallery() {
        try {
            const rows = await invoke<UVHNode[]>('get_uvh_tree', { limit: 100, offset: 0 });
            setPosts(rows);
            // Refresh detailed node if active
            const current = selectedNode();
            if (current) {
                const refreshed = rows.find(r => r.imageId === current.imageId);
                if (refreshed) setSelectedNode(refreshed);
            }
            setError('');
        } catch (err: any) {
            console.error('[GalleryPanel] UVH query failed:', err);
            setError(err.message || 'Failed to load gallery');
        } finally {
            setLoading(false);
        }
    }

    async function handleForceSync() {
        setSyncing(true);
        try {
            await invoke('force_gallery_sync');
        } catch (err: any) {
            setError(err.message || 'Sync failed');
        }
        setTimeout(() => setSyncing(false), 10000); // Safety timeout
    }

    async function handleCardClick(post: UVHNode) {
        setSelectedNode(post);
    }

    onMount(() => {
        loadGallery();
        const unlisten = listen('db-updated', () => {
            console.log("DB Updated event received, refreshing UVH tree...");
            loadGallery();
        });
        
        onCleanup(async () => {
             (await unlisten)();
        });
    });

    const _refresh = () => {
        if (props.refreshTrigger !== undefined) {
            loadGallery();
            setSyncing(false);
        }
    };
    (() => { const _ = props.refreshTrigger; _refresh(); })();

    return (
        <div class="gallery-panel uvh-panel">
            <div class="gallery-header">
                <h3>{selectedNode() ? `Detailed View: ${selectedNode()?.imageId.split('-')[0]}` : 'Gallery'}</h3>
                <div class="gallery-actions">
                    <span class="gallery-count">{posts().length} roots</span>
                    <Show when={selectedNode()}>
                        <button class="back-btn" onClick={() => setSelectedNode(null)}>
                            Back to Grid
                        </button>
                    </Show>
                    <button class="sync-btn" onClick={handleForceSync} disabled={syncing()}>
                        {syncing() ? '⏳ Syncing...' : '🔄 Sync'}
                    </button>
                </div>
            </div>

            <Show when={error()}>
                <div class="gallery-error">⚠️ {error()}</div>
            </Show>

            <Show when={!loading()} fallback={<div class="gallery-loading">Loading UVH Tree...</div>}>
                <Show when={!selectedNode()}>
                   <Show when={posts().length > 0} fallback={<div class="gallery-empty">No gallery data yet.</div>}>
                       <div class="gallery-grid">
                           <For each={posts()}>
                               {(post) => (
                                   <div class="generation-card" onClick={() => handleCardClick(post)}>
                                       <div class="generation-media">
                                           <Show when={post.thumbnailUrl} fallback={<div class="media-placeholder">🖼️</div>}>
                                               <img src={post.thumbnailUrl} loading="lazy" />
                                           </Show>
                                           <Show when={post.successCount > 0}>
                                               <span class="child-badge success">{post.successCount}</span>
                                           </Show>
                                           <Show when={post.failCount > 0}>
                                               <span class="child-badge fail">{post.failCount}</span>
                                           </Show>
                                       </div>
                                       <div class="generation-info">
                                           <p class="generation-prompt">{post.imaginePrompt || post.title || '(no prompt)'}</p>
                                       </div>
                                   </div>
                               )}
                           </For>
                       </div>
                   </Show>
                </Show>

                <Show when={selectedNode()}>
                    {/* Detail Split View */}
                    <div class="uvh-detail-view">
                        <section class="uvh-root-section">
                            <img src={selectedNode()!.imageUrl} alt="Root" class="uvh-root-img" />
                            <p class="uvh-large-prompt">{selectedNode()!.imaginePrompt || "Root Image"}</p>
                        </section>
                        
                        <div class="uvh-children-split">
                            <section class="uvh-split-pane">
                                <h4>Edited Images ({selectedNode()!.editedImages.length})</h4>
                                <div class="uvh-list">
                                    <For each={selectedNode()!.editedImages}>
                                        {(edit) => (
                                            <div class="uvh-child-item">
                                                <img src={edit.thumbnailUrl} />
                                                <small>{edit.prompt}</small>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            </section>

                            <section class="uvh-split-pane">
                                <h4>Videos ({selectedNode()!.videos.length})</h4>
                                <div class="uvh-list">
                                    <For each={selectedNode()!.videos}>
                                        {(vid) => (
                                            <div class="uvh-child-item">
                                                <img src={vid.thumbnailUrl} />
                                                <small>{vid.prompt}</small>
                                                <Show when={vid.extension === "true"}>
                                                    <span class="ext-badge">Extended</span>
                                                </Show>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            </section>
                        </div>
                        
                        {/* HMR Failures Pane */}
                        <Show when={selectedNode()!.failurePrompts.length > 0}>
                            <section class="uvh-hmr-pane">
                                4>Failed / Moderated Attempts ({selectedNode()!.failCount})</h4>
                                <ul>
                                    <For each={selectedNode()!.failurePrompts}>
                                        {(fail) => <li>⚠️ {fail.prompt}</li>}
                                    </For>
                                </ul>
                            </section>
                        </Show>
                    </div>
                </Show>
            </Show>
        </div>
    );
}
```

---
**Done.** Flash implementer can execute safely.
