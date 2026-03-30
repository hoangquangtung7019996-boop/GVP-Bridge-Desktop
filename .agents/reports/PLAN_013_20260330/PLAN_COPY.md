# PLAN_013: Complete Desktop App Fix + Preview Mode Statsig

## Overview

Three main issues to fix:
1. **Window config** - Wrong size, always on top
2. **UI/UX** - No tabs, connection/activity not working
3. **Preview Mode** - Missing x-statsig-id causes anti-bot trigger

---

## PART 1: Tauri Window Config

**File**: `src-tauri/tauri.conf.json`

**Current**:
```json
"windows": [
  {
    "title": "GVP Bridge",
    "width": 400,
    "height": 300,
    "resizable": true,
    "alwaysOnTop": true
  }
]
```

**Change to**:
```json
"windows": [
  {
    "title": "GVP Bridge",
    "width": 500,
    "height": 650,
    "minWidth": 400,
    "minHeight": 500,
    "resizable": true,
    "alwaysOnTop": false,
    "center": true
  }
]
```

Changes:
- `width: 400 → 500`
- `height: 300 → 650`
- Add `minWidth: 400`
- Add `minHeight: 500`
- `alwaysOnTop: true → false`
- Add `center: true`

---

## PART 2: Tab System

**File**: `src-desktop/App.tsx`

Add tab navigation between Prompt and Gallery views.

### 2.1 Add Tab Type and State

After the imports, add:
```tsx
type TabId = 'prompt' | 'gallery';
```

In the component, add state:
```tsx
const [activeTab, setActiveTab] = createSignal<TabId>('prompt');
```

### 2.2 Add Tab Navigation

After `</header>` and before `<main>`, add:
```tsx
{/* Tab Navigation */}
<nav class="tab-nav">
  <button
    class={`tab-btn ${activeTab() === 'prompt' ? 'active' : ''}`}
    onClick={() => setActiveTab('prompt')}
  >
    <span class="tab-icon">✏️</span>
    <span class="tab-label">Prompt</span>
  </button>
  <button
    class={`tab-btn ${activeTab() === 'gallery' ? 'active' : ''}`}
    onClick={() => setActiveTab('gallery')}
  >
    <span class="tab-icon">🖼️</span>
    <span class="tab-label">Gallery</span>
    {generations().length > 0 && (
      <span class="tab-badge">{generations().length}</span>
    )}
  </button>
</nav>
```

### 2.3 Conditional Content Rendering

Replace the current content inside `<main>` with tab-conditional rendering:

```tsx
<main class="app-main">
  {!appReady() ? (
    <div class="loading">
      <span class="loading-text">Loading...</span>
    </div>
  ) : (
    <>
      {/* Prompt Tab */}
      {activeTab() === 'prompt' && (
        <>
          <section class="prompt-section">
            <PromptInput onPromptSet={handlePromptSet} />
          </section>
          <section class="status-section">
            <StatusBar initialStatus={promptSet() ? 'Prompt ready' : 'Ready'} />
          </section>
        </>
      )}

      {/* Gallery Tab */}
      {activeTab() === 'gallery' && (
        <section class="gallery-section-full">
          <GalleryPanel generations={generations()} />
        </section>
      )}
    </>
  )}
</main>
```

---

## PART 3: Tab Styles

**File**: `src-desktop/styles.css`

Add after `.generation-time` styles:

```css
/* ============================================================================
   TAB NAVIGATION
   ============================================================================ */

.tab-nav {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tab-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.tab-icon {
  font-size: 14px;
}

.tab-label {
  font-family: inherit;
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: var(--accent);
  color: white;
  font-size: 10px;
  font-weight: 600;
  border-radius: 9px;
}

/* Gallery Section Full (for tab view) */
.gallery-section-full {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.gallery-section-full .gallery-panel {
  flex: 1;
  margin-top: 0;
  max-height: none;
}
```

---

## PART 4: Fix Connection Indicator

**File**: `src-desktop/components/StatusBar.tsx`

The connection indicator doesn't update because it only uses initial props.

### 4.1 Add Event Listener for WS Connection

Add import for listen:
```tsx
import { listen } from '@tauri-apps/api/event';
```

Add state for connection:
```tsx
const [connected, setConnected] = createSignal(false);
```

In onMount, listen for connection events:
```tsx
onMount(async () => {
  // Listen for WebSocket connection status changes
  await listen<string>('ws-connection', (event) => {
    const status = event.payload;
    setConnected(status.startsWith('Connected'));
  });
});
```

### 4.2 Update JSX to Use State

