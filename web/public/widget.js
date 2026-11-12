(function () {
  'use strict';

  if (window.__nordicOmniWidgetLoaded) return;
  window.__nordicOmniWidgetLoaded = true;

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();
  if (!script) return;

  var contactId = (script.getAttribute('data-contact') || '').trim();
  var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(contactId)) {
    if (window.console && console.warn) console.warn('[Nordic Omni] widget.js requires a valid data-contact UUID. No demo fallback is used.');
    return;
  }

  var origin;
  try { origin = new URL(script.src, window.location.href).origin; } catch (error) { return; }
  var color = script.getAttribute('data-primary-color') || '#7C3AED';
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) color = '#7C3AED';
  var label = script.getAttribute('data-label') || 'Open browser call';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var root = document.createElement('div');
  root.id = 'nordic-omni-widget-root';
  root.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

  var panel = document.createElement('div');
  panel.id = 'nordic-omni-widget-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', label);
  panel.style.cssText = 'display:none;position:absolute;right:0;bottom:72px;width:380px;max-width:calc(100vw - 40px);height:480px;max-height:calc(100dvh - 112px);overflow:hidden;border-radius:16px;border:1px solid rgba(28,21,18,.14);background:#FAF7F2;box-shadow:0 18px 56px rgba(28,21,18,.22);opacity:0;transform:translateY(8px) scale(.985);transition:opacity .18s ease,transform .18s ease;';

  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', panel.id);
  button.style.cssText = 'display:flex;align-items:center;justify-content:center;width:56px;height:56px;margin-left:auto;border:none;border-radius:50%;background:' + color + ';color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(18,22,19,.24);transition:transform .16s ease,filter .16s ease;';
  var phoneIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.35 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.58 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  var closeIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  button.innerHTML = phoneIcon;

  var iframe = null;
  var open = false;
  function ensureFrame() {
    if (iframe) return;
    iframe = document.createElement('iframe');
    iframe.title = label;
    iframe.src = origin + '/call/' + encodeURIComponent(contactId) + '?embed=1';
    iframe.allow = 'microphone; autoplay';
    iframe.loading = 'lazy';
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    panel.appendChild(iframe);
  }
  function setOpen(next) {
    open = next;
    button.setAttribute('aria-expanded', next ? 'true' : 'false');
    button.setAttribute('aria-label', next ? 'Close browser call' : label);
    button.innerHTML = next ? closeIcon : phoneIcon;
    if (next) {
      ensureFrame();
      panel.style.display = 'block';
      requestAnimationFrame(function () { panel.style.opacity = '1'; panel.style.transform = 'translateY(0) scale(1)'; });
    } else {
      panel.style.opacity = '0';
      panel.style.transform = reduceMotion ? 'none' : 'translateY(8px) scale(.985)';
      var hide = function () { if (!open) panel.style.display = 'none'; };
      if (reduceMotion) hide(); else window.setTimeout(hide, 180);
    }
  }
  button.addEventListener('click', function () { setOpen(!open); });
  button.addEventListener('mouseenter', function () { if (!reduceMotion) button.style.transform = 'scale(1.05)'; });
  button.addEventListener('mouseleave', function () { button.style.transform = 'scale(1)'; });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && open) { setOpen(false); button.focus(); }
  });

  root.appendChild(panel);
  root.appendChild(button);
  document.body.appendChild(root);
})();
