/**
 * GVP Bridge - Prompt Input Component
 * Textarea for entering prompts with send action
 */

import { createSignal, onMount } from 'solid-js';
import { invoke } from '@tauri-apps/api/tauri';

interface PromptInputProps {
    onPromptSet?: (prompt: string) => void;
    disabled?: boolean;
}

export default function PromptInput(props: PromptInputProps) {
    const [prompt, setPrompt] = createSignal('');
    const [isLoading, setIsLoading] = createSignal(false);
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

    const handleKeyDown = (e: KeyboardEvent) => {
        // Ctrl/Cmd + Enter to set prompt
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSetPrompt();
        }
    };

    onMount(() => {
        // Load existing prompt on mount
        invoke<string>('get_prompt')
            .then(savedPrompt => {
                if (savedPrompt) {
                    setPrompt(savedPrompt);
                    adjustHeight();
                }
            })
            .catch(console.error);
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
                </div>
            </div>
        </div>
    );
}
