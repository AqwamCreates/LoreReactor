use tauri_plugin_shell::ShellExt;
use std::net::TcpStream;
use std::thread;
use std::time::Duration;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        // ✅ FIX: Added `let _ = ` to explicitly ignore the Result and silence the warning
        let _ = app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        );
      }

      // 1. Spawn the Express backend sidecar
      let sidecar_command = app.handle().shell().sidecar("server")
          .expect("Failed to initialize sidecar command. Is 'server' defined in tauri.conf.json externalBin?");
          
      let (_rx, _child) = sidecar_command
          .spawn()
          .expect("Failed to spawn Express backend sidecar");

      // 2. Poll indefinitely every 300ms until the backend is fully up and listening
      loop {
        if TcpStream::connect("127.0.0.1:8448").is_ok() {
          break;
        }
        thread::sleep(Duration::from_millis(300));
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("Error while building tauri application");
}