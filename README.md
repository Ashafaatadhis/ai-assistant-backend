# Aria Backend — Auth Module

Backend NestJS untuk aplikasi Aria (AI assistant). Modul pertama: **Auth** — register, login, Google sign-in, refresh token rotation, logout, profil.

Semua response memakai envelope `{ success, message, data, error? }` — detail di `docs/2026-08-12-backend-auth-api-contract.md` (v2).

## Prasyarat

- Node.js >= 20
- PostgreSQL lokal (default dev: user `postgres`, password `root`, port 5432)

## Setup

```bash
npm install
cp .env.example .env    # sesuaikan DATABASE_URL / TEST_DATABASE_URL / GOOGLE_CLIENT_ID
```

`GOOGLE_CLIENT_ID` = **Client ID** OAuth client bertipe **Web application** dari Google Cloud Console (tanpa redirect URI; dipakai untuk verifikasi ID token dan nanti sebagai `serverClientId` di Flutter).

Buat database dev & test, lalu jalankan migration:

```sql
CREATE DATABASE aria;
CREATE DATABASE aria_test;
```

```bash
npx prisma migrate dev          # DB dev (aria)
# DB test (aria_test) — prisma CLI hanya membaca DATABASE_URL:
DATABASE_URL="postgresql://postgres:root@localhost:5432/aria_test?schema=public" npx prisma migrate deploy
```

## Menjalankan

```bash
npm run start:dev
```

- API: `http://localhost:<PORT>/api` (env `PORT`, default 3000)
- Swagger UI: `http://localhost:<PORT>/api/docs`
- Health: `GET /api/health`

## Endpoint

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/auth/register` | Daftar email+password (201, TANPA token — kirim kode verifikasi) |
| POST | `/api/auth/verify-email` | Verifikasi kode 6 digit → pasangan token (auto-login) |
| POST | `/api/auth/resend-code` | Kirim ulang kode (cooldown 60 detik) |
| POST | `/api/auth/login` | Login email+password (200; 403 jika belum verifikasi) |
| POST | `/api/auth/google` | Login/daftar via Google ID token (201 baru / 200 login) |
| POST | `/api/auth/refresh` | Rotation refresh token → pasangan token baru |
| POST | `/api/auth/logout` | Revoke refresh token (idempotent) |
| GET | `/api/auth/me` | Profil user (butuh `Authorization: Bearer`) |
| GET | `/api/health` | Health check |

## Test

```bash
npm run test        # unit (23 test)
npm run test:e2e    # e2e terhadap DB aria_test (18 test)
npm run lint
```

## Catatan

- Verifikasi email wajib: register → kode 6 digit ke email → verify-email baru dapat token. User Google otomatis terverifikasi.
- Kode verifikasi: TTL 10 menit, maks 5 percobaan salah, disimpan sebagai hash SHA-256. Kegagalan SMTP tidak membatalkan register (pakai resend-code).
- SMTP Gmail: `SMTP_PASS` memakai Gmail App Password (2FA wajib aktif).
- Rate limit 20 request/menit/IP untuk route auth (429 `RATE_LIMIT_EXCEEDED`); `/api/health` dikecualikan.
- Refresh token disimpan sebagai hash SHA-256; rotation atomik (token lama langsung mati).
- Lihat `docs/2026-08-12-backend-auth-prd.md` dan `docs/2026-08-13-backend-email-verification-addendum.md` untuk scope & aturan bisnis lengkap.
