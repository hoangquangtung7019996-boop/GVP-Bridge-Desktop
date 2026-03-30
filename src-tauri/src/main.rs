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
use tauri::{Manager, Emitter};
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
    pub preview_mode: bool,
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

/// Set preview mode
#[tauri::command]
fn set_preview_mode(enabled: bool, state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let mut s = state.lock();
    s.preview_mode = enabled;
    println!("[GVP Desktop] Preview mode: {}", enabled);
    Ok(enabled)
}

/// Get preview mode
#[tauri::command]
fn get_preview_mode(state: tauri::State<Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let s = state.lock();
    Ok(s.preview_mode)
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

    // Emit connection event to frontend (Tauri v2 uses .emit)
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
                            // Preview mode: card clicked in gallery
                            "preview_card_clicked" => {
                                let image_id = payload["imageId"].as_str().unwrap_or("");
                                println!("[GVP Desktop] Preview card clicked: {}", image_id);
                                
                                // Get current prompt and preview mode
                                let prompt = {
                                    let s = state.lock();
                                    s.current_prompt.clone()
                                };
                                let preview_mode = {
                                    let s = state.lock();
                                    s.preview_mode
                                };
                                
                                // Send prompt response (will trigger direct API call in extension)
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode
                                    },
                                    "timestamp": chrono_timestamp()
                                });
                                
                                if let Err(e) = ws_sender.send(Message::Text(response.to_string())).await {
                                    println!("[GVP Desktop] Send error: {}", e);
                                    break;
                                }
                            }

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

                                // Get preview mode
                                let preview_mode = {
                                    let s = state.lock();
                                    s.preview_mode
                                };

                                // Send prompt response
                                let response = serde_json::json!({
                                    "type": "prompt_response",
                                    "payload": {
                                        "prompt": prompt,
                                        "imageId": image_id,
                                        "previewMode": preview_mode
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

                            // Extension reports generation result
                            "generation_result" => {
                                println!("[GVP Desktop] Received generation_result");
                                // Forward directly to frontend
                                let _ = app_handle.emit("generation-result", payload);
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

#[tokio::main]
async fn main() {
    // Initialize shared state
    let state = Arc::new(Mutex::new(AppState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state.clone())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<Arc<Mutex<AppState>>>();
            let state_clone = state.inner().clone();

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
            set_preview_mode,
            get_preview_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
