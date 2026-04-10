# /flash-implement
# PLAN_042: API Fix & Legacy IDB Migration

## Context
1. `fetchGalleryPage` sends empty `{}` body → Grok returns 400. API requires `{ limit, filter }`.
2. The user has thousands of UVH entries in Chrome IDB (`GVP-IDB-V2` → `UVH_unifiedVideoHistory`) from the legacy extension. Migrating these is faster and more complete than re-fetching from the API.

---

## Step 1: Fix fetchGalleryPage payload
**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```javascript
  async function fetchGalleryPage(cursor = null) {
    debug('📥 Fetching gallery page, cursor:', cursor ? cursor.substring(0, 20) + '...' : 'null');
    try {
      const body = {};
      if (cursor) body.cursor = cursor;

      const response = await fetch('https://grok.com/rest/media/post/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include'
      });
```

**Replace With:**
```javascript
  async function fetchGalleryPage(cursor = null) {
    debug('📥 Fetching gallery page, cursor:', cursor ? cursor.substring(0, 20) + '...' : 'null');
    try {
      const body = {
        limit: 50,
        filter: { source: "MEDIA_POST_SOURCE_LIKED" }
      };
      if (cursor) body.cursor = cursor;

      const response = await fetch('https://grok.com/rest/media/post/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include'
      });
```

---

## Step 2: Add migrateLegacyIDB() function
**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

Insert this function IMMEDIATELY BEFORE the existing comment block:
```
  // ============================================================================
  // WEBSOCKET CLIENT
  // ============================================================================
```

**Find Exact Block:**
```javascript
  // ============================================================================
  // WEBSOCKET CLIENT
  // ============================================================================

  let ws = null;
```

**Replace With:**
```javascript
  // ============================================================================
  // LEGACY IDB MIGRATION (GVP-IDB-V2 → Desktop SQLite)
  // ============================================================================

  /**
   * Reads all records from the legacy extension's IndexedDB (GVP-IDB-V2)
   * and sends them to the Desktop app via WebSocket in batches.
   * Data is already in nested UVH format (root + editedImages[] + videos[]).
   * Rust does NOT run ingest_gallery_batch — it inserts directly.
   */
  async function migrateLegacyIDB() {
    debug('🔄 Starting legacy IDB migration...');

    return new Promise((resolve) => {
      const openReq = indexedDB.open('GVP-IDB-V2');

      openReq.onerror = () => {
        debug('❌ Legacy IDB not found or access denied');
        resolve({ migrated: 0, error: 'IDB open failed' });
      };

      openReq.onsuccess = (event) => {
        const db = event.target.result;

        // Check if the store exists
        if (!db.objectStoreNames.contains('UVH_unifiedVideoHistory')) {
          debug('❌ UVH_unifiedVideoHistory store not found in GVP-IDB-V2');
          db.close();
          resolve({ migrated: 0, error: 'Store not found' });
          return;
        }

        const tx = db.transaction('UVH_unifiedVideoHistory', 'readonly');
        const store = tx.objectStore('UVH_unifiedVideoHistory');
        const getAllReq = store.getAll();

        getAllReq.onsuccess = () => {
          const records = getAllReq.result || [];
          debug(`📦 Found ${records.length} legacy UVH records`);

          if (records.length === 0) {
            db.close();
            resolve({ migrated: 0, error: null });
            return;
          }

          // Send in batches of 50 to avoid WS message size limits
          const BATCH_SIZE = 50;
          let sent = 0;

          for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            wsClient.send({
              type: 'legacy_idb_migration',
              payload: {
                records: batch,
                batchIndex: Math.floor(i / BATCH_SIZE),
                totalRecords: records.length,
                isFinal: (i + BATCH_SIZE) >= records.length
              },
              timestamp: Date.now()
            });
            sent += batch.length;
          }

          debug(`✅ Legacy migration: sent ${sent} records in ${Math.ceil(records.length / BATCH_SIZE)} batches`);
          db.close();
          resolve({ migrated: sent, error: null });
        };

        getAllReq.onerror = () => {
          debug('❌ Failed to read UVH store');
          db.close();
          resolve({ migrated: 0, error: 'getAll failed' });
        };
      };

      openReq.onupgradeneeded = () => {
        // DB doesn't exist — close and abort
        debug('Legacy IDB does not exist (onupgradeneeded fired)');
        openReq.transaction?.abort();
        resolve({ migrated: 0, error: 'IDB does not exist' });
      };
    });
  }

  // ============================================================================
  // WEBSOCKET CLIENT
  // ============================================================================

  let ws = null;
```

