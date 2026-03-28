# Implementation Plan — Migrate to Tauri v2

**Plan ID:** PLAN-006
**Feature:** Upgrade from Tauri v1 to Tauri v2
**Target:** `GVP-Bridge-Desktop`
**Date:** 2025-03-28
**Depends On:** PLAN-005
**Priority:** HIGH - Required for Windows 10 LTSC compatibility

---

## Overview

The current Tauri v1 implementation fails on Windows 10 IoT Enterprise LTSC with error 216. A fresh Tauri v2 test app works perfectly. This plan migrates the existing project to Tauri v2.

**Total Steps:** 7
**Estimated Time:** 30 minutes

---

## Why Tauri v2?

| Issue | Tauri v1 | Tauri v2 |
|-------|----------|----------|
| WebView2 on LTSC | Error 216 | Works |
| webview2-com | v0.19 | v0.38 |
| Better async handling | No | Yes |
| Windows 10 LTSC | Issues | Compatible |

---

## STEP 1 — Update package.json

**File:** `package.json`
**Action:** REPLACE ENTIRE FILE

```json
{
  "name": "gvp-quick",
  "version": "0.1.0",
  "description": "GVP Bridge Desktop - WebSocket bridge for Grok automation",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "solid-js": "^1.8.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@tauri-apps/api": "^2.0.0",
    "vite": "^5.0.0",
    "vite-plugin-solid": "^2.8.0",
    "typescript": "^5.3.0"
  }
}
```

---

## STEP 2 — Update Cargo.toml

**File:** `src-tauri/Cargo.toml`
**Action:** REPLACE ENTIRE FILE

```toml
[package]
name = "gvp-quick"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["full"] }
tokio-tungstenite = "0.24"
futures-util = "0.3"
parking_lot = "0.12"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

---

## STEP 3 — Update tauri.conf.json (v2 format)

**File:** `src-tauri/tauri.conf.json`
**Action:** REPLACE ENTIRE FILE

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "GVP Bridge",
  "version": "0.1.0",
  "identifier": "com.gvp.bridge",
  "build": {
    "beforeBuildCommand": "npm run build",
    "beforeDevCommand": "npm run dev",
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173"
  },
  "app": {
    "windows": [
      {
        "title": "GVP Bridge",
        "width": 400,
        "height": 300,
        "resizable": true,
        "alwaysOnTop": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

---

## STEP 4 — Update main.rs for Tauri v2

**File:** `src-tauri/src/main.rs`
**Action:** REPLACE ENTIRE FILE

```rust
// GVP Bridge - Desktop App Backend (Tauri v2)
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
    let _ = app_handle.emit("ws-connection", {
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
                                let _ = app_handle.emit("prompt-sent", image_id);
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
                                let _ = app_handle.emit("url-changed", serde_json::json!({
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
                                let _ = app_handle.emit("status-update", serde_json::json!({
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
    let _ = app_handle.emit("ws-connection", "Disconnected");

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
// MAIN (Tauri v2 style)
// ============================================================================

fn main() {
    // Initialize shared state
    let state = Arc::new(Mutex::new(AppState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state.clone())
        .setup(move |app| {
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

---

## STEP 5 — Update build.rs

**File:** `src-tauri/build.rs`
**Action:** REPLACE ENTIRE FILE

```rust
fn main() {
    tauri_build::build()
}
```

---

## STEP 6 — Clean and Reinstall

**Action:** RUN TERMINAL COMMANDS

```powershell
cd "A:\Tools n Programs\GVP-Desktop"

# Delete old dependencies and build cache
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force src-tauri\target -ErrorAction SilentlyContinue
Remove-Item package-lock.json -ErrorAction SilentlyContinue

# Reinstall dependencies
npm install

# Run the app
npm run tauri dev
```

---

## STEP 7 — Verify

**Action:** RUN AND VERIFY

After running `npm run tauri dev`, verify:
- [ ] No compilation errors
- [ ] Window opens
- [ ] Console shows: `[GVP Desktop] WebSocket server started on 127.0.0.1:8765`

---

## VERIFICATION CHECKLIST

| Check | Expected |
|-------|----------|
| `package.json` uses tauri v2 | YES |
| `Cargo.toml` uses tauri v2 | YES |
| `tauri.conf.json` v2 format | YES |
| `main.rs` v2 API style | YES |
| `npm install` succeeds | YES |
| `npm run tauri dev` launches | YES |
| WebSocket on :8765 | YES |

---

## KEY CHANGES FROM v1 TO v2

| Component | v1 | v2 |
|-----------|----|----|
| Config schema | No schema | `$schema` property |
| Config format | `build.devPath` | `build.devUrl` |
| Config format | `build.distDir` | `build.frontendDist` |
| Config format | `package` root | `productName`, `version`, `identifier` at root |
| Config format | `tauri.windows` | `app.windows` |
| Config format | `tauri.allowlist` | Removed (plugins handle this) |
| Shell plugin | Built-in | `tauri-plugin-shell` |
| Events | `emit_all` | `emit` |

---

## END OF PLAN

**STOP after completing all 7 steps.**
**Produce Work Report as specified in `/report` workflow.**
