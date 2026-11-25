# AIKOE — Gambar & Video

Website AI generate **gambar dan video** berbasis API.
Semua model yang tersedia di akun kamu dimuat **live** dari API — tidak ada daftar model yang di-hardcode — dan panel kontrolnya dibangun otomatis dari skema parameter resmi tiap model.

## Anti-duplikat (tidak ada model kembar)

Daftar model digabung dari endpoint model gambar + video, lalu di-**dedupe ketat berdasarkan `model_id`** di server *dan* di frontend: satu `model_id` hanya muncul satu kali.
Catatan: nama tampil yang sama (mis. "Nano Banana 2.1" muncul 3×) **bukan** duplikat — itu varian mode berbeda (Teks→Gambar / Gambar→Gambar / Multi-Gambar) dengan `model_id` berbeda. UI selalu menampilkan label mode + `model_id` di badge agar tiap entri bisa dibedakan.
Hasil audit pada akun pemilik (2026-11-25): **194 model gambar + 254 model video + 107 model teks = 555 model, 555 ID unik, 0 duplikat, 0 tumpang tindih antar-jenis.**

## Fitur

- **Semua model gambar, video & chat** — tab Gambar/Video/Chat dengan jumlah model, estimasi waktu, dan badge model unggulan. Ada pencarian + filter capability yang dinamis (Teks→Video, Gambar→Video, Video→Video, Frame→Video, Upscaler, dst. mengikuti data API).
- **Tab Chat (model teks/asisten)** — 107 model jenis teks: 33 chat murni (Claude, GPT, Gemini, dll. — kategori "Chat (Teks → Teks)"), 33 Gambar→Teks (vision: deskripsikan/analisis gambar referensi), 33 Video→Teks, 8 Audio→Teks (transkrip; butuh URL audio). Parameter ekstra per model (mis. `thinking`, `web_search` pada sebagian model Claude) dirender otomatis di panel.
- **Layout chat beneran untuk model chat murni** — memilih model "Chat (Teks → Teks)" mengubah tampilan jadi antarmuka percakapan seperti aplikasi chat umumnya: gelembung pesan (kamu di kanan biru, asisten di kiri putih), indikator "sedang mengetik", kotak pesan di bawah (Enter = kirim, Shift+Enter = baris baru), tombol "Percakapan baru". Karena API bersifat sekali-jalan (stateless), ingatan konteks dijaga website: riwayat percakapan (maks 16 giliran terakhir) dikirim sebagai konteks tiap pesan — terverifikasi model bisa mengingat nama yang disebut di awal chat. Percakapan tersimpan per model di browser (localStorage `aikoe-chats`). Model teks non-chat (Gambar/Video/Audio→Teks) tetap memakai alur generate + kartu teks di galeri (Salin & Download .txt).
- **Kontrol video dinamis** — durasi, resolusi, aspek rasio, seed, dan parameter lain dirender dari skema model video terpilih, sama seperti gambar. Parameter bertanda **WAJIB** divalidasi sebelum generate (mis. model Gambar→Video wajib punya referensi).
- **Panel kontrol dinamis per model** — setiap model punya parameter berbeda, dan UI menampilkannya sesuai skema dari API:
  - *Aspek rasio* → pemilih visual berbentuk kotak rasio (1:1, 16:9, 9:16, 4:3, 3:4, dst. sesuai model)
  - *Kualitas / resolusi* → tombol segmen sesuai opsi model
  - *Seed* → input angka + tombol acak 🎲
  - *Angka berskala* (guidance, steps, dll.) → slider
  - *Boolean* → saklar, *enum panjang* → dropdown, *teks* → input biasa
- **Model Motion Control tersedia** — Kling 2.6 Pro / 3.0 Pro / 3.0 Standard Motion Control + Marey Motion Transfer ada di tab **Video**, kategori **Gabungan / Motion → Video**. Model motion butuh **foto karakter + video referensi gerakan** (video gerakan min. 3 detik, dari validasi provider).
- **Upload referensi gambar DAN video, mengikuti model (bukan angka tetap)** — drag & drop, klik, atau paste dari clipboard. Batasnya diturunkan dari skema parameter model terpilih: tanpa parameter gambar = 0 referensi; `image_url` tunggal = tepat 1; `image_urls` (array) = banyak, dengan batas asli per model yang **tidak dipublikasikan di skema API** — website mempelajarinya otomatis dari pesan validasi resmi server (pra-cek validasi sebelum generate, mis. terverifikasi: keluarga Nano Banana maks 14, FLUX 3 maks 10) lalu menyimpannya per `model_id`. Plafon upload UI 14. Referensi di luar batas model ditandai "cadangan" (abu-abu) dan tidak dikirim, tapi tetap tersimpan kalau kamu ganti model yang muat lebih banyak. File diupload lewat backend ke penyimpanan asset API (≤4MB direct, lebih besar via signed upload). Kalau modelnya teks→gambar, ada peringatan bahwa referensi tidak akan dipakai.
- **Generate + polling otomatis** — mulai generate, lalu status dipolling sampai selesai; hasil langsung masuk galeri.
- **Galeri & riwayat** — tersimpan di browser (localStorage), ada lightbox, tombol Download (lewat proxy backend), dan "Jadikan referensi" untuk iterasi.
- **UI putih–biru + glassmorphism**, layout responsif: desktop dua kolom (panel lengket di kiri, galeri di kanan), mobile satu kolom dengan bar tombol Generate yang lengket di bawah.

