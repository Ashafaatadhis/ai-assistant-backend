# Todo CRUD — Design Spec

**Date:** 2026-08-14
**Version:** 1.0
**Scope:** Backend module (NestJS) + API contract. Flutter wiring menyusul di repo terpisah.

---

## 1. Overview

Fitur CRUD pertama setelah auth. User bisa membuat, melihat, mengubah, dan menghapus todo. Setiap todo punya judul dan tanggal jatuh tempo opsional. Semua operasi terikat ke user yang sedang login (JWT) dan diisolasi per-user.

**Keputusan yang sudah disepakati:**
- Field: `title` + `dueDate` (opsional). Prioritas tidak masuk v1.
- Tambah via input inline di layar Flutter (bukan dialog).
- Edit/hapus via bottom sheet saat tap todo.
- Filter (`semua | aktif | selesai`) dilakukan di **client** — backend selalu mengembalikan semua todo user.
- Pagination tidak dipakai v1 — `GET /todos` mengembalikan array langsung.

---

## 2. Data Model

Tambahkan ke `prisma/schema.prisma`:

```prisma
model Todo {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String
  dueDate   DateTime?
  completed Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}
```

Tambahkan relasi balik di model `User`:

```prisma
model User {
  // ... field yang sudah ada ...
  todos Todo[]
}
```

Lalu `npx prisma migrate dev --name add_todo`.

---

## 3. API Contract

Semua endpoint di bawah prefix `/api/todos` dan **membutuhkan** header `Authorization: Bearer <accessToken>`.

Semua response memakai envelope yang sudah ada:
- Sukses: `{ success: true, message: string, data: T }`
- Gagal: `{ success: false, message: string, data: null, error: CODE }`

### Bentuk Todo (TodoDto)

```ts
{
  id: string;
  title: string;
  dueDate: string | null;      // ISO 8601 UTC, null kalau tidak diisi
  completed: boolean;
  createdAt: string;           // ISO 8601 UTC
  updatedAt: string;           // ISO 8601 UTC
}
```

`dueDate` di-serialize sebagai ISO 8601 (pakai `.toISOString()`).

### 3.1 GET /todos

Mengambil semua todo milik user yang login.

**Query params:** tidak ada.

**Sorting:** belum selesai dulu (`completed = false`), lalu `createdAt` desc. Todo selesai di bawah.

**Response sukses — `200 OK`**, `data: TodoDto[]`:

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "9f1c...",
      "title": "Beli susu",
      "dueDate": "2026-08-15T08:00:00.000Z",
      "completed": false,
      "createdAt": "2026-08-14T10:00:00.000Z",
      "updatedAt": "2026-08-14T10:00:00.000Z"
    }
  ]
}
```

### 3.2 POST /todos

Membuat todo baru.

**Request body:**

```ts
{
  title: string;        // wajib, 1–200 karakter setelah trim
  dueDate?: string;     // opsional, ISO 8601; kalau ada harus tanggal valid
}
```

**Validasi:**
- `title` wajib, string, min 1 max 200 (trim dulu).
- `dueDate` opsional; kalau disediakan harus ISO 8601 yang valid, kalau tidak → 400.

**Response sukses — `201 Created`**, `data: TodoDto` (todo yang baru dibuat, `completed: false`).

**Error:**

| Kondisi | HTTP | `error` |
|---------|------|---------|
| Validasi gagal | 400 | `VALIDATION_ERROR` |

### 3.3 PATCH /todos/:id

Mengubah sebagian field. Hanya field yang dikirim yang diubah.

**Request body** (semua opsional, minimal satu harus ada):

```ts
{
  title?: string;       // kalau ada, 1–200 karakter setelah trim
  dueDate?: string | null;  // string ISO 8601 untuk set, null untuk hapus
  completed?: boolean;
}
```

Catatan penting: `dueDate: null` **menghapus** tanggal jatuh tempo (beda dengan field tidak dikirim).

**Response sukses — `200 OK`**, `data: TodoDto` (todo setelah diubah).

**Error:**

| Kondisi | HTTP | `error` |
|---------|------|---------|
| Validasi gagal | 400 | `VALIDATION_ERROR` |
| Todo tidak ditemukan ATAU bukan milik user | 404 | `NOT_FOUND` |

### 3.4 DELETE /todos/:id

Menghapus todo.

**Response sukses — `200 OK`**, `data: null`:

```json
{ "success": true, "message": "OK", "data": null }
```

**Error:**

| Kondisi | HTTP | `error` |
|---------|------|---------|
| Todo tidak ditemukan ATAU bukan milik user | 404 | `NOT_FOUND` |

### Kepemilikan (ownership)

Setiap operasi baca/tulis memfilter dengan `where: { id, userId }`. Todo milik user lain tidak akan pernah dikembalikan atau diubah — bagi user yang tidak berhak, todo itu terlihat seperti tidak ada (404). Ini mencegah enumerasi id.

`userId` diambil dari JWT payload (`sub`), bukan dari request body.

### Tabel kode error (tambahan)

| Kode | HTTP | Dipakai di |
|------|------|-----------|
| `NOT_FOUND` | 404 | todo tidak ada / bukan milik user |

---

## 4. Struktur Module (backend)

Ikuti pola module `auth`. Buat `src/todo/`:

```
src/todo/
  todo.module.ts        # Module: controller + service, PrismaModule
  todo.controller.ts    # 4 endpoint, JwtAuthGuard, Swagger
  todo.service.ts       # Logika CRUD + ownership filter
  todo.errors.ts        # Reuse AppException dari auth.errors, tambah NOT_FOUND
  dto/
    create-todo.dto.ts  # title wajib, dueDate opsional
    update-todo.dto.ts  # semua opsional, minimal satu
