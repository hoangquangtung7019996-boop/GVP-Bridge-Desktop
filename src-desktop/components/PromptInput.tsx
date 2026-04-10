/**
 * GVP Bridge - Prompt Input Component
 * Textarea for entering prompts with send action
 */

import { createSignal, onMount } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';

interface PromptInputProps {
    onPromptSet?: (prompt: string) => void;
    disabled?: boolean;
}

export default function PromptInput(props: PromptInputProps) {
    const [prompt, setPrompt] = createSignal('');
    const [isLoading, setIsLoading] = createSignal(false);
    const [previewMode, setPreviewMode] = createSignal(false);
    const [fireStatus, setFireStatus] = createSignal<string | null>(null);
    let textareaRef: HTMLTextAreaElement | undefined;

    // Auto-resize textarea
    const adjustHeight = () => {
        if (textareaRef) {
            textareaRef.style.height = 'auto';
            textareaRef.style.height = Math.min(textareaRef.scrollHeight, 300) + 'px';
        }
    };

    const handleInput = (e: Event) => {
        const target = e.target as HTMLTextAreaElement;
        setPrompt(target.value);
        adjustHeight();
    };

    const handleSetPrompt = async () => {
        if (!prompt().trim()) return;

        setIsLoading(true);
        try {
            await invoke('set_prompt', { prompt: prompt() });
            props.onPromptSet?.(prompt());
        } catch (error) {
            console.error('Failed to set prompt:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClear = async () => {
        try {
            await invoke('clear_prompt');
            setPrompt('');
            if (textareaRef) {
                textareaRef.style.height = 'auto';
            }
        } catch (error) {
            console.error('Failed to clear prompt:', error);
        }
    };

    const handleTogglePreview = async () => {
        const newState = !previewMode();
        setPreviewMode(newState);
        try {
            await invoke('set_preview_mode', { enabled: newState });
        } catch (error) {
            console.error('Failed to toggle preview mode:', error);
            setPreviewMode(!newState);
        }
    };

    const handleFire = async () => {
        if (!prompt().trim()) return;
        
        setFireStatus('Firing...');
        try {
            // Ensure the prompt is saved first
            await invoke('set_prompt', { prompt: prompt() });
            // Then trigger the remote fire
            const result = await invoke<string>('trigger_fire');
            setFireStatus(`✅ ${result}`);
        } catch (error: any) {
            setFireStatus(`❌ ${error}`);
        }
        // Clear status after 5 seconds
        setTimeout(() => setFireStatus(null), 5000);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        // Ctrl/Cmd + Enter to set prompt
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSetPrompt();
        }
    };

    onMount(() => {
        // Load existing state on mount
        Promise.all([
            invoke<string>('get_prompt'),
            invoke<boolean>('get_preview_mode')
        ]).then(([savedPrompt, savedPreviewMode]) => {
            if (savedPrompt) {
                setPrompt(savedPrompt);
                adjustHeight();
            }
            setPreviewMode(savedPreviewMode);
        }).catch(console.error);
    });

    return (
        <div class="prompt-input-container">
            <label class="prompt-label">Prompt</label>
            <textarea
                ref={textareaRef}
                class="prompt-textarea"
                placeholder="Enter your prompt here...&#10;&#10;When you click a gallery card on Grok, this prompt will be automatically injected.&#10;&#10;Press Ctrl+Enter to save."
                value={prompt()}
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                disabled={props.disabled || isLoading()}
                rows={4}
            />
            <div class="prompt-actions">
                <span class="prompt-hint">
                    {prompt().length} chars • Ctrl+Enter to save
                </span>
                <div class="prompt-buttons">
                    <label class="preview-toggle" title="Intercept and display generations instead of auto-submitting">
                        <input 
                            type="checkbox" 
                            checked={previewMode()} 
                            onChange={handleTogglePreview} 
                        />
                        <span>Preview Mode</span>
                    </label>
                    <button
                        class="btn btn-secondary"
                        onClick={handleClear}
                        disabled={!prompt() || isLoading()}
                    >
                        Clear
                    </button>
                    <button
                        class="btn btn-primary"
                        onClick={handleSetPrompt}
                        disabled={!prompt().trim() || isLoading()}
                    >
                        {isLoading() ? 'Saving...' : 'Set Prompt'}
                    </button>
                    <button
                        class="btn btn-fire"
                        onClick={handleFire}
                        disabled={!prompt().trim() || isLoading()}
                        title="Send prompt to Ghost Window for DOM automation"
                    >
                        🚀 Fire
                    </button>
                </div>
                {fireStatus() && (
                    <div class="fire-status" style={{ 
                        'margin-top': '8px', 
                        'font-size': '12px', 
                        color: fireStatus()!.startsWith('✅') ? '#22c55e' : 
                                fireStatus()!.startsWith('❌') ? '#ef4444' : '#f59e0b' 
                    }}>
                        {fireStatus()}
                    </div>
                )}
            </div>
        </div>
    );
}
