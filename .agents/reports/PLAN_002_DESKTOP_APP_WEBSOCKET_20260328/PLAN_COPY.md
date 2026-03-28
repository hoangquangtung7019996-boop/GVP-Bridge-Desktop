# Implementation Plan — Desktop App WebSocket Server + SolidJS UI

**Plan ID:** PLAN-002
**Feature:** Desktop App (Tauri + SolidJS)
**Target:** `src-desktop/` and `src-tauri/`
**Date:** 2025-03-28
**Depends On:** PLAN-001 (Extension MVP) - COMPLETE

---

## Overview

Build the Tauri desktop application that:
1. Runs a WebSocket server on port 8765 (listens for extension connections)
2. Provides a SolidJS UI with prompt input textarea
3. Shows connection status (Connected/Disconnected)
4. Handles `prompt_request` from extension → sends `prompt_response`
5. Displays status updates from extension (injected, submitted, errors)
6. Stores current prompt in memory

**Total Steps:** 10
**Estimated Files:** 6 files (3 modified, 3 new)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DESKTOP APP (Tauri + SolidJS)                 │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    SolidJS Frontend                          │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │    │
│  │  │   App.tsx       │  │ PromptInput.tsx │  │ StatusBar.tsx │ │    │
│  │  │   Main UI       │  │ Textarea +      │  │ Connection +  │ │    │
│  │  │   State mgmt    │  │ Send button     │  │ Status msgs   │ │    │
│  │  └─────────────────┘  └─────────────────┘  └──────────────┘ │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              │ invoke() / Tauri Commands             │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Rust Backend (Tauri)                      │    │
│  │  ┌─────────────────────────────────────────────────────────┐ │    │
│  │  │  WebSocket Server (tokio-tungstenite)                   │ │    │
│  │  │  - Port 8765                                            │ │    │
│  │  │  - Accept connections from extension                    │ │    │
│  │  │  - Handle prompt_request → respond with prompt_response │ │    │
│  │  │  - Forward status updates to frontend                   │ │    │
│  │  └─────────────────────────────────────────────────────────┘ │    │
│  │  ┌─────────────────────────────────────────────────────────┐ │    │
│  │  │  Shared State (Arc<Mutex>)                              │ │    │
│  │  │  - current_prompt: String                               │ │    │
│  │  │  - connection_count: u32                                │ │    │
│  │  │  - last_status: String                                  │ │    │
│  │  └─────────────────────────────────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                    │
                    │ WebSocket :8765
                    ▼
        ┌──────────────────────┐
        │   Chrome Extension   │
        │   (PLAN-001 DONE)    │
        └──────────────────────┘
```

---

## Target Files

| File | Action | Purpose |
|------|--------|---------|
| `src-tauri/src/main.rs` | MODIFY | WebSocket server + Tauri commands |
| `src-tauri/Cargo.toml` | MODIFY | Add dependencies |
| `src-tauri/tauri.conf.json` | MODIFY | Enable Tauri features |
| `src-desktop/App.tsx` | MODIFY | Main UI with state management |
| `src-desktop/components/PromptInput.tsx` | CREATE | Prompt textarea component |
| `src-desktop/components/StatusBar.tsx` | CREATE | Connection/status display |
| `src-desktop/styles.css` | MODIFY | Complete styling |

---

## WebSocket Protocol (Reference)

### Messages FROM Extension → Desktop

```json
// Extension detects URL change
{
  "type": "url_changed",
  "payload": { "url": "https://x.com/i/grok/imagine/post/abc123", "imageId": "abc123" },
  "timestamp": 1234567890
}

// Extension requests prompt
{
  "type": "prompt_request",
  "payload": { "imageId": "abc123" },
  "timestamp": 1234567890
}

// Extension reports injection status
{
  "type": "status",
  "payload": { "status": "injected", "success": true, "imageId": "abc123" },
  "timestamp": 1234567890
}

// Extension sends ready signal
{
  "type": "status",
  "payload": { "status": "ready", "url": "https://x.com/i/grok" },
  "timestamp": 1234567890
}
```

### Messages FROM Desktop → Extension

```json
// Desktop responds with prompt
{
  "type": "prompt_response",
  "payload": { "prompt": "A cinematic video of...", "imageId": "abc123" },
  "timestamp": 1234567890
}

