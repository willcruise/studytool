use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

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

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn add_zip_file(zip: &mut ZipWriter<fs::File>, path: &Path, name: &str) -> Result<(), String> {
    if !path.is_file() {
        return Ok(());
    }
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file(name, opts).map_err(|e| e.to_string())?;
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    zip.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// Packs the SQLite DB and attachment files into a zip at dest_path.
#[tauri::command]
fn export_backup(app: tauri::AppHandle, dest_path: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let file = fs::File::create(&dest_path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    for name in ["studymap.db", "studymap.db-wal", "studymap.db-shm"] {
        add_zip_file(&mut zip, &dir.join(name), name)?;
    }
    let att = dir.join("attachments");
    if att.is_dir() {
        for entry in fs::read_dir(&att).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() {
                let fname = entry.file_name().to_string_lossy().to_string();
                add_zip_file(&mut zip, &path, &format!("attachments/{fname}"))?;
            }
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn safe_zip_path(name: &str) -> Option<PathBuf> {
    if Path::new(name).is_absolute() || name.contains("..") {
        return None;
    }
    if name == "studymap.db" || name == "studymap.db-wal" || name == "studymap.db-shm" {
        return Some(PathBuf::from(name));
    }
    if let Ok(rest) = Path::new(name).strip_prefix("attachments") {
        if rest.as_os_str().is_empty() {
            return None;
        }
        return Some(PathBuf::from("attachments").join(rest));
    }
    None
}

/// Restores DB + attachments from a zip. Caller should reload the app afterwards.
#[tauri::command]
fn import_backup(app: tauri::AppHandle, src_path: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    fs::create_dir_all(dir.join("attachments")).map_err(|e| e.to_string())?;
    let file = fs::File::open(&src_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut saw_db = false;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(rel) = safe_zip_path(entry.name()) else {
            continue;
        };
        if rel.file_name().and_then(|n| n.to_str()) == Some("studymap.db") {
            saw_db = true;
        }
        let dest = dir.join(&rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(&dest).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        out.write_all(&buf).map_err(|e| e.to_string())?;
    }
    if !saw_db {
        return Err("백업에 studymap.db가 없습니다".into());
    }
    Ok(())
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
        Migration {
            version: 6,
            description: "cache rename, parent split, source file, spaced review",
            sql: r#"
            UPDATE debts SET tier = 'cache' WHERE tier = 'l1';
            ALTER TABLE debts ADD COLUMN parent_id INTEGER;
            ALTER TABLE debts ADD COLUMN source_file TEXT;
            ALTER TABLE debts ADD COLUMN next_review_at TEXT;
            ALTER TABLE debts ADD COLUMN review_stage INTEGER NOT NULL DEFAULT 0;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "undirected graph edges with optional name and direction",
            sql: r#"
            ALTER TABLE graph_edges ADD COLUMN directed INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE graph_edges ADD COLUMN label TEXT NOT NULL DEFAULT '';
            "#,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
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
            paint_dark_windows(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            import_file,
            save_bytes,
            export_backup,
            import_backup
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

fn paint_dark_windows(app: &tauri::AppHandle) {
    let dark = tauri::window::Color(0x0e, 0x11, 0x16, 255);
    for label in ["main", "quick", "dig"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.set_background_color(Some(dark));
        }
    }
}

#[cfg(target_os = "macos")]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
