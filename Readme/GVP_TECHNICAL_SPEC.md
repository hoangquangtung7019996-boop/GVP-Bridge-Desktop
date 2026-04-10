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
| `prompt_requested` | Ext -> DT | `{ "type": "prompt_requested" }` |
| `set_prompt` | DT -> Ext | `{ "type": "set_prompt", "prompt": "..." }` |
| `url_changed` | Ext -> DT | `{ "type": "url_changed", "url": "..." }` |
| `status_update` | Ext -> DT | `{ "type": "status", "msg": "Injected!" }` |

---

## 3. DATA ARCHITECTURE (SQLITE)
Persistent data is stored in `gallery.db` using the **UVH (Unified Video History)** schema.

### Core Tables (SQLite)
1. **`posts`**: Root generations and metadata.
2. **`edited_images`**: Relationship mapping for variants.
3. **`videos`**: Generation records.
4. **`hmr`**: Historical Moderation Repository for tracking blocks.

---

## 4. MEDIA PROXY SYSTEM
- **Scheme**: `gvp://` -> `http://gvp.localhost/proxy`
- **Implementation**: Rust `reqwest::blocking` with injected Grok session cookies and browser headers.
- **Authentication**: Extension "smuggles" Grok cookies to the backend via WebSocket to authorize proxy requests.
