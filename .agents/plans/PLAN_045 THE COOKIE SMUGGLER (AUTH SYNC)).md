***

**[COPY START]**
# INITIALIZE PLAN_045: THE COOKIE SMUGGLER (AUTH SYNC)

**Context:**
The Rust Media Proxy (`PLAN_044`) successfully bypasses Cloudflare, but receives a `403 Forbidden` for all media hosted at `https://assets.grok.com/users/...`. This is because the `reqwest` client lacks the user's `grok.com` authentication cookies. The user's Ghost Window (Chrome Extension) has these cookies.

**Goal:**
Extract the cookies from the Chrome extension and sync them to the Rust backend over the existing WebSocket so the proxy can use them.

**Your Directives for PLAN_045:**

**1. Update AppState (Rust):**
*   Add `grok_cookies: String` to `AppState` in `main.rs` (default to an empty string).

**2. WebSocket Handler (Rust):**
*   Add a new message handler for `"sync_cookies"`.
*   Extract `payload["cookies"]` and save it to `AppState.grok_cookies`.

**3. The Proxy Handler (Rust):**
*   In the `gvp` URI protocol handler (`main.rs`), retrieve the cookies using `_app.state::<Arc<Mutex<AppState>>>()`.
*   If the cookie string is not empty, attach it to the `reqwest` request: `.header("Cookie", cookies)`.

**4. The Extension Extract & Sync (JS):**
*   In `src-extension/content.bundle.js`, we need to extract the cookies and send them over the WebSocket `{ type: "sync_cookies", payload: { cookies: "..." } }`.
*   *CRITICAL MANIFEST V3 WARNING:* Essential auth cookies (like `sso` or session tokens) are almost certainly `HttpOnly`, meaning `document.cookie` in the content script will not see them. 
*   You must instruct me on how to fetch these using the `chrome.cookies` API via the background service worker, and relay them to the content script. Provide the exact code for `background.js` (or similar) and how `content.bundle.js` requests them.

Please write a strict `PLAN_045.md` detailing the exact Find/Replace blocks for `main.rs`, the additions for the Chrome Extension background worker, and the updates to `content.bundle.js`.
**[COPY END]**

***