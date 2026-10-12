// Block touch zooms the player couldn't undo: pinch, double-tap and Safari gesture zoom.
// Works together with the viewport meta (user-scalable=no) and touch-action CSS.
export function blockZoom() {
  const prevent = (e) => e.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, prevent, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 || (e.scale !== undefined && e.scale !== 1)) e.preventDefault();
  }, { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = performance.now();
    if (now - lastTouchEnd < 320 && !(e.target instanceof HTMLButtonElement)) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  // ctrl/cmd + wheel zoom on trackpads
  addEventListener('wheel', (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
}
