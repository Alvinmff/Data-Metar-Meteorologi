# Panduan Testing Sound Alarm

## Latar Belakang
Sound alarm tidak berbunyi ketika data metar baru masuk, padahal tombol sound on sudah diklik. Telah dilakukan perbaikan pada file `static/dashboard.js` untuk meningkatkan keandalan sound.

## Perubahan yang dilakukan:
1. **Penyimpanan state sound di localStorage**: State `soundEnabled` disimpan sehingga tetap ON setelah refresh halaman.
2. **Unlock audio context yang lebih robust**: Fungsi `enableSound()` sekarang mencoba memutar audio dan pause untuk membuka kunci kebijakan autoplay browser.
3. **Penanganan error pada pemutaran sound**: Fungsi `playNotify()` dan `playAlarm()` menangani error dengan mencoba load ulang audio.
4. **Logging tambahan**: Ditambahkan console.log untuk memudahkan debugging.

## Langkah-langkah testing:

### 1. Pastikan server berjalan
Server Flask sudah berjalan di `http://127.0.0.1:5000`. Buka browser dan akses alamat tersebut.

### 2. Aktifkan sound
- Klik tombol "Sound OFF" di pojok kanan atas (akan berubah menjadi "Sound ON" dengan latar belakang kuning).
- Console browser (F12 > Console) akan menampilkan log "Sound ENABLED" dan "Audio unlocked successfully".

### 3. Tunggu data metar baru
- Data metar baru akan masuk setiap 80 detik (jika ada perubahan). Atau Anda bisa memicu dengan mengklik tombol "⚡ Load METAR" di form ICAO Station.
- Saat data baru masuk, console akan menampilkan:
   - "METAR update received"
   - "soundEnabled: true"
   - "Playing notify sound for new data"
   - "Notify sound played" (jika berhasil)

### 4. Testing alarm kondisi bahaya
- Untuk memicu alarm visibility rendah, pastikan METAR memiliki visibility < 3000m (misal 2000).
- Untuk memicu alarm thunderstorm, pastikan METAR mengandung kode TS, TSRA, dll.
- Alarm akan memutar file `alarm.mp3`.

### 5. Jika sound masih tidak berbunyi:
- Buka tab Network di DevTools, periksa apakah file `notify.mp3` dan `alarm.mp3` berhasil dimuat (status 200 atau 206).
- Cek Console untuk error seperti "Failed to play notify sound".
- Pastikan volume browser tidak mute.

### 6. Tombol test sound (opsional)
Jika diperlukan, dapat ditambahkan tombol test sound di UI. Namun untuk saat ini, Anda dapat test dengan mengklik tombol sound toggle dua kali (OFF lalu ON) untuk memicu unlock audio.

## Kesimpulan
Dengan perubahan ini, sound alarm seharusnya sudah berfungsi dengan baik. Jika masih ada masalah, silakan periksa log di console browser dan laporkan error yang muncul.
