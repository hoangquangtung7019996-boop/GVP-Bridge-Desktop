

**[COPY START]**
`/flash-implement`

**Context:** The user wants to overhaul `GalleryPanel.tsx` into a 3-pane "Workspace" layout based on their wireframes. 
- Left Pane: Scrollable list of edited images. (CRITICAL RULE: The `img src` for edited images MUST strictly use `edit.url`, never `edit.thumbnailUrl`, due to legacy data inconsistencies). The Root image is always the first item in this list.
- Center Pane: The active media. Auto-loops `<video>` or displays `<img />`. Has a bottom drawer for the prompt, future copy buttons, and HMR moderation warnings.
- Right Pane: Scrollable list of video thumbnails (uses `vid.thumbnailUrl || vid.url`).
- Top Header: Navigation buttons to move to Previous/Next Root families.

**Task:** Rewrite `src-desktop/components/GalleryPanel.tsx` to implement this layout.

**Action:** REPLACE_ENTIRE_FILE
**File:** `src-desktop/components/GalleryPanel.tsx`

```tsx
/**
 * GVP Bridge - Detailed Gallery Panel Component
 * Implements 3-Pane UVH Detail View Workspace
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

type ActiveMedia = {
    type: 'image' | 'video';
    url: string;
    prompt: string;
    id: string;
};

export default function GalleryPanel(props: { refreshTrigger?: number }) {
    const [posts, setPosts] = createSignal<UVHNode[]>([]);
    const [loading, setLoading] = createSignal(true);
    const[syncing, setSyncing] = createSignal(false);
    const [error, setError] = createSignal('');
    
    // Tracks the active UVH Family (The Root)
    const [selectedNode, setSelectedNode] = createSignal<UVHNode | null>(null);
    // Tracks what is currently displayed in the Center Stage
    const[activeMedia, setActiveMedia] = createSignal<ActiveMedia | null>(null);

    async function loadGallery() {
        try {
            const rows = await invoke<UVHNode[]>('get_uvh_tree', { limit: 100, offset: 0 });
            setPosts(rows);
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
        setTimeout(() => setSyncing(false), 10000);
    }

    // Opens a family and sets the Root image as the active media
    function handleCardClick(post: UVHNode) {
        setSelectedNode(post);
        setActiveMedia({
            type: 'image',
            url: post.imageUrl,
            prompt: post.imaginePrompt || post.title || '(no prompt)',
            id: post.imageId
        });
    }

    // Navigation logic
    const currentIndex = () => posts().findIndex(p => p.imageId === selectedNode()?.imageId);
    const hasPrev = () => currentIndex() > 0;
    const hasNext = () => currentIndex() >= 0 && currentIndex() < posts().length - 1;

    function goPrevRoot() {
        if (hasPrev()) handleCardClick(posts()[currentIndex() - 1]);
    }
    function goNextRoot() {
        if (hasNext()) handleCardClick(posts()[currentIndex() + 1]);
    }

    onMount(() => {
        loadGallery();
        const unlisten = listen('db-updated', () => {
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
        <div class="gallery-panel uvh-panel" style={{ display: "flex", "flex-direction": "column", height: "100vh", overflow: "hidden" }}>
            
            {/* TOP HEADER */}
            <div class="gallery-header" style={{ flex: "0 0 auto" }}>
                <h3>{selectedNode() ? `Workspace: ${selectedNode()?.imageId.split('-')[0]}` : 'Gallery'}</h3>
                
                {/* Dynamic Navigation Toolbar based on view */}
                <div class="gallery-actions">
                    <Show when={selectedNode()}>
                        <div style={{ display: "flex", gap: "10px", background: "rgba(0,0,0,0.3)", padding: "5px", "border-radius": "6px" }}>
                            <button class="back-btn" onClick={goPrevRoot} disabled={!hasPrev()}>◀ Prev RootImg</button>
                            <button class="back-btn" onClick={() => setSelectedNode(null)}>Back to Gallery</button>
                            <button class="back-btn" onClick={goNextRoot} disabled={!hasNext()}>Next RootImg ▶</button>
                        </div>
                    </Show>

                    <Show when={!selectedNode()}>
                        <span class="gallery-count">{posts().length} roots</span>
                        <button class="sync-btn" onClick={handleForceSync} disabled={syncing()}>
                            {syncing() ? '⏳ Syncing...' : '🔄 Sync'}
                        </button>
                    </Show>
                </div>
            </div>

            <Show when={error()}>
                <div class="gallery-error" style={{ flex: "0 0 auto" }}>⚠️ {error()}</div>
            </Show>

            <Show when={!loading()} fallback={<div class="gallery-loading">Loading UVH Tree...</div>}>
                
                {/* --- GRID VIEW --- */}
                <Show when={!selectedNode()}>
                   <Show when={posts().length > 0} fallback={<div class="gallery-empty">No gallery data yet.</div>}>
                       <div class="gallery-grid" style={{ "overflow-y": "auto", flex: 1, padding: "10px" }}>
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

                {/* --- 3-PANE DETAIL VIEW WORKSPACE --- */}
                <Show when={selectedNode()}>
                    <div class="uvh-workspace-container" style={{ display: "flex", flex: 1, "min-height": 0, padding: "10px", gap: "10px", background: "#0a0a0a" }}>
                        
                        {/* LEFT PANE: Edited Images List */}
                        <div class="uvh-sidebar left" style={{ width: "160px", "overflow-y": "auto", display: "flex", "flex-direction": "column", gap: "10px" }}>
                            <h5 style={{ margin: "0 0 5px 0", color: "#888", "font-size": "0.8rem", "text-transform": "uppercase" }}>Edits</h5>
                            
                            {/* Root Image (Always First) */}
                            <div 
                                style={{ cursor: "pointer", border: activeMedia()?.id === selectedNode()!.imageId ? "2px solid #fff" : "2px solid transparent", "border-radius": "6px", overflow: "hidden", position: "relative" }}
                                onClick={() => setActiveMedia({ type: 'image', url: selectedNode()!.imageUrl, prompt: selectedNode()!.imaginePrompt || "Root Image", id: selectedNode()!.imageId })}
                            >
                                <img src={selectedNode()!.thumbnailUrl || selectedNode()!.imageUrl} style={{ width: "100%", display: "block" }} title="Root Image" />
                                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.7)", color: "white", "font-size": "0.7rem", padding: "2px", "text-align": "center" }}>Root</div>
                            </div>

                            {/* Edited Children */}
                            <For each={selectedNode()!.editedImages}>
                                {(edit) => (
                                    <div 
                                        style={{ cursor: "pointer", border: activeMedia()?.id === edit.id ? "2px solid #fff" : "2px solid transparent", "border-radius": "6px", overflow: "hidden" }}
                                        onClick={() => setActiveMedia({ type: 'image', url: edit.url, prompt: edit.prompt, id: edit.id })}
                                    >
                                        {/* CRITICAL: ONLY using edit.url, ignoring legacy thumbnails */}
                                        <img src={edit.url} style={{ width: "100%", display: "block", background: "#222" }} title={edit.prompt} />
                                    </div>
                                )}
                            </For>
                        </div>

                        {/* CENTER PANE: Main Viewing Pane */}
                        <div class="uvh-main-stage" style={{ flex: 1, display: "flex", "flex-direction": "column", background: "#111", "border-radius": "8px", overflow: "hidden", position: "relative" }}>
                            
                            {/* Media Display Area */}
                            <div style={{ flex: 1, display: "flex", "justify-content": "center", "align-items": "center", overflow: "hidden", padding: "10px" }}>
                                <Show when={activeMedia()?.type === 'video'}>
                                    <video src={activeMedia()!.url} autoplay loop controls style={{ "max-width": "100%", "max-height": "100%", "object-fit": "contain", "border-radius": "8px" }} />
                                </Show>
                                <Show when={activeMedia()?.type === 'image'}>
                                    <img src={activeMedia()!.url} style={{ "max-width": "100%", "max-height": "100%", "object-fit": "contain", "border-radius": "8px" }} />
                                </Show>
                            </div>

                            {/* Bottom Drawer (Prompt & Future Controls) */}
                            <div style={{ background: "#1a1a1a", "border-top": "1px solid #333", padding: "15px", "flex-shrink": 0 }}>
                                <p style={{ margin: "0 0 10px 0", "font-size": "0.95rem", color: "#eee", "max-height": "80px", "overflow-y": "auto" }}>
                                    {activeMedia()?.prompt || "No prompt available"}
                                </p>
                                
                                <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "font-size": "0.8rem" }}>
                                    <div style={{ display: "flex", gap: "10px" }}>
                                        <button style={{ background: "#333", color: "white", border: "none", padding: "6px 12px", "border-radius": "4px", cursor: "not-allowed", opacity: 0.5 }} title="Coming soon">Copy Prompt</button>
                                        <button style={{ background: "#333", color: "white", border: "none", padding: "6px 12px", "border-radius": "4px", cursor: "not-allowed", opacity: 0.5 }} title="Coming soon">Send to Text Area</button>
                                        <a href={activeMedia()?.url} target="_blank" rel="noopener noreferrer" style={{ background: "#0ea5e9", color: "white", "text-decoration": "none", padding: "6px 12px", "border-radius": "4px" }}>Open Original</a>
                                    </div>

                                    {/* Moderation Warnings (HMR access point) */}
                                    <Show when={selectedNode()!.failurePrompts.length > 0}>
                                        <div style={{ color: "#ff4444", display: "flex", "align-items": "center", gap: "5px", cursor: "pointer", background: "rgba(255,0,0,0.1)", padding: "4px 8px", "border-radius": "4px" }} title={selectedNode()!.failurePrompts.map(f => f.prompt).join('\n\n')}>
                                            ⚠️ {selectedNode()!.failCount} Moderated Attempts
                                        </div>
                                    </Show>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT PANE: Videos List */}
                        <div class="uvh-sidebar right" style={{ width: "160px", "overflow-y": "auto", display: "flex", "flex-direction": "column", gap: "10px" }}>
                            <h5 style={{ margin: "0 0 5px 0", color: "#888", "font-size": "0.8rem", "text-transform": "uppercase" }}>Videos</h5>
                            
                            <Show when={selectedNode()!.videos.length === 0}>
                                <div style={{ color: "#555", "font-size": "0.8rem", "text-align": "center", "margin-top": "20px" }}>No videos</div>
                            </Show>

                            <For each={selectedNode()!.videos}>
                                {(vid) => (
                                    <div 
                                        style={{ position: "relative", cursor: "pointer", border: activeMedia()?.id === vid.id ? "2px solid #fff" : "2px solid transparent", "border-radius": "6px", overflow: "hidden" }}
                                        onClick={() => setActiveMedia({ type: 'video', url: vid.url, prompt: vid.prompt, id: vid.id })}
                                    >
                                        <img src={vid.thumbnailUrl || vid.url} style={{ width: "100%", display: "block", opacity: 0.7, background: "#222" }} title={vid.prompt} />
                                        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", "font-size": "2rem", "text-shadow": "0 2px 6px rgba(0,0,0,1)" }}>▶️</div>
                                        <Show when={vid.extension === "true"}>
                                            <span style={{ position: "absolute", top: "5px", right: "5px", background: "red", color: "white", "font-size": "0.6rem", padding: "2px 4px", "border-radius": "3px", "font-weight": "bold" }}>EXT</span>
                                        </Show>
                                    </div>
                                )}
                            </For>
                        </div>

                    </div>
                </Show>
            </Show>
        </div>
    );
}
```
