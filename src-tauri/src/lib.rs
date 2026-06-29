use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

/// sidecar プロセスをアプリ状態として管理
struct SidecarState(Mutex<Option<CommandChild>>);

/// バックエンドポートをアプリ状態として管理
/// 開発時は NestJS stdout から、本番時は sidecar stdout から取得してセット
struct BackendPortState(Mutex<Option<u16>>);

/// フロントエンドから invoke でポートを取得するコマンド
#[tauri::command]
fn get_backend_port(state: tauri::State<BackendPortState>) -> Option<u16> {
    *state.0.lock().unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(SidecarState(Mutex::new(None)))
        .manage(BackendPortState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_backend_port])
        .setup(|app| {
            // データ保存先ディレクトリを決定
            // ~/Library/Application Support/io.github.saicologic.ai-speak-trace/data/
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("アプリデータディレクトリの取得に失敗");
            let data_dir = app_data_dir.join("data");
            std::fs::create_dir_all(&data_dir)
                .expect("データディレクトリの作成に失敗");

            // 設定ファイルのパス
            let settings_file = app_data_dir.join("settings.json");

            // 開発時は npm run start:dev でバックエンドを別途起動するため、sidecarはスキップ
            // scripts/dev.mjs が書き込む .backend-port ファイルからポートを読んでセットする
            if cfg!(debug_assertions) {
                println!("[tauri] 開発モード: sidecar の起動をスキップします（npm run start:dev を使用）");

                // プロジェクトルートの .backend-port ファイルからポートを読む
                // tauri dev の cwd は src-tauri/ なので "../" で親ディレクトリを参照
                let port_file = std::path::Path::new("../.backend-port");
                if let Ok(content) = std::fs::read_to_string(port_file) {
                    if let Ok(port) = content.trim().parse::<u16>() {
                        println!("[tauri] 開発モード: バックエンドポート={}", port);
                        let port_state = app.state::<BackendPortState>();
                        *port_state.0.lock().unwrap() = Some(port);
                    }
                } else {
                    println!("[tauri] 開発モード: .backend-port が見つかりません。バックエンド起動待ちです。");
                }
            } else {
                let shell = app.shell();
                // ~/Library/Application Support/... から ~ を逆算
                let home_dir = std::env::var("HOME").unwrap_or_else(|_| {
                    // app_data_dir = /Users/<user>/Library/Application Support/<bundle_id>
                    app_data_dir
                        .ancestors()
                        .find(|p| *p != std::path::Path::new("/") && p.join("Library").exists())
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default()
                });

                // Podcastキャッシュフォルダのパスを明示的に渡す
                let podcast_cache_dir = std::path::PathBuf::from(&home_dir)
                    .join("Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache");
                println!("[tauri] PODCAST_CACHE_DIR={}", podcast_cache_dir.display());

                // バンドルされたffmpegバイナリのパスを解決してNestJSへ渡す
                // externalBinはContents/MacOS/に配置されるため、実行ファイルと同じディレクトリを参照する
                let ffmpeg_path = std::env::current_exe()
                    .expect("実行ファイルパスの取得に失敗")
                    .parent()
                    .expect("実行ファイルの親ディレクトリ取得に失敗")
                    .join("ffmpeg");
                println!("[tauri] FFMPEG_PATH={}", ffmpeg_path.display());

                // sidecarはシェルを経由しないためPATHが最小限になる
                let system_path = std::env::var("PATH").unwrap_or_default();
                let extra_paths = "/opt/homebrew/bin:/usr/local/bin";
                let full_path = if system_path.is_empty() {
                    extra_paths.to_string()
                } else {
                    format!("{}:{}", extra_paths, system_path)
                };

                let sidecar = shell
                    .sidecar("nestjs-server")
                    .expect("nestjs-server sidecar バイナリが見つかりません")
                    .env("HOME", &home_dir)
                    .env("PATH", &full_path)
                    .env("DATA_DIR", data_dir.to_string_lossy().to_string())
                    .env("SETTINGS_FILE", settings_file.to_string_lossy().to_string())
                    .env("PODCAST_CACHE_DIR", podcast_cache_dir.to_string_lossy().to_string())
                    .env("FFMPEG_PATH", ffmpeg_path.to_string_lossy().to_string());

                let (mut rx, child) = sidecar
                    .spawn()
                    .expect("nestjs-server sidecar の起動に失敗しました");

                println!("[tauri] sidecar 起動完了 (DATA_DIR={})", data_dir.display());

                // sidecar プロセスを状態に保存（終了時にkillするため）
                let state = app.state::<SidecarState>();
                *state.0.lock().unwrap() = Some(child);

                // sidecar の stdout/stderr をログに出力し、PORT= 行を検出してフロントへ通知
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_shell::process::CommandEvent;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                let text = String::from_utf8_lossy(&line);
                                println!("[nestjs] {}", text);
                                // "PORT=xxxxx" の行を検出してフロントエンドへ通知
                                if let Some(port_str) = text.trim().strip_prefix("PORT=") {
                                    if let Ok(port) = port_str.parse::<u16>() {
                                        println!("[tauri] バックエンドポート確定: {}", port);
                                        // AppState に保存（invoke 用）
                                        let port_state = app_handle.state::<BackendPortState>();
                                        *port_state.0.lock().unwrap() = Some(port);
                                        // フロントエンドへイベント送信
                                        let _ = app_handle.emit("backend-port", port);
                                    }
                                }
                            }
                            CommandEvent::Stderr(line) => {
                                eprintln!("[nestjs] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Terminated(status) => {
                                println!("[nestjs] プロセス終了: {:?}", status);
                            }
                            _ => {}
                        }
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri アプリのビルドに失敗しました")
        .run(|app_handle, event| {
            // アプリ終了時に sidecar プロセスを停止
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<SidecarState>();
                let mut guard = state.0.lock().unwrap();
                if let Some(child) = guard.take() {
                    println!("[tauri] sidecar プロセスを終了します");
                    let _ = child.kill();
                }
            }
        });
}
