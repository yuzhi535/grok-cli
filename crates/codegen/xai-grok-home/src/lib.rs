//! Single source of truth for the Gcode home directory: `$GCODE_HOME`, legacy
//! `$GORK_HOME` / `$GROK_HOME`, or `<home>/.gcode`. Shared by `xai-grok-config` and
//! `xai-fast-worktree`.
//!
//! Which function to call:
//! - [`grok_home`]: the usual choice, a cached, created path to build on.
//! - [`user_grok_home`]: `None` instead of a cwd fallback when no home resolves.
//! - [`default_grok_home`]: the `<home>/.gcode` default, ignoring overrides, so callers can detect one.
//! - [`resolve_grok_home`]: a fresh, uncached resolve.
//!
//! TODO: collapse these getters by threading the path through config as an
//! explicit value.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// `<home>/.gcode`, canonicalized via `dunce` (not `std::fs::canonicalize`,
/// which yields Windows `\\?\` verbatim paths).
fn grok_home_in(home: &Path) -> PathBuf {
    dunce::canonicalize(home)
        .unwrap_or_else(|_| home.to_path_buf())
        .join(".gcode")
}

/// `$GCODE_HOME` verbatim when non-empty, then legacy `$GORK_HOME` and
/// `$GROK_HOME`, else `<home>/.gcode`. The env value is
/// used as-is (not canonicalized) so it stays stable and comparable: callers do
/// literal prefix checks against it, and downstream symlink guards must still see
/// its original components.
fn resolve_grok_home_from(
    gcode_home_env: Option<&OsStr>,
    gork_home_env: Option<&OsStr>,
    grok_home_env: Option<&OsStr>,
    os_home: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(env) = gcode_home_env.filter(|env| !env.is_empty()) {
        return Some(PathBuf::from(env));
    }
    if let Some(env) = gork_home_env.filter(|env| !env.is_empty()) {
        return Some(PathBuf::from(env));
    }
    if let Some(env) = grok_home_env.filter(|env| !env.is_empty()) {
        return Some(PathBuf::from(env));
    }
    os_home.map(grok_home_in)
}

/// Resolve the grok home from the environment (fresh, no cache); `None` if neither resolves.
pub fn resolve_grok_home() -> Option<PathBuf> {
    resolve_grok_home_from(
        std::env::var_os("GCODE_HOME").as_deref(),
        std::env::var_os("GORK_HOME").as_deref(),
        std::env::var_os("GROK_HOME").as_deref(),
        dirs::home_dir().as_deref(),
    )
}

/// The default `<home>/.gcode`, used when no home override is set.
pub fn default_grok_home() -> PathBuf {
    grok_home_in(&dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
}

/// The grok home, created if missing and cached for the process; falls back to
/// [`default_grok_home`] when no supported home override or OS home resolves.
pub fn grok_home() -> PathBuf {
    static GROK_HOME: OnceLock<PathBuf> = OnceLock::new();
    GROK_HOME
        .get_or_init(|| {
            let home = resolve_grok_home().unwrap_or_else(default_grok_home);
            if let Err(err) = std::fs::create_dir_all(&home) {
                tracing::warn!(path = %home.display(), %err, "failed to create Gcode home");
            }
            home
        })
        .clone()
}

/// Like [`grok_home`], but `None` when no home resolves (no cwd fallback).
pub fn user_grok_home() -> Option<PathBuf> {
    resolve_grok_home().is_some().then(grok_home)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use std::ffi::OsString;

    #[test]
    fn env_wins_over_os_home() {
        let resolved = resolve_grok_home_from(
            Some(OsStr::new("/custom/home")),
            None,
            None,
            Some(Path::new("/home/u")),
        );
        assert_eq!(resolved, Some(PathBuf::from("/custom/home")));
    }

    #[test]
    fn env_used_verbatim_even_when_it_exists() {
        // A real, existing dir whose canonical form differs (macOS symlinks
        // `/var` -> `/private/var`): the env value must come back unchanged.
        let tmp = tempfile::tempdir().unwrap();
        let resolved = resolve_grok_home_from(Some(tmp.path().as_os_str()), None, None, None);
        assert_eq!(resolved, Some(tmp.path().to_path_buf()));
    }

    #[test]
    fn empty_env_falls_through_to_os_home() {
        let tmp = tempfile::tempdir().unwrap();
        let resolved = resolve_grok_home_from(Some(&OsString::new()), None, None, Some(tmp.path()));
        assert_eq!(
            resolved,
            Some(dunce::canonicalize(tmp.path()).unwrap().join(".gcode"))
        );
    }

    #[test]
    fn default_grok_home_has_no_verbatim_prefix() {
        // The reason we canonicalize via dunce: std::fs::canonicalize yields
        // `\\?\` verbatim paths on Windows that break git and byte-exact
        // comparisons. No-op assertion on Unix.
        let home = default_grok_home();
        assert!(!home.to_string_lossy().starts_with(r"\\?\"));
        assert!(home.ends_with(".gcode"));
    }

    #[test]
    fn none_when_nothing_resolves() {
        assert_eq!(
            resolve_grok_home_from(
                /* gcode_home_env */ None, /* gork_home_env */ None,
                /* grok_home_env */ None, /* os_home */ None,
            ),
            None
        );
    }

    #[test]
    fn gcode_home_wins_over_legacy_homes() {
        assert_eq!(
            resolve_grok_home_from(
                Some(OsStr::new("/gcode/home")),
                Some(OsStr::new("/gork/home")),
                Some(OsStr::new("/legacy/home")),
                Some(Path::new("/home/u")),
            ),
            Some(PathBuf::from("/gcode/home"))
        );
    }

    #[test]
    fn legacy_gork_home_wins_over_grok_home() {
        assert_eq!(
            resolve_grok_home_from(
                None,
                Some(OsStr::new("/gork/home")),
                Some(OsStr::new("/grok/home")),
                Some(Path::new("/home/u")),
            ),
            Some(PathBuf::from("/gork/home"))
        );
    }
}
