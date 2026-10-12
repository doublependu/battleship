// Keyboard: arrows move the aim, Enter/Space fire, R rotates (placement), P/Esc pause, M mute.
export function bindKeyboard(actions) {
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key;
    if (k === 'p' || k === 'P' || k === 'Escape') actions.pauseToggle();
    else if (k === 'm' || k === 'M') actions.toggleMute();
    else if (k === 'r' || k === 'R') actions.rotate();
    else if (k === 'ArrowUp') actions.moveAim(-1, 0);
    else if (k === 'ArrowDown') actions.moveAim(1, 0);
    else if (k === 'ArrowLeft') actions.moveAim(0, -1);
    else if (k === 'ArrowRight') actions.moveAim(0, 1);
    else if (k === 'Enter' || k === ' ') {
      if (e.target instanceof HTMLButtonElement) return;
      actions.fireAim();
    } else return;
    e.preventDefault();
  });
}
