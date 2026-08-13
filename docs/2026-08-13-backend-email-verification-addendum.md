# Backend Auth — Addendum: Email Verification

**Date:** 2026-08-13
**Version:** 1.0 (addendum, supersedes bagian terkait dari contract 2026-08-12)
**Base contract:** `2026-08-12-backend-auth-api-contract.md`

Addendum ini menambahkan **verifikasi email wajib** ke modul auth. Semua konvensi base contract tetap berlaku: envelope `{ success, message, data, error? }`, kode error UPPER_SNAKE_CASE, `message` berbahasa Indonesia.

---

## 1. Ringkasan Perubahan

1. **`POST /auth/register` BERUBAH** — akun dibuat dalam status *belum diverifikasi*, kode 6 digit dikirim ke email, dan response **tidak lagi berisi token**.
2. **`POST /auth/verify-email` BARU** — validasi kode; kalau valid, akun diverifikasi dan token diterbitkan (auto-login).
3. **`POST /auth/resend-code` BARU** — kirim ulang kode baru (kode lama mati), cooldown 60 detik per email.
4. **`POST /auth/login` BERUBAH** — akun yang `emailVerifiedAt`-nya null ditolak dengan **403 `EMAIL_NOT_VERIFIED`**.
5. **Google sign-in** (`/auth/google`) tidak terpengaruh — email dari Google dianggap sudah terverifikasi (`emailVerifiedAt = now()` saat akun dibuat).

---

## 2. Data Model

Perubahan pada Prisma schema:

```prisma
model User {
  // ... field yang sudah ada ...
  emailVerifiedAt DateTime?     // null = belum diverifikasi
  verificationCodes VerificationCode[]
}

model VerificationCode {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash  String   // SHA-256 dari kode 6 digit; JANGAN simpan plaintext
  expiresAt DateTime
  attempts  Int      @default(0)   // jumlah percobaan verifikasi terhadap kode ini
  createdAt DateTime @default(now())

  @@index([userId])
}
```

Aturan:
- Kode 6 digit numerik (generate cryptographically random, `000000`–`999999`).
- TTL kode: **10 menit** (env `CODE_TTL_MINUTES`).
- Maksimal **5 kali** percobaan salah per kode (`CODE_MAX_ATTEMPTS`). Lewat itu → kode mati, user harus resend.
- Setiap `register`/`resend` sukses: invalidasi semua kode lama user itu, buat satu kode baru.

---

## 3. Endpoint

### 3.1 POST /auth/register (BERUBAH)

**Request:** `RegisterRequest` (tidak berubah).

**Perilaku:**
1. Validasi + cek email unik (sama seperti sebelumnya).
2. Buat user dengan `emailVerifiedAt: null`.
3. Generate kode, simpan hash, kirim email (lihat bagian 4).
4. Return response **tanpa token**.

**Response sukses — `201 Created`**, `data: null`:

```json
{
  "success": true,
  "message": "Kode verifikasi telah dikirim ke email kamu",
  "data": null
}
```

Client memakai `message` ini langsung sebagai umpan balik, dan berpindah ke layar verifikasi memakai email yang barusan didaftarkan.

**Error:** tidak berubah (`EMAIL_TAKEN` 409, `VALIDATION_ERROR` 400).

**Catatan penting:** jika implementasi lama sudah mengembalikan `AuthData` dari register, **hapus** — itu melanggar addendum ini.

### 3.2 POST /auth/verify-email (BARU)

**Request:**

```ts
VerifyEmailRequest = {
  email: string;    // wajib, format email valid
  code: string;     // wajib, 6 digit
}
```

**Perilaku:**
1. Cari user by email (lowercase). Email tidak terdaftar → 400 `INVALID_CODE` (pesan seragam — jangan membocorkan keberadaan email).
2. Ambil kode aktif user (belum expired, attempts < 5).
3. Bandingkan hash. Salah → `attempts += 1`, balas 400 `INVALID_CODE`.
4. Benar → set `emailVerifiedAt = now()`, hapus semua kode user itu, terbitkan pasangan token.

**Response sukses — `200 OK`**, `data: AuthData` (bentuk sama dengan `/auth/login`):

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "user": { "id": "u1", "email": "budi@example.com", "name": "Budi", "authProvider": "email", "tier": "free" },
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

**Error:**

| Kondisi | HTTP | `error` | `message` |
|---------|------|---------|-----------|
| Email tidak terdaftar / tidak ada kode aktif / kode salah / attempts habis | 400 | `INVALID_CODE` | `"Kode tidak valid atau sudah kedaluwarsa"` |

Keempat kondisi sengaja memakai kode yang seragam — mencegah probing dan timing attack.

### 3.3 POST /auth/resend-code (BARU)

**Request:**

```ts
ResendCodeRequest = {
  email: string;    // wajib, format email valid
}
```

