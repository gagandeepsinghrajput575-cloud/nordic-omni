/**
 * Runs before paint so the document is never briefly unstyled.
 *
 * The product ships exactly one identity — obsidian glass — so this only has to
 * pin `data-theme`, the `light`/`dark` class and `color-scheme` to `dark`. It no
 * longer reads storage for a preference, because no stored value can select a
 * different palette. Kept as an inline script (no network, no dependencies) so it
 * completes before first paint.
 */
export const themeInitScript = `(function(){try{var r=document.documentElement;r.classList.remove('light');r.classList.add('dark');r.dataset.theme='dark';r.style.colorScheme='dark';}catch(e){}})();`;
