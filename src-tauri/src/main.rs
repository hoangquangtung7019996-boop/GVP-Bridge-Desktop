// TODO: Implement WebSocket server
// 
// Requirements:
// 1. Start WebSocket server on port 3001
// 2. Accept connections from Chrome extension
// 3. Handle messages:
//    - { "type": "prompt_requested" } → respond with current prompt
//    - { "type": "url_changed", "url": "...", "imageId": "..." } → log it
//    - { "type": "injected", "success": true } → update status
//    - { "type": "submitted", "success": true } → update status
//    - { "type": "error", "message": "..." } → show error
// 4. Expose Tauri command to set prompt from frontend
// 5. Expose Tauri command to get current status
//
// See PROJECT_CONTEXT.md for full protocol spec

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::Manager;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
use futures_util::{SinkExt, StreamExt};

// Shared state for prompt
struct AppState {
    current_prompt: Arc<Mutex<String>>,
    current_status: Arc<Mutex<String>>,
}

fn main() {
    // TODO: Initialize shared state
    // TODO: Start WebSocket server in background task
    // TODO: Register Tauri commands
    
    tauri::Builder::default()
        // .setup(|app| {
        //     // Start WebSocket server here
        //     Ok(())
        // })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// TODO: Implement these Tauri commands
// #[tauri::command]
// fn set_prompt(prompt: String, state: tauri::State<AppState>) -> Result<(), String> { }

// #[tauri::command]
// fn get_status(state: tauri::State<AppState>) -> Result<String, String> { }