Change:
```tsx
<span class={`status-dot ${connected ? 'connected' : 'disconnected'}`}>
```

To:
```tsx
<span class={`status-dot ${connected() ? 'connected' : 'disconnected'}`}>
```

And:
```tsx
<span class="connection-text">{connected ? 'Connected' : 'Disconnected'}</span>
```

To:
```tsx
<span class="connection-text">{connected() ? 'Connected' : 'Disconnected'}</span>
```

---

## PART 5: Fix Recent Activity

**File**: `src-desktop/components/StatusBar.tsx`

### 5.1 Add Activity State

```tsx
const [activityLog, setActivityLog] = createSignal<string[]>([]);
```

### 5.2 Listen for Activity Events

In onMount, add:
```tsx
await listen<{message: string}>('status-update', (event) => {
  const msg = event.payload.message;
  setActivityLog(prev => [msg, ...prev].slice(0, 10));
});

await listen<string>('prompt-sent', (event) => {
  const imageId = event.payload;
  setActivityLog(prev => [`Prompt sent to: ${imageId.substring(0, 8)}...`, ...prev].slice(0, 10)]);
});
```

### 5.3 Render Activity Log

In the history-list section, replace the empty state with:
```tsx
<div class="history-list">
  <Show 
    when={activityLog().length > 0}
    fallback={<div class="history-empty">No activity yet</div>}
  >
    <For each={activityLog()}>
      {(item, index) => (
        <div class="history-item" data-index={index()}>
          {item}
        </div>
      )}
    </For>
  </Show>
</div>
```

---

## PART 6: Preview Mode Statsig Capture

**File**: `src-extension/content.bundle.js`

### 6.1 Add Global Statsig Cache

After `let interceptGenerations = false;`, add:
```javascript
let cachedStatsigId = null;  // Captured statsig-id for Preview Mode
```

### 6.2 Add Statsig Extraction Helper

Add this function after the variable declarations:
```javascript
/**
 * Extract x-statsig-id from fetch headers (any format)
 */
function extractStatsigId(headers) {
  if (!headers) return null;
  
  if (headers instanceof Headers) {
    return headers.get('x-statsig-id');
  } else if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k.toLowerCase() === 'x-statsig-id');
    return found ? found[1] : null;
  } else if (typeof headers === 'object') {
    return headers['x-statsig-id'] || 
           headers['x-statsig-id'.toLowerCase()] ||
           headers['X-Statsig-Id'] ||
           headers['X-STATSIG-ID'];
  }
  return null;
}
```

### 6.3 Capture Statsig in proxyFetch

In the `proxyFetch` function, BEFORE calling `originalFetch`, add capture logic:

```javascript
function proxyFetch() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].href : (args[0] && args[0].url));
    const options = args[1];
    
    // CAPTURE STATSIG-ID from outgoing requests on Grok domain
    if (url && url.includes('grok.com')) {
      const statsigId = extractStatsigId(options?.headers);
      if (statsigId) {
        cachedStatsigId = statsigId;
        debug('Captured statsig-id:', statsigId.substring(0, 30) + '...');
      }
    }
    
    const response = await originalFetch.apply(this, args);
    
    // ... existing interception code ...
    
    return response;
  };
  debug('Fetch proxy installed (with statsig capture)');
}
```

### 6.4 Use Captured Statsig in Direct API Call

In `sendDirectGenerationRequest`, add statsig-id to headers:

Find the headers object and ADD this line:
```javascript
'x-statsig-id': cachedStatsigId || ''  // CRITICAL: Reuse captured statsig-id
```

Also add debug logging:
```javascript
debug('[sendDirectGenerationRequest] Using statsig-id:', cachedStatsigId ? 'YES (captured)' : 'NO (missing!)');
```

---

## Summary of Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/tauri.conf.json` | Window size, alwaysOnTop, min size |
| `src-desktop/App.tsx` | Tab navigation system |
| `src-desktop/styles.css` | Tab styles, gallery-full section |
| `src-desktop/components/StatusBar.tsx` | Connection + activity event listeners |
| `src-extension/content.bundle.js` | Statsig capture + reuse in Preview Mode |

---

## Testing

1. Rebuild Tauri app - window should open 500x650, centered, not always-on-top
2. Click tabs - should switch between Prompt and Gallery views
3. Gallery tab should show badge with count when generations exist
4. Open Grok, click around - statsig-id should be captured (check console logs)
5. Enable Preview Mode, click a gallery card - should see "Using statsig-id: YES (captured)" in console
6. Connection indicator should show green when extension connects
7. Recent Activity should show logged actions
