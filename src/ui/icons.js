// Inline SVG icons (no icon font or image downloads).
const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  soundOn: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
};

/**
 * p3p2's mark, as on its multiplayer button top right (from @p3p2/client, MIT): "Play with a friend" in the menus opens
 * the same panel, so it wears the same mark.
 */
export const P3P2_MARK = '<svg class="mark" viewBox="0 0 16 16" aria-hidden="true">' +
  '<path opacity=".55" d="M.6 7.2a1.9 1.9 0 0 0 3.8 0a1.9 1.9 0 0 0-3.8 0M11.6 7.2a1.9 1.9 0 0 0 3.8 0a1.9 1.9 0 0 0-3.8 0M-.8 13.2A3.3 3.3 0 0 1 5.12 11.2A5.6 5.6 0 0 0 3.15 13.2zM16.8 13.2A3.3 3.3 0 0 0 10.88 11.2A5.6 5.6 0 0 1 12.85 13.2z"/>' +
  '<path d="M5.4 7.7a2.6 2.6 0 0 0 5.2 0a2.6 2.6 0 0 0-5.2 0M3.4 16a4.6 4.6 0 0 1 9.2 0z"/></svg>';
