import { BrowserWindow } from 'electron';

export function createStartupWindow(locale: string): BrowserWindow {
  const german = locale.toLowerCase().startsWith('de');
  const title = german ? 'Plysmith wird gestartet' : 'Plysmith is starting';
  const detail = german
    ? 'Die Anwendung wird vorbereitet.'
    : 'Preparing the application.';
  const window = new BrowserWindow({
    width: 440,
    height: 220,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f8',
    title: 'Plysmith',
    show: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const html = `<!doctype html>
<html lang="${german ? 'de' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>Plysmith</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; color: #26313d; background: #f5f6f8; }
    main { display: flex; align-items: center; gap: 20px; height: 100vh; padding: 32px; box-sizing: border-box; }
    .spinner { flex: none; width: 32px; height: 32px; border: 3px solid #c8d2df; border-top-color: #3264aa; border-radius: 50%; animation: spin 0.9s linear infinite; }
    h1 { margin: 0 0 7px; font-size: 19px; font-weight: 650; }
    p { margin: 0; color: #647182; font-size: 14px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  </style>
</head>
<body><main role="status"><div class="spinner" aria-hidden="true"></div><div><h1>${title}</h1><p>${detail}</p></div></main></body>
</html>`;
  void window
    .loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
    .catch(() => {
      window.destroy();
    });
  return window;
}