// Desktop sends ping
{
  "type": "ping",
  "payload": {},
  "timestamp": 1234567890
}
```

---

## STEP 1 — Update Cargo.toml with Dependencies

**File:** `src-tauri/Cargo.toml`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```toml
[dependencies]
tauri = { version = "1.5", features = ["shell-open"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["full"] }
tokio-tungstenite = "0.21"
futures-util = "0.3"
```

**Replace with:**
```toml
[dependencies]
tauri = { version = "1.5", features = ["shell-open"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["full"] }
tokio-tungstenite = "0.21"
futures-util = "0.3"
parking_lot = "0.12"
```

⚠️ DO NOT modify any line outside this block.

---

## STEP 2 — Update tauri.conf.json for Features

**File:** `src-tauri/tauri.conf.json`
**Action:** MODIFY EXISTING FILE

**Find this exact block:**
```json
    "allowlist": {
      "all": false,
      "shell": {
        "open": true
      }
    },
```

**Replace with:**
```json
    "allowlist": {
      "all": false,
      "shell": {
        "open": true
      },
      "window": {
        "all": true
      },
      "event": {
        "all": true
      }
    },
```

⚠️ DO NOT modify any line outside this block.

---

## STEP 3 — Implement WebSocket Server in main.rs

**File:** `src-tauri/src/main.rs`
**Action:** REPLACE ENTIRE FILE

**Code to write:**
```rust
// GVP Bridge - Desktop App Backend
// WebSocket server + Tauri commands

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::Manager;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};

// ============================================================================
// SHARED STATE
// ============================================================================

/// Global state shared between WebSocket server and Tauri commands
pub struct AppState {
    pub current_prompt: String,
    pub connection_count: u32,
    pub last_status: String,
    pub last_url: String,
    pub last_image_id: String,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            current_prompt: String::new(),
            connection_count: 0,
            last_status: "Ready".to_string(),
            last_url: String::new(),
            last_image_id: String::new(),
        }
    }
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Set the current prompt (called from frontend)
#[tauri::command]
fn set_prompt(prompt: String, state: tauri::State<Arc<Mutex<AppState>>>) -> Result<String, String> {
    let mut s = state.lock();
    s.current_prompt = prompt.clone();
    s.last_status = "Prompt set".to_string();
    println!("[GVP Desktop] Prompt set: {} chars", prompt.len());
    Ok(prompt)
}

