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
    
    const [selectedNode, setSelectedNode] = createSignal<UVHNode | null>(null);
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
            setError(err.message || 'Failed to load gallery');
        } finally {
            setLoading(false);
        }
    }

    async function handleForceSync() {
        setSyncing(true);
        try { await invoke('force_gallery_sync'); } catch (err: any) { setError(err.message); }
        setTimeout(() => setSyncing(false), 10000);
    }

    function handleCardClick(post: UVHNode) {
        setSelectedNode(post);
        setActiveMedia({ type: 'image', url: post.imageUrl, prompt: post.imaginePrompt || post.title || '(no prompt)', id: post.imageId });
    }

    const currentIndex = () => posts().findIndex(p => p.imageId === selectedNode()?.imageId);
    const hasPrev = () => currentIndex() > 0;
    const hasNext = () => currentIndex() >= 0 && currentIndex() < posts().length - 1;

    function goPrevRoot() { if (hasPrev()) handleCardClick(posts()[currentIndex() - 1]); }
    function goNextRoot() { if (hasNext()) handleCardClick(posts()[currentIndex() + 1]); }

    onMount(() => {
        loadGallery();
        const unlisten = listen('db-updated', () => loadGallery());
        onCleanup(async () => (await unlisten)());
    });

    const _refresh = () => { if (props.refreshTrigger !== undefined) { loadGallery(); setSyncing(false); } };
    (() => { const _ = props.refreshTrigger; _refresh(); })();

    return (
        <div class="gallery-panel uvh-panel" style={{ display: "flex", "flex-direction": "column", height: "100vh", overflow: "hidden" }}>
            
            {/* TOP HEADER */}
            <div class="gallery-header" style={{ flex: "0 0 auto", display: "flex", "align-items": "center", "justify-content": "space-between", padding: "10px 20px", background: "#1a1a1a", "border-bottom": "1px solid #333" }}>
                
                {/* Left: Branding & Active ID */}
                <div style={{ display: "flex", "flex-direction": "column", "min-width": "200px" }}>
                    <h2 style={{ margin: 0, "font-size": "1.2rem", color: "#fff", "line-height": 1 }}>GVP Desktop</h2>
                    <span style={{ "font-size": "0.7rem", color: "#888", "margin-top": "4px" }}>v0.1.0</span>
                    <Show when={activeMedia()}>
                        <span style={{ "font-size": "0.8rem", color: "#0ea5e9", "margin-top": "6px", "font-family": "monospace" }}>ID: {activeMedia()?.id.split('-')[0]}</span>
                    </Show>
                </div>

                {/* Center: Navigation & Open Original */}
                <div style={{ display: "flex", gap: "15px", "align-items": "center", flex: 1, "justify-content": "center" }}>
                    <Show when={selectedNode()}>
                        <div style={{ display: "flex", gap: "5px", background: "rgba(0,0,0,0.3)", padding: "4px", "border-radius": "6px" }}>
                            <button class="back-btn" onClick={goPrevRoot} disabled={!hasPrev()} style={{ padding: "6px 12px" }}>◀ Prev Root</button>
                            <button class="back-btn" onClick={() => setSelectedNode(null)} style={{ padding: "6px 12px", background: "#333" }}>Grid</button>
                            <button class="back-btn" onClick={goNextRoot} disabled={!hasNext()} style={{ padding: "6px 12px" }}>Next Root ▶</button>
                        </div>
                        
                        <Show when={activeMedia()}>
                            <a href={activeMedia()?.url} target="_blank" rel="noopener noreferrer" style={{ background: "#0ea5e9", color: "white", "text-decoration": "none", padding: "6px 16px", "border-radius": "4px", "font-weight": "bold", "font-size": "0.85rem", transition: "0.2s" }}>Open Original</a>
                        </Show>
                    </Show>
                </div>

                {/* Right: Sync Status */}
                <div style={{ "min-width": "200px", "text-align": "right" }}>
                    <Show when={!selectedNode()}>
                        <span class="gallery-count" style={{ "margin-right": "15px" }}>{posts().length} roots</span>
                        <button class="sync-btn" onClick={handleForceSync} disabled={syncing()}>
                            {syncing() ? '⏳ Syncing...' : '🔄 Sync'}
                        </button>
                    </Show>
                </div>
            </div>

            <Show when={error()}>
                <div class="gallery-error" style={{ flex: "0 0 auto", padding: "10px", background: "#ff4444", color: "white" }}>⚠️ {error()}</div>
            </Show>

            <Show when={!loading()} fallback={<div class="gallery-loading" style={{ padding: "20px" }}>Loading UVH Tree...</div>}>
                
                {/* --- GRID VIEW --- */}
                <Show when={!selectedNode()}>
                   <Show when={posts().length > 0} fallback={<div class="gallery-empty" style={{ padding: "20px" }}>No gallery data yet.</div>}>
                       <div class="gallery-grid" style={{ "overflow-y": "auto", flex: 1, padding: "15px" }}>
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
                        <div class="uvh-sidebar left" style={{ width: "140px", "overflow-y": "auto", display: "flex", "flex-direction": "column", gap: "10px", "padding-right": "5px" }}>
                            <h5 style={{ margin: "0 0 5px 0", color: "#888", "font-size": "0.75rem", "text-transform": "uppercase", "letter-spacing": "1px" }}>Edits</h5>
                            
                            {/* Root Image (Always First) */}
                            <div 
                                style={{ cursor: "pointer", border: activeMedia()?.id === selectedNode()!.imageId ? "2px solid #0ea5e9" : "2px solid transparent", "border-radius": "8px", overflow: "hidden", position: "relative", transition: "0.2s" }}
                                onClick={() => setActiveMedia({ type: 'image', url: selectedNode()!.imageUrl, prompt: selectedNode()!.imaginePrompt || "Root Image", id: selectedNode()!.imageId })}
                            >
                                <img src={selectedNode()!.thumbnailUrl || selectedNode()!.imageUrl} style={{ width: "100%", "aspect-ratio": "1/1", "object-fit": "cover", display: "block" }} title="Root Image" />
                                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.8)", color: "white", "font-size": "0.7rem", padding: "4px", "text-align": "center", "font-weight": "bold" }}>ROOT</div>
                            </div>

                            {/* Edited Children */}
                            <For each={selectedNode()!.editedImages}>
                                {(edit) => (
                                    <div 
                                        style={{ cursor: "pointer", border: activeMedia()?.id === edit.id ? "2px solid #0ea5e9" : "2px solid transparent", "border-radius": "8px", overflow: "hidden", transition: "0.2s" }}
                                        onClick={() => setActiveMedia({ type: 'image', url: edit.url, prompt: edit.prompt, id: edit.id })}
                                    >
                                        <img src={edit.url} style={{ width: "100%", "aspect-ratio": "1/1", "object-fit": "cover", display: "block", background: "#222" }} title={edit.prompt} />
                                    </div>
                                )}
                            </For>
                        </div>

                        {/* CENTER PANE: Main Viewing Pane */}
                        <div class="uvh-main-stage" style={{ flex: 1, display: "flex", "flex-direction": "column", background: "#111", "border-radius": "10px", overflow: "hidden", position: "relative", "box-shadow": "0 4px 20px rgba(0,0,0,0.5)" }}>
                            
                            {/* Media Display Area */}
                            <div style={{ flex: 1, display: "flex", "justify-content": "center", "align-items": "center", overflow: "hidden", padding: "15px", position: "relative" }}>
                                <Show when={activeMedia()?.type === 'video'}>
                                    <video src={activeMedia()!.url} autoplay loop controls style={{ "max-width": "100%", "max-height": "100%", "object-fit": "contain", "border-radius": "6px", "box-shadow": "0 0 20px rgba(0,0,0,0.8)" }} />
                                </Show>
                                <Show when={activeMedia()?.type === 'image'}>
                                    <img src={activeMedia()!.url} style={{ "max-width": "100%", "max-height": "100%", "object-fit": "contain", "border-radius": "6px", "box-shadow": "0 0 20px rgba(0,0,0,0.8)" }} />
                                </Show>
                            </div>

                            {/* Bottom Drawer (Prompt & Future Controls) */}
                            <div style={{ background: "#18181b", "border-top": "1px solid #27272a", padding: "15px", "flex-shrink": 0 }}>
                                <p style={{ margin: "0 0 12px 0", "font-size": "0.95rem", color: "#e4e4e7", "max-height": "80px", "overflow-y": "auto", "line-height": 1.5 }}>
                                    {activeMedia()?.prompt || "No prompt available"}
                                </p>
                                
                                <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "font-size": "0.85rem" }}>
                                    <div style={{ display: "flex", gap: "10px" }}>
                                        <button style={{ background: "#3f3f46", color: "white", border: "1px solid #52525b", padding: "6px 14px", "border-radius": "6px", cursor: "not-allowed", opacity: 0.5, "font-weight": 500 }} title="Coming soon">Copy Prompt</button>
                                        <button style={{ background: "#3f3f46", color: "white", border: "1px solid #52525b", padding: "6px 14px", "border-radius": "6px", cursor: "not-allowed", opacity: 0.5, "font-weight": 500 }} title="Coming soon">Send to Text Area</button>
                                    </div>

                                    {/* Moderation Warnings (HMR access point) */}
                                    <Show when={selectedNode()!.failurePrompts.length > 0}>
                                        <div style={{ color: "#ef4444", display: "flex", "align-items": "center", gap: "6px", cursor: "pointer", background: "rgba(239,68,68,0.1)", padding: "6px 12px", "border-radius": "6px", "font-weight": "bold", border: "1px solid rgba(239,68,68,0.3)" }} title={selectedNode()!.failurePrompts.map(f => f.prompt).join('\n\n')}>
                                            ⚠️ {selectedNode()!.failCount} Moderated Attempts
                                        </div>
                                    </Show>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT PANE: Videos List */}
                        <div class="uvh-sidebar right" style={{ width: "140px", "overflow-y": "auto", display: "flex", "flex-direction": "column", gap: "10px", "padding-left": "5px" }}>
                            <h5 style={{ margin: "0 0 5px 0", color: "#888", "font-size": "0.75rem", "text-transform": "uppercase", "letter-spacing": "1px", "text-align": "right" }}>Videos</h5>
                            
                            <Show when={selectedNode()!.videos.length === 0}>
                                <div style={{ color: "#555", "font-size": "0.8rem", "text-align": "center", "margin-top": "20px" }}>No videos</div>
                            </Show>

                            <For each={selectedNode()!.videos}>
                                {(vid) => (
                                    <div 
                                        style={{ position: "relative", cursor: "pointer", border: activeMedia()?.id === vid.id ? "2px solid #0ea5e9" : "2px solid transparent", "border-radius": "8px", overflow: "hidden", transition: "0.2s" }}
                                        onClick={() => setActiveMedia({ type: 'video', url: vid.url, prompt: vid.prompt, id: vid.id })}
                                    >
                                        {/* Fallback to vid.url if preview image is totally missing, forced into square */}
                                        <img src={vid.thumbnailUrl || vid.url} style={{ width: "100%", "aspect-ratio": "1/1", "object-fit": "cover", display: "block", opacity: 0.6, background: "#222" }} title={vid.prompt} />
                                        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", "font-size": "2rem", "text-shadow": "0 2px 8px rgba(0,0,0,1)" }}>▶️</div>
                                        <Show when={vid.extension === "true"}>
                                            <span style={{ position: "absolute", top: "4px", right: "4px", background: "#ef4444", color: "white", "font-size": "0.6rem", padding: "2px 5px", "border-radius": "4px", "font-weight": "bold", "box-shadow": "0 2px 4px rgba(0,0,0,0.5)" }}>EXT</span>
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
