# TODO: Perbaikan Sound Alarm

## Langkah-langkah yang telah dilakukan:

1. **Analisis masalah**: Sound alarm tidak berbunyi ketika data metar baru masuk, padahal tombol sound on sudah diklik.

2. **Identifikasi penyebab**:
   - Audio context belum di-unlock karena kebijakan autoplay browser.
   - Fungsi `enableSound()` tidak menangani error dengan baik.
   - State `soundEnabled` tidak disimpan di localStorage sehingga state hilang saat refresh.
   - Kurang logging untuk debugging.

3. **Perubahan yang dilakukan pada `static/dashboard.js`**:
   - **Variabel `soundEnabled`**: sekarang diinisialisasi dari localStorage.
   - **Fungsi `enableSound()`**: diperbaiki dengan penanganan error yang lebih baik, menggunakan `unlockAudio` untuk memastikan audio diputar dan pause. State disimpan ke localStorage.
   - **Fungsi `playNotify()` dan `playAlarm()`**: tambahkan logging dan penanganan error dengan retry.
   - **Tombol sound toggle**: saat halaman dimuat, tombol diupdate sesuai state dari localStorage.
   - **Handler `socket.on('metar_update')`**: tambahkan logging untuk `soundEnabled` dan pemanggilan sound.

4. **File yang diubah**: `static/dashboard.js`

## Langkah-langkah berikutnya:

1. **Test perubahan**: Jalankan aplikasi Flask dan coba dengan data metar baru.
   - Buka browser ke `http://localhost:5000`
   - Klik tombol "Sound ON"
   - Tunggu data metar baru masuk (atau simulasi dengan mengirim event WebSocket)
   - Cek apakah sound muncul.

2. **Jika masih tidak bekerja**, periksa:
   - Console log di browser untuk melihat error.
   - Pastikan file audio bisa dimuat (network tab).
   - Coba tambahkan tombol test sound untuk debugging.

3. **Jika berhasil**, dokumentasikan perubahan.

## Perintah untuk menjalankan server:

```
bash
python app.py
```

Server akan berjalan di port 5000.

## Catatan:

- Perubahan hanya pada frontend JavaScript. Tidak ada perubahan pada backend Flask.
- Sound diputar untuk semua data baru (kecuali pertama kali load) dan untuk kondisi alarm (visibility rendah, thunderstorm).
- State sound disimpan secara persist antar refresh halaman.
