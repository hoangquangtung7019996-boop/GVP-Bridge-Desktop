**[COPY START]**
`/flash-implement`

# PLAN_044: Rust Media Proxy (CORS/CSP Bypass)

## Problem/Goal
Media from `assets.grok.com` fails to load in Tauri's WebView2 due to:
1. Missing `Access-Control-Allow-Origin` headers → CORS block on images
2. `Content-Security-Policy: default-src 'none'` header → prevents `<video>` rendering

**Solution:** Register a Tauri v2 custom URI scheme protocol (`gvp`) that proxies media requests through Rust's HTTP client. Rust ignores CORS/CSP entirely. The frontend accesses media via `http://gvp.localhost/proxy?url=<encoded_url>` (Tauri v2 Windows format).

**CRITICAL RULE:** The `"Open Original"` link (`<a href=...>`) must NOT be proxified. It opens in an external browser where CORS doesn't apply.

---

## Step 1: Add `reqwest` dependency
**File:** `src-tauri/Cargo.toml`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```toml
sqlx = { version = "0.8.6", features = ["sqlite", "runtime-tokio"] }
```

**Replace With:**
```toml
sqlx = { version = "0.8.6", features = ["sqlite", "runtime-tokio"] }
reqwest = { version = "0.12", features = ["blocking"] }
```

---

## Step 2: Add `percent_decode` helper function
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
// ============================================================================
// MAIN (Tauri v2 style)
// ============================================================================
```

**Replace With:**
```rust
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
```

---

## Step 3: Register `gvp` custom URI scheme protocol on the Builder
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(state.clone())
```

**Replace With:**
```rust
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

                let resp = client
                    .get(&target_url)
                    .header("Accept", "*/*")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("Referer", "https://grok.com/")
                    .header("Origin", "https://grok.com")
                    .send()
                    .map_err(|e| format!("Fetch failed: {}", e))?;

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
```

---

## Step 4: Add `proxify()` helper function to GalleryPanel.tsx
**File:** `src-desktop/components/GalleryPanel.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
export default function GalleryPanel(props: { refreshTrigger?: number }) {
```

**Replace With:**
```tsx
/**
 * Wraps a remote media URL through the Rust proxy to bypass CORS/CSP.
 * Tauri v2 on Windows uses http://<scheme>.localhost/ for custom protocols.
 */
function proxify(url: string): string {
    if (!url) return '';
    return `http://gvp.localhost/proxy?url=${encodeURIComponent(url)}`;
}