---

## Step 3: Trigger IDB migration after WS "ready"
**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

In the WS `onopen` handler, after the "ready" status message is sent, add the migration call.
Find the block inside `wsClient.connect()` where `ws.onopen` sends the "ready" status:

**Find Exact Block:**
```javascript
        ws.onopen = () => {
          debug('WebSocket connected');
          reconnectAttempts = 0;
          lastAction = 'Connected';

          // Report ready status
          wsClient.send({
            type: 'status',
            payload: { status: 'ready', success: true, url: window.location.href },
            timestamp: Date.now()
          });
```

**Replace With:**
```javascript
        ws.onopen = () => {
          debug('WebSocket connected');
          reconnectAttempts = 0;
          lastAction = 'Connected';

          // Report ready status
          wsClient.send({
            type: 'status',
            payload: { status: 'ready', success: true, url: window.location.href },
            timestamp: Date.now()
          });

          // Attempt legacy IDB migration on first connect
          migrateLegacyIDB().then(result => {
            debug('IDB migration result:', JSON.stringify(result));
          });
```

---

## Step 4: Add `legacy_idb_migration` handler to `fetch_gallery` case in extension WS message handler
**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

No change needed here — the extension SENDS `legacy_idb_migration`, it doesn't receive it. The handler is Rust-side only. Skip.

---

## Step 5: Add `legacy_idb_migration` WS handler in Rust backend
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

The UVH data is ALREADY normalized/nested. The Rust handler simply maps:
- Root fields → `posts` table
- `editedImages[]` → `edited_images` table
- `videos[]` → `videos` table

**Find Exact Block:**
```rust
                            // PLAN_040: Ghost Window fire result
                            "fire_result" => {
                                println!("[GVP Desktop] 🚀 Fire result: {:?}", payload);
                                let _ = app_handle.emit("fire-result", payload);
                            }
```

**Replace With:**
```rust
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
```

---

## KEY DESIGN DECISIONS

1. **`INSERT OR IGNORE`** (not `INSERT OR REPLACE`) for IDB migration. Legacy data should NOT overwrite fresher API data if the Desktop already has it from a /list sync.

2. **UVH field names are different from API field names.** The legacy UVH uses:
   - `imageId` (not `id`)
   - `imageUrl` (not `mediaUrl`)
   - `thumbnailUrl` (not `thumbnailImageUrl`)
   - `createdAt` as epoch ms (not `createTime` ISO string)
   - `editedImages[]` (nested array, not `images[]` or `childPosts[]`)
   - `videos[]` with `duration` (number) and `resolution` (string like "480p")

   This is why `ingest_gallery_batch` (which normalizes flat API data) MUST NOT be reused for IDB migration.

3. **Batching at 50** prevents WebSocket frame overflow for users with very large galleries.

4. **Migration fires once on every WS connect.** `INSERT OR IGNORE` makes repeated runs safe (idempotent). Future optimization: the Desktop can respond with a "migration_not_needed" message to skip on subsequent connects.

---

## VERIFICATION
```powershell
cd "a:\Tools n Programs\GVP-Desktop\src-tauri"
cargo check
```
Then `npm run tauri dev`, open Chrome on `grok.com/imagine`, and observe:
1. Console: `📦 Found N legacy UVH records` + `✅ Legacy migration: sent N records`
2. Rust log: `📦 IDB Migration batch 0: ...` → `✅ IDB Migration complete`
3. Gallery panel populates with historical data
4. `fetch_gallery` auto-sync succeeds (no more 400)
