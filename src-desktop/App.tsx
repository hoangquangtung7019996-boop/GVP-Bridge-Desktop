/**
 * GVP Bridge - Desktop App Main Component
 * Tauri + SolidJS frontend for prompt management
 */

import { createSignal, onMount } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import PromptInput from './components/PromptInput';
import StatusBar from './components/StatusBar';
import GalleryPanel, { Generation } from './components/GalleryPanel';

export default function App() {
    const [promptSet, setPromptSet] = createSignal(false);
    const [currentPrompt, setCurrentPrompt] = createSignal('');
    const [appReady, setAppReady] = createSignal(false);
    const [generations, setGenerations] = createSignal<Generation[]>([]);

    onMount(async () => {
        try {
            // Check if we can communicate with Tauri backend
            const status = await invoke<{ connections?: string; status?: string; url?: string; imageId?: string }>('get_status');
            console.log('[GVP Desktop] Initial status:', status);
            if (status.connections) {
                console.log('[GVP Desktop] Initial connections:', status.connections);
            }
            
            // Load existing prompt
            const prompt = await invoke<string>('get_prompt');
            if (prompt) {
                setCurrentPrompt(prompt);
                setPromptSet(true);
            }
            
            setAppReady(true);

            // Listen for generation results from backend
            await listen<any>('generation-result', (event) => {
                console.log('[GVP Desktop] Received generation result event:', event);
                handleGenerationResult(event.payload);
            });
        } catch (error) {
            console.error('[GVP Desktop] Failed to initialize:', error);
        }
    });

    const handleGenerationResult = (payload: any) => {
        const { url, data } = payload;
        
        // Process Grok API response
        // Note: Raw structure depends on endpoint (upscale, generate, etc.)
        // This is a simplified extraction
        let type: 'video' | 'image' = 'image';
        let mediaUrl = '';
        let status: 'success' | 'moderated' | 'processing' | 'error' = 'success';
        let reason = '';

        if (url.includes('/upscale') || url.includes('/generate')) {
            const result = data.result || data;
            if (result.imageUrl) {
                mediaUrl = result.imageUrl;
                type = 'image';
            } else if (result.videoUrl) {
                mediaUrl = result.videoUrl;
                type = 'video';
            } else if (result.isModerated) {
                status = 'moderated';
                reason = result.moderationReason || 'Safety filter';
            }
        } else if (url.includes('/get_video_generation_result')) {
            type = 'video';
            if (data.videoUrl) {
                mediaUrl = data.videoUrl;
            } else if (data.status === 'PROCESSING') {
                status = 'processing';
            } else if (data.status === 'ERROR') {
                status = 'error';
            }
        }

        if (mediaUrl || status !== 'success') {
            const newGen: Generation = {
                id: Math.random().toString(36).substring(2, 11),
                type,
                url: mediaUrl,
                prompt: currentPrompt() || 'Intercepted prompt',
                status,
                createdAt: Date.now(),
                moderatedReason: reason
            };

            setGenerations(prev => [newGen, ...prev].slice(0, 20)); // Keep last 20
        }
    };

    const handlePromptSet = (prompt: string) => {
        setCurrentPrompt(prompt);
        setPromptSet(true);
    };

    return (
        <div class="app">
            {/* Header */}
            <header class="app-header">
                <h1>GVP Bridge</h1>
                <span class="version">v0.1.0</span>
            </header>

            {/* Main Content */}
            <main class="app-main">
                {!appReady() ? (
                    <div class="loading">
                        <span class="loading-text">Loading...</span>
                    </div>
                ) : (
                    <>
                        {/* Prompt Input Section */}
                        <section class="prompt-section">
                            <PromptInput onPromptSet={handlePromptSet} />
                        </section>

                        {/* Status Section */}
                        <section class="status-section">
                            <StatusBar initialStatus={promptSet() ? 'Prompt ready' : 'Ready'} />
                        </section>

                        {/* Gallery Section */}
                        <section class="gallery-section">
                            <GalleryPanel generations={generations()} />
                        </section>
                    </>
                )}
            </main>

            {/* Footer */}
            <footer class="app-footer">
                <p>WebSocket: ws://localhost:8765</p>
                <p class={promptSet() ? 'prompt-ready' : 'prompt-empty'}>
                    {promptSet() 
                        ? `✓ Prompt ready (${currentPrompt().length} chars)` 
                        : '○ No prompt set'}
                </p>
            </footer>
        </div>
    );
}
