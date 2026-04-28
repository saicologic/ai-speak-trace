use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

/// sidecar プロセスをアプリ状態として管理
struct SidecarState(Mutex<Option<CommandChild>>);

/// 開発モード時のバックエンドポート番号を保持（終了時のkillに使用）
struct DevBackendPort(Mutex<Option<String>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(SidecarState(Mutex::new(None)))
        .manage(DevBackendPort(Mutex::new(None)))
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

            // settings.json からポートを読み込む（未設定の場合は3100）
            let backend_port = std::fs::read_to_string(&settings_file)
                .ok()
                .and_then(|content| {
                    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
                    v.get("port")?.as_u64().map(|p| p.to_string())
                })
                .unwrap_or_else(|| "3100".to_string());
            println!("[tauri] BACKEND_PORT={}", backend_port);

            // sidecar（NestJSサーバー）を環境変数付きで起動
            // 開発時は npm run start:dev でバックエンドを別途起動するため、sidecarはスキップ
            if cfg!(debug_assertions) {
                println!("[tauri] 開発モード: sidecar の起動をスキップします（npm run start:dev を使用）");
                // 終了時にバックエンドプロセスをkillできるようポートを保持
                let dev_port_state = app.state::<DevBackendPort>();
                *dev_port_state.0.lock().unwrap() = Some(backend_port.clone());
            } else {
                // 起動前に使用中のポートをkillして競合を防ぐ（本番モードのみ）
                if let Ok(output) = std::process::Command::new("lsof")
                    .args(["-ti", &format!(":{}", backend_port)])
                    .output()
                {
                    if let Ok(pids) = String::from_utf8(output.stdout) {
                        for pid in pids.lines() {
                            if let Ok(pid_num) = pid.trim().parse::<u32>() {
                                let _ = std::process::Command::new("kill")
                                    .args(["-9", &pid_num.to_string()])
                                    .output();
                                println!("[tauri] ポート{}を使用中のプロセス{}を終了しました", backend_port, pid_num);
                            }
                        }
                    }
                }

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

                // sidecarはシェルを経由しないためPATHが最小限になる
                // ffmpeg等の外部コマンドを利用するため、Homebrew等のパスを追加する
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
                    .env("BACKEND_PORT", &backend_port)
                    .env("PODCAST_CACHE_DIR", podcast_cache_dir.to_string_lossy().to_string());

                let (mut rx, child) = sidecar
                    .spawn()
                    .expect("nestjs-server sidecar の起動に失敗しました");

                println!("[tauri] sidecar 起動完了 (DATA_DIR={})", data_dir.display());

                // sidecar プロセスを状態に保存（終了時にkillするため）
                let state = app.state::<SidecarState>();
                *state.0.lock().unwrap() = Some(child);

                // sidecar の stdout/stderr をログに出力
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_shell::process::CommandEvent;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                println!("[nestjs] {}", String::from_utf8_lossy(&line));
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
                // 本番モード: sidecar プロセスを停止
                let state = app_handle.state::<SidecarState>();
                let mut guard = state.0.lock().unwrap();
                if let Some(child) = guard.take() {
                    println!("[tauri] sidecar プロセスを終了します");
                    let _ = child.kill();
                }

                // 開発モード: ポートを占有しているバックエンドプロセスを停止
                let dev_port_state = app_handle.state::<DevBackendPort>();
                let dev_port_guard = dev_port_state.0.lock().unwrap();
                if let Some(port) = dev_port_guard.as_ref() {
                    println!("[tauri] 開発モード: ポート{}のバックエンドプロセスを終了します", port);
                    if let Ok(output) = std::process::Command::new("lsof")
                        .args(["-ti", &format!(":{}", port)])
                        .output()
                    {
                        if let Ok(pids) = String::from_utf8(output.stdout) {
                            for pid in pids.lines() {
                                if let Ok(pid_num) = pid.trim().parse::<u32>() {
                                    let _ = std::process::Command::new("kill")
                                        .args(["-9", &pid_num.to_string()])
                                        .output();
                                    println!("[tauri] ポート{}を使用中のプロセス{}を終了しました", port, pid_num);
                                }
                            }
                        }
                    }
                }
            }
        });
}
