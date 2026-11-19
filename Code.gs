/**
 * Fail Disiplin 2026: API akaun dan senarai pintasan.
 *
 * Skrip ini diletakkan dalam Google Sheet "Fail Disiplin 2026 - Akaun dan Pintasan"
 * (Sambungan > Apps Script). Ia menyediakan daftar akaun, log masuk dan senarai
 * pintasan kepada PWA. Tiada kod daftar sekolah diperlukan.
 *
 * Tab dalam Sheet:
 *   Akaun     dicipta automatik. Tukar lajur Status kepada "sekat" untuk menyekat akaun.
 *   Pintasan  senarai kategori dan pautan fail. Ubah di sini, PWA terus mengikut.
 */

var TAB_AKAUN = 'Akaun';
var TAB_PINTASAN = 'Pintasan';
var TAJUK_AKAUN = ['ID', 'Nama', 'Emel', 'Hash', 'Salt', 'Status', 'Dicipta', 'Log masuk terakhir', 'Foto'];
var LAJUR_FOTO = 9;
var HAD_FOTO = 45000; // had sel Google Sheet ialah 50,000 aksara
var SESI_HARI = 30;
var PUSINGAN_HASH = 500;
var HAD_GAGAL = 5;
var TETINGKAP_GAGAL_SAAT = 900;

/* ---------- Titik masuk ---------- */

function doGet() {
  return json_({ ok: true, mesej: 'API Fail Disiplin 2026 aktif.' });
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

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_PINTASAN);
  if (!sh || sh.getLastRow() < 2) return { ok: true, kumpulan: [], kemaskini: '' };

  var nilai = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues();
  var peta = {};
  var senarai = [];
  var kemaskini = '';

  nilai.forEach(function (r) {
    if (!kemaskini && String(r[8]).trim()) kemaskini = String(r[8]).trim();
    var tajuk = String(r[2]).trim();
    if (!tajuk) return;
    var k = peta[tajuk];
    if (!k) {
      k = {
        kategori: String(r[0]).trim().toLowerCase(),
        ikon: String(r[1]).trim().toLowerCase(),
        tajuk: tajuk,
        keterangan: String(r[3]).trim(),
        url: String(r[4]).trim(),
        fail: []
      };
      peta[tajuk] = k;
      senarai.push(k);
    }
    var namaFail = String(r[5]).trim();
    var urlFail = String(r[6]).trim();
    if (namaFail && urlFail) k.fail.push([namaFail, urlFail, String(r[7]).trim() || 'FAIL']);
  });

  return { ok: true, kumpulan: senarai, kemaskini: kemaskini };
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