## Keamanan API key

Provider mewajibkan API key **server-side only** — tidak boleh ada di kode frontend.
Karena itu website ini punya backend tipis (Node.js murni, tanpa dependensi): key tinggal di file `.env` server dan tidak pernah dikirim ke browser maupun muncul di kode frontend.

## Cara menjalankan

Syarat: Node.js 20+ dan API key dari provider (buat di dashboard provider → Settings → API Keys, permission **Read + Write**).

```bash
cp .env.example .env   # lalu isi API key (dan workspace ID bila perlu)
npm start              # atau: node server.js
```

Buka http://localhost:3000

### Isi `.env`

| Variabel | Keterangan |
|---|---|
| `FLORA_API_KEY` | Wajib. Key dari Settings → API Keys. |
| `FLORA_WORKSPACE_ID` | ID workspace (`ws_...`). Boleh kosong — server memakai workspace pertama yang dijangkau key. |
| `FLORA_PROJECT_ID` | Opsional (`prj_...`). Kosong = server otomatis membuat/menemukan project **"AIKOE"** dan mengingatnya di `data/project.json`. Semua hasil generate mendarat di canvas project itu. |
| `PORT` | Port server, default `3000`. |

## Endpoint backend

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/config` | Status konfigurasi (tanpa membocorkan key) |
| GET | `/api/health` | Diagnosa langkah-demi-langkah (env → workspace → model → project) |
| GET | `/api/models` | Gabungan model gambar + video, dedupe by `model_id` (cache 5 menit) |
| GET | `/api/workspaces` | Proxy daftar workspace |
| POST | `/api/upload` | Upload 1 gambar referensi ke penyimpanan asset |
| POST | `/api/generate` | Mulai generate (dengan `Idempotency-Key`) |
| GET | `/api/runs/:id` | Polling status & output run |
| GET | `/api/generations` | Riwayat generate di workspace |
| GET | `/api/download?url=` | Download hasil sebagai lampiran |

## Deploy online (GitHub → Vercel → domain sendiri)

Project ini siap Vercel dengan mode **server entrypoint**: Vercel menjalankan `server.js` langsung sebagai server Node (terdeteksi otomatis, tanpa `vercel.json` dan tanpa folder `api/` — keduanya justru HARUS tidak ada agar routing `/api/*` tidak tertimpa rewrite). `server.js` yang sama juga jalan sebagai server biasa di lokal.

1. **GitHub** — buat repo baru (mis. `aikoe`), upload semua isi project ini **kecuali `.env`** (file `.env` sudah dikecualikan oleh `.gitignore` — JANGAN pernah upload API key ke GitHub).
2. **Vercel** — [vercel.com](https://vercel.com) → *Add New… → Project* → import repo `aikoe` → Framework Preset: **Other** (Root Directory: `./`).
3. **Environment Variables** (di halaman import / Settings → Environment Variables), isi:
   - `FLORA_API_KEY` — key kamu
   - `FLORA_WORKSPACE_ID` — workspace kamu
   - `SITE_PASSWORD` — **sangat disarankan**: password kunci website (username selalu `aikoe`). Tanpa ini, siapa pun yang tahu URL bisa generate memakai kuota akunmu.
4. **Deploy** → website online di `https://aikoe-xxxx.vercel.app`.
5. **Domain sendiri** — di Vercel: *Settings → Domains → Add* → ketik domainmu → Vercel menampilkan DNS yang harus dipasang di tempat kamu membeli domain:
   - Domain utama (apex, mis. `contoh.com`): **A record** `@` → `76.76.21.21`
   - Subdomain (mis. `www` / `ai`): **CNAME** → `cname.vercel-dns.com`
   - Kalau DNS dikelola Cloudflare: matikan proxy (awan abu-abu / *DNS only*) untuk record tersebut.
   - Tunggu status domain di Vercel jadi **Valid** (HTTPS otomatis aktif; propagasi DNS bisa 5 menit – beberapa jam).

Batasan versi online (Vercel Hobby): satu request maks ±4,5MB, jadi upload referensi berukuran besar (terutama video panjang) bisa gagal — gambar referensi ukuran wajar aman. Generate & polling berjalan normal.

## Catatan

- URL output berumur panjang tapi tidak permanen — download hasil yang penting.
- Untuk deploy publik, jalankan di balik HTTPS (mis. VPS + pm2 + Nginx/Caddy) dan jangan pernah commit file `.env`.
