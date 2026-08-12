# Aria Backend Auth — API Contract

**Date:** 2026-08-12
**Version:** 2.0
**Companion doc:** `2026-08-12-backend-auth-prd.md`

Contract ini adalah sumber kebenaran bentuk request/response. Client Flutter dan implementasi backend **sama-sama** mengikuti dokumen ini.

---

## 1. Konvensi Umum

### Base URL & prefix
```
http://localhost:3000/api
```
Semua endpoint auth di bawah `/api/auth`.

### Content-Type
Semua request/response JSON memakai `Content-Type: application/json`.

### Header autentikasi
Endpoint yang butuh login menerima header:
```
Authorization: Bearer <accessToken>
```

### Tanggal & waktu
Semua timestamp memakai **ISO 8601 UTC**, contoh: `"2026-08-12T09:30:00.000Z"`.

### HTTP status code
Tetap standar dan bermakna: `200`, `201`, `400`, `401`, `409`, `429`. Envelope (di bawah) membungkus **body** — tidak mengubah status code.

---

## 2. Response Envelope

**Setiap** response API — sukses maupun error — dibungkus satu bentuk yang sama. Client cukup parse satu struktur untuk semua endpoint.

```ts
ResponseEnvelope<T> = {
  success: boolean;      // penentu utama: true = sukses, false = error
  message: string;       // teks manusia (bahasa Indonesia), aman ditampilkan ke user
  data: T | null;        // payload jika sukses; null jika error
  error?: string;        // kode mesin UPPER_SNAKE_CASE; HANYA ada jika success=false
}
```

Aturan:
- `success` dan `message` **selalu** ada.
- `data` berisi payload saat sukses, `null` saat error.
- `error` hanya muncul saat error — dipakai client untuk **logika** (misal: `EMAIL_TAKEN` → fokuskan user ke field email).
- `message` saat error boleh langsung ditampilkan sebagai toast/snackbar.

### Contoh sukses

```json
{
  "success": true,
  "message": "OK",
  "data": { ... }
}
```

### Contoh error

```json
{
  "success": false,
  "error": "INVALID_CREDENTIALS",
  "message": "Email atau password salah",
  "data": null
}
```

### Contoh error validasi

```json
{
  "success": false,
  "error": "VALIDATION_ERROR",
  "message": "Periksa kembali isian kamu",
  "data": {
    "details": [
      "email harus alamat email yang valid",
      "password minimal 8 karakter"
    ]
  }
}
```

### Tabel kode error

| Kode | HTTP | Dipakai di | `message` default |
|------|------|-----------|-------------------|
| `VALIDATION_ERROR` | 400 | request tidak valid | `"Periksa kembali isian kamu"` |
| `EMAIL_TAKEN` | 409 | register dengan email sudah terdaftar | `"Email sudah terdaftar"` |
| `INVALID_CREDENTIALS` | 401 | login gagal; Google token tidak valid | `"Email atau password salah"` |
| `INVALID_REFRESH_TOKEN` | 401 | refresh token tidak dikenal / revoked / kedaluwarsa | `"Sesi berakhir, silakan masuk lagi"` |
| `UNAUTHORIZED` | 401 | `/me` tanpa token valid | `"Silakan masuk terlebih dahulu"` |
| `RATE_LIMIT_EXCEEDED` | 429 | melebihi 20 request/menit per IP | `"Terlalu banyak permintaan, coba lagi nanti"` |

---

## 3. Definisi Tipe

Semua tipe didefinisikan di sini sebagai **satu sumber kebenaran**. Endpoint di bagian bawah mereferensikan tipe-tipe ini.

### UserPublic

Objek user yang BOLEH dikirim ke client. `passwordHash` tidak pernah muncul di response manapun.

```ts
UserPublic = {
  id: string;                         // uuid v4
  email: string;                      // selalu lowercase
  name: string;                       // 1–100 karakter
  authProvider: "email" | "google";
  tier: "free" | "premium";
}
```

### UserDetail

Profil lengkap untuk `/me` — `UserPublic` plus tanggal daftar.

```ts
UserDetail = UserPublic & {
  createdAt: string;                  // ISO 8601 UTC
}
```

