/**
 * GVP Bridge - Desktop App Main Component
 * Tauri + SolidJS frontend for prompt management
 */

import { createSignal, onMount } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import PromptInput from './components/PromptInput';
import StatusBar from './components/StatusBar';

export default function App() {
    const [promptSet, setPromptSet] = createSignal(false);
    const [currentPrompt, setCurrentPrompt] = createSignal('');
    const [appReady, setAppReady] = createSignal(false);

    onMount(async () => {
        try {
            // Check if we can communicate with Tauri backend
            const status = await invoke<{ [key: string]: string }>('get_status');
            console.log('[GVP Desktop] Initial status:', status);
            
            // Load existing prompt
            const prompt = await invoke<string>('get_prompt');
            if (prompt) {
                setCurrentPrompt(prompt);
                setPromptSet(true);
            }
            
            setAppReady(true);
        } catch (error) {
            console.error('[GVP Desktop] Failed to initialize:', error);
        }
    });

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
