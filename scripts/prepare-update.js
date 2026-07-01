const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const version = pkg.version;
const distInstaller = path.join(root, 'dist', `Sales B2B Setup ${version}.exe`);
const installerDir = path.join(root, 'installer');
const updatesDir = path.join(root, 'updates');
const fileName = `Sales-B2B-Setup-${version}.exe`;
const installerPath = path.join(installerDir, fileName);

if (!fs.existsSync(distInstaller)) {
  throw new Error(`Brak instalatora: ${distInstaller}`);
}

fs.mkdirSync(installerDir, { recursive: true });
fs.mkdirSync(updatesDir, { recursive: true });
fs.copyFileSync(distInstaller, installerPath);

const file = fs.readFileSync(installerPath);
const sha512 = crypto.createHash('sha512').update(file).digest('base64');
const manifest = {
  version,
  fileName,
  url: `https://github.com/superelektryczni12-cpu/SalesB2B/raw/main/installer/${fileName}`,
  size: file.length,
  sha512,
  notes: 'Nowa wersja Sales B2B jest gotowa do instalacji.',
  publishedAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(updatesDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Update manifest ready for ${version}: ${fileName}`);
