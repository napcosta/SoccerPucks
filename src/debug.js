export const DEBUG = {
  noCooldowns: false,
  freezeTimer: false,
  disableAI: false,
  slowMotion: false,
};

const TOGGLES = [
  { key: 'noCooldowns', label: 'No cooldowns' },
  { key: 'freezeTimer', label: 'Freeze timer' },
  { key: 'disableAI', label: 'Disable AI' },
  { key: 'slowMotion', label: 'Slow motion' },
];

export function initDebugPanel() {
  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  panel.classList.add('hidden');

  const title = document.createElement('div');
  title.id = 'debug-title';
  title.textContent = 'Debug';
  panel.appendChild(title);

  for (const { key, label } of TOGGLES) {
    const row = document.createElement('label');
    row.className = 'debug-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = DEBUG[key];
    input.addEventListener('change', () => {
      DEBUG[key] = input.checked;
    });

    const text = document.createElement('span');
    text.textContent = label;

    row.appendChild(input);
    row.appendChild(text);
    panel.appendChild(row);
  }

  const hint = document.createElement('div');
  hint.id = 'debug-hint';
  hint.textContent = 'Toggle with ` or F8';
  panel.appendChild(hint);

  document.body.appendChild(panel);

  const toggleVisibility = () => panel.classList.toggle('hidden');
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote' || e.code === 'F8') {
      toggleVisibility();
      e.preventDefault();
    }
  });

  return panel;
}
