const { app, BrowserWindow, nativeTheme, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const backend = require('./backend');
const { analyzeCompanyWebsite } = require('./company-research');

const GOOGLE_API_KEY = 'AIzaSyAkAJfARQ2P1WUO7__-1IvPuAeeFDBK0lA';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchAllPlaces(query, city) {
  const results = [];
  const q = encodeURIComponent(`${query} ${city}`);
  let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&language=pl&region=pl&key=${GOOGLE_API_KEY}`;

  for (let page = 0; page < 3; page++) {
    const data = await httpsGet(url);
    if (data.results) results.push(...data.results);
    if (!data.next_page_token) break;
    // Google wymaga 2s przerwy przed kolejną stroną
    await new Promise(r => setTimeout(r, 2000));
    url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${data.next_page_token}&key=${GOOGLE_API_KEY}`;
  }
  return results;
}

ipcMain.handle('search-places', async (_e, query, city) => {
  return await fetchAllPlaces(query, city);
});

ipcMain.handle('get-place-details', async (_e, placeId) => {
  const fields = 'name,formatted_address,address_components,formatted_phone_number,website,rating,user_ratings_total,business_status,opening_hours,types,editorial_summary,price_level,url';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=pl&key=${GOOGLE_API_KEY}`;
  const data = await httpsGet(url);
  return data.result || {};
});

ipcMain.handle('analyze-company-website', (_e, website) => analyzeCompanyWebsite(website));

ipcMain.handle('backend-status', () => backend.backendStatus());
ipcMain.handle('auth-restore', () => backend.restoreSession());
ipcMain.handle('auth-login', (_e, email, password) => backend.signIn(email, password));
ipcMain.handle('auth-register', (_e, account) => backend.signUp(account));
ipcMain.handle('auth-logout', () => backend.signOut());
ipcMain.handle('employees-list', () => backend.listEmployees());
ipcMain.handle('employees-save', (_e, employee) => backend.saveEmployee(employee));
ipcMain.handle('employees-delete', (_e, id) => backend.deleteEmployee(id));
ipcMain.handle('user-data-load', () => backend.loadUserData());
ipcMain.handle('user-data-save', (_e, dataKey, value) => backend.saveUserData(dataKey, value));
ipcMain.handle('sales-ai-generate', (_e, action, payload) => backend.generateSalesAI(action, payload));
ipcMain.handle('apollo-contacts', (_e, action, payload) => backend.apolloContacts(action, payload));

nativeTheme.themeSource = 'dark';

const isMac = process.platform === 'darwin';

let mainWindow = null;

// IPC handlers
ipcMain.handle('get-bookings', () => backend.getBookings());
ipcMain.handle('update-booking-status', (_e, id, status) => backend.updateBookingStatus(id, status));

// Local HTTP server — receives bookings from revforge.html
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'POST' && req.url === '/booking') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const booking = JSON.parse(body);
        booking.id = Date.now().toString();
        booking.createdAt = new Date().toISOString();
        booking.status = 'nowe';
        await backend.addBooking(booking);
        if (mainWindow) mainWindow.webContents.send('new-booking', booking);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id: booking.id }));
      } catch {
        res.writeHead(400); res.end('{"error":"invalid"}');
      }
    });
  } else if (req.method === 'POST' && req.url === '/booking/assign') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id, assignedTo } = JSON.parse(body);
        await backend.assignBooking(id, assignedTo);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch { res.writeHead(400); res.end(); }
    });
  } else if (req.method === 'GET' && req.url === '/bookings') {
    backend.getBookings().then(bookings => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(bookings));
    }).catch(() => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"not_authenticated"}');
    });
  } else {
    res.writeHead(404); res.end();
  }
});

server.listen(3721, '127.0.0.1');

// macOS menu bar
function buildMenu() {
  const template = [
    ...(isMac ? [{
      label: 'Sales B2B',
      submenu: [
        { label: 'O aplikacji', role: 'about' },
        { type: 'separator' },
        { label: 'Usługi', role: 'services' },
        { type: 'separator' },
        { label: 'Ukryj Sales B2B', role: 'hide' },
        { label: 'Ukryj pozostałe', role: 'hideOthers' },
        { label: 'Pokaż wszystkie', role: 'unhide' },
        { type: 'separator' },
        { label: 'Zakończ Sales B2B', accelerator: 'Cmd+Q', role: 'quit' },
      ]
    }] : []),
    {
      label: 'Edycja',
      submenu: [
        { label: 'Cofnij', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Ponów', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Wytnij', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Kopiuj', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Wklej', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Zaznacz wszystko', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ]
    },
    {
      label: 'Widok',
      submenu: [
        { label: 'Przeładuj', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { type: 'separator' },
        { label: 'Pełny ekran', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', role: 'togglefullscreen' },
        { label: 'Powiększ', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Pomniejsz', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Resetuj zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      ]
    },
    {
      label: 'Okno',
      submenu: [
        { label: 'Minimalizuj', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        ...(isMac ? [
          { type: 'separator' },
          { label: 'Na pierwszym planie', role: 'front' },
        ] : [
          { label: 'Zamknij', accelerator: 'CmdOrCtrl+W', role: 'close' },
        ])
      ]
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0d0d0d',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    vibrancy: isMac ? 'under-window' : undefined,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Inject platform class into renderer
    mainWindow.webContents.executeJavaScript(
      `document.documentElement.setAttribute('data-platform', '${process.platform}')`
    );
  });
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