### TokenPair

```ts
TokenPair = {
  accessToken: string;                // JWT HS256, TTL 15m, payload { sub: userId }
  refreshToken: string;               // 64 karakter hex acak
}
```

### AuthData

Payload login/daftar sukses — profil user plus pasangan token.

```ts
AuthData = {
  user: UserPublic;
} & TokenPair
```

### ValidationDetails

Isi `data` khusus untuk error `VALIDATION_ERROR`.

```ts
ValidationDetails = {
  details: string[];                  // satu string per aturan yang dilanggar
}
```

### Paginated\<T\> — konvensi untuk endpoint list di masa depan

Endpoint list modul berikutnya (chat messages, memories, dst.) memakai **cursor-based pagination**, bukan page number — lebih stabil untuk data yang terus bertambah dan cocok untuk pola scroll-ke-atas di chat.

Request query params:

```
?limit=20&before=<cursor>
```

| Param | Tipe | Default | Arti |
|-------|------|---------|------|
| `limit` | integer | 20 | jumlah item per halaman, maksimal 100 |
| `before` | string | — | cursor: ambil item **sebelum** titik ini (untuk load lebih lama) |

Bentuk `data`:

```ts
Paginated<T> = {
  items: T[];                         // urut terbaru → terlama
  nextCursor: string | null;          // null = tidak ada data lagi; pakai sebagai `before` berikutnya
}
```

Contoh pemakaian di chat (fase nanti):

```
GET /api/messages?limit=20            → 20 pesan terbaru + nextCursor
GET /api/messages?limit=20&before=<nextCursor>  → 20 pesan lebih lama
```

> Endpoint paginated BELUM ada di fase auth — konvensi ini dikunci sekarang agar konsisten saat modul berikutnya dibangun.

---

## 4. Tipe Request

```ts
RegisterRequest = {
  email: string;                      // wajib, format email valid, disimpan lowercase
  password: string;                   // wajib, minimal 8 karakter, maksimal 72
  name: string;                       // wajib, 1–100 karakter
}

LoginRequest = {
  email: string;                      // wajib, format email valid
  password: string;                   // wajib, minimal 1 karakter (validasi kecocokan di server)
}

GoogleAuthRequest = {
  idToken: string;                    // wajib, Google ID token; aud harus = GOOGLE_CLIENT_ID
}

RefreshRequest = {
  refreshToken: string;               // wajib, 64 karakter hex
}

LogoutRequest = {
  refreshToken: string;               // wajib, 64 karakter hex
}
```

---

## 5. Endpoint

### 5.1 POST /api/auth/register

Mendaftar akun baru dengan email + password. Sukses = user dibuat **dan** langsung mendapat pasangan token (auto-login).

**Request:** `RegisterRequest`

**Response sukses — `201 Created`**, `data: AuthData`:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "user": {
      "id": "9f1c...",
      "email": "budi@example.com",
      "name": "Budi",
      "authProvider": "email",
      "tier": "free"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "8f3a2b...64-hex-chars"
  }
}
```

**Error:**

| Kondisi | HTTP | `error` |
|---------|------|---------|
| Email sudah terdaftar | 409 | `EMAIL_TAKEN` |
| Validasi gagal | 400 | `VALIDATION_ERROR` |

---

### 5.2 POST /api/auth/login

Login dengan email + password.

**Request:** `LoginRequest`

**Response sukses — `200 OK`**, `data: AuthData` (bentuk sama dengan register).

**Error:**

| Kondisi | HTTP | `error` |
|---------|------|---------|
| Email tidak ditemukan, password salah, ATAU akun Google mencoba login via form | 401 | `INVALID_CREDENTIALS` |
| Validasi gagal | 400 | `VALIDATION_ERROR` |

Ketiga kondisi kegagalan di atas sengaja memakai kode dan pesan yang identik — mencegah enumerasi email.

---

### 5.3 POST /api/auth/google

Login (atau daftar otomatis) memakai Google ID token yang dihasilkan library `google_sign_in` di Flutter.

**Request:** `GoogleAuthRequest`

Backend memverifikasi token memakai Google OAuth2Client. Klaim `email` dan `name` diambil dari payload token.

**Perilaku:**
- Email **belum terdaftar** → buat user baru (`authProvider: "google"`, tanpa password) → `201 Created`
- Email **sudah terdaftar** → login sebagai user itu (akun di-link apapun `authProvider` awalnya) → `200 OK`

**Response sukses**, `data: AuthData` (bentuk sama dengan register).

**Error:**

| Kondisi | HTTP | `error` |
|---------|------|---------|
| ID token tidak valid / kedaluwarsa / audience salah | 401 | `INVALID_CREDENTIALS` |
| Validasi gagal | 400 | `VALIDATION_ERROR` |

---

### 5.4 POST /api/auth/refresh

Menukar refresh token dengan pasangan token baru. **Rotation:** token lama langsung mati begitu endpoint ini sukses.

**Request:** `RefreshRequest`

**Response sukses — `200 OK`**, `data: TokenPair`:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "accessToken": "eyJhbGci...(baru)",
    "refreshToken": "c9d1e2...(baru)"
  }
}
```

