#[cfg(target_os = "android")]
mod android_engine;
mod convert;
mod download;
mod logs;
mod platform;
mod tools;

use convert::ActiveConvert;
use download::ActiveDownload;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Sharing a link into mp3fy is a second launch on Windows and Linux: the
    // OS starts the app again with the URL as an argument. Single-instance
    // hands those arguments to the copy already running (its `deep-link`
    // feature does the forwarding) and raises its window — otherwise every
    // shared link would open another empty mp3fy. It must be registered
    // before any other plugin. macOS delivers the URL as an event instead,
    // so this whole branch is a no-op there.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    // Android carries its own yt-dlp instead of downloading one; the engine
    // plugin is the bridge to it.
    #[cfg(target_os = "android")]
    let builder = builder.plugin(android_engine::init());

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ActiveDownload::default())
        .manage(ActiveConvert::default())
        .invoke_handler(tauri::generate_handler![
            tools::ensure_tools,
            tools::tools_report,
            tools::update_ytdlp,
            tools::fetch_info,
            tools::downloads_folder,
            tools::take_shared_link,
            download::start_download,
            download::cancel_download,
            convert::convert_file,
            convert::cancel_convert,
            platform::file_exists,
            platform::open_file,
            platform::safe_area_insets,
            platform::show_media_notification,
            platform::hide_media_notification,
            logs::get_logs,
            logs::log_event
        ])
        .setup(|_app| {
            // Windows and Linux only know the app owns `mp3fy://` once it is
            // written to the registry / the desktop database. An installer
            // does that, but a dev build or an unpacked AppImage never was
            // installed — registering at startup makes sharing work anyway.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = _app.deep_link().register_all() {
                    logs::log("app", format!("could not register the mp3fy:// scheme: {e}"));
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
