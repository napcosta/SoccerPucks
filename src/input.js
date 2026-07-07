const pressed = new Set();
let inputLocked = false;

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'shoot',
  ShiftLeft: 'power', ShiftRight: 'power',
};

window.addEventListener('keydown', (e) => {
  if (inputLocked) return;
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
  if (inputLocked) return { moveX: 0, moveZ: 0, shoot: false, power: false };

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

export function clearCommands() {
  pressed.clear();
}
