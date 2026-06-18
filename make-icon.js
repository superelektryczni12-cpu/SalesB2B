// Generates a valid 256x256 PNG icon using raw bytes
const fs = require('fs');
const path = require('path');

// Minimal PNG generator (no external deps)
function crc32(buf) {
  let c = 0xFFFFFFFF;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = i;
    for (let j = 0; j < 8; j++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
    t[i] = v;
  }
  for (const b of buf) c = t[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function deflateRaw(data) {
  // minimal store-only deflate (no compression, but valid)
  const chunks = [];
  for (let i = 0; i < data.length; i += 65535) {
    const chunk = data.slice(i, i + 65535);
    const last = i + 65535 >= data.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = last;
    header.writeUInt16LE(chunk.length, 1);
    header.writeUInt16LE(~chunk.length & 0xFFFF, 3);
    chunks.push(header, chunk);
  }
  return Buffer.concat(chunks);
}
function adler32(data) {
  let a = 1, b = 0;
  for (const byte of data) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  return (b << 16) | a;
}
function makePNG(size, bgR, bgG, bgB, fgR, fgG, fgB) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter byte
    for (let x = 0; x < size; x++) {
      const cx = size / 2, cy = size / 2, r = size * 0.42;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const corner = Math.min(1, Math.max(0, (r - dist) / 2));
      // "S" letter area
      const nx = (x / size - 0.5) * 2, ny = (y / size - 0.5) * 2;
      const inS = (Math.abs(nx) < 0.35 && Math.abs(ny) < 0.65);
      const isFg = dist < r * 0.72 && inS;
      const isBg = dist < r;
      if (isFg) { row.push(fgR, fgG, fgB, 255); }
      else if (isBg) { row.push(bgR, bgG, bgB, 255); }
      else { row.push(0, 0, 0, 0); }
    }
    rows.push(Buffer.from(row));
  }
  const raw = Buffer.concat(rows);
  const zlib = Buffer.concat([
    Buffer.from([0x78, 0x01]),
    deflateRaw(raw),
    u32(adler32(raw))
  ]);
  function chunk(type, data) {
    const t = Buffer.from(type);
    const crc = crc32(Buffer.concat([t, data]));
    return Buffer.concat([u32(data.length), t, data, u32(crc)]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);
// Dark bg (#1c1c1c), blue accent (#3b82f6)
fs.writeFileSync(path.join(assetsDir, 'icon.png'), makePNG(256, 28, 28, 28, 59, 130, 246));
fs.writeFileSync(path.join(assetsDir, 'icon512.png'), makePNG(512, 28, 28, 28, 59, 130, 246));
console.log('Icon generated: assets/icon.png');
