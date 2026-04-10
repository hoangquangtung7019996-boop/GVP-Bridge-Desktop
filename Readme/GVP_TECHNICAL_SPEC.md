# 🛠️ GVP TECHNICAL SPECIFICATION

## 1. DOM AUTOMATION (CHROME EXTENSION)
The extension bridge uses advanced DOM manipulation to interface with Grok's TipTap editor.

### Target Selectors
| Element | CSS Selector |
|---------|--------------|
| **TipTap Editor** | `div.tiptap.ProseMirror[contenteditable="true"]` |
| **Fallback Editor** | `div[contenteditable="true"][translate="no"].ProseMirror` |
| **Submit Button** | `button[aria-label="Make video"]`, `button[aria-label="Submit"]` |
| **Gallery Card** | `a[href*="/imagine/post/"]` |

### Resource Blocking (Blind Robot)
To minimize RAM usage (~60MB) and prevent WAF detection, the Ghost Window aggressively blocks media on the `grok.com` tab via `chrome.declarativeNetRequest`:
- **Blocked**: `image`, `media`, `font`, `object`, `xmlhttprequest` (to non-essential endpoints).
- **Passive SSE**: The extension listens to the `events` stream to extract generation results without replay.

### Prompt Injection Pattern
To maintain React state reconciliation on x.com, we use `insertText` rather than value assignment.
```javascript
// CRITICAL: Must focus first to trigger TipTap event listeners
editor.focus();

// Use execCommand for React-friendly injection
document.execCommand('insertText', false, promptText);

// Fallback submit trigger
const enterEvent = new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
});
editor.dispatchEvent(enterEvent);
```

---

## 2. WEBSOCKET PROTOCOL
**Server**: Tauri Desktop (Rust) on `ws://127.0.0.1:8765`
**Client**: Chrome Extension (Ghost Window Bridge)

### Common Messages
| Type | Direction | Payload Example |
|------|-----------|-----------------|
| `prompt_request` | Ext -> DT | `{ "type": "prompt_request", "payload": { "imageId": "UUID" } }` |
| `prompt_response`| DT -> Ext | `{ "type": "prompt_response", "payload": { "prompt": "...", "imageId": "...", "previewMode": true } }` |
| `url_changed`    | Ext -> DT | `{ "type": "url_changed", "payload": { "url": "...", "imageId": "..." } }` |
| `status`         | Ext -> DT | `{ "type": "status", "payload": { "status": "ready", "success": true } }` |
| `fetch_gallery`  | DT -> Ext | `{ "type": "fetch_gallery", "payload": { "cursor": null } }` |
| `gallery_data`   | Ext -> DT | `{ "type": "gallery_data", "payload": { "posts": [...], "cursor": "..." } }` |
| `fire_result`    | Ext -> DT | `{ "type": "generation_result", "payload": { ... } }` |

### Smart Sync (Sentinel Pattern)
To prevent redundant API pollution, the sync engine uses a **Sentinel Check**:
- **Logic**: During `fetch_gallery`, the engine checks if each `imageId` already exists in the `posts` table.
- **Behavior**: If a match is found, `sentinel_hit` is set to `true`, and the auto-pagination loop terminates immediately. This ensures we only fetch fresh content since the last sync.

---

## 3. DATA ARCHITECTURE (SQLITE)
Persistent data is stored in `gallery.db` using the **UVH (Unified Video History)** schema managed via `sqlx`.

### Table Schemas

#### 1. `posts` (Root Generations)
| Column | Type | Description |
|--------|------|-------------|
| `image_id` | TEXT (PK) | Unique Grok UUID |
| `account_id` | TEXT | Linked Grok account |
| `image_url` | TEXT | Primary media link |
| `title` | TEXT | Generation title |
| `imagine_prompt`| TEXT | Original prompt text |
| `created_at` | INTEGER | Epoch MS timestamp |

#### 2. `edited_images` (Child Variants)
- Tracks variations and in-painting results derived from a root `post_id`.

#### 3. `videos` (Generations)
| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (PK) | Video UUID |
| `post_id` | TEXT (FK) | Root reference |
| `url` | TEXT | Direct asset link |
| `duration` | INTEGER | Length in seconds |
| `is_extension` | INTEGER | 0/1 (from Video Extension) |

#### 4. `hmr` (Historical Moderation Repository)
- **Purpose**: Captures generations that triggered Grok's safety filters. 
- **Join Key**: `image_id` (links to `posts.image_id`).
- **UI Logic**: Used to render ⚠️ warnings and prompt history for failed attempts.

### UVH Tree Data Model
The frontend consumes data via `get_uvh_tree`, which returns a nested object:
```json
{
  "imageId": "UUID",
  "imaginePrompt": "...",
  "videos": [{ "id": "...", "url": "gvp://..." }],
  "editedImages": [{ "id": "...", "url": "gvp://..." }],
  "successCount": 5,
  "failCount": 2,
  "failurePrompts": [{ "id": "...", "prompt": "..." }]
}
```

---

## 4. MEDIA PROXY SYSTEM
- **Scheme**: `gvp://` -> `http://gvp.localhost/proxy`
- **Implementation**: Rust `reqwest::blocking` with injected Grok session cookies and browser headers.
- **Authentication**: Extension "smuggles" Grok cookies to the backend via WebSocket to authorize proxy requests.