**Perilaku:**
1. Cari user by email. Tidak ada → tetap balas 200 dengan pesan generik (anti-enumerasi).
2. Jika kode aktif terakhir dibuat < 60 detik lalu (env `RESEND_COOLDOWN_SECONDS`) → 429 `RESEND_TOO_SOON`.
3. Buat kode baru (yang lama mati), kirim email.

**Response sukses — `200 OK`**, `data: null`:

```json
{
  "success": true,
  "message": "Kode verifikasi telah dikirim ulang",
  "data": null
}
```

**Error:**

| Kondisi | HTTP | `error` | `message` |
|---------|------|---------|-----------|
| Belum 60 detik sejak kode terakhir | 429 | `RESEND_TOO_SOON` | `"Tunggu sebentar sebelum mengirim ulang"` |
| Validasi gagal | 400 | `VALIDATION_ERROR` | (array detail) |

### 3.4 POST /auth/login (BERUBAH)

Tambahkan satu cabang kegagalan **sebelum** pengecekan password:

- User ditemukan DAN `emailVerifiedAt == null` → **403 `EMAIL_NOT_VERIFIED`**.

```json
{
  "success": false,
  "error": "EMAIL_NOT_VERIFIED",
  "message": "Email kamu belum diverifikasi",
  "data": null
}
```

Catatan urutan: agar konsisten dengan prinsip anti-enumerasi, respons untuk *email tidak ditemukan* dan *password salah* tetap 401 `INVALID_CREDENTIALS` yang seragam. Status 403 khusus ini hanya muncul untuk akun yang **benar-benar ada** tapi belum diverifikasi — trade-off yang disetujui karena client membutuhkannya untuk mengarahkan user ke layar verifikasi.

Endpoint lain (`/auth/google`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/auth/health`) tidak berubah.

### 3.5 Tabel kode error (tambahan)

| Kode | HTTP | Dipakai di |
|------|------|-----------|
| `EMAIL_NOT_VERIFIED` | 403 | login oleh akun belum verifikasi |
| `INVALID_CODE` | 400 | verify-email: kode salah / tidak ada / kedaluwarsa / attempts habis |
| `RESEND_TOO_SOON` | 429 | resend-code dalam cooldown 60 detik |

---

## 4. Pengiriman Email (Gmail SMTP)

- Library: **Nodemailer**, transport SMTP.
- Konfigurasi env baru:

```env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your-account@gmail.com"
SMTP_PASS="gmail-app-password-16-digit"
MAIL_FROM="Aria <your-account@gmail.com>"
CODE_TTL_MINUTES="10"
CODE_MAX_ATTEMPTS="5"
RESEND_COOLDOWN_SECONDS="60"
```

- `SMTP_PASS` memakai **Gmail App Password** (bukan password akun) — dibuat di pengaturan Google Account (2FA wajib aktif).
- Format email — plain text sederhana (tanpa template engine):

```
Subject: Kode verifikasi Aria

Halo {name},

Kode verifikasi kamu: {code}

Kode berlaku 10 menit. Jika kamu tidak merasa mendaftar di Aria, abaikan email ini.
```

- Bungkus service email dalam satu class (`MailService`) dengan satu method `sendVerificationCode(to, name, code)` — supaya pengirimnya bisa diganti/di-mock di test.
- **Kegagalan pengiriman SMTP tidak boleh membatalkan register**: user tetap dibuat dan endpoint tetap 201; kegagalan kirim dicatat di log server. (User bisa memakai resend-code.)

---

## 5. Testing Requirement (tambahan)

- Unit: generate kode selalu 6 digit; expired/attempts-habis ditolak; resend cooldown.
- E2E flow verifikasi (mock `MailService`):
  - register → 201 tanpa token → verify-email kode benar → 200 dengan token → `/me` bekerja
  - verify-email kode salah → 400 `INVALID_CODE`; 5x salah → `INVALID_CODE` terus sampai resend
  - login sebelum verifikasi → 403 `EMAIL_NOT_VERIFIED`; sesudah verifikasi → 200
  - resend-code < 60 detik → 429 `RESEND_TOO_SOON`

---

## 6. Checklist Conformance (tambahan)

- [ ] `/auth/register` TIDAK mengembalikan token
- [ ] Kode disimpan sebagai hash, bukan plaintext
- [ ] Kode expired (10 menit) dan attempts-habis (5x) ditolak dengan pesan seragam
- [ ] Resend cooldown 60 detik
- [ ] Login akun belum verifikasi → 403 `EMAIL_NOT_VERIFIED`
- [ ] User Google sign-in otomatis `emailVerifiedAt = now()`
- [ ] Kegagalan SMTP tidak membatalkan register
- [ ] Swagger `/api/docs` mencerminkan endpoint baru