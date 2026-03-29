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
