const pressed = new Set();
let inputLocked = false;
let gameplayActive = false;

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'shoot',
  ShiftLeft: 'power', ShiftRight: 'power',
};

function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;

  return Boolean(
    target.closest('input, textarea, select, button')
    || target.isContentEditable
    || target.closest('[contenteditable]:not([contenteditable="false"])'),
  );
}

window.addEventListener('keydown', (e) => {
  if (!gameplayActive || inputLocked || isInteractiveTarget(e.target)) return;
  const action = KEYMAP[e.code];
  if (action) {
    pressed.add(action);
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  const action = KEYMAP[e.code];
  if (action) pressed.delete(action);
});

window.addEventListener('blur', () => pressed.clear());

export function readCommands() {
  if (!gameplayActive || inputLocked) {
    return { moveX: 0, moveZ: 0, shoot: false, power: false };
  }

  let x = 0;
  let z = 0;
  if (pressed.has('up')) z -= 1;
  if (pressed.has('down')) z += 1;
  if (pressed.has('left')) x -= 1;
  if (pressed.has('right')) x += 1;
  const len = Math.hypot(x, z);
  if (len > 0) {
    x /= len;
    z /= len;
  }
  return {
    moveX: x,
    moveZ: z,
    shoot: pressed.has('shoot'),
    power: pressed.has('power'),
  };
}

export function setInputLocked(locked) {
  inputLocked = Boolean(locked);
  if (inputLocked) pressed.clear();
}

export function setGameplayActive(active) {
  gameplayActive = Boolean(active);
  if (!gameplayActive) pressed.clear();
}

export function clearCommands() {
  pressed.clear();
}