```

**todo.controller.ts:**
- `@Controller('todos')`, `@UseGuards(JwtAuthGuard)`, `@ApiBearerAuth()`.
- `userId` diambil dari `req.user.userId` (dari `jwt.strategy.ts`).

**todo.service.ts:**
- `list(userId)` → `findMany({ where: { userId }, orderBy: [{ completed: 'asc' }, { createdAt: 'desc' }] })`.
- `create(userId, dto)` → `create({ data: { ...dto, userId } })`.
- `update(userId, id, dto)` → cari dulu dengan `{ id, userId }`, kalau tidak ada lempar `NOT_FOUND`, lalu `update`.
- `remove(userId, id)` → cari dulu dengan `{ id, userId }`, kalau tidak ada lempar `NOT_FOUND`, lalu `delete`.

**AppModule:** tambahkan `TodoModule` ke `imports`.

**Error `NOT_FOUND`:** tambah konstanta di `auth.errors.ts`:

```ts
export const AuthErrorCodes = {
  // ... yang sudah ada ...
  NOT_FOUND: 'NOT_FOUND',
} as const;
```

(`AllExceptionsFilter` sudah memetakan status 404 ke kode berdasarkan `httpStatus`; kalau dilempar sebagai `AppException` dengan `httpStatus: 404`, kode `NOT_FOUND` dan pesan `"Tidak ditemukan"` dipakai.)

---

## 5. Testing

**Unit (`todo.service.spec.ts`):**
- list mengembalikan todo terurut (belum selesai dulu, createdAt desc)
- create men-set `userId` dan `completed: false`
- update hanya mengubah field yang dikirim; `dueDate: null` menghapus tanggal
- update/remove todo milik user lain → lempar `NOT_FOUND`

**E2E (`todo.e2e-spec.ts`):**
- Auth: tanpa token → 401 `UNAUTHORIZED`
- POST valid → 201, todo muncul di GET
- POST tanpa title → 400 `VALIDATION_ERROR`
- POST title > 200 char → 400
- POST dueDate tidak valid → 400
- PATCH title + completed → 200, berubah
- PATCH dueDate null → 200, dueDate jadi null
- PATCH todo milik user lain → 404
- DELETE → 200, todo hilang dari GET
- DELETE todo milik user lain → 404
- Isolation: todo user A tidak terlihat oleh user B di GET

---

## 6. Flutter Wiring (repo app — di luar scope implementasi backend ini)

Kontrak di atas cukup untuk membangun sisi Flutter:

```
lib/todo/
  todo_model.dart       # class Todo + fromJson
  todo_api.dart         # interface TodoApi
  dio_todo_api.dart     # implementasi dio (reuse dio client + interceptor auth)
  todo_provider.dart    # TodoNotifier (Riverpod): list, create, toggle, update, remove
lib/screens/todo_screen.dart  # rombak mock jadi data nyata + inline input + bottom sheet
```

Perilaku UI:
- Input inline di atas list: ketik judul → enter/`+` → POST. Ikon kalender untuk set dueDate.
- Filter `semua | aktif | selesai` di client dari hasil GET.
- Tap row → bottom sheet: edit judul, edit tanggal, toggle selesai, hapus (konfirmasi).
- Toggle selesai → PATCH optimis (UI langsung, revert kalau gagal + snackbar).

---

## 7. YAGNI (tidak masuk v1)

- Prioritas (high/medium/low)
- Reminder/notifikasi saat dueDate tiba (itu fitur alarm/reminder terpisah)
- Pagination `GET /todos` (nanti kalau membesar)
- Pencarian/filter di server
- Undo delete
