/**
 * Fail Disiplin: API akaun dan senarai fail Google Drive.
 *
 * Skrip ini diletakkan dalam Google Sheet "Fail Disiplin 2026 - Akaun dan Pintasan"
 * (Sambungan > Apps Script). Ia menyediakan daftar akaun, log masuk dan senarai
 * fail kepada PWA. Senarai fail dibaca terus daripada folder Drive (FOLDER_UTAMA).
 *
 * Tab dalam Sheet:
 *   Akaun     dicipta automatik. Tukar lajur Status kepada "sekat" untuk menyekat akaun.
 *
 * Folder Drive:
 *   Setiap subfolder dalam FOLDER_UTAMA menjadi satu kategori dan fail di dalamnya
 *   dipaparkan automatik. Letak fail baharu dalam folder Drive; tiada Sheet perlu dikemas kini.
 */

var TAB_AKAUN = 'Akaun';
var FOLDER_UTAMA = '1abY0Hpimq4fRokCyNUPHaxmzi-6ZF1mT';
var KUNCI_CACHE_DRIVE = 'drive-senarai-v1';
var CACHE_DRIVE_SAAT = 300; // senarai disimpan 5 minit; "Muat semula senarai" dalam app memintas cache
var TAJUK_AKAUN = ['ID', 'Nama', 'Emel', 'Hash', 'Salt', 'Status', 'Dicipta', 'Log masuk terakhir', 'Foto'];
var LAJUR_FOTO = 9;
var HAD_FOTO = 45000; // had sel Google Sheet ialah 50,000 aksara
var SESI_HARI = 30;
var PUSINGAN_HASH = 500;
var HAD_GAGAL = 5;
var TETINGKAP_GAGAL_SAAT = 900;

/* ---------- Titik masuk ---------- */

function doGet() {
  return json_({ ok: true, mesej: 'API Fail Disiplin aktif.' });
}

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (data.aksi) {
      case 'daftar': return json_(daftar_(data));
      case 'masuk': return json_(masuk_(data));
      case 'sesi': return json_(sesi_(data));
      case 'pintasan': return json_(pintasan_(data));
      case 'foto': return json_(foto_(data));
      default: return json_(gagal_('Permintaan tidak dikenali.'));
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_(gagal_('Ralat pada pelayan. Cuba lagi sebentar.'));
  }
}

/** Jalankan sekali dari editor untuk membenarkan skrip dan menyediakan tab Akaun. */
function sediakan() {
  lembaranAkaun_();
  rahsia_();
  console.log('Folder Drive: ' + DriveApp.getFolderById(FOLDER_UTAMA).getName());
  console.log('Siap. Tab Akaun disediakan. Seterusnya: Deploy > New deployment > Web app.');
}

/* ---------- Tindakan ---------- */

function daftar_(d) {
  var nama = String(d.nama || '').replace(/\s+/g, ' ').replace(/^[=+\-@\s]+/, '').trim();
  var emel = normalEmel_(d.emel);
  var kata = String(d.kata || '');

  if (nama.length < 2 || nama.length > 80) return gagal_('Masukkan nama penuh anda (2 hingga 80 aksara).');
  if (!sahEmel_(emel)) return gagal_('Emel tidak sah. Semak ejaan dan cuba lagi.');
  if (kata.length < 8 || kata.length > 100) return gagal_('Kata laluan mesti sekurang-kurangnya 8 aksara.');

  var salt = Utilities.getUuid();
  var hash = hash_(kata, salt);

  var kunci = LockService.getScriptLock();
  kunci.waitLock(15000);
  try {
    if (cariAkaun_(emel)) return gagal_('Emel ini sudah berdaftar. Sila log masuk.');
    var sekarang = new Date();
    lembaranAkaun_().appendRow([Utilities.getUuid(), nama, emel, hash, salt, 'aktif', sekarang, sekarang]);
  } finally {
    kunci.releaseLock();
  }
  return { ok: true, token: cipta_(emel), nama: nama, emel: emel, foto: '' };
}

