# Walkthrough — Tauri v2 Migration (PLAN-006)

This walkthrough documents the successful migration of the GVP Bridge Desktop application from Tauri v1.5 to Tauri v2.0. This upgrade resolves critical "OS Error 216" compatibility issues on Windows 10 LTSC environments.

---

## 1. Environment Modernization

The migration involved a complete overhaul of the project dependencies and configuration schemas to align with the Tauri v2 standards.

### 1.1 Node & NPM
- Upgraded `@tauri-apps/cli` and `@tauri-apps/api` to `v2.x`.
- Performed a full `node_modules` clean and reinstall to ensure dependency resolution.

### 1.2 Rust & Cargo
- Upgraded the `tauri` crate to version `2.0`.
- Integrated the new modular plugin system with `tauri-plugin-shell`.

---

## 2. Code Refactoring

The backend logic was modernized for the Tauri v2 API, focusing on async safety and the new Event Emitter pattern.

### 2.1 Emitter Trait Integration
Implemented the `tauri::Emitter` trait to enable event broadcasting from the `AppHandle` to the SolidJS frontend.

### 2.2 Async Runtime Fix
Wrapped the `main` function in a `#[tokio::main]` async runtime, ensuring that the background WebSocket server can be spawned reliably within an asynchronous context.

### 2.3 Closure Ownership
Resolved a critical "borrowed data escapes closure" error by explicitly cloning the `AppHandle` and shared `AppState` before moving them into the server thread.

---

## 3. Verification & Proof

### 3.1 Successful Compilation
The application was rebuilt from a clean state.
```powershell
Finished `dev` profile [unoptimized + debuginfo] target(s) in 13.99s
```

### 3.2 Runtime Confirmation
The application launches without the previous architecture panic. The WebSocket server initializes correctly on the designated port.
```
Running `target\debug\gvp-quick.exe`
[GVP Desktop] WebSocket server started on 127.0.0.1:8765
```

---

## 4. How to Test
1. Run `$env:PATH = "$HOME\.cargo\bin;" + $env:PATH; npm run tauri dev`.
2. Confirm the UI window opens.
3. Observe the `[GVP Desktop] WebSocket server started` message in the console.
