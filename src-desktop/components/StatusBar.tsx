/**
 * GVP Bridge - Status Bar Component
 * Shows connection status and recent activity using SolidJS signals
 */

import { createSignal, onMount, onCleanup, Show, For } from 'solid-js';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface StatusBarProps {
    initialStatus?: string;
}

export default function StatusBar(props: StatusBarProps) {
    const [connected, setConnected] = createSignal(false);
    const [currentStatus, setCurrentStatus] = createSignal(props.initialStatus || 'Ready');
    const [activityLog, setActivityLog] = createSignal<string[]>([]);
    const [lastUrl, setLastUrl] = createSignal('');
    const [lastImageId, setLastImageId] = createSignal('');

    const unlisteners: (() => void)[] = [];

    onMount(async () => {
        // Fetch initial status
        try {
            const status = await invoke<{ connections?: string; status?: string; url?: string; imageId?: string }>('get_status');
            const connCount = parseInt(status.connections || '0');
            setConnected(connCount > 0);
            
            if (status.status) setCurrentStatus(status.status);
            if (status.url) setLastUrl(status.url);
            if (status.imageId) setLastImageId(status.imageId);
        } catch (e) {
            console.error('[StatusBar] Initial status error:', e);
        }

        // Listen for WebSocket connection status changes
        const un1 = await listen<string>('ws-connection', (event) => {
            const status = event.payload;
            setConnected(status.startsWith('Connected'));
        });
        unlisteners.push(un1);

        // Listen for activity events
        const un2 = await listen<{ message: string }>('status-update', (event) => {
            const msg = event.payload.message;
            setCurrentStatus(msg);
            addActivity(msg);
        });
        unlisteners.push(un2);

        // Listen for prompt sent events
        const un3 = await listen<string>('prompt-sent', (event) => {
            const imageId = event.payload;
            addActivity(`Prompt sent to: ${imageId.substring(0, 8)}...`);
        });
        unlisteners.push(un3);

        // Listen for URL changes
        const un4 = await listen<{ url: string; imageId: string }>('url-changed', (event) => {
            setLastUrl(event.payload.url);
            setLastImageId(event.payload.imageId);
            addActivity(`Navigated to ${event.payload.imageId || 'unknown'}`);
        });
        unlisteners.push(un4);
    });

    onCleanup(() => {
        unlisteners.forEach(fn => fn());
    });

    const addActivity = (message: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const logEntry = `[${timestamp}] ${message}`;
        setActivityLog(prev => [logEntry, ...prev].slice(0, 10));
    };

    return (
        <div class="status-bar">
            {/* Connection Status */}
            <div class="status-row">
                <div class="connection-indicator">
                    <span class={`status-dot ${connected() ? 'connected' : 'disconnected'}`}></span>
                    <span class="connection-text">{connected() ? 'Connected' : 'Disconnected'}</span>
                </div>
                <div class="current-status">
                    {currentStatus()}
                </div>
            </div>

            {/* Last Activity context */}
            {lastImageId() && (
                <div class="url-display">
                    <span class="url-label">Target:</span>
                    <span class="url-value" title={lastUrl()}>
                        {lastImageId()}
                    </span>
                </div>
            )}

            {/* Recent Activity Log */}
            <div class="status-history">
                <div class="history-header">Recent Activity</div>
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
            </div>
        </div>
    );
}
