# /flash-implement
# PLAN_041B: Extension Gallery Fetch + Instant Teleport + Frontend Gallery

## Problem/Goal
Complete the data pipeline: Extension fetches gallery data from Grok API → sends to Desktop via WS. Replace destructive CSS cloak + DOM clicking with soft opacity + pushState teleport. Rewrite GalleryPanel to query SQLite directly via `@tauri-apps/plugin-sql`.

**PREREQUISITE:** PLAN_041A must be fully applied and `cargo check` must pass before starting this plan.

---

## Step 1: Soften CSS Cloak
**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```javascript
  function injectCSSCloak() {
    const style = document.createElement('style');
    style.id = 'gvp-ghost-cloak';
    style.textContent = `
      /* GHOST WINDOW CSS CLOAK — PLAN_040 */
      /* CRITICAL: Do NOT use pointer-events:none — breaks React event delegation */
      img, video, picture, canvas, svg:not([class*="icon"]), iframe {
        display: none !important;
      }
      * {
        animation: none !important;
        transition: none !important;
        background-image: none !important;
      }
      body {
        opacity: 0.01 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    debug('CSS cloak injected');
  }
```

**Replace With:**
```javascript
  function injectCSSCloak() {
    const style = document.createElement('style');
    style.id = 'gvp-ghost-cloak';
    style.textContent = `
      /* GHOST WINDOW CSS CLOAK — PLAN_041 (Softened) */
      /* declarativeNetRequest blocks media at network layer. */
      /* Body is near-invisible but fully interactive for TipTap + React. */
      /* NO display:none — breaks React Virtual DOM reconciliation. */
      * {
        animation: none !important;
        transition: none !important;
        background-image: none !important;
      }
      body {
        opacity: 0.01 !important;
        pointer-events: auto !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    debug('CSS cloak injected (soft — PLAN_041)');
  }
```

---

## Step 2: Replace navigateToPost with Instant Teleport
**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```javascript
  /**
   * Navigate to a post view by clicking the first gallery card.
   * CRITICAL: Do NOT search for a specific imageId — virtualized list won't have it.
   */
  async function navigateToPost(imageId) {
    if (isOnPostView()) {
      const currentId = window.location.pathname.match(URL_PATTERNS.POST_VIEW)?.[1];
      if (!imageId || currentId === imageId) {
        debug('Already on target post view');
        return true;
      }
      await returnToGallery(200);
    }

    const cardLink = document.querySelector('a[href*="/imagine/post/"]');
    if (!cardLink) {
      debug('No gallery card found to click');
      return false;
    }

    debug('Clicking first gallery card:', cardLink.getAttribute('href'));
    reactClick(cardLink, 'Gallery Card');
    await new Promise(r => setTimeout(r, 1500));
    
    const arrived = isOnPostView();
    debug('Arrived at post view:', arrived);
    return arrived;
  }
```

**Replace With:**
```javascript
  /**
   * Instant Teleport — soft-navigate to a post view using pushState + popstate.
   * NO hard reloads (preserves WS). NO DOM card clicking (virtualized list unreliable).
   * React's router listens for popstate and re-renders the post view.
   */
  async function teleportToPost(imageId) {
    if (!imageId) {
      debug('teleportToPost: no imageId provided');
      return false;
    }

    const currentId = window.location.pathname.match(URL_PATTERNS.POST_VIEW)?.[1];
    if (currentId === imageId) {
      debug('Already on target post:', imageId);
      return true;
    }

    debug('🚀 Teleporting to /imagine/post/' + imageId);
    window.history.pushState({}, '', '/imagine/post/' + imageId);
    window.dispatchEvent(new PopStateEvent('popstate'));

    // Wait for React to re-render and TipTap editor to mount
    const editor = await waitForEditor(8000);
    if (editor) {
      debug('Teleport successful — editor found');
      return true;
    }

    debug('Teleport: editor not found after timeout');
    return false;
  }
```

---

## Step 3: Update injectAndSubmitAsync to use teleportToPost
**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```javascript
  async function injectAndSubmitAsync(prompt, imageId, maxAttempts = 3) {
    debug('injectAndSubmitAsync called:', prompt?.length, 'chars, imageId:', imageId);

    const navigated = await navigateToPost(imageId);
    if (!navigated) {
      return { success: false, error: 'Failed to navigate to post view' };
    }
```

**Replace With:**
```javascript
  async function injectAndSubmitAsync(prompt, imageId, maxAttempts = 3) {
    debug('injectAndSubmitAsync called:', prompt?.length, 'chars, imageId:', imageId);

    const navigated = await teleportToPost(imageId);
    if (!navigated) {
      return { success: false, error: 'Teleport failed — no editor found for imageId: ' + (imageId || 'none') };
    }
```

---

## Step 4: Add gallery fetch proxy function + sync_gallery WS handler
**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

This inserts the gallery fetch function right before the WS CLIENT section, and adds the `sync_gallery` case to the message handler.

**Find Exact Block:**
```javascript
  // ============================================================================
  // WEBSOCKET CLIENT
  // ============================================================================
```

**Replace With:**
```javascript
  // ============================================================================
  // GALLERY FETCH PROXY (authenticated via page cookies)
  // ============================================================================

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

      if (!response.ok) {
        debug('Gallery fetch failed:', response.status);
        return { posts: [], cursor: null, error: 'HTTP ' + response.status };
      }

      const data = await response.json();

      // Extract posts from various response shapes
      const posts = data?.result?.posts || data?.posts || data?.data?.posts || [];
      const nextCursor = data?.result?.cursor || data?.cursor || null;

      debug('Gallery fetch OK:', posts.length, 'posts, nextCursor:', nextCursor ? 'yes' : 'no');
      return { posts, cursor: nextCursor, error: null };
    } catch (err) {
      debug('Gallery fetch error:', err.message);
      return { posts: [], cursor: null, error: err.message };
    }
  }

  // ============================================================================
  // WEBSOCKET CLIENT
  // ============================================================================
```

Now add the `sync_gallery` handler to the switch statement:

**Find Exact Block:**
```javascript
      case 'mode_sync':
        debug('[mode_sync] Received (ghost window ignores modes)');
        break;
```

**Replace With:**
```javascript
      case 'sync_gallery': {
        // Desktop requests gallery data. Fetch from Grok API and send back.
        const { cursor, force } = message.payload || {};
        debug('🔄 sync_gallery — cursor:', cursor ? 'yes' : 'first page', 'force:', force);
        lastAction = 'Gallery sync...';

        fetchGalleryPage(cursor || null).then(result => {
          if (result.error) {
            debug('Gallery sync error:', result.error);
            wsClient.send({
              type: 'gallery_data',
              payload: { posts: [], cursor: null, error: result.error, force: !!force },
              timestamp: Date.now()
            });
          } else {
            debug('Sending', result.posts.length, 'posts to Desktop');
            wsClient.send({
              type: 'gallery_data',
              payload: { posts: result.posts, cursor: result.cursor, force: !!force },
              timestamp: Date.now()
            });
          }
          lastAction = `Synced ${result.posts?.length || 0} posts`;
        });
        break;
      }

      case 'mode_sync':
        debug('[mode_sync] Received (ghost window ignores modes)');
        break;
```

---

## Step 5: Rewrite GalleryPanel.tsx to query SQLite
**File:** `src-desktop/components/GalleryPanel.tsx`
**Action:** MODIFY_EXISTING (full rewrite)

**Find Exact Block:**
```typescript
/**
 * GVP Bridge - Gallery Panel Component
 * Displays intercepted generations (videos/images)
 */

import { createSignal, For, Show } from 'solid-js';

export interface Generation {
    id: string;
    type: 'video' | 'image';
    url: string;
    thumbnailUrl?: string;
    prompt: string;
    status: 'success' | 'moderated' | 'processing' | 'error';
    createdAt: number;
    moderatedReason?: string;
}

export default function GalleryPanel(props: { generations: Generation[] }) {
    return (
        <div class="gallery-panel">
            <div class="gallery-header">
                <h3>Recent Generations</h3>
                <span class="gallery-count">{props.generations.length} items</span>
            </div>
            
            <Show 
                when={props.generations.length > 0} 
                fallback={<div class="gallery-empty">No generations intercepted yet. Enable "Preview Mode" to capture Grok's output here.</div>}
            >
                <div class="gallery-grid">
                    <For each={props.generations}>
                        {(gen) => (
                            <div class={`generation-card ${gen.status}`}>
                                <div class="generation-media">
                                    <Show when={gen.status === 'success'} fallback={
                                        <div class="media-placeholder">
                                            <Show when={gen.status === 'moderated'}>
                                                <span class="status-icon">⚠️</span>
                                                <span class="status-text">Moderated</span>
                                                <p class="moderated-reason">{gen.moderatedReason}</p>
                                            </Show>
                                            <Show when={gen.status === 'processing'}>
                                                <span class="status-icon">⏳</span>
                                                <span class="status-text">Processing...</span>
                                            </Show>
                                            <Show when={gen.status === 'error'}>
                                                <span class="status-icon">✗</span>
                                                <span class="status-text">Error</span>
                                            </Show>
                                        </div>
                                    }>
                                        <Show when={gen.type === 'video'} fallback={
                                            <img src={gen.url} alt={gen.prompt} loading="lazy" />
                                        }>
                                            <video src={gen.url} controls preload="metadata" />
                                        </Show>
                                    </Show>
                                </div>
                                <div class="generation-info">
                                    <p class="generation-prompt" title={gen.prompt}>{gen.prompt}</p>
                                    <div class="generation-meta">
                                        <span class="generation-type">{gen.type}</span>
                                        <span class="generation-time">
                                            {new Date(gen.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
}
```

**Replace With:**
```typescript
/**
 * GVP Bridge - Gallery Panel Component (PLAN_041)
 * Queries SQLite directly via @tauri-apps/plugin-sql.
 * Renders gallery from Tauri-owned UVH database.
 */

import { createSignal, onMount, For, Show } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';

export interface GalleryPost {
    image_id: string;
    account_id: string;
    image_url: string;
    thumbnail_url: string;
    created_at: number;
    title: string;
    moderated: number;
    json_count: number;
    original_post_id: string | null;
}

export default function GalleryPanel(props: { refreshTrigger?: number }) {
    const [posts, setPosts] = createSignal<GalleryPost[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [syncing, setSyncing] = createSignal(false);
    const [error, setError] = createSignal('');
    let db: any = null;

    async function loadGallery() {
        try {
            if (!db) {
                db = await Database.load('sqlite:gallery.db');
            }
            const rows = await db.select<GalleryPost[]>(
                'SELECT * FROM posts ORDER BY created_at DESC LIMIT 100'
            );
            setPosts(rows);
            setError('');
        } catch (err: any) {
            console.error('[GalleryPanel] DB query failed:', err);
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
            console.error('[GalleryPanel] Force sync failed:', err);
            setError(err.message || 'Sync failed');
        }
        // Syncing state cleared when gallery-updated event fires
        setTimeout(() => setSyncing(false), 10000); // Safety timeout
    }

    async function handleCardClick(post: GalleryPost) {
        try {
            // Set the imageId in backend state, then fire
            await invoke('set_prompt', { prompt: '' }); // preserve existing prompt
            await invoke('trigger_fire');
        } catch (err: any) {
            console.error('[GalleryPanel] Fire failed:', err);
        }
    }

    onMount(() => {
        loadGallery();
    });

    // Reactive: reload when refreshTrigger changes
    const _refresh = () => {
        if (props.refreshTrigger !== undefined) {
            loadGallery();
            setSyncing(false);
        }
    };
    // Trigger on prop change
    (() => { const _ = props.refreshTrigger; _refresh(); })();

    return (
        <div class="gallery-panel">
            <div class="gallery-header">
                <h3>Gallery</h3>
                <div class="gallery-actions">
                    <span class="gallery-count">{posts().length} posts</span>
                    <button
                        class="sync-btn"
                        onClick={handleForceSync}
                        disabled={syncing()}
                        title="Force full gallery sync from Grok"
                    >
                        {syncing() ? '⏳ Syncing...' : '🔄 Sync'}
                    </button>
                </div>
            </div>

            <Show when={error()}>
                <div class="gallery-error">⚠️ {error()}</div>
            </Show>

            <Show when={!loading()} fallback={<div class="gallery-loading">Loading gallery...</div>}>
                <Show
                    when={posts().length > 0}
                    fallback={<div class="gallery-empty">No gallery data yet. Connect the Ghost Window to sync.</div>}
                >
                    <div class="gallery-grid">
                        <For each={posts()}>
                            {(post) => (
                                <div
                                    class={`generation-card ${post.moderated ? 'moderated' : 'success'}`}
                                    onClick={() => handleCardClick(post)}
                                    title={post.title || post.image_id}
                                >
                                    <div class="generation-media">
                                        <Show when={post.thumbnail_url} fallback={
                                            <div class="media-placeholder">
                                                <span class="status-icon">🖼️</span>
                                            </div>
                                        }>
                                            <img
                                                src={post.thumbnail_url}
                                                alt={post.title || 'Gallery image'}
                                                loading="lazy"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                        </Show>
                                        <Show when={post.json_count > 0}>
                                            <span class="child-badge">{post.json_count}</span>
                                        </Show>
                                    </div>
                                    <div class="generation-info">
                                        <p class="generation-prompt" title={post.title}>
                                            {post.title || '(no prompt)'}
                                        </p>
                                        <div class="generation-meta">
                                            <span class="generation-time">
                                                {new Date(post.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </Show>
        </div>
    );
}
```

---

## Step 6: Update App.tsx — wire gallery-updated event + remove old Generation type
**File:** `src-desktop/App.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```typescript
import { createSignal, onMount } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import PromptInput from './components/PromptInput';
import StatusBar from './components/StatusBar';
import GalleryPanel, { Generation } from './components/GalleryPanel';

type TabId = 'prompt' | 'gallery';

export default function App() {
    const [promptSet, setPromptSet] = createSignal(false);
    const [currentPrompt, setCurrentPrompt] = createSignal('');
    const [appReady, setAppReady] = createSignal(false);
    const [generations, setGenerations] = createSignal<Generation[]>([]);
    const [activeTab, setActiveTab] = createSignal<TabId>('prompt');
```

**Replace With:**
```typescript
import { createSignal, onMount } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import PromptInput from './components/PromptInput';
import StatusBar from './components/StatusBar';
import GalleryPanel from './components/GalleryPanel';

type TabId = 'prompt' | 'gallery';

export default function App() {
    const [promptSet, setPromptSet] = createSignal(false);
    const [currentPrompt, setCurrentPrompt] = createSignal('');
    const [appReady, setAppReady] = createSignal(false);
    const [galleryRefresh, setGalleryRefresh] = createSignal(0);
    const [activeTab, setActiveTab] = createSignal<TabId>('prompt');
```

Now wire the gallery-updated event:

**Find Exact Block:**
```typescript
            // Listen for fire results (Ghost Window)
            await listen<any>('fire-result', (event) => {
                console.log('[GVP Desktop] 🚀 Fire result:', event.payload);
            });
```

**Replace With:**
```typescript
            // Listen for fire results (Ghost Window)
            await listen<any>('fire-result', (event) => {
                console.log('[GVP Desktop] 🚀 Fire result:', event.payload);
            });

            // PLAN_041: Listen for gallery sync updates
            await listen<any>('gallery-updated', (event) => {
                console.log('[GVP Desktop] 📥 Gallery updated:', event.payload);
                setGalleryRefresh(prev => prev + 1);
            });
```

Remove the old handleGenerationResult function and its listener:

**Find Exact Block:**
```typescript
            // Listen for generation results from backend
            await listen<any>('generation-result', (event) => {
                console.log('[GVP Desktop] Received generation result event:', event);
                handleGenerationResult(event.payload);
            });
```

**Replace With:**
```typescript
            // Listen for generation results from backend (passive interceptor)
            await listen<any>('generation-result', (event) => {
                console.log('[GVP Desktop] Received generation result:', event.payload);
            });
```

Replace the Gallery tab rendering and badge:

**Find Exact Block:**
```typescript
                    {generations().length > 0 && (
                        <span class="tab-badge">{generations().length}</span>
                    )}
```

**Replace With:**
```typescript
                    {galleryRefresh() > 0 && (
                        <span class="tab-badge">●</span>
                    )}
```

Replace the gallery section:

**Find Exact Block:**
```typescript
                        {/* Gallery Tab */}
                        {activeTab() === 'gallery' && (
                            <section class="gallery-section-full">
                                <GalleryPanel generations={generations()} />
                            </section>
                        )}
```

**Replace With:**
```typescript
                        {/* Gallery Tab */}
                        {activeTab() === 'gallery' && (
                            <section class="gallery-section-full">
                                <GalleryPanel refreshTrigger={galleryRefresh()} />
                            </section>
                        )}
```

---

## VERIFICATION
After all steps:

1. **Rust build check:**
```powershell
cd "a:\Tools n Programs\GVP-Desktop\src-tauri"
cargo check
```
Must pass with zero errors.

2. **Frontend build check:**
```powershell
cd "a:\Tools n Programs\GVP-Desktop"
npx vite build
```
Must pass with zero errors.

3. **Live test (if both pass):**
```powershell
cd "a:\Tools n Programs\GVP-Desktop"
npm run tauri dev
```
- Open Chrome with the extension on `grok.com/imagine`
- Check Desktop console for: `📥 Gallery batch: N posts`
- Switch to Gallery tab — should show post thumbnails
- Check `gallery.db` exists in `%APPDATA%/com.gvp.bridge/`
