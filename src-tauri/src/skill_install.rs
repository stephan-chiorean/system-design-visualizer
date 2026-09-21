//! Global install of the bundled authoring skill.
//!
//! The skill is what teaches an agent to emit the design JSON this app renders,
//! so shipping the renderer without a way to install the skill leaves the user
//! holding half a tool. The markdown is embedded at compile time — there is no
//! resource to locate at runtime and no way for the bundle to arrive incomplete.
//!
//! Each install target is classified before anything is written:
//!
//!   Missing — nothing there
//!   Managed — we installed it and it still matches what we installed
//!   Stale   — we installed it, ours has since changed (safe to refresh)
//!   Custom  — present, but not matching any fingerprint we wrote
//!
//! `Custom` is never overwritten without an explicit force. Someone who edited
//! the skill meant it, and silently clobbering that is the one unrecoverable
//! thing this code could do.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// The skill markdown, embedded from the repo at build time.
const SKILL_MD: &str = include_str!("../../skill/system-design-visualizer/SKILL.md");

/// Bumped when the skill's content changes meaningfully. Shown in the UI so a
/// user can tell an old install from a current one.
const SKILL_VERSION: u32 = 1;

const SKILL_DIR_NAME: &str = "system-design-visualizer";
const MARKER_FILE: &str = ".managed-by-sdv.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillState {
    Missing,
    Managed,
    Stale,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillTarget {
    /// `claude` or `codex` — which agent this directory serves.
    pub agent: String,
    /// Absolute path of the skill directory for this target.
    pub dir: String,
    /// Whether the agent's root (`~/.claude`) exists at all.
    pub agent_present: bool,
    pub state: SkillState,
    /// Version recorded by our marker, when there is one.
    pub installed_version: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillStatus {
    pub bundle_version: u32,
    pub targets: Vec<SkillTarget>,
    /// True when at least one target would change if the user pressed Install.
    pub can_install: bool,
}

#[derive(Serialize, Deserialize)]
struct Marker {
    version: u32,
    fingerprint: String,
}

fn fingerprint(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn agent_roots() -> Vec<(String, PathBuf)> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    vec![
        ("claude".to_string(), home.join(".claude")),
        ("codex".to_string(), home.join(".codex")),
    ]
}

fn classify(dir: &Path) -> (SkillState, Option<u32>) {
    let skill_file = dir.join("SKILL.md");
    if !skill_file.exists() {
        return (SkillState::Missing, None);
    }

    let installed = match fs::read_to_string(&skill_file) {
        Ok(text) if !text.trim().is_empty() => text,
        // Present but unreadable or empty: treat as ours to replace.
        _ => return (SkillState::Stale, None),
    };

    let marker: Option<Marker> = fs::read_to_string(dir.join(MARKER_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());

    let Some(marker) = marker else {
        // No marker: someone else's file, or a hand-copied one. Leave it alone.
        return (SkillState::Custom, None);
    };

    let installed_fp = fingerprint(&installed);
    if installed_fp != marker.fingerprint {
        // We installed it, but it has been edited since. Still the user's work.
        return (SkillState::Custom, Some(marker.version));
    }
    if installed_fp == fingerprint(SKILL_MD) {
        (SkillState::Managed, Some(marker.version))
    } else {
        (SkillState::Stale, Some(marker.version))
    }
}

pub fn status() -> SkillStatus {
    let targets: Vec<SkillTarget> = agent_roots()
        .into_iter()
        .map(|(agent, root)| {
            let dir = root.join("skills").join(SKILL_DIR_NAME);
            let (state, installed_version) = classify(&dir);
            SkillTarget {
                agent,
                agent_present: root.exists(),
                dir: dir.to_string_lossy().to_string(),
                state,
                installed_version,
            }
        })
        .collect();

    let can_install = targets
        .iter()
        .any(|t| t.agent_present && matches!(t.state, SkillState::Missing | SkillState::Stale));

    SkillStatus {
        bundle_version: SKILL_VERSION,
        targets,
        can_install,
    }
}

/// Install into every agent directory that exists.
///
/// `force` is the user explicitly choosing to overwrite a copy they edited; it
/// is never set on their behalf.
pub fn install(force: bool) -> Result<SkillStatus, String> {
    for (_, root) in agent_roots() {
        // Only serve agents the user actually has. Creating `~/.codex` for
        // someone who does not use Codex would be presumptuous.
        if !root.exists() {
            continue;
        }

        let dir = root.join("skills").join(SKILL_DIR_NAME);
        let (state, _) = classify(&dir);
        if state == SkillState::Custom && !force {
            continue;
        }

        fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        fs::write(dir.join("SKILL.md"), SKILL_MD)
            .map_err(|e| format!("could not write the skill to {}: {e}", dir.display()))?;

        let marker = Marker {
            version: SKILL_VERSION,
            fingerprint: fingerprint(SKILL_MD),
        };
        fs::write(
            dir.join(MARKER_FILE),
            serde_json::to_string_pretty(&marker).unwrap_or_default(),
        )
        .map_err(|e| format!("could not write the install marker: {e}"))?;
    }

    Ok(status())
}

/// Remove only what we installed. A `Custom` copy is left in place.
pub fn remove() -> Result<SkillStatus, String> {
    for (_, root) in agent_roots() {
        let dir = root.join("skills").join(SKILL_DIR_NAME);
        let (state, _) = classify(&dir);
        if matches!(state, SkillState::Managed | SkillState::Stale) {
            fs::remove_dir_all(&dir)
                .map_err(|e| format!("could not remove {}: {e}", dir.display()))?;
        }
    }
    Ok(status())
}

pub fn markdown() -> String {
    SKILL_MD.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // `dirs::home_dir` reads $HOME, and these tests move it. Serialize them so
    // one test's home is never in effect during another's.
    static HOME_LOCK: Mutex<()> = Mutex::new(());

    struct FakeHome {
        dir: PathBuf,
        previous: Option<String>,
    }

    impl FakeHome {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("sdv-skill-test-{name}"));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(dir.join(".claude")).unwrap();
            let previous = std::env::var("HOME").ok();
            std::env::set_var("HOME", &dir);
            FakeHome { dir, previous }
        }
        fn claude_skill_dir(&self) -> PathBuf {
            self.dir.join(".claude/skills").join(SKILL_DIR_NAME)
        }
    }

    impl Drop for FakeHome {
        fn drop(&mut self) {
            match &self.previous {
                Some(p) => std::env::set_var("HOME", p),
                None => std::env::remove_var("HOME"),
            }
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn claude_target(status: &SkillStatus) -> SkillTarget {
        status
            .targets
            .iter()
            .find(|t| t.agent == "claude")
            .cloned()
            .unwrap()
    }

    #[test]
    fn installs_then_reports_managed() {
        let _guard = HOME_LOCK.lock().unwrap();
        let home = FakeHome::new("install");

        assert_eq!(claude_target(&status()).state, SkillState::Missing);

        let after = install(false).unwrap();
        assert_eq!(claude_target(&after).state, SkillState::Managed);
        assert_eq!(
            fs::read_to_string(home.claude_skill_dir().join("SKILL.md")).unwrap(),
            SKILL_MD
        );
        assert!(!after.can_install, "a fresh install should need no further work");
    }

    #[test]
    fn skips_codex_when_the_user_has_none() {
        let _guard = HOME_LOCK.lock().unwrap();
        let home = FakeHome::new("no-codex");

        install(false).unwrap();
        assert!(
            !home.dir.join(".codex").exists(),
            "must not create an agent directory the user does not have"
        );
    }

    #[test]
    fn a_user_edited_skill_is_never_overwritten() {
        let _guard = HOME_LOCK.lock().unwrap();
        let home = FakeHome::new("custom");

        install(false).unwrap();
        let file = home.claude_skill_dir().join("SKILL.md");
        fs::write(&file, "# my own version").unwrap();

        assert_eq!(claude_target(&status()).state, SkillState::Custom);

        install(false).unwrap();
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "# my own version",
            "install without force must leave an edited skill alone"
        );

        install(true).unwrap();
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            SKILL_MD,
            "install with force is the user explicitly choosing to overwrite"
        );
    }

    #[test]
    fn a_foreign_skill_without_our_marker_reads_as_custom() {
        let _guard = HOME_LOCK.lock().unwrap();
        let home = FakeHome::new("foreign");

        let dir = home.claude_skill_dir();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), "# installed by hand").unwrap();

        assert_eq!(claude_target(&status()).state, SkillState::Custom);
        install(false).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("SKILL.md")).unwrap(),
            "# installed by hand"
        );
    }

    #[test]
    fn stale_installs_refresh_without_force() {
        let _guard = HOME_LOCK.lock().unwrap();
        let home = FakeHome::new("stale");

        // Simulate an older bundle: content plus a marker that matches it.
        let dir = home.claude_skill_dir();
        fs::create_dir_all(&dir).unwrap();
        let old = "# an older shipped skill";
        fs::write(dir.join("SKILL.md"), old).unwrap();
        fs::write(
            dir.join(MARKER_FILE),
            serde_json::to_string(&Marker {
                version: 0,
                fingerprint: fingerprint(old),
            })
            .unwrap(),
        )
        .unwrap();

        let before = status();
        assert_eq!(claude_target(&before).state, SkillState::Stale);
        assert!(before.can_install);

        install(false).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("SKILL.md")).unwrap(),
            SKILL_MD,
            "a copy we installed and have since updated should refresh silently"
        );
    }

    #[test]
    fn remove_deletes_ours_and_spares_theirs() {
        let _guard = HOME_LOCK.lock().unwrap();
        let home = FakeHome::new("remove");

        install(false).unwrap();
        remove().unwrap();
        assert!(!home.claude_skill_dir().exists());

        let dir = home.claude_skill_dir();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), "# mine").unwrap();
        remove().unwrap();
        assert!(dir.join("SKILL.md").exists(), "remove must not touch a custom copy");
    }
}
