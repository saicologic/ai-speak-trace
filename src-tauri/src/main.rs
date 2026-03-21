// macOSでターミナルウィンドウを非表示にする
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_speak_trace_lib::run()
}