export default function GalleryPanel(props: { refreshTrigger?: number }) {
```

---

## Step 5: Wrap Grid View thumbnail `src` through proxy
**File:** `src-desktop/components/GalleryPanel.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
                                                <img src={post.thumbnailUrl} loading="lazy" />
```

**Replace With:**
```tsx
                                                <img src={proxify(post.thumbnailUrl)} loading="lazy" />
```

---

## Step 6: Wrap Root Image sidebar `src` through proxy
**File:** `src-desktop/components/GalleryPanel.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
                                <img src={selectedNode()!.thumbnailUrl || selectedNode()!.imageUrl} style={{ width: "100%", "aspect-ratio": "1/1", "object-fit": "cover", display: "block" }} title="Root Image" />
```

**Replace With:**
```tsx
                                <img src={proxify(selectedNode()!.thumbnailUrl || selectedNode()!.imageUrl)} style={{ width: "100%", "aspect-ratio": "1/1", "object-fit": "cover", display: "block" }} title="Root Image" />
```

---

## Step 7: Wrap Edited Images sidebar `src` through proxy
**File:** `src-desktop/components/GalleryPanel.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
                                        <img src={edit.url} style={{ width: "100%", "aspect-ratio": "1/1", "object-fit": "cover", display: "block", background: "#222" }} title={edit.prompt} />
```

**Replace With:**
```tsx
                                        <img src={proxify(edit.url)} style={{ width: "100%", "aspect-ratio": "1/1", "object-fit": "cover", display: "block", background: "#222" }} title={edit.prompt} />
```

---

## Step 8: Wrap Center Stage `<video>` `src` through proxy
**File:** `src-desktop/components/GalleryPanel.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
                                    <video src={activeMedia()!.url} autoplay loop controls style={{ "max-width": "100%", "max-height": "100%", "object-fit": "contain", "border-radius": "6px", "box-shadow": "0 0 20px rgba(0,0,0,0.8)" }} />
```

**Replace With:**
```tsx
                                    <video src={proxify(activeMedia()!.url)} autoplay loop controls style={{ "max-width": "100%", "max-height": "100%", "object-fit": "contain", "border-radius": "6px", "box-shadow": "0 0 20px rgba(0,0,0,0.8)" }} />
```

---

## Step 9: Wrap Center Stage `<img>` `src` through proxy
**File:** `src-desktop/components/GalleryPanel.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
                                    <img src={activeMedia()!.url} style={{ "max-width": "100%", "max-height": "100%", "object-fit": "contain", "border-radius": "6px", "box-shadow": "0 0 20px rgba(0,0,0,0.8)" }} />
```

**Replace With:**
```tsx
                                    <img src={proxify(activeMedia()!.url)} style={{ "max-width": "100%", "max-height": "100%", "object-fit": "contain", "border-radius": "6px", "box-shadow": "0 0 20px rgba(0,0,0,0.8)" }} />
```

---

## Step 10: Wrap Video Thumbnails right pane `src` through proxy
**File:** `src-desktop/components/GalleryPanel.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
                                        <img src={vid.thumbnailUrl || vid.url} style={{ width: "100%", "aspect-ratio": "1/1", "object-fit": "cover", display: "block", opacity: 0.6, background: "#222" }} title={vid.prompt} />
```

**Replace With:**
```tsx
                                        <img src={proxify(vid.thumbnailUrl || vid.url)} style={{ width: "100%", "aspect-ratio": "1/1", "object-fit": "cover", display: "block", opacity: 0.6, background: "#222" }} title={vid.prompt} />
```

---

## DO NOT TOUCH
- The `<a href={activeMedia()?.url}>Open Original</a>` link — it opens in an external browser where CORS doesn't apply. It must remain un-proxified.

## Summary of Changes

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `reqwest` with `blocking` feature |
| `src-tauri/src/main.rs` | Add `percent_decode()` helper function |
| `src-tauri/src/main.rs` | Register `gvp` custom URI scheme protocol on Builder |
| `src-desktop/components/GalleryPanel.tsx` | Add `proxify()` helper function |
| `src-desktop/components/GalleryPanel.tsx` | Wrap 6 `<img>`/`<video>` `src` attributes through proxy |

## Technical Notes for Flash
1. **Cloudflare Bot Detection:** `assets.grok.com` is behind Cloudflare. A bare `reqwest::blocking::get()` sends `User-Agent: reqwest/0.12.x` which gets instant 403. The `Client::builder().user_agent(...)` injects a real Chrome 147 UA + `Referer`/`Origin` headers matching `grok.com` to pass Cloudflare's checks. These headers are sourced from the live request capture in `good.md`.
2. **Tokio Runtime Conflict:** `reqwest::blocking` internally creates a tokio runtime. Since Tauri's protocol handler runs on the main/UI thread which is already inside `#[tokio::main]`, calling it directly would panic. The `std::thread::spawn().join()` pattern runs the blocking fetch on a fresh OS thread with no tokio context — this is intentional and required.
3. On Windows, Tauri v2 custom protocols use `http://<scheme>.localhost/` format. The frontend URL `http://gvp.localhost/proxy?url=...` is correct for Windows.
4. The `percent_decode` function is a self-contained implementation to avoid adding another crate dependency. It handles standard URL encoding (`%XX` hex pairs and `+` for spaces).

**[COPY END]**