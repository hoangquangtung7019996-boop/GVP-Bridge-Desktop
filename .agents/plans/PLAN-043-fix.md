
**[COPY START]**
`/flash-implement`

**Context:** During PLAN_043, the SQLite schema was overhauled, but the `legacy_idb_migration` WebSocket handler in `main.rs` was not updated to match the new columns. It is currently trying to insert into columns that no longer exist (e.g., `like_status`, `json_count`, `is_root`).

**Task:** Update the SQL queries inside the `legacy_idb_migration` handler in `src-tauri/src/main.rs`.

**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
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
```

**Replace With:**
```rust
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
```
**[COPY END]**

***

Once Flash applies that fix, you are completely clear to run the `.bat` file (press `1`) and test the app! Let me know if the SolidJS frontend loads the new UVH Split View!