# 🌦️ METAR Auto Dashboard – BMKG Style

[![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![Framework](https://img.shields.io/badge/framework-Flask-lightgrey.svg)](https://flask.palletsprojects.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**METAR Auto Dashboard** adalah sistem monitoring cuaca penerbangan real-time yang dirancang dengan antarmuka operasional standar BMKG. Aplikasi ini mengotomatisasi pengambilan data dari NOAA Aviation Weather Server dan menyajikannya dalam bentuk visualisasi data, analisis parameter cuaca, serta sistem peringatan dini.

---

## ✨ Fitur Utama

- 📡 **Auto Fetch METAR**: Pengambilan data otomatis dari server NOAA setiap 60 detik.
- 📊 **Real-Time Visualization**: Grafik interaktif untuk tren temperatur dan tekanan udara menggunakan Chart.js.
- 🔊 **Smart Audio Alert**:
  - 🔴 **Alarm Bahaya**: Aktif otomatis saat visibilitas < 3000m.
  - 🟢 **Notifikasi**: Bunyi pemberitahuan setiap ada data METAR baru yang masuk.
- ✈️ **Aviation Calculator**: Perhitungan otomatis *Runway Crosswind* untuk keselamatan lepas landas/mendarat.
- 🌩️ **Thunderstorm Detection**: Deteksi otomatis fenomena badai guntur (TS) dalam kode METAR.
- 📄 **Digital QAM Form**: Pembuatan format berita cuaca penerbangan (QAM) secara otomatis.
- 📥 **Data Management**: Riwayat data tersimpan dalam CSV dan dapat diunduh berdasarkan rentang tanggal.
- 🔄 **No-Refresh Updates**: Menggunakan **WebSocket (Socket.IO)** untuk pembaruan data instan tanpa memuat ulang halaman.

---

## 📦 Tech Stack

| Komponen | Teknologi |
| --- | --- |
| **Backend** | Python 3.10+, Flask, Flask-SocketIO |
| **Data Processing** | Pandas, Requests |
| **Frontend** | HTML5, CSS3, JavaScript (Vanilla) |
| **Charts** | Chart.js |
| **Communication** | WebSocket / Socket.IO |

---

## 📂 Struktur Folder

```text
metar-auto-dashboard/
│
├── app.py                 # Main application & Background worker
├── metar_history.csv      # Local database (CSV format)
├── requirements.txt       # Daftar dependensi library
│
├── templates/             # File HTML (UI Layout)
│   ├── index.html         # Dashboard Utama
│   ├── history_by_date.html
│   └── manual_parser.html
│
├── static/                # Assets Statis
│   ├── style.css          # Styling BMKG Dark/Light Mode
│   ├── dashboard.js       # Logika WebSocket & Chart
│   ├── alarm.mp3          # Alert visibilitas rendah
│   └── notify.mp3         # Alert data baru
│
└── README.md
