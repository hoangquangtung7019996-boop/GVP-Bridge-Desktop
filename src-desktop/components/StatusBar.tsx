/**
 * GVP Bridge - Status Bar Component
 * Shows connection status and recent activity
 */

import { createSignal, onMount, onCleanup } from 'solid-js';
import { listen } from '@tauri-apps/api/event';

interface StatusBarProps {
    initialStatus?: string;
}

interface StatusUpdate {
    status: string;
    success: boolean;
    message: string;
}

interface UrlChange {
    url: string;
    imageId: string;
}

export default function StatusBar(props: StatusBarProps) {
    const [connectionStatus, setConnectionStatus] = createSignal('Disconnected');
    const [lastStatus, setLastStatus] = createSignal(props.initialStatus || 'Ready');
    const [lastUrl, setLastUrl] = createSignal('');
    const [lastImageId, setLastImageId] = createSignal('');
    const [statusHistory, setStatusHistory] = createSignal<string[]>([]);

    const unlisteners: (() => void)[] = [];

    onMount(async () => {
        // Listen for WebSocket connection events
        const unlisten1 = await listen<string>('ws-connection', (event) => {
            setConnectionStatus(event.payload);
        });
        unlisteners.push(unlisten1);

        // Listen for status updates from extension
        const unlisten2 = await listen<StatusUpdate>('status-update', (event) => {
            const { message } = event.payload;
            setLastStatus(message);
            addToHistory(message);
        });
        unlisteners.push(unlisten2);

        // Listen for URL changes
        const unlisten3 = await listen<UrlChange>('url-changed', (event) => {
            setLastUrl(event.payload.url);
            if (event.payload.imageId) {
                setLastImageId(event.payload.imageId);
            }
            addToHistory(`Navigated to ${event.payload.imageId || 'unknown'}`);
        });
        unlisteners.push(unlisten3);

        // Listen for prompt sent events
        const unlisten4 = await listen<string>('prompt-sent', (event) => {
            addToHistory(`Prompt sent to image: ${event.payload}`);
        });
        unlisteners.push(unlisten4);
    });

    onCleanup(() => {
        unlisteners.forEach(unlisten => unlisten());
    });

    const addToHistory = (message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setStatusHistory(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 9)]);
    };

    const isConnected = () => connectionStatus().includes('Connected');

    return (
        <div class="status-bar">
            {/* Connection Status */}
            <div class="status-row">
                <div class="connection-indicator">
                    <span class={`status-dot ${isConnected() ? 'connected' : 'disconnected'}`}></span>
                    <span class="connection-text">{connectionStatus()}</span>
                </div>
                <div class="current-status">
                    {lastStatus()}
                </div>
            </div>

            {/* Last URL / Image ID */}
            {lastImageId() && (
                <div class="url-display">
                    <span class="url-label">Last Image:</span>
                    <span class="url-value" title={lastUrl()}>
                        {lastImageId()}
                    </span>
                </div>
            )}

            {/* Status History */}
            <div class="status-history">
                <div class="history-header">Recent Activity</div>
                <div class="history-list">
                    {statusHistory().length === 0 ? (
                        <div class="history-empty">No activity yet</div>
                    ) : (
                        statusHistory().map((item, i) => (
                            <div class="history-item" data-index={i}>
                                {item}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
