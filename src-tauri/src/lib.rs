mod domain;
mod services;

use domain::{Dashboard, SessionDetail};

#[tauri::command]
async fn get_dashboard() -> Result<Dashboard, String> {
    tauri::async_runtime::spawn_blocking(services::collect_dashboard)
        .await
        .map_err(|error| format!("バックグラウンド取得に失敗しました: {error}"))
}

#[tauri::command]
async fn get_session(path: String) -> Result<SessionDetail, String> {
    tauri::async_runtime::spawn_blocking(move || services::load_session(&path))
        .await
        .map_err(|error| format!("セッション取得に失敗しました: {error}"))?
}

#[tauri::command]
async fn send_message(address: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || services::send_network_message(&address, &message))
        .await
        .map_err(|error| format!("送信処理に失敗しました: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_dashboard,
            get_session,
            send_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running Reason Network");
}
