//! The user's design library.
//!
//! Designs bundled with the app live inside it and are read-only. That is fine
//! for the worked examples and useless for everything else: an agent invoked in
//! some unrelated repo has nowhere to put what it writes, and asking the user
//! where the visualizer lives turns a global skill back into a local one.
//!
//! So there is one fixed, absolute location — `~/.system-design-visualizer/
//! designs` — that the skill can always write to and the app always reads. It is
//! scanned rather than indexed by a manifest, because a manifest is a second
//! thing to keep in sync and the agent writing the file is not in a good
//! position to edit it.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct UserDesign {
    /// Absolute path, passed straight back to `read_design_file`.
    pub path: String,
    /// The design's own `title`, falling back to the file name.
    pub title: String,
    pub file_name: String,
}

pub fn designs_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".system-design-visualizer")
        .join("designs")
}

/// Create the library directory if it is missing, so the skill can assume it
/// exists and the user can find it before ever saving anything there.
pub fn ensure_dir() -> Result<PathBuf, String> {
    let dir = designs_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Every `.json` in the library, newest first.
///
/// A file that is not readable or not a JSON object is skipped rather than
/// failing the listing — one malformed design should not empty the picker.
pub fn list() -> Vec<UserDesign> {
    let dir = designs_dir();
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut found: Vec<(std::time::SystemTime, UserDesign)> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension()?.to_str()? != "json" {
                return None;
            }

            let file_name = path.file_name()?.to_string_lossy().to_string();
            let text = fs::read_to_string(&path).ok()?;
            let title = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v.get("title")?.as_str().map(str::to_string))
                .unwrap_or_else(|| file_name.trim_end_matches(".json").to_string());

            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((
                modified,
                UserDesign {
                    path: path.to_string_lossy().to_string(),
                    title,
                    file_name,
                },
            ))
        })
        .collect();

    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, d)| d).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_come_from_the_design_and_fall_back_to_the_file_name() {
        let home = std::env::temp_dir().join("sdv-designs-test");
        let _ = fs::remove_dir_all(&home);
        let dir = home.join(".system-design-visualizer/designs");
        fs::create_dir_all(&dir).unwrap();

        fs::write(dir.join("titled.json"), r#"{"title":"Rate Limiter"}"#).unwrap();
        fs::write(dir.join("untitled.json"), r#"{"nodes":[]}"#).unwrap();
        fs::write(dir.join("broken.json"), "not json at all").unwrap();
        fs::write(dir.join("ignored.txt"), "{}").unwrap();

        let previous = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home);
        let listed = list();
        match previous {
            Some(p) => std::env::set_var("HOME", p),
            None => std::env::remove_var("HOME"),
        }

        let titles: Vec<&str> = listed.iter().map(|d| d.title.as_str()).collect();
        assert!(titles.contains(&"Rate Limiter"), "reads the design's own title");
        assert!(titles.contains(&"untitled"), "falls back to the file name");
        assert!(!titles.iter().any(|t| *t == "ignored"), "ignores non-JSON files");
        assert_eq!(listed.len(), 3, "a malformed design is listed, not fatal");

        let _ = fs::remove_dir_all(&home);
    }
}
