# PLAN_039: Fetch Replay & Execution Engine

## Problem/Goal
The Desktop App cannot proactively push a "fire now" command to the Extension. Currently, all harvester fires are initiated by the extension (gallery card click → prompt_request → prompt_response). PLAN_039 adds a **direct Desktop→Extension push** so the user can type a prompt in the Desktop UI and fire the harvester without any browser interaction.

## Architecture Summary
```
Desktop UI "🚀 Fire" click
  → Tauri command `trigger_fire`
  → Emits Tauri event `trigger-fire`
  → WS handler picks up event, sends `trigger_remote_fetch` to extension
  → Content script receives `trigger_remote_fetch`
  → Dispatches `GVP_HARVESTER_FIRE` (existing)
  → Injected cloneAndFire() executes (existing)
  → Response flows back via existing `harvester_fire_result` / `harvester_error`
  → Desktop UI displays result
```

## Pre-Requisites (Already Implemented)
- `cloneAndFire()` in gvpFetchInterceptor.js (PLAN-038) ✅
- `GVP_HARVESTER_FIRE` event listener (PLAN-038) ✅
- `GVP_HARVESTER_FIRE_RESULT` / `GVP_HARVESTER_ERROR` event reporting (PLAN-038) ✅
- Content bundle forwarding to desktop via WS (PLAN-038) ✅
- Gallery card click automation (just implemented) ✅
- Mode sync on connection (just implemented) ✅
- Cooldown removal (just implemented) ✅

---

