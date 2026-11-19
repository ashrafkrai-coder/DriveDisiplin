#!/usr/bin/env node
/* Penjana ikon PWA Fail Disiplin: folder fail dengan dokumen, warna navy dan brass.
   Tiada pakej luar diperlukan. Jalankan: node generate_icons.js */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, 'icons');
fs.mkdirSync(OUT, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const NAVY = hex('#0b2b40'), NAVY2 = hex('#14425e'), BRASS = hex('#d1a94f'), BRASS_GELAP = hex('#a67c25');
const KERTAS = hex('#f7fafc'), GARIS = hex('#9fb3bf'), TEAL = hex('#0a7a85');

// Jarak bertanda ke segi empat bucu bulat (negatif = di dalam)
function rrect(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Warna pada titik (u, v) dalam 0..1. Pulangkan [r, g, b, a].
// mod: 'any' = bucu bulat lutsinar, 'maskable' = penuh dengan zon selamat, 'full' = penuh (iOS)
function sampel(u, v, mod) {
  if (mod === 'any' && rrect(u, v, 0, 0, 1, 1, 0.22) > 0) return [0, 0, 0, 0];
  const skala = mod === 'maskable' ? 0.72 : 0.9;
  const x = (u - 0.5) / skala + 0.5, y = (v - 0.5) / skala + 0.5;

  // Latar navy dengan cahaya lembut di atas kiri
  const t = Math.max(0, 1 - Math.hypot(u - 0.3, v - 0.25) * 1.4);
  let c = NAVY.map((n, i) => n + (NAVY2[i] - n) * t);

  // Belakang folder dengan tab
  if (rrect(x, y, 0.16, 0.26, 0.84, 0.78, 0.05) < 0 || rrect(x, y, 0.16, 0.2, 0.44, 0.32, 0.04) < 0) c = BRASS_GELAP;
  // Kertas yang terkeluar
  if (rrect(x, y, 0.25, 0.17, 0.75, 0.62, 0.035) < 0) {
    c = KERTAS;
    if (rrect(x, y, 0.32, 0.25, 0.56, 0.29, 0.02) < 0) c = TEAL;
    for (const gy of [0.35, 0.42]) if (rrect(x, y, 0.32, gy - 0.017, 0.68, gy + 0.017, 0.017) < 0) c = GARIS;
  }
  // Muka depan folder
  if (rrect(x, y, 0.16, 0.45, 0.84, 0.8, 0.05) < 0) {
    c = BRASS;
    if (rrect(x, y, 0.4, 0.56, 0.6, 0.6, 0.02) < 0) c = NAVY;
  }
  return [...c, 255];
}

const crcJadual = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcJadual[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function ketul(jenis, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(jenis), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

function png(saiz, mod) {
  const SS = 4, baris = Buffer.alloc((saiz * 4 + 1) * saiz);
  for (let py = 0; py < saiz; py++) {
    for (let px = 0; px < saiz; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const s = sampel((px + (sx + 0.5) / SS) / saiz, (py + (sy + 0.5) / SS) / saiz, mod);
        r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
      }
      const o = py * (saiz * 4 + 1) + 1 + px * 4;
      baris[o] = a ? Math.round(r / a) : 0; baris[o + 1] = a ? Math.round(g / a) : 0;
      baris[o + 2] = a ? Math.round(b / a) : 0; baris[o + 3] = Math.round(a / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(saiz, 0); ihdr.writeUInt32BE(saiz, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ketul('IHDR', ihdr), ketul('IDAT', zlib.deflateSync(baris, { level: 9 })), ketul('IEND', Buffer.alloc(0))]);
}

const sasaran = [
  ...[48, 72, 96, 144, 192, 512].map((s) => [`launchericon-${s}x${s}.png`, s, 'any']),
  ['maskable-512x512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'full'] // iOS membulatkan sendiri, jadi tiada lutsinar
];
for (const [nama, saiz, mod] of sasaran) {
  fs.writeFileSync(path.join(OUT, nama), png(saiz, mod));
  console.log('Dijana', nama);
}
