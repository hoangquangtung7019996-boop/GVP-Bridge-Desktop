# Plan: Resolve SQLite Dependency Conflict (PLAN_041B)

The current build is failing because both `tauri-plugin-sql` and `rusqlite` (with `bundled`) are attempting to link the `sqlite3` library.

## Proposed Changes

### [Rust Backend]

#### [MODIFY] [Cargo.toml](file:///a:/Tools%20n%20Programs/GVP-Desktop/src-tauri/Cargo.toml)
Replace `rusqlite` with `sqlx` to match the underlying database engine used by `tauri-plugin-sql`.

- Remove `rusqlite`
- Add `sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio", "tls-rustls"] }`

#### [MODIFY] [main.rs](file:///a:/Tools%20n%20Programs/GVP-Desktop/src-tauri/src/main.rs)
Port the ingestion and normalization logic from synchronous `rusqlite` to asynchronous `sqlx`.

- Update `AppState` to use `sqlx::SqlitePool`.
- Update `init_gallery_db` to be `async` and use `sqlx`.
- Update `ingest_gallery_batch` to be `async` and use `sqlx`.
- Update the WebSocket loop and `main()` to handle the async DB operations.

## Verification Plan

### Automated Tests
- Run `cargo check` in `src-tauri` to ensure the conflict is resolved.
- Run `cargo build` to verify successful compilation.

### Manual Verification
- Once built, verify that the `gallery.db` is created and the schema is initialized.
- Test the integration with the Ghost Window (fetching data and seeing it ingested into the DB).
