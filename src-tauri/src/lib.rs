//! Desktop shell for the System Design Visualizer.
//!
//! The frontend is the same static app that runs in a browser; the shell exists
//! to do the two things a browser sandbox cannot: install the authoring skill
//! into the user's agent directories, and open design files from anywhere on
//! disk rather than only from the bundled `designs/` folder.

mod designs;
mod skill_install;

use designs::UserDesign;
use skill_install::SkillStatus;

#[tauri::command]
fn skill_status() -> SkillStatus {
    skill_install::status()
}

#[tauri::command]
fn install_skill(force: bool) -> Result<SkillStatus, String> {
    skill_install::install(force)
}

#[tauri::command]
fn remove_skill() -> Result<SkillStatus, String> {
    skill_install::remove()
}

#[tauri::command]
fn skill_markdown() -> String {
    skill_install::markdown()
}

/// Read a design file chosen through the native dialog.
///
/// The frontend receives text and hands it to the same `applyRaw` path a
/// dragged file takes, so the desktop build adds a doorway, not a code path.
#[tauri::command]
fn read_design_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("could not read {path}: {e}"))
}

/// The user's design library — everything the skill has written, from any repo.
#[tauri::command]
fn list_user_designs() -> Vec<UserDesign> {
    designs::list()
}

/// Absolute path of the library, shown in the UI and used by the skill.
#[tauri::command]
fn designs_dir() -> String {
    designs::designs_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn open_designs_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = designs::ensure_dir()?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("could not open the designs folder: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            skill_status,
            install_skill,
            remove_skill,
            skill_markdown,
            read_design_file,
            list_user_designs,
            designs_dir,
            open_designs_dir
        ])
        .setup(|_app| {
            // Create the library up front so the skill can assume it exists and
            // the user can find it before saving anything there.
            let _ = designs::ensure_dir();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the System Design Visualizer");
}