## Step 1: Add WS Push Channel to AppState
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{Manager, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};
```

**Replace With:**
```rust
use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{Manager, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
```

---

## Step 2: Add Broadcast Channel to AppState
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
/// Global state shared between WebSocket server and Tauri commands
pub struct AppState {
    pub current_prompt: String,
    pub connection_count: u32,
    pub last_status: String,
    pub last_url: String,
    pub last_image_id: String,
    pub preview_mode: bool,
    pub harvester_mode: bool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            current_prompt: String::new(),
            connection_count: 0,
            last_status: "Ready".to_string(),
            last_url: String::new(),
            last_image_id: String::new(),
            preview_mode: false,
            harvester_mode: true, // Default to true for PLAN-038 reliability
        }
    }
}
```

**Replace With:**
```rust
/// Global state shared between WebSocket server and Tauri commands
pub struct AppState {
    pub current_prompt: String,
    pub connection_count: u32,
    pub last_status: String,
    pub last_url: String,
    pub last_image_id: String,
    pub preview_mode: bool,
    pub harvester_mode: bool,
    /// Broadcast channel for pushing messages FROM Tauri commands TO the WS handler
    pub ws_push_tx: broadcast::Sender<String>,
}

impl AppState {
    fn new() -> Self {
        let (tx, _) = broadcast::channel::<String>(16);
        Self {
            current_prompt: String::new(),
            connection_count: 0,
            last_status: "Ready".to_string(),
            last_url: String::new(),
            last_image_id: String::new(),
            preview_mode: false,
            harvester_mode: true,
            ws_push_tx: tx,
        }
    }
}
```

---

## Step 3: Add `trigger_fire` Tauri Command
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

Add this new command AFTER the `get_harvester_mode` command (after line ~119):

**Find Exact Block:**
```rust
/// Get harvester mode
#[tauri::command]
fn get_harvester_mode(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let s = state.lock();
    Ok(s.harvester_mode)
}
```

**Replace With:**
```rust
/// Get harvester mode
#[tauri::command]
fn get_harvester_mode(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let s = state.lock();
    Ok(s.harvester_mode)
}

/// Trigger a remote fetch fire — pushes a message to the extension WS
/// This is the Desktop→Extension "fire now" command
#[tauri::command]
fn trigger_fire(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<String, String> {
    let s = state.lock();
    let prompt = s.current_prompt.clone();
    let image_id = s.last_image_id.clone();
    
    if prompt.is_empty() {
        return Err("No prompt set. Enter a prompt first.".to_string());
    }
    
    let msg = serde_json::json!({
        "type": "trigger_remote_fetch",
        "payload": {
            "prompt": prompt,
            "imageId": image_id,
        },
        "timestamp": chrono_timestamp()
    });
    
    let msg_str = msg.to_string();
    
    match s.ws_push_tx.send(msg_str.clone()) {
        Ok(n) => {
            println!("[GVP Desktop] 🚀 trigger_fire pushed to {} WS subscribers", n);
            Ok(format!("Fire triggered for imageId: {}", image_id))
        }
        Err(_) => {
            println!("[GVP Desktop] ⚠️ trigger_fire: No active WS connections to receive");
            Err("No extension connected. Open Grok in Chrome first.".to_string())
        }
    }
}
```

---

## Step 4: Subscribe WS Handler to Push Channel
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

Inside `handle_connection()`, AFTER the `ws_stream.split()` line, add a broadcast subscriber and modify the main loop to select between incoming WS messages and push channel messages.

**Find Exact Block:**
```rust
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Handle incoming messages
    while let Some(msg_result) = ws_receiver.next().await {
```

**Replace With:**
```rust
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Subscribe to push channel for Desktop→Extension messages
    let mut push_rx = {
        let s = state.lock();
        s.ws_push_tx.subscribe()
    };

    // Handle incoming WS messages AND push channel messages concurrently
    loop {
        tokio::select! {
            // Push channel: Desktop command wants to send a message to the extension
            push_msg = push_rx.recv() => {
                match push_msg {
                    Ok(msg_str) => {
                        println!("[GVP Desktop] 📤 Pushing message to extension: {}", &msg_str[..msg_str.len().min(120)]);
                        if let Err(e) = ws_sender.send(Message::Text(msg_str)).await {
                            println!("[GVP Desktop] Push send error: {}", e);
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        println!("[GVP Desktop] Push channel lagged by {} messages", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        println!("[GVP Desktop] Push channel closed");
                        break;
                    }
                }
            }
            // Incoming WS message from the extension
            msg_result = ws_receiver.next() => {
        let Some(msg_result) = msg_result else { break };
```

**CRITICAL:** Also close the new `loop` + `select!` + second match arm. The existing `while let` loop body ending must be adjusted. Find the closing of the while loop:

**Find Exact Block (at the end of handle_connection, around line ~330):**
```rust
                            _ => {
                                println!("[GVP Desktop] Unknown message type: {}", msg_type);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                println!("[GVP Desktop] Read error: {}", e);
                break;
            }
        }
    }
```

**Replace With:**
```rust
                            _ => {
                                println!("[GVP Desktop] Unknown message type: {}", msg_type);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                println!("[GVP Desktop] Read error: {}", e);
                break;
            }
        }
            } // close tokio::select! second arm
        } // close tokio::select!
    } // close loop
```

---

## Step 5: Update main() to use AppState::new() and register trigger_fire
**File:** `src-tauri/src/main.rs`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```rust
    // Initialize shared state
    let state = Arc::new(Mutex::new(AppState::default()));
```

**Replace With:**
```rust
    // Initialize shared state (with push channel)
    let state = Arc::new(Mutex::new(AppState::new()));
```

**Find Exact Block:**
```rust
        .invoke_handler(tauri::generate_handler![
            set_prompt,
            get_prompt,
            get_status,
            clear_prompt,
            set_preview_mode,
            get_preview_mode,
            set_harvester_mode,
            get_harvester_mode,
        ])
```

**Replace With:**
```rust
        .invoke_handler(tauri::generate_handler![
            set_prompt,
            get_prompt,
            get_status,
            clear_prompt,
            set_preview_mode,
            get_preview_mode,
            set_harvester_mode,
            get_harvester_mode,
            trigger_fire,
        ])
```

---

## Step 6: Handle `trigger_remote_fetch` in Content Bundle
**File:** `src-extension/content.bundle.js`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```javascript
      case 'mode_sync':
        // Desktop sends this on connection to bootstrap mode state
        interceptGenerations = !!message.payload?.previewMode;
        harvesterModeActive = !!message.payload?.harvesterMode;
        debug('[mode_sync] Received mode state from desktop:', 
          'preview=' + interceptGenerations, 'harvester=' + harvesterModeActive);
        break;
      case 'ping':
```

**Replace With:**
```javascript
      case 'mode_sync':
        // Desktop sends this on connection to bootstrap mode state
        interceptGenerations = !!message.payload?.previewMode;
        harvesterModeActive = !!message.payload?.harvesterMode;
        debug('[mode_sync] Received mode state from desktop:', 
          'preview=' + interceptGenerations, 'harvester=' + harvesterModeActive);
        break;
      case 'trigger_remote_fetch': {
        // Desktop pushes a "fire now" command
        const { prompt: tfPrompt, imageId: tfImageId } = message.payload || {};
        console.log('[REPLAY] 🚀 TRIGGER_REMOTE_FETCH received from Desktop');
        console.log('[REPLAY] Prompt:', tfPrompt ? tfPrompt.substring(0, 80) + '...' : '(none)');
        console.log('[REPLAY] ImageId:', tfImageId || '(none)');
        lastAction = `Remote fire: ${tfPrompt ? tfPrompt.substring(0, 30) + '...' : 'no prompt'}`;
        
        // Dispatch to the injected context for cloneAndFire execution
        const fireEvent = new CustomEvent('GVP_HARVESTER_FIRE', {
          detail: { prompt: tfPrompt, imageId: tfImageId }
        });
        window.dispatchEvent(fireEvent);
        console.log('[REPLAY] ✅ Dispatched GVP_HARVESTER_FIRE to page context');
        break;
      }
      case 'ping':
```

---

## Step 7: Add "Fire" Button to Desktop UI
**File:** `src-desktop/components/PromptInput.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
    const [prompt, setPrompt] = createSignal('');
    const [isLoading, setIsLoading] = createSignal(false);
    const [previewMode, setPreviewMode] = createSignal(false);
    const [harvesterMode, setHarvesterMode] = createSignal(true);
    let textareaRef: HTMLTextAreaElement | undefined;
```

**Replace With:**
```tsx
    const [prompt, setPrompt] = createSignal('');
    const [isLoading, setIsLoading] = createSignal(false);
    const [previewMode, setPreviewMode] = createSignal(false);
    const [harvesterMode, setHarvesterMode] = createSignal(true);
    const [fireStatus, setFireStatus] = createSignal<string | null>(null);
    let textareaRef: HTMLTextAreaElement | undefined;
```

**Find Exact Block:**
```tsx
    const handleKeyDown = (e: KeyboardEvent) => {
        // Ctrl/Cmd + Enter to set prompt
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSetPrompt();
        }
    };
```

**Replace With:**
```tsx
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
```

**Find Exact Block (the button row):**
```tsx
                    <button
                        class="btn btn-primary"
                        onClick={handleSetPrompt}
                        disabled={!prompt().trim() || isLoading()}
                    >
                        {isLoading() ? 'Saving...' : 'Set Prompt'}
                    </button>
                </div>
            </div>
```

**Replace With:**
```tsx
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
                        title="Fire the harvester immediately with the current prompt"
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
```

---

## Step 8: Listen for Fire Results in App.tsx
**File:** `src-desktop/App.tsx`
**Action:** MODIFY_EXISTING

**Find Exact Block:**
```tsx
            // Listen for generation results from backend
            await listen<any>('generation-result', (event) => {
                console.log('[GVP Desktop] Received generation result event:', event);
                handleGenerationResult(event.payload);
            });
```

**Replace With:**
```tsx
            // Listen for generation results from backend
            await listen<any>('generation-result', (event) => {
                console.log('[GVP Desktop] Received generation result event:', event);
                handleGenerationResult(event.payload);
            });

            // Listen for harvester fire results
            await listen<any>('harvester-fire-result', (event) => {
                console.log('[GVP Desktop] 🚀 Harvester fire result:', event.payload);
            });

            await listen<any>('harvester-error', (event) => {
                console.error('[GVP Desktop] ❌ Harvester error:', event.payload);
            });

            await listen<any>('harvester-template-ready', (event) => {
                console.log('[GVP Desktop] 🎯 Skeleton template captured:', event.payload);
            });
```

---

## Verification Plan

### Manual Testing Sequence:
1. Build and run Tauri: `npm run tauri dev`
2. Open Grok in Chrome with extension loaded
3. Verify `[mode_sync]` log appears in browser console on connection
4. Generate one video manually to capture skeleton template
5. Verify `[HARVESTER] ✅ TEMPLATE READY` appears in console
6. Type a new prompt in Desktop UI, click "🚀 Fire"
7. Verify `[REPLAY] 🚀 TRIGGER_REMOTE_FETCH` appears in browser console
8. Verify `[CLONER] 🔄 CLONE & FIRE INITIATED` appears
9. Verify `[FETCH-REPLAY] 📡 RESPONSE RECEIVED` with status 200
10. Verify Desktop UI shows `✅ Fire triggered for imageId: xxx`

### Console Log Tags to Monitor:
- `[REPLAY]` — trigger_remote_fetch receipt
- `[CLONER]` — skeleton clone and body swap
- `[FETCH-REPLAY]` — actual fetch() execution and response
- `[HARVESTER]` — template capture and error events