/// Get the current prompt
#[tauri::command]
fn get_prompt(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<String, String> {
    let s = state.lock();
    Ok(s.current_prompt.clone())
}

/// Get current status
#[tauri::command]
fn get_status(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<HashMap<String, String>, String> {
    let s = state.lock();
    let mut status = HashMap::new();
    status.insert("status".to_string(), s.last_status.clone());
    status.insert("url".to_string(), s.last_url.clone());
    status.insert("imageId".to_string(), s.last_image_id.clone());
    status.insert("connections".to_string(), s.connection_count.to_string());
    Ok(status)
}

/// Clear the current prompt
#[tauri::command]
fn clear_prompt(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<(), String> {
    let mut s = state.lock();
    s.current_prompt.clear();
    s.last_status = "Prompt cleared".to_string();
    Ok(())
}

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

/// Handle a single WebSocket connection
async fn handle_connection(
    raw_stream: TcpStream,
    addr: SocketAddr,
    state: Arc<Mutex<AppState>>,
    app_handle: tauri::AppHandle,
) {
    println!("[GVP Desktop] New connection from: {}", addr);

    // Increment connection count
    {
        let mut s = state.lock();
        s.connection_count += 1;
        s.last_status = format!("Connected ({})", s.connection_count);
    }

    // Emit connection event to frontend
    let _ = app_handle.emit_all("ws-connection", { 
        let s = state.lock();
        format!("Connected ({})", s.connection_count)
    });

    // Accept WebSocket connection
    let ws_stream = match accept_async(raw_stream).await {
        Ok(stream) => stream,
        Err(e) => {
            println!("[GVP Desktop] WebSocket accept error: {}", e);
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Handle incoming messages
    while let Some(msg_result) = ws_receiver.next().await {
        match msg_result {
            Ok(msg) => {
                if msg.is_text() || msg.is_binary() {
                    let text = msg.to_text().unwrap_or("");
                    println!("[GVP Desktop] Received: {}", text);

                    // Parse message
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(text) {
                        let msg_type = json["type"].as_str().unwrap_or("");
                        let payload = &json["payload"];

                        match msg_type {
                            // Extension requests prompt
                            "prompt_request" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");
                                
                                // Store image ID
                                {
                                    let mut s = state.lock();
                                    s.last_image_id = image_id.to_string();
                                }

                                // Get current prompt
                                let prompt = {
                                    let s = state.lock();
                                    s.current_prompt.clone()
                                };

                                // Send prompt response
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id
                                    },
                                    "timestamp": chrono_timestamp()
                                });

                                if let Err(e) = ws_sender.send(Message::Text(response.to_string())).await {
                                    println!("[GVP Desktop] Send error: {}", e);
                                    break;
                                }

                                // Emit to frontend
                                let _ = app_handle.emit_all("prompt-sent", image_id);
                            }

                            // Extension reports URL change
                            "url_changed" => {
                                let url = payload["url"].as_str().unwrap_or("");
                                let image_id = payload["imageId"].as_str().unwrap_or("");

                                {
                                    let mut s = state.lock();
                                    s.last_url = url.to_string();
                                    if !image_id.is_empty() {
                                        s.last_image_id = image_id.to_string();
                                    }
                                }

                                // Emit to frontend
                                let _ = app_handle.emit_all("url-changed", serde_json::json!({
                                    "url": url,
                                    "imageId": image_id
                                }));
                            }

                            // Extension reports status
                            "status" => {
                                let status = payload["status"].as_str().unwrap_or("");
                                let success = payload["success"].as_bool().unwrap_or(false);

                                let status_msg = if success {
                                    format!("✓ {}", status)
                                } else {
                                    let error = payload["error"].as_str().unwrap_or("Unknown error");
                                    format!("✗ {} - {}", status, error)
                                };

                                {
                                    let mut s = state.lock();
                                    s.last_status = status_msg.clone();
                                }

                                // Emit to frontend
                                let _ = app_handle.emit_all("status-update", serde_json::json!({
                                    "status": status,
                                    "success": success,
                                    "message": status_msg
                                }));
                            }

                            // Pong response
                            "pong" => {
                                println!("[GVP Desktop] Received pong");
                            }

                            _ => {
                                println!("[GVP Desktop] Unknown message type: {}", msg_type);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                println!("[GVP Desktop] WebSocket error: {}", e);
                break;
            }
        }
    }

    // Decrement connection count
    {
        let mut s = state.lock();
        s.connection_count = s.connection_count.saturating_sub(1);
        s.last_status = if s.connection_count > 0 {
            format!("Connected ({})", s.connection_count)
        } else {
            "Disconnected".to_string()
        };
    }

    // Emit disconnection event
    let _ = app_handle.emit_all("ws-connection", "Disconnected");

    println!("[GVP Desktop] Connection closed: {}", addr);
}

/// Start WebSocket server
async fn start_server(state: Arc<Mutex<AppState>>, app_handle: tauri::AppHandle) {
    let addr = "127.0.0.1:8765";
    
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => {
            println!("[GVP Desktop] WebSocket server started on {}", addr);
            l
        }
        Err(e) => {
            eprintln!("[GVP Desktop] Failed to bind to {}: {}", addr, e);
            return;
        }
    };

    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                let state_clone = state.clone();
                let app_handle_clone = app_handle.clone();
                
                tokio::spawn(async move {
                    handle_connection(stream, addr, state_clone, app_handle_clone).await;
                });
            }
            Err(e) => {
                eprintln!("[GVP Desktop] Accept error: {}", e);
            }
        }
    }
}

/// Get current timestamp in milliseconds
fn chrono_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

// ============================================================================
// MAIN
// ============================================================================

fn main() {
    // Initialize shared state
    let state = Arc::new(Mutex::new(AppState::default()));

    tauri::Builder::default()
        .manage(state.clone())
        .setup(|app| {
            let app_handle = app.handle();
            let state_clone = state.clone();

            // Start WebSocket server in background
            tokio::spawn(async move {
                start_server(state_clone, app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_prompt,
            get_prompt,
            get_status,
            clear_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

⚠️ DO NOT use any other file. This is a complete replacement.

---

## STEP 4 — Create PromptInput Component

**File:** `src-desktop/components/PromptInput.tsx`
**Action:** CREATE NEW FILE

**Code to write:**
```typescript
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
```

⚠️ DO NOT create this file in any other location.

---

## STEP 5 — Create StatusBar Component

**File:** `src-desktop/components/StatusBar.tsx`
**Action:** CREATE NEW FILE

**Code to write:**
```typescript
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
```

⚠️ DO NOT create this file in any other location.

---

## STEP 6 — Update App.tsx

**File:** `src-desktop/App.tsx`
**Action:** REPLACE EXISTING FILE

**Code to write:**
```typescript
/**
 * GVP Bridge - Desktop App Main Component
 * Tauri + SolidJS frontend for prompt management
 */

import { createSignal, onMount } from 'solid-js';
import { invoke } from '@tauri-apps/api/tauri';
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
```

⚠️ DO NOT create this file in any other location.

---

## STEP 7 — Update styles.css

**File:** `src-desktop/styles.css`
**Action:** REPLACE EXISTING FILE

**Code to write:**
```css
/* GVP Bridge - Desktop App Styles */
/* Dark theme matching Grok */

:root {
    --bg-primary: #141414;
    --bg-secondary: #1a1a1a;
    --bg-tertiary: #212121;
    --bg-hover: #262626;
    --bg-active: #2a2a2a;
    --border-color: #333;
    --border-light: #444;
    --text-primary: #f4f4f5;
    --text-secondary: #a3a3a3;
    --text-muted: #737373;
    --accent: #ef4444;
    --accent-hover: #dc2626;
    --success: #22c55e;
    --warning: #f59e0b;
    --error: #ef4444;
    --font-mono: 'SF Mono', 'Fira Code', monospace;
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 8px;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html, body {
    height: 100%;
    overflow: hidden;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.5;
}

/* ============================================================================
   APP LAYOUT
   ============================================================================ */

.app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 12px;
    gap: 12px;
}

.app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color);
}

.app-header h1 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}

.app-header .version {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
}

.app-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: hidden;
}

.app-footer {
    display: flex;
    justify-content: space-between;
    padding-top: 8px;
    border-top: 1px solid var(--border-color);
    font-size: 11px;
    color: var(--text-muted);
}

.app-footer p {
    margin: 0;
}

.app-footer .prompt-ready {
    color: var(--success);
}

.app-footer .prompt-empty {
    color: var(--text-muted);
}

/* ============================================================================
   LOADING STATE
   ============================================================================ */

.loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
}

.loading-text {
    color: var(--text-muted);
    font-size: 12px;
}

/* ============================================================================
   SECTIONS
   ============================================================================ */

.prompt-section {
    flex-shrink: 0;
}

.status-section {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

/* ============================================================================
   PROMPT INPUT
   ============================================================================ */

.prompt-input-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.prompt-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.prompt-textarea {
    width: 100%;
    min-height: 100px;
    max-height: 200px;
    padding: 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    line-height: 1.5;
    resize: none;
    transition: border-color 0.15s ease;
}

.prompt-textarea:focus {
    outline: none;
    border-color: var(--accent);
}

.prompt-textarea::placeholder {
    color: var(--text-muted);
}

.prompt-textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.prompt-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.prompt-hint {
    font-size: 11px;
    color: var(--text-muted);
}

.prompt-buttons {
    display: flex;
    gap: 8px;
}

/* ============================================================================
   BUTTONS
   ============================================================================ */

.btn {
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
}

.btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn-primary {
    background: var(--accent);
    color: white;
}

.btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
}

.btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
}

/* ============================================================================
   STATUS BAR
   ============================================================================ */

.status-bar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 10px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

.status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.connection-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    animation: pulse 2s infinite;
}

.status-dot.connected {
    background: var(--success);
    box-shadow: 0 0 6px var(--success);
}

.status-dot.disconnected {
    background: var(--error);
    box-shadow: 0 0 6px var(--error);
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
}

.connection-text {
    font-size: 12px;
    font-weight: 500;
}

.current-status {
    font-size: 12px;
    color: var(--text-secondary);
}

.url-display {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-size: 11px;
}

.url-label {
    color: var(--text-muted);
}

.url-value {
    font-family: var(--font-mono);
    color: var(--text-primary);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ============================================================================
   STATUS HISTORY
   ============================================================================ */

.status-history {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.history-header {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
}

.history-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.history-empty {
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
    padding: 20px;
}

.history-item {
    font-size: 11px;
    color: var(--text-secondary);
    padding: 4px 6px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    word-break: break-all;
}

.history-item[data-index="0"] {
    color: var(--text-primary);
    background: var(--bg-hover);
}

/* ============================================================================
   SCROLLBAR
   ============================================================================ */

.history-list::-webkit-scrollbar {
    width: 4px;
}

.history-list::-webkit-scrollbar-track {
    background: transparent;
}

.history-list::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 2px;
}

.history-list::-webkit-scrollbar-thumb:hover {
    background: var(--border-light);
}

/* ============================================================================
   RESPONSIVE
   ============================================================================ */

@media (max-height: 400px) {
    .app {
        padding: 8px;
        gap: 8px;
    }
    
    .prompt-textarea {
        min-height: 60px;
        max-height: 100px;
    }
    
    .status-history {
        display: none;
    }
}
```

⚠️ DO NOT create this file in any other location.

---

## STEP 8 — Create components directory structure

**File:** `src-desktop/components/` (directory)
**Action:** CREATE DIRECTORY

Create the directory:
```
src-desktop/
└── components/
    ├── PromptInput.tsx  (created in Step 4)
    └── StatusBar.tsx    (created in Step 5)
```

---

## STEP 9 — Create Vite entry point (index.tsx)

**File:** `src-desktop/index.tsx`
**Action:** CREATE NEW FILE (if doesn't exist)

**Code to write:**
```typescript
/**
 * GVP Bridge - Desktop App Entry Point
 */

import { render } from 'solid-js/web';
import App from './App';
import './styles.css';

render(() => <App />, document.getElementById('root')!);
```

---

## STEP 10 — Update HANDOVER.md

**File:** `.agents/HANDOVER.md`
**Action:** UPDATE EXISTING FILE

**Find this exact block:**
```markdown
## Priority Order for Next Session

1. **Implement Extension MVP** (PLAN-001)
   - Why: Core functionality needed before desktop app
   - Files: `src-extension/` (5 new files)
   - Status: Plan created, awaiting implementation

2. **Create Desktop App WebSocket Server**
   - Why: Extension needs something to connect to
   - Files: `src-desktop/`
   - Status: Not started, depends on Extension MVP
```

**Replace with:**
```markdown
## Priority Order for Next Session

1. **Test Extension ↔ Desktop Integration**
   - Why: Verify end-to-end flow works
   - Steps:
     1. Load extension in Chrome
     2. Run desktop app (`npm run tauri dev`)
     3. Navigate to Grok
     4. Enter prompt in desktop app
     5. Click gallery card
     6. Verify prompt injection
   - Status: Ready for testing

2. **Add Error Handling & Edge Cases**
   - Why: Improve robustness
   - Items: Editor not found, slow load, multiple connections
   - Status: Not started, depends on integration testing
```

---

## VERIFICATION CHECKLIST

After completing all steps, verify:

| Check | Expected |
|-------|----------|
| `src-tauri/Cargo.toml` updated with parking_lot | YES |
| `src-tauri/tauri.conf.json` has event/window features | YES |
| `src-tauri/src/main.rs` implements WebSocket server | YES |
| `src-desktop/components/` folder exists | YES |
| `src-desktop/components/PromptInput.tsx` exists | YES |
| `src-desktop/components/StatusBar.tsx` exists | YES |
| `src-desktop/App.tsx` uses components | YES |
| `src-desktop/styles.css` has complete styling | YES |
| `src-desktop/index.tsx` exists | YES |
| `.agents/HANDOVER.md` updated | YES |

---

## TESTING GUIDE

After implementation, test with these steps:

### 1. Build and Run Desktop App
```bash
cd GVP-Bridge-Desktop
npm install
npm run tauri dev
```

### 2. Verify WebSocket Server
- Check console output: `[GVP Desktop] WebSocket server started on 127.0.0.1:8765`
- Window should show "Disconnected" initially

### 3. Load Extension in Chrome
1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `GVP-Bridge-Desktop/src-extension/`

### 4. Test Integration
1. Navigate to `https://x.com/i/grok`
2. Extension console should show: `[GVP Bridge] WebSocket connected`
3. Desktop app should show: "Connected (1)"
4. Enter prompt in desktop app, click "Set Prompt"
5. Click a gallery card on Grok
6. Extension should detect URL change
7. Extension should request and receive prompt
8. Prompt should be injected into editor
9. Desktop app should show status updates

---

## END OF PLAN

**STOP after completing all 10 steps.**
**Produce Work Report as specified in `/implement` workflow.**
