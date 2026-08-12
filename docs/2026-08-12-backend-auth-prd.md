# Aria Backend — Auth Module PRD

**Date:** 2026-08-12
**Version:** 1.0
**Status:** Ready for implementation
**Companion doc:** `2026-08-12-backend-auth-api-contract.md` (contract detail per endpoint)

---

## 1. Context

**Aria** adalah aplikasi AI assistant personal berbasis percakapan. Arsitektur keseluruhan:

```
Flutter App (thin client)  ──HTTP──►  NestJS Backend  ──►  PostgreSQL (Prisma)
                                              │
                                              ├──► Groq/OpenAI/Anthropic API
                                              └──► FCM (push notification)
```

Fase sebelumnya (frontend) sudah selesai: semua screen dibuat dengan **mock data** — login/register/upgrade bekerja in-memory tanpa server. Dokumen ini memulai **fase backend**, dan target pertamanya adalah **modul Auth**.

Backend ini **repo terpisah** dari repo Flutter. Dokumen ini self-contained — tidak perlu mengakses repo lain untuk mengimplementasikannya.

---

## 2. Scope

### In scope (dokumen ini)

- Modul Auth lengkap: register, login, Google sign-in, refresh token rotation, logout, profil.
- Infra minimum untuk menjalankannya: NestJS scaffold, Prisma + PostgreSQL via Docker Compose, Swagger docs, health check.
- Testing: unit + e2e untuk semua endpoint auth.

### Out of scope (fase berikutnya, JANGAN dibuat sekarang)

- Chat / AI orchestration (endpoint chat, integrasi Groq, tool calling, MCP).
- Todo, alarm, reminder, memory endpoints.
- Subscription/billing sungguhan — field `tier` ada di model, tapi TIDAK ADA endpoint yang mengubahnya di fase ini.
- Email verification dan password reset (butuh infrastruktur email; nanti).
- Admin panel.

---

## 3. Tech Stack

| Komponen | Pilihan | Catatan |
|----------|---------|---------|
| Framework | NestJS 10 | REST API |
| Bahasa | TypeScript | strict mode |
| ORM | Prisma | + migrations |
| Database | PostgreSQL 16 | via Docker Compose untuk dev lokal |
| JWT | `@nestjs/jwt` + `@nestjs/passport` + `passport-jwt` | access token |
| Password | `bcrypt` | cost factor 10 |
| Validasi | `class-validator` + `class-transformer` | global ValidationPipe |
| Rate limiting | `@nestjs/throttler` | untuk route auth |
| API docs | `@nestjs/swagger` | served di `/api/docs` |
| Testing | Jest + supertest | unit + e2e |
| Node | >= 20 | LTS |

---

## 4. Arsitektur & Struktur Project

```
aria-backend/
├── docker-compose.yml          # PostgreSQL untuk dev lokal
├── .env.example                # template env vars
├── prisma/
│   └── schema.prisma
├── src/
│   ├── main.ts                 # bootstrap: global pipe, CORS, Swagger, /api prefix
│   ├── app.module.ts
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts  # semua endpoint /api/auth
│   │   ├── auth.service.ts     # business logic
│   │   ├── jwt.strategy.ts     # passport strategy untuk access token
│   │   ├── jwt-auth.guard.ts
│   │   ├── auth.errors.ts      # kode error konstan
│   │   └── dto/
│   │       ├── register.dto.ts
│   │       ├── login.dto.ts
│   │       ├── google-auth.dto.ts
│   │       └── refresh.dto.ts
│   ├── common/
│   │   ├── response.interceptor.ts   # bungkus semua response sukses jadi envelope
│   │   └── http-exception.filter.ts  # ubah semua error jadi envelope
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts   # extends PrismaClient, lifecycle hooks
│   └── health/
│       └── health.controller.ts
└── test/
    ├── auth.e2e-spec.ts        # flow lengkap register→login→me→refresh→logout
    └── google-auth.e2e-spec.ts
```

**Aturan kode:**
- Controller tipis — validasi via DTO, logic di service.
- Semua endpoint auth (kecuali `/me`) TIDAK butuh auth header; `/me` butuh Bearer token.
- **Setiap** response memakai envelope `{ success, message, data, error? }` — implementasi via interceptor global (sukses) + exception filter global (error). Bentuk persisnya ada di API contract.
- Jangan pernah mengembalikan `passwordHash` ke client di response manapun.

---

## 5. Data Model

```prisma
enum AuthProvider {
  email
  google
}

enum UserTier {
  free
  premium
}

model User {
  id           String       @id @default(uuid())
  email        String       @unique
  passwordHash String?      // null untuk user yang daftar via Google
  name         String
  authProvider AuthProvider @default(email)
  tier         UserTier     @default(free)
  createdAt    DateTime     @default(now())
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String    @unique   // SHA-256 dari token, JANGAN simpan plaintext
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
}
```

---

## 6. Token Design

### Access token
- JWT, algoritma HS256.
- Payload: `{ "sub": "<userId>" }` — jangan taruh data lain.
- TTL: **15 menit** (env: `ACCESS_TOKEN_TTL`).
- Dikirim client via header `Authorization: Bearer <accessToken>`.

### Refresh token
- String acak: `crypto.randomBytes(32).toString('hex')` → 64 karakter hex.
- Yang disimpan di DB hanya **SHA-256 hash**-nya, tidak pernah plaintext.
- TTL: **30 hari** (env: `REFRESH_TOKEN_TTL_DAYS`).
- **Rotation:** setiap kali `/refresh` dipanggil, token lama langsung di-revoke dan token baru diterbitkan. Token lama tidak boleh bisa dipakai lagi.

