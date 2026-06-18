// Run once: node generate-icons.js
// Generates simple PNG icons using Canvas API via node-canvas, or creates SVG placeholders
const fs = require('fs');

function makeSVG(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size*0.2}" fill="#0d0d0d"/>
  <rect x="${size*0.12}" y="${size*0.12}" width="${size*0.76}" height="${size*0.76}" rx="${size*0.12}" fill="#1a1a1a"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="-apple-system,sans-serif" font-weight="700" font-size="${size*0.38}" fill="#3b82f6">S</text>
</svg>`;
}

// Write SVG as PNG placeholder (browsers accept SVG for icons too)
fs.writeFileSync('icon-192.png', makeSVG(192));
fs.writeFileSync('icon-512.png', makeSVG(512));
console.log('Icons generated.');
