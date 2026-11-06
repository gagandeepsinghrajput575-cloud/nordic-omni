(function () {
  'use strict';

  // Read configuration from the script tag
  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var tenant = currentScript.getAttribute('data-tenant') || 'kbh-vvs';
  var primaryColor = currentScript.getAttribute('data-primary-color') || '#6366F1';
  var origin = currentScript.src ? new URL(currentScript.src).origin : window.location.origin;

  // Create container
  var container = document.createElement('div');
  container.id = 'nordic-omni-widget-root';
  container.style.position = 'fixed';
  container.style.bottom = '24px';
  container.style.right = '24px';
  container.style.zIndex = '999999';
  container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // Create floating button
  var button = document.createElement('button');
  button.style.width = '56px';
  button.style.height = '56px';
  button.style.borderRadius = '50%';
  button.style.backgroundColor = primaryColor;
  button.style.border = 'none';
  button.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3)';
  button.style.cursor = 'pointer';
  button.style.display = 'flex';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.transition = 'transform 0.15s ease, box-shadow 0.15s ease';
  button.style.outline = 'none';

  button.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';

  button.onmouseenter = function () {
    button.style.transform = 'scale(1.05)';
  };
  button.onmouseleave = function () {
    button.style.transform = 'scale(1)';
  };

  // Create iframe dialog (lazy loaded)
  var dialog = document.createElement('div');
  dialog.style.display = 'none';
  dialog.style.position = 'fixed';
  dialog.style.bottom = '92px';
  dialog.style.right = '24px';
  dialog.style.width = '380px';
  dialog.style.maxWidth = 'calc(100vw - 48px)';
  dialog.style.height = '560px';
  dialog.style.maxHeight = 'calc(100vh - 120px)';
  dialog.style.backgroundColor = '#12141B';
  dialog.style.borderRadius = '14px';
  dialog.style.border = '1px solid #202430';
  dialog.style.boxShadow = '0 16px 40px rgba(0,0,0,0.45)';
  dialog.style.overflow = 'hidden';
  dialog.style.zIndex = '999999';

  var isOpen = false;
  var iframe = null;

  button.onclick = function () {
    isOpen = !isOpen;
    if (isOpen) {
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.src = origin + '/call/demo-caller-' + tenant;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.allow = 'microphone';
        dialog.appendChild(iframe);
      }
      dialog.style.display = 'block';
      button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    } else {
      dialog.style.display = 'none';
      button.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';
    }
  };
        iframe.allow = 'microphone';
        dialog.appendChild(iframe);
      }
      dialog.style.display = 'block';
      button.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    } else {
      dialog.style.display = 'none';
      button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';
    }
  };

  container.appendChild(dialog);
  container.appendChild(button);
  document.body.appendChild(container);
})();

