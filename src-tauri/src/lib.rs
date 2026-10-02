/// Desktop shell around the Vite build.
///
/// Open and drag-and-drop stay in the WebView (`dragDropEnabled: false`).
/// The page receives a `File` and the existing `Blob.slice` path reads a
/// multi-gigabyte PLY in chunks. Do not read that path into a second buffer.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running 3Dviewer");
}