function masuk_(d) {
  var emel = normalEmel_(d.emel);
  var kata = String(d.kata || '');
  if (!emel || !kata) return gagal_('Masukkan emel dan kata laluan.');

  var cache = CacheService.getScriptCache();
  var kunciGagal = 'gagal:' + emel;
  var bilGagal = Number(cache.get(kunciGagal) || 0);
  if (bilGagal >= HAD_GAGAL) return gagal_('Terlalu banyak cubaan. Cuba lagi dalam 15 minit.');

  var akaun = cariAkaun_(emel);
  var sah = false;
  if (akaun) sah = samaMasa_(hash_(kata, akaun.salt), akaun.hash);
  else hash_(kata, 'tiada-akaun');

  if (!sah) {
    cache.put(kunciGagal, String(bilGagal + 1), TETINGKAP_GAGAL_SAAT);
    return gagal_('Emel atau kata laluan tidak betul.');
  }
  if (akaun.status !== 'aktif') return gagal_('Akaun ini disekat. Hubungi pentadbir sekolah.');

  cache.remove(kunciGagal);
  lembaranAkaun_().getRange(akaun.baris, 8).setValue(new Date());
  return { ok: true, token: cipta_(akaun.emel), nama: akaun.nama, emel: akaun.emel, foto: fotoAkaun_(akaun.baris) };
}

function sesi_(d) {
  var akaun = semakToken_(d.token);
  if (!akaun) return { ok: false, tamat: true, mesej: 'Sesi tamat. Log masuk semula.' };
  return { ok: true, nama: akaun.nama, emel: akaun.emel, foto: fotoAkaun_(akaun.baris) };
}

/** Simpan atau buang foto profil. Foto dihantar sebagai data URL JPEG yang sudah dikecilkan oleh PWA. */
function foto_(d) {
  var akaun = semakToken_(d.token);
  if (!akaun) return { ok: false, tamat: true, mesej: 'Sesi tamat. Log masuk semula.' };

  var foto = String(d.foto || '');
  if (foto && (foto.length > HAD_FOTO || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/]+=*$/.test(foto))) {
    return gagal_('Foto tidak sah atau terlalu besar.');
  }

  var sh = lembaranAkaun_();
  if (!sh.getRange(1, LAJUR_FOTO).getValue()) sh.getRange(1, LAJUR_FOTO).setValue('Foto').setFontWeight('bold');
  sh.getRange(akaun.baris, LAJUR_FOTO).setValue(foto);
  return { ok: true, foto: foto };
}

function pintasan_(d) {
  var akaun = semakToken_(d.token);
  if (!akaun) return { ok: false, tamat: true, mesej: 'Sesi tamat. Log masuk semula.' };

  var cache = CacheService.getScriptCache();
  if (!d.segar) {
    var simpanan = cache.get(KUNCI_CACHE_DRIVE);
    if (simpanan) return JSON.parse(simpanan);
  }

  var hasil = { ok: true, kumpulan: bacaDrive_(), kemaskini: Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'd/M/yyyy, h:mm a') };
  try { cache.put(KUNCI_CACHE_DRIVE, JSON.stringify(hasil), CACHE_DRIVE_SAAT); } catch (e) { /* terlalu besar untuk cache: abaikan */ }
  return hasil;
}

/* ---------- Senarai fail terus dari Google Drive ---------- */

/**
 * Setiap subfolder dalam FOLDER_UTAMA menjadi satu kategori. Fail dan subfolder di dalamnya
 * disenaraikan automatik. Fail yang terletak terus dalam folder utama dikumpul sebagai
 * "Dokumen Utama". Nombor di depan nama folder ("5. SURAT") digunakan untuk susunan.
 * Keterangan kategori diambil daripada Description folder di Drive (klik kanan > Folder information).
 */
function bacaDrive_() {
  var utama = DriveApp.getFolderById(FOLDER_UTAMA);
  var kumpulan = [];

  var lepas = senaraiKandungan_(utama, false);
  if (lepas.length) {
    kumpulan.push({ susun: -1, kategori: 'pengurusan', ikon: 'carta', tajuk: 'Dokumen Utama',
      keterangan: 'Fail dalam folder utama.', url: utama.getUrl(), fail: lepas });
  }

  var folder = utama.getFolders();
  while (folder.hasNext()) {
    var f = folder.next();
    if (f.isTrashed()) continue;
    var nama = f.getName().trim();
    var jenis = jenisKategori_(nama);
    kumpulan.push({
      susun: nomborDepan_(nama),
      kategori: jenis.kategori,
      ikon: jenis.ikon,
      tajuk: tajukKemas_(nama),
      keterangan: String(f.getDescription() || '').trim(),
      url: f.getUrl(),
      fail: senaraiKandungan_(f, true)
    });
  }

  kumpulan.sort(function (a, b) { return a.susun - b.susun || a.tajuk.localeCompare(b.tajuk); });
  kumpulan.forEach(function (k) { delete k.susun; });
  return kumpulan;
}

