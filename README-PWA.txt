FAIL DISIPLIN — PAKEJ PWA

Kandungan
- index.html: aplikasi (log masuk, daftar akaun, senarai fail Drive)
- manifest.json: maklumat pemasangan aplikasi
- sw.js: cache app-shell supaya aplikasi boleh dibuka semula tanpa internet selepas muat pertama
- icons/: ikon aplikasi (48, 72, 96, 144, 192, 512, maskable 512, apple-touch-icon 180)
- generate_icons.js: penjana ikon (node generate_icons.js) jika mahu ubah reka bentuk ikon
- vercel.json: tetapan header supaya sw.js dan manifest.json sentiasa disemak semula
- Code.gs: skrip Google Apps Script untuk akaun dan senarai pintasan

Cara guna
1. Deploy Code.gs sebagai Web app (Execute as: Me, Who has access: Anyone) dan salin alamat /exec.
2. Tampal alamat itu dalam API_DEFAULT di index.html, atau melalui ikon tetapan pada skrin log masuk.
3. Terbitkan index.html, manifest.json, sw.js dan folder icons/ pada hosting HTTPS (GitHub Pages, Vercel, Netlify).
4. Android/Chrome: buka URL, kemudian pilih "Install app" / "Tambah ke skrin utama" pada menu pelayar.
5. iPhone/iPad: buka dalam Safari, tekan Kongsi, kemudian "Tambah ke Skrin Utama".

Selepas mengubah fail, naikkan CACHE_NAME dalam sw.js (contoh v10 -> v11) supaya semua peranti mengambil versi baharu.
