use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

fn attachments_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("attachments");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();
    if cleaned.is_empty() {
        "file".to_string()
    } else {
        cleaned
    }
}

fn unique_name(original: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{}-{}", millis, sanitize_filename(original))
}

/// Copies an external file (e.g. dropped onto the window) into the app's
/// attachment store. Returns the absolute path of the stored copy.
#[tauri::command]
fn import_file(app: tauri::AppHandle, src_path: String) -> Result<String, String> {
    let src = PathBuf::from(&src_path);
    let original = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let dest = attachments_dir(&app)?.join(unique_name(&original));
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// Saves raw bytes (e.g. an image pasted from the clipboard) into the
/// attachment store. Returns the absolute path of the stored file.
#[tauri::command]
fn save_bytes(app: tauri::AppHandle, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let dest = attachments_dir(&app)?.join(unique_name(&filename));
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: r#"
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                is_active INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS debts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                tier TEXT NOT NULL DEFAULT 'inbox',
                status TEXT NOT NULL DEFAULT 'open',
                session_id INTEGER REFERENCES sessions(id),
                source_url TEXT,
                summary TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_touched TEXT NOT NULL DEFAULT (datetime('now')),
                touch_count INTEGER NOT NULL DEFAULT 0,
                resolved_at TEXT
            );
            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                path TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "dig timeboxing fields",
            sql: r#"
            ALTER TABLE debts ADD COLUMN dig_until TEXT;
            ALTER TABLE debts ADD COLUMN time_spent_min INTEGER NOT NULL DEFAULT 0;
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "dig start timestamp",
            sql: "ALTER TABLE debts ADD COLUMN dig_started_at TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "user-defined graphs",
            sql: r#"
            CREATE TABLE IF NOT EXISTS graphs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS graph_nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                graph_id INTEGER NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
                debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(graph_id, debt_id)
            );
            CREATE TABLE IF NOT EXISTS graph_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                graph_id INTEGER NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
                a_debt INTEGER NOT NULL,
                b_debt INTEGER NOT NULL,
                UNIQUE(graph_id, a_debt, b_debt)
            );
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "check content for resolve",
            sql: "ALTER TABLE debts ADD COLUMN check_content TEXT NOT NULL DEFAULT '';",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:studymap.db", migrations)
                .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Emitter;
                use tauri_plugin_global_shortcut::ShortcutState;

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcut("super+shift+d")?
                        .with_handler(|app, _shortcut, event| {
                            if event.state() == ShortcutState::Pressed {
                                if let Some(w) = app.get_webview_window("quick") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                    let _ = w.emit("quick-open", ());
                                }
                            }
                        })
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![import_file, save_bytes])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
