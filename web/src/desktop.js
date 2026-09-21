/**
 * Desktop-only features.
 *
 * The same frontend ships to a browser and to the Tauri shell, so everything
 * here is additive and gated on actually running inside the shell. In a browser
 * `isDesktop()` is false, no desktop UI is built, and the app behaves exactly as
 * it did before this file existed.
 */

const STATE_COPY = {
  missing: { label: 'Not installed', tone: 'idle' },
  managed: { label: 'Installed', tone: 'good' },
  stale: { label: 'Update available', tone: 'warn' },
  custom: { label: 'Edited by you — left alone', tone: 'warn' },
};

export function isDesktop() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI__);
}

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

/** Wire the Skill button and its panel. No-op outside the desktop shell. */
export function initSkillPanel() {
  if (!isDesktop()) return;

  const button = document.getElementById('btn-skill');
  const modal = document.getElementById('skill-modal');
  const body = document.getElementById('skill-targets');
  const actions = document.getElementById('skill-actions');
  const note = document.getElementById('skill-note');

  button.hidden = false;

  const close = () => { modal.hidden = true; };
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.getElementById('skill-close').addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  button.addEventListener('click', async () => {
    modal.hidden = false;
    await refresh();
  });

  async function refresh() {
    let status;
    try {
      status = await invoke('skill_status');
    } catch (error) {
      note.textContent = `Could not read the skill status: ${error}`;
      return;
    }
    render(status);
  }

  function render(status) {
    body.replaceChildren();
    actions.replaceChildren();
    note.textContent = '';

    const present = status.targets.filter((t) => t.agent_present);

    if (present.length === 0) {
      note.textContent =
        'No agent directory found. Install Claude Code or Codex first, then reopen this panel.';
      return;
    }

    for (const target of present) {
      const row = document.createElement('div');
      row.className = 'skill-row';

      const left = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = target.agent === 'claude' ? 'Claude Code' : 'Codex';
      const path = document.createElement('span');
      path.className = 'skill-path';
      path.textContent = target.dir.replace(/^\/Users\/[^/]+/, '~');
      left.append(name, path);

      const copy = STATE_COPY[target.state] ?? STATE_COPY.missing;
      const badge = document.createElement('span');
      badge.className = `skill-badge ${copy.tone}`;
      badge.textContent = copy.label;

      row.append(left, badge);
      body.append(row);
    }

    const anyCustom = present.some((t) => t.state === 'custom');
    const anyInstalled = present.some((t) => t.state === 'managed' || t.state === 'stale');

    if (status.can_install) {
      actions.append(
        actionButton(present.some((t) => t.state === 'stale') ? 'Update skill' : 'Install skill', 'primary', async () => {
          render(await invoke('install_skill', { force: false }));
          note.textContent = 'Installed. Start a new agent session to pick it up.';
        })
      );
    }

    if (anyInstalled) {
      actions.append(
        actionButton('Remove', 'ghost', async () => {
          render(await invoke('remove_skill'));
          note.textContent = 'Removed. Your own edited copies, if any, were left in place.';
        })
      );
    }

    if (anyCustom) {
      actions.append(
        actionButton('Overwrite my edits', 'ghost danger', async () => {
          render(await invoke('install_skill', { force: true }));
          note.textContent = 'Overwritten with the bundled skill.';
        })
      );
      if (!note.textContent) {
        note.textContent =
          'A skill is already installed that does not match what this app ships. It has been left untouched.';
      }
    }

    if (!status.can_install && !anyCustom && anyInstalled) {
      note.textContent = `Up to date (v${status.bundle_version}). Start a new agent session to use it.`;
    }

    actions.append(
      actionButton('Designs folder', 'ghost', () => invoke('open_designs_dir'))
    );
  }

  function actionButton(label, className, onClick) {
    const el = document.createElement('button');
    el.className = className;
    el.textContent = label;
    el.addEventListener('click', async () => {
      el.disabled = true;
      try {
        await onClick();
      } catch (error) {
        note.textContent = String(error);
      } finally {
        el.disabled = false;
      }
    });
    return el;
  }
}

/**
 * The user's design library: everything the skill has written, from any repo.
 *
 * Returned as picker entries shaped like the bundled manifest, so main.js can
 * concatenate the two lists and stay unaware of where a design came from.
 */
export async function listUserDesigns() {
  if (!isDesktop()) return [];
  try {
    const designs = await invoke('list_user_designs');
    return designs.map((d) => ({ file: d.path, title: d.title, external: true }));
  } catch {
    return [];
  }
}

export async function readDesignPath(path) {
  return invoke('read_design_file', { path });
}

export async function designsDir() {
  if (!isDesktop()) return null;
  try {
    return await invoke('designs_dir');
  } catch {
    return null;
  }
}

/**
 * Replace the web file picker with a native dialog when running on desktop, so
 * "Open JSON…" can reach anywhere on disk rather than a sandboxed picker.
 */
export function initNativeOpen(onDesignText) {
  if (!isDesktop()) return;

  const button = document.getElementById('btn-open');
  const clone = button.cloneNode(true); // drop the web listener
  button.replaceWith(clone);

  clone.addEventListener('click', async () => {
    const selected = await window.__TAURI__.dialog.open({
      multiple: false,
      filters: [{ name: 'Design JSON', extensions: ['json'] }],
    });
    if (!selected) return;
    const path = typeof selected === 'string' ? selected : selected.path;
    onDesignText(await invoke('read_design_file', { path }), path);
  });
}
