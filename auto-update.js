const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const FEED_URL = 'https://raw.githubusercontent.com/superelektryczni12-cpu/SalesB2B/main/updates/latest.json';

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function request(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Sales-B2B-Updater',
        'Cache-Control': 'no-cache',
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 5) {
        res.resume();
        resolve(request(new URL(res.headers.location, url).toString(), redirectCount + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Serwer aktualizacji zwrócił status ${res.statusCode}.`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Przekroczono czas połączenia z serwerem aktualizacji.'));
    });
  });
}

async function fetchJson(url) {
  const res = await request(url);
  let body = '';
  for await (const chunk of res) body += chunk;
  return JSON.parse(body);
}

async function downloadFile(url, targetPath, onProgress) {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.download`;
  const res = await request(url);
  const total = parseInt(res.headers['content-length'] || '0', 10);
  let downloaded = 0;
  const hash = crypto.createHash('sha512');
  const stream = fs.createWriteStream(tempPath);

  await new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      downloaded += chunk.length;
      hash.update(chunk);
      if (total && onProgress) onProgress(Math.round((downloaded / total) * 100), downloaded, total);
    });
    res.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);
    res.pipe(stream);
  });

  await fs.promises.rename(tempPath, targetPath);
  return { sha512: hash.digest('base64'), size: downloaded };
}

function createUpdateManager({ app, getWindow }) {
  let latestManifest = null;
  let downloading = false;

  function send(payload) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update-event', payload);
  }

  function normalizeManifest(manifest) {
    if (!manifest || !manifest.version || !manifest.url || !manifest.fileName || !manifest.sha512) {
      throw new Error('Manifest aktualizacji jest niepełny.');
    }
    return manifest;
  }

  async function checkForUpdates({ manual = false } = {}) {
    try {
      const manifest = normalizeManifest(await fetchJson(FEED_URL));
      const currentVersion = app.getVersion();
      const hasUpdate = compareVersions(manifest.version, currentVersion) > 0;
      if (!hasUpdate) {
        if (manual) send({ status: 'no-update', currentVersion });
        return { hasUpdate: false, currentVersion };
      }
      latestManifest = manifest;
      const payload = {
        status: 'available',
        currentVersion,
        version: manifest.version,
        notes: manifest.notes || '',
        size: manifest.size || 0,
      };
      send(payload);
      return { hasUpdate: true, ...payload };
    } catch (error) {
      if (manual) send({ status: 'error', message: error.message || 'Nie udało się sprawdzić aktualizacji.' });
      return { hasUpdate: false, error: error.message || 'Nie udało się sprawdzić aktualizacji.' };
    }
  }

  async function downloadAndInstall() {
    if (downloading) return { started: false, reason: 'download-in-progress' };
    if (!latestManifest) {
      const result = await checkForUpdates({ manual: true });
      if (!result.hasUpdate) return result;
    }

    downloading = true;
    const manifest = latestManifest;
    try {
      const targetPath = path.join(app.getPath('userData'), 'updates', manifest.fileName);
      send({ status: 'downloading', version: manifest.version, progress: 0 });
      const file = await downloadFile(manifest.url, targetPath, (progress, downloaded, total) => {
        send({ status: 'downloading', version: manifest.version, progress, downloaded, total });
      });

      if (file.sha512 !== manifest.sha512) {
        await fs.promises.unlink(targetPath).catch(() => {});
        throw new Error('Pobrany instalator nie przeszedł weryfikacji pliku.');
      }

      send({ status: 'ready', version: manifest.version });
      const child = spawn(targetPath, [], { detached: true, stdio: 'ignore' });
      child.unref();
      send({ status: 'installing', version: manifest.version });
      setTimeout(() => app.quit(), 800);
      return { started: true, path: targetPath };
    } catch (error) {
      send({ status: 'error', message: error.message || 'Nie udało się zainstalować aktualizacji.' });
      return { started: false, error: error.message };
    } finally {
      downloading = false;
    }
  }

  return { checkForUpdates, downloadAndInstall };
}

module.exports = { createUpdateManager };
