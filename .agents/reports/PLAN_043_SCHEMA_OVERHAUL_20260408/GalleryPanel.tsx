/**
 * GVP Bridge - Detailed Gallery Panel Component (PLAN_043)
 * Maps strictly to the UVH / HMR Schema via get_uvh_tree
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

export default function GalleryPanel(props: { refreshTrigger?: number }) {
    const [posts, setPosts] = createSignal<UVHNode[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [syncing, setSyncing] = createSignal(false);
    const [error, setError] = createSignal('');
    const [selectedNode, setSelectedNode] = createSignal<UVHNode | null>(null);

    async function loadGallery() {
        try {
            const rows = await invoke<UVHNode[]>('get_uvh_tree', { limit: 100, offset: 0 });
            setPosts(rows);
            // Refresh detailed node if active
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
        setTimeout(() => setSyncing(false), 10000); // Safety timeout
    }

    async function handleCardClick(post: UVHNode) {
        setSelectedNode(post);
    }

    onMount(() => {
        loadGallery();
        const unlisten = listen('db-updated', () => {
            console.log("DB Updated event received, refreshing UVH tree...");
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
        <div class="gallery-panel uvh-panel">
            <div class="gallery-header">
                <h3>{selectedNode() ? `Detailed View: ${selectedNode()?.imageId.split('-')[0]}` : 'Gallery'}</h3>
                <div class="gallery-actions">
                    <span class="gallery-count">{posts().length} roots</span>
                    <Show when={selectedNode()}>
                        <button class="back-btn" onClick={() => setSelectedNode(null)}>
                            Back to Grid
                        </button>
                    </Show>
                    <button class="sync-btn" onClick={handleForceSync} disabled={syncing()}>
                        {syncing() ? '⏳ Syncing...' : '🔄 Sync'}
                    </button>
                </div>
            </div>

            <Show when={error()}>
                <div class="gallery-error">⚠️ {error()}</div>
            </Show>

            <Show when={!loading()} fallback={<div class="gallery-loading">Loading UVH Tree...</div>}>
                <Show when={!selectedNode()}>
                   <Show when={posts().length > 0} fallback={<div class="gallery-empty">No gallery data yet.</div>}>
                       <div class="gallery-grid">
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

                <Show when={selectedNode()}>
                    {/* Detail Split View */}
                    <div class="uvh-detail-view">
                        <section class="uvh-root-section">
                            <img src={selectedNode()!.imageUrl} alt="Root" class="uvh-root-img" />
                            <p class="uvh-large-prompt">{selectedNode()!.imaginePrompt || "Root Image"}</p>
                        </section>
                        
                        <div class="uvh-children-split">
                            <section class="uvh-split-pane">
                                <h4>Edited Images ({selectedNode()!.editedImages.length})</h4>
                                <div class="uvh-list">
                                    <For each={selectedNode()!.editedImages}>
                                        {(edit) => (
                                            <div class="uvh-child-item">
                                                <img src={edit.thumbnailUrl} />
                                                <small>{edit.prompt}</small>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            </section>

                            <section class="uvh-split-pane">
                                <h4>Videos ({selectedNode()!.videos.length})</h4>
                                <div class="uvh-list">
                                    <For each={selectedNode()!.videos}>
                                        {(vid) => (
                                            <div class="uvh-child-item">
                                                <img src={vid.thumbnailUrl} />
                                                <small>{vid.prompt}</small>
                                                <Show when={vid.extension === "true"}>
                                                    <span class="ext-badge">Extended</span>
                                                </Show>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            </section>
                        </div>
                        
                        {/* HMR Failures Pane */}
                        <Show when={selectedNode()!.failurePrompts.length > 0}>
                            <section class="uvh-hmr-pane">
                                <h4>Failed / Moderated Attempts ({selectedNode()!.failCount})</h4>
                                <ul>
                                    <For each={selectedNode()!.failurePrompts}>
                                        {(fail) => <li>⚠️ {fail.prompt}</li>}
                                    </For>
                                </ul>
                            </section>
                        </Show>
                    </div>
                </Show>
            </Show>
        </div>
    );
}