### Password
- Hash dengan bcrypt, cost factor 10.
- Validasi: minimal 8 karakter.

---

## 7. Aturan Bisnis

1. **Register** — email unik (case-insensitive: simpan lowercase). Daftar berhasil → user langsung dapat pasangan token (auto-login).
2. **Login** — email tidak ditemukan ATAU password salah → error 401 yang SAMA (`INVALID_CREDENTIALS`). Ini penting supaya tidak bisa dipakai untuk enumerasi email. Akun Google (tanpa password) yang coba login via form → juga `INVALID_CREDENTIALS`.
3. **Google sign-in** — Flutter menjalankan OAuth flow dan mengirim **ID token** ke backend. Backend memverifikasi ID token memakai Google OAuth2Client dengan `GOOGLE_CLIENT_ID`. Kalau email di token sudah terdaftar → login (link ke akun itu, apapun `authProvider`-nya). Kalau belum → buat user baru dengan `authProvider: google`, `passwordHash: null`.
4. **Logout** — revoke refresh token. Endpoint harus **idempotent**: token tidak dikenal atau sudah revoked tetap return sukses.
5. **Tier** — user baru selalu `free`. Tidak ada cara mengubah tier di fase ini (billing nanti).
6. **Rate limiting** — route `/api/auth/*` dibatasi 20 request/menit per IP (ThrottlerModule), balas 429 kalau lewat.
7. **CORS** — aktifkan di bootstrap (semua origin untuk fase dev).

---

## 8. Environment Variables

`.env.example`:
```env
DATABASE_URL="postgresql://aria:aria@localhost:5432/aria?schema=public"
ACCESS_TOKEN_SECRET="change-me-in-production"
ACCESS_TOKEN_TTL="15m"
REFRESH_TOKEN_TTL_DAYS="30"
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
PORT=3000
```

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: aria
      POSTGRES_PASSWORD: aria
      POSTGRES_DB: aria
    ports:
      - "5432:5432"
    volumes:
      - aria_db_data:/var/lib/postgresql/data

volumes:
  aria_db_data:
```

---

## 9. Endpoint (ringkasan)

Detail lengkap (request/response body, status code, contoh JSON) ada di **API contract doc**: `2026-08-12-backend-auth-api-contract.md`.

| Method | Path | Auth | Fungsi |
|--------|------|------|--------|
| POST | `/api/auth/register` | — | Daftar email+password |
| POST | `/api/auth/login` | — | Login email+password |
| POST | `/api/auth/google` | — | Login/daftar via Google ID token |
| POST | `/api/auth/refresh` | — | Tukar refresh token → pasangan token baru |
| POST | `/api/auth/logout` | — | Revoke refresh token |
| GET | `/api/auth/me` | Bearer | Profil user yang sedang login |
| GET | `/api/health` | — | Health check |

---

## 10. Testing Requirement

**Wajib ada:**

1. **Unit tests** — `auth.service`: hash password saat register, verifikasi password saat login, rotation refresh token, revoke saat logout, user baru selalu tier `free`.
2. **E2E happy path** (`test/auth.e2e-spec.ts`):
   - register → 201, dapat `user` + `accessToken` + `refreshToken`
   - GET `/me` dengan access token → 200, email cocok
   - POST `/refresh` → 200, pasangan token baru; refresh token lama → 401 (rotation terbukti)
   - POST `/logout` → 200; refresh token → 401
   - login dengan kredensial benar → 200
   - login dengan password salah → 401 `INVALID_CREDENTIALS`
3. **E2E Google** (`test/google-auth.e2e-spec.ts`) — mock verifikasi ID token: email baru → user dibuat dengan `authProvider: google`; ID token invalid → 401.
4. **Validasi** — email tidak valid, password < 8 karakter, field kosong → 400 dengan pesan yang jelas.

E2E test memakai database test terpisah (misal `aria_test` via `DATABASE_URL` override), dan melakukan reset antar test.

---

## 11. Definition of Done

- [ ] `docker compose up -d` → PostgreSQL jalan
- [ ] `npx prisma migrate dev` → migration User + RefreshToken terbentuk
- [ ] `npm run start:dev` → server jalan di port 3000 dengan prefix `/api`
- [ ] Swagger UI bisa dibuka di `http://localhost:3000/api/docs` dan semua endpoint terdokumentasi
- [ ] Semua endpoint berperilaku persis sesuai API contract
- [ ] `npm run test` → semua unit test pass
- [ ] `npm run test:e2e` → semua e2e test pass
- [ ] `npm run lint` → bersih

---

## 12. Catatan untuk implementer AI

- Ini fase pertama backend. Setelah auth selesai, modul berikutnya (chat/AI, todo, alarm, memory) akan dibangun di atas pondasi ini — jadi pastikan struktur module Prisma dan guard JWT bisa dipakai ulang.
- Jangan membuat endpoint diluar yang ada di contract.
- Jangan menambahkan library besar diluar yang tercantum di Tech Stack tanpa alasan kuat.
- Semua response memakai envelope konsisten `{ success, message, data, error? }` (lihat contract) — client Flutter mem-parse satu bentuk untuk semua endpoint.
- Konvensi pagination `Paginated<T>` (cursor-based) sudah dikunci di contract — modul masa depan (chat, memory) wajib mengikutinya.