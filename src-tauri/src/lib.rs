use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

/// sidecar プロセスをアプリ状態として管理
struct SidecarState(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            // データ保存先ディレクトリを決定
            // ~/Library/Application Support/com.saicologic.ai-speak-trace/data/
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("アプリデータディレクトリの取得に失敗");
            let data_dir = app_data_dir.join("data");
            std::fs::create_dir_all(&data_dir)
                .expect("データディレクトリの作成に失敗");

            // 設定ファイルのパス
            let settings_file = app_data_dir.join("settings.json");

            // sidecar（NestJSサーバー）を環境変数付きで起動
            let shell = app.shell();
            let sidecar = shell
                .sidecar("nestjs-server")
                .expect("nestjs-server sidecar バイナリが見つかりません")
                .env("DATA_DIR", data_dir.to_string_lossy().to_string())
                .env("SETTINGS_FILE", settings_file.to_string_lossy().to_string());

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