/** Senarai [nama, url, jenis] untuk fail (dan subfolder jika denganFolder) dalam satu folder. */
function senaraiKandungan_(folder, denganFolder) {
  var item = [];
  if (denganFolder) {
    var sub = folder.getFolders();
    while (sub.hasNext()) {
      var s = sub.next();
      if (!s.isTrashed()) item.push([s.getName().trim(), s.getUrl(), 'folder']);
    }
  }
  var fail = folder.getFiles();
  while (fail.hasNext()) {
    var f = fail.next();
    if (f.isTrashed()) continue;
    var mime = f.getMimeType();
    if (mime === MimeType.SHORTCUT) mime = f.getTargetMimeType() || mime;
    item.push([buangSambungan_(f.getName().trim()), f.getUrl(), jenisFail_(mime, f.getName())]);
  }
  item.sort(function (a, b) {
    if ((a[2] === 'folder') !== (b[2] === 'folder')) return a[2] === 'folder' ? -1 : 1;
    return nomborDepan_(a[0]) - nomborDepan_(b[0]) || a[0].localeCompare(b[0]);
  });
  return item;
}

function jenisFail_(mime, nama) {
  if (mime === MimeType.FOLDER) return 'folder';
  if (mime === MimeType.PDF) return 'pdf';
  if (/document|msword|wordprocessing/.test(mime)) return 'doc';
  if (/spreadsheet|ms-excel|sheet/.test(mime)) return 'xls';
  if (/presentation|powerpoint/.test(mime)) return 'ppt';
  if (/^image\//.test(mime) || mime === MimeType.GOOGLE_DRAWINGS) return 'img';
  var ext = (String(nama).match(/\.([a-z0-9]{1,4})$/i) || [])[1];
  return ext ? ext.toLowerCase() : 'fail';
}

/** Kategori (untuk tapisan) dan ikon dipilih berdasarkan kata kunci dalam nama folder. */
function jenisKategori_(nama) {
  var n = nama.toUpperCase();
  var peta = [
    [/PEKELILING|SPI/, 'surat', 'spi'],
    [/SURAT/, 'surat', 'surat'],
    [/UBK/, 'rekod', 'ubk'],
    [/SAHSIAH/, 'rekod', 'sahsiah'],
    [/KES/, 'rekod', 'kes'],
    [/LEWAT/, 'rekod', 'lewat'],
    [/PEMERIKSAAN|SPOT|AMARAN/, 'rekod', 'amaran'],
    [/LAPORAN/, 'rekod', 'laporan'],
    [/MINIT/, 'pengurusan', 'minit'],
    [/MESYUARAT/, 'pengurusan', 'mesyuarat'],
    [/JADUAL|TAKWIM/, 'pengurusan', 'jadual'],
    [/POSTER|HEBAHAN/, 'pengurusan', 'poster'],
    [/CARTA|ORGANISASI/, 'pengurusan', 'carta'],
    [/JOM KE SEKOLAH|JKS/, 'pengurusan', 'jks'],
    [/SENARAI|BORANG/, 'pengurusan', 'senarai']
  ];
  for (var i = 0; i < peta.length; i++) if (peta[i][0].test(n)) return { kategori: peta[i][1], ikon: peta[i][2] };
  return { kategori: 'pengurusan', ikon: 'folder' };
}

function nomborDepan_(nama) {
  var m = String(nama).match(/^\s*(\d+)/);
  return m ? Number(m[1]) : 9999;
}

var SINGKATAN_ = ['UBK', 'SPI', 'JKS', 'PIBG', 'KPM', 'JPN', 'PPD', 'SMK', 'LDP', 'HEM', 'PDPC', 'SPBT', 'KSSM'];

/** "10. LAPORAN SAHSIAH MURID " -> "Laporan Sahsiah Murid" (singkatan dikekalkan). */
function tajukKemas_(nama) {
  var t = String(nama).replace(/^\s*\d+\s*[.)\-]?\s*/, '').replace(/\s+/g, ' ').trim();
  if (t !== t.toUpperCase()) return t;
  return t.split(' ').map(function (w) {
    if (SINGKATAN_.indexOf(w.replace(/[^A-Z]/g, '')) >= 0) return w;
    if (['DAN', 'DI', 'KE', 'DARI', 'BAGI', 'UNTUK'].indexOf(w) >= 0) return w.toLowerCase();
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(' ');
}

function buangSambungan_(nama) {
  return String(nama).replace(/\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|heic|webp)$/i, '');
}

/* ---------- Akaun ---------- */

function lembaranAkaun_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_AKAUN);
  if (!sh) {
    sh = ss.insertSheet(TAB_AKAUN);
    sh.getRange(1, 1, 1, TAJUK_AKAUN.length).setValues([TAJUK_AKAUN]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function cariAkaun_(emel) {
  var sh = lembaranAkaun_();
  var terakhir = sh.getLastRow();
  if (terakhir < 2) return null;
  var nilai = sh.getRange(2, 1, terakhir - 1, 8).getValues();
  for (var i = 0; i < nilai.length; i++) {
    if (String(nilai[i][2]).toLowerCase() === emel) {
      return {
        baris: i + 2,
        id: nilai[i][0],
        nama: String(nilai[i][1]),
        emel: String(nilai[i][2]).toLowerCase(),
        hash: String(nilai[i][3]),
        salt: String(nilai[i][4]),
        status: String(nilai[i][5]).trim().toLowerCase()
      };
    }
  }
  return null;
}

/** Foto dibaca berasingan supaya cariAkaun_ tidak memuat semua foto setiap kali. */
function fotoAkaun_(baris) {
  if (lembaranAkaun_().getLastColumn() < LAJUR_FOTO) return '';
  return String(lembaranAkaun_().getRange(baris, LAJUR_FOTO).getValue() || '');
}

function normalEmel_(v) {
  return String(v || '').trim().toLowerCase();
}

function sahEmel_(e) {
  return e.length <= 120 && /^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(e);
}

/* ---------- Kata laluan dan token ---------- */

function hex_(bait) {
  return bait.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function hash_(kata, salt) {
  var h = salt + kata;
  for (var i = 0; i < PUSINGAN_HASH; i++) {
    h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt + kata, Utilities.Charset.UTF_8));
  }
  return h;
}

function samaMasa_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var beza = 0;
  for (var i = 0; i < a.length; i++) beza |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return beza === 0;
}