**Error:**

| Kondisi | HTTP | `error` |
|---------|------|---------|
| Token tidak dikenal, sudah revoked, atau kedaluwarsa | 401 | `INVALID_REFRESH_TOKEN` |

Endpoint ini sengaja TIDAK mengembalikan objek user — client yang butuh profil memakai `/me`.

---

### 5.5 POST /api/auth/logout

Me-revoke refresh token. Idempotent: token tidak dikenal atau sudah revoked tetap dianggap sukses.

**Request:** `LogoutRequest`

**Response sukses — `200 OK`**, `data: null`:

```json
{
  "success": true,
  "message": "OK",
  "data": null
}
```

Tidak ada error case — selalu 200 selama body valid.

---

### 5.6 GET /api/auth/me

Profil user yang sedang login. Satu-satunya endpoint yang butuh access token.

**Request:** header `Authorization: Bearer <accessToken>`, tanpa body.

**Response sukses — `200 OK`**, `data: UserDetail`:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "9f1c...",
    "email": "budi@example.com",
    "name": "Budi",
    "authProvider": "email",
    "tier": "free",
    "createdAt": "2026-08-12T09:30:00.000Z"
  }
}
```

**Error:**

| Kondisi | HTTP | `error` |
|---------|------|---------|
| Token tidak ada, tidak valid, atau kedaluwarsa | 401 | `UNAUTHORIZED` |

---

### 5.7 GET /api/health

Health check sederhana.

**Response sukses — `200 OK`**:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "status": "ok"
  }
}
```

---

## 6. Contoh Flow Lengkap (dari sisi client)

```
1. POST /api/auth/register  { email, password, name }
   → 201, envelope: success=true, data={ user, accessToken, refreshToken }
   → client simpan kedua token

2. GET /api/auth/me  (Bearer accessToken)
   → 200, success=true, data=UserDetail

3. ...15 menit kemudian accessToken kedaluwarsa, request dapat 401...

4. POST /api/auth/refresh  { refreshToken }
   → 200, success=true, data={ accessToken, refreshToken }   ← keduanya BARU
   → token lama tidak boleh dipakai lagi

5. User memilih "Keluar":
   POST /api/auth/logout  { refreshToken }
   → 200, success=true
   → client hapus token dari penyimpanan
```

---

## 7. Checklist Conformance untuk Implementer

- [ ] **Setiap** response memakai envelope `{ success, message, data, error? }` — termasuk error (via exception filter global) dan sukses (via interceptor global)
- [ ] `passwordHash` tidak pernah muncul di response manapun
- [ ] Kode `error` persis seperti tabel (UPPER_SNAKE_CASE, konstan)
- [ ] `message` berbahasa Indonesia dan aman ditampilkan ke user
- [ ] Login gagal selalu 401 `INVALID_CREDENTIALS` yang seragam (anti enumerasi email)
- [ ] Refresh token di-rotation dan yang lama langsung mati
- [ ] Logout idempotent
- [ ] Konvensi `Paginated<T>` diikuti saat membuat endpoint list di masa depan
- [ ] Swagger di `/api/docs` mendokumentasikan semua endpoint sesuai contract ini