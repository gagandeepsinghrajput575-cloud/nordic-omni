/**
 * Runs before paint so the document is never briefly the wrong theme.
 *
 * Resolution order, matching the ThemeContext:
 *   1. a saved preference in localStorage
 *   2. the OS preference (`prefers-color-scheme`)
 *   3. `light` — the ElevenLabs studio look is the product's default
 *
 * Kept as a synchronous inline script (no network, no dependencies) so it
 * finishes before first paint and there is no flash of the opposite theme.
 */
export const themeInitScript = `(function(){try{
var KEY='nordic-omni-theme';
var saved=null;
try{saved=localStorage.getItem(KEY);}catch(e){}
var t=(saved==='light'||saved==='dark')
  ?saved
  :(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
var r=document.documentElement;
r.classList.remove('light','dark');
r.classList.add(t);
r.dataset.theme=t;
r.style.colorScheme=t;
}catch(e){}})();`;