function rahsia_() {
  var p = PropertiesService.getScriptProperties();
  var r = p.getProperty('RAHSIA');
  if (!r) {
    r = Utilities.getUuid() + Utilities.getUuid();
    p.setProperty('RAHSIA', r);
  }
  return r;
}

function tandatangan_(muatan) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(muatan, rahsia_()));
}

function cipta_(emel) {
  var tamat = Date.now() + SESI_HARI * 24 * 60 * 60 * 1000;
  var muatan = Utilities.base64EncodeWebSafe(emel + '|' + tamat, Utilities.Charset.UTF_8);
  return muatan + '.' + tandatangan_(muatan);
}

function semakToken_(token) {
  if (!token || typeof token !== 'string') return null;
  var bahagian = token.split('.');
  if (bahagian.length !== 2) return null;
  if (!samaMasa_(tandatangan_(bahagian[0]), bahagian[1])) return null;
  var teks = Utilities.newBlob(Utilities.base64DecodeWebSafe(bahagian[0])).getDataAsString();
  var s = teks.split('|');
  if (s.length !== 2 || Number(s[1]) < Date.now()) return null;
  var akaun = cariAkaun_(s[0]);
  if (!akaun || akaun.status !== 'aktif') return null;
  return akaun;
}

/* ---------- Bantuan ---------- */

function gagal_(mesej) {
  return { ok: false, mesej: mesej };
}

function json_(objek) {
  return ContentService.createTextOutput(JSON.stringify(objek)).setMimeType(ContentService.MimeType.JSON);
}
