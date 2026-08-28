# Apartment Booking API

Node.js + Express REST API for an apartment rental website with room management, banners, a CRM, and monthly payment tracking. Uses **Node's built-in SQLite** (`node:sqlite`) so it runs with **zero database setup and no native compilation** (no Visual Studio / build tools needed on Windows), JWT authentication, and Multer 2.x for image uploads.

## Requirements

- **Node.js 22.5 or newer** — `node:sqlite` does not exist before that. Fully stable on Node 24, which is what this project is developed against.
- No database server, no build tools. The database is a single `apartment.db` file created on first run.

## Quick Start

```bash
npm install
npm run seed     # creates the default admin + contact row
npm run dev      # nodemon, restarts on change -> http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | Start with nodemon (development) |
| `npm start` | Start with plain node (production) |
| `npm run seed` | Insert the default admin user and About Us row, if missing |

**Default admin login:** phone `0201234567` / password `admin123` — change it after the first login.

### Environment

Copy the template and edit it:

```bash
cp .env.example .env
```

| Variable | Required | Default | What it is |
|---|---|---|---|
| `JWT_SECRET` | **Yes, before deploying** | `super-secret-change-me` | Signing key for admin JWTs (`middleware/auth.js`). The fallback is a public default — anyone can forge a token with it. |
| `PORT` | No | `3000` | Port the API listens on |

Both have fallbacks so the app runs without a `.env` file, but shipping with the default `JWT_SECRET` means the admin API is effectively unauthenticated.

### Authentication

Log in, then send the token on every `/api/admin/*` request:

```
POST /api/admin/login   { "phone": "0201234567", "password": "admin123" }  ->  { token }
Authorization: Bearer <token>
```

Tokens expire after 1 day. Missing token → `401`; a non-admin hitting an admin-only route → `403`.

### Response shape

Every endpoint answers with the same envelope:

```json
{ "success": true,  "data": ... }              // or  { "success": true, "message": "..." }
{ "success": false, "message": "what failed" }  // 4xx / 5xx
```

Uploaded files are served from `/uploads/<filename>`, and every stored image path is already in that form.

---

## Database

13 tables, all created by `config/db.js` on startup.

| Table | Purpose | Key fields |
|---|---|---|
| `users` | Admin / owner accounts | `phone` (UNIQUE), `password` (bcrypt), `role` `admin`\|`owner`, `create_date` |
| `rooms` | Rooms shown on the website | `cover`, `code`, `name`, `descriptions`, `address`, `price`, `size`, `bedrooms`, `bathrooms`, `phone`, `whatsapp`, `roomType` (0\|1), `status` (0 = not paid, 1 = paid), `available`, `create_date` |
| `room_images` | Gallery, max 3 per room (enforced in code) | `room_id` → rooms **CASCADE**, `path` |
| `room_amenities` | Amenity icon + label per room | `room_id` → rooms **CASCADE**, `icon`, `name` |
| `contacts` | Single About Us row | `tel`, `email`, `address`, `link` (map link) |
| `tenants` | Current tenant, one per room | `room_id` **UNIQUE** → rooms **CASCADE**, `name`, `lastname`, `tel`, `link` |
| `leases` | Lease dates, one per room | `room_id` **UNIQUE** → rooms **CASCADE**, `startDate`, `endDate` (YYYY-MM-DD) |
| `bills` | This month's price detail, one per room | `room_id` **UNIQUE** → rooms **CASCADE**, `roomPrice`, `electricityPrice`, `waterPrice`, `wasteFees`, `total`, `lastPaidDate` |
| `payments` | Payment history, one row per Not paid → Paid flip | `room_id` → rooms **CASCADE**, same price columns, `paidDate` |
| `banners` | Hero images for home / rooms page | `type` (0 = home, 1 = rooms), `topic`, `image`, `link_url`, `display_order`, `status` (1 = shown, 0 = hidden), `create_date` |
| `contact_messages` | Contact-form submissions from visitors | `name`, `phone`, `topic`, `detail`, `create_date` |
| `customers` | CRM leads | `name`, `phone`, `channel`, `room_interest` (free text), `first_contact`, `next_appointment`, `assigned_to`, `status` (0 = new, 1 = in progress, 2 = closed), `create_date` |
| `customer_logs` | Contact history per lead | `customer_id` → customers **CASCADE**, `note`, `create_date` |

`bills` holds the *current* state (one row per room); `payments` is the append-only history — same columns, different lifetime.

`contacts` (About Us, one row) and `contact_messages` (visitor inbox, many rows) are unrelated despite the similar names.

### Migrations

`CREATE TABLE IF NOT EXISTS` never adds a column to a table that already exists, so schema changes to existing tables go through the helpers at the bottom of `config/db.js`:

```js
addColumnIfMissing("rooms", "code", "TEXT");   // PRAGMA table_info -> ALTER TABLE ADD COLUMN
dropColumnIfExists("rooms", "discount_price"); // PRAGMA table_info -> ALTER TABLE DROP COLUMN
```

Both check before acting, so they are safe to re-run and never touch existing rows.

---

## I. Public APIs

No token required.

### Rooms

| Method | Endpoint | Returns |
|---|---|---|
| GET | `/api/rooms` | All rooms, newest first |
| GET | `/api/rooms/latest` | 3 newest rooms |
| GET | `/api/rooms/recommended` | 3 random rooms, **available ones only** |
| GET | `/api/rooms/:id` | One room + `images`, `amenities`, `phone`, `whatsapp`, and the About Us `tel` / `link` |

The three list endpoints return the same card fields: `id, cover, code, name, roomType, available, price, descriptions, address, size, bedrooms, bathrooms`. `phone` and `whatsapp` are **detail-page only** — the call and WhatsApp buttons live there.

`latest` and `recommended` must stay declared **above** `/rooms/:id` in `routes/public.js`; Express matches in order, so otherwise `:id` would capture the literal word `latest`.

### Banners / Contact / Contact form

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/banners` | Only `status = 1`. Returns `id, type, topic, image, link_url`, ordered by `display_order ASC, create_date DESC`. Optional `?type=0\|1` (anything else → 400) |
| GET | `/api/contact` | About Us: `tel`, `email`, `address`, `link` |
| POST | `/api/contact-messages` | Visitor contact form → 201 `{ success: true }` |

`POST /api/contact-messages` body:

```json
{ "name": "...", "phone": "...", "topic": "...", "detail": "..." }
```

- `name`, `phone` — required, cannot be blank after trimming
- `topic`, `detail` — optional
- Max lengths: `name` / `phone` / `topic` 200, `detail` 2000 → otherwise `400`

Only admins can read or delete what lands here.

---

## II. Admin APIs

All require `Authorization: Bearer <token>`.

### 1. Login & Users

| Method | Endpoint | Body |
|---|---|---|
| POST | `/api/admin/login` | `{ "phone", "password" }` → `{ token, user }` — **no auth needed** |
| GET | `/api/admin/users` | — *(admin only)* |
| POST | `/api/admin/users` | `{ "phone", "password" }` — duplicate phone → `409` *(admin only)* |
| PUT | `/api/admin/users/:id` | `{ "phone"?, "password"? }` *(admin only)* |
| DELETE | `/api/admin/users/:id` | — the admin account cannot be deleted *(admin only)* |

### 2. Dashboard

| Method | Endpoint | Returns |
|---|---|---|
| GET | `/api/admin/dashboard` | Everything in one call: 4 totals, `occupancyRate` (%), `incomeThisMonth`, `outstanding`, `incomeHistory` (last 6 months), `expiringLeases` (within 30 days), `topOverdue` (top 5), `recentPayments` (last 5), `roomTypeBreakdown`, `totalTenants` |
| GET | `/api/admin/dashboard/total` | Total rooms |
| GET | `/api/admin/dashboard/available` | Available rooms |
| GET | `/api/admin/dashboard/not-paid` | Rooms not paid yet |
| GET | `/api/admin/dashboard/paid` | Rooms paid |

### 3. Rooms

Send as `multipart/form-data`.

| Field | Type | Notes |
|---|---|---|
| `cover` | file ×1 | Replacing it deletes the old file |
| `images` | file ×3 | Uploading new ones **replaces** the whole gallery |
| `name` | text | Required on create |
| `code`, `address`, `descriptions`, `price`, `phone`, `whatsapp` | text | Optional |
| `size`, `bedrooms`, `bathrooms` | number | Optional, but must be numeric when sent → otherwise `400` |
| `roomType` | 0 \| 1 | |
| `status` | 0 \| 1 | 0 = not paid, 1 = paid |
| `available` | bool | Accepts `true`/`false`/`1`/`0` |

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/admin/rooms` | Every field + `images` + `amenities` |
| POST | `/api/admin/rooms` | Create (also creates the empty bill row) |
| PUT | `/api/admin/rooms/:id` | All fields optional |
| DELETE | `/api/admin/rooms/:id` | Deletes the room, its images, amenities, tenant, lease, bill — and every uploaded file |

**Amenities** are managed one at a time rather than stuffed into the room multipart:

| Method | Endpoint | Body |
|---|---|---|
| POST | `/api/admin/rooms/:id/amenities` | `multipart`: file `icon` ×1 + text `name` (required). Unknown room → `404` |
| DELETE | `/api/admin/rooms/:id/amenities/:amenityId` | Deletes the row **and** the icon file. `404` if the amenity does not belong to that room |

### 4. Banners

Send as `multipart/form-data`.

| Field | Type | Notes |
|---|---|---|
| `image` | file ×1 | Required on create; a new one deletes the old file |
| `type` | 0 \| 1 | **Required on create.** 0 = home page, 1 = rooms page |
| `topic` | text | Headline, e.g. `Promotion 20%` |
| `link_url` | text | Where the banner links to |
| `display_order` | number | Lower shows first, default `0` |
| `status` | 0 \| 1 | 1 = shown (default), 0 = hidden from the public endpoint |

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/admin/banners` | Every banner including hidden ones, ordered `display_order ASC, create_date DESC`. Optional `?type=0\|1` |
| POST | `/api/admin/banners` | Create |
| PUT | `/api/admin/banners/:id` | All fields optional |
| DELETE | `/api/admin/banners/:id` | Deletes the row **and** its image file |

### 5. About Us

One row, so there is no `:id`.

| Method | Endpoint | Body |
|---|---|---|
| GET | `/api/admin/contact` | — |
| POST | `/api/admin/contact` | `{ "tel", "email", "address", "link" }` — a second POST returns `409`, use PUT |
| PUT | `/api/admin/contact` | Same fields, all optional |
| DELETE | `/api/admin/contact` | — |

`link` is the map link shown on the About Us block.

### 6. Contact Messages

Read-only inbox — rows arrive from the public form, so there is deliberately no POST or PUT.

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/admin/contact-messages` | Newest first (`create_date DESC, id DESC`) |
| DELETE | `/api/admin/contact-messages/:id` | `404` if not found |

### 7. Customers (CRM)

Send as `application/json`. No public side at all.

| Field | Notes |
|---|---|
| `name` | Required, cannot be blank after trimming |
| `phone`, `channel`, `assigned_to` | Optional text |
| `room_interest` | Optional free text (e.g. `ห้อง A01`) — deliberately **not** a foreign key, so a lead survives its room being deleted |
| `first_contact`, `next_appointment` | Optional, must be a real `YYYY-MM-DD` date → otherwise `400` (`2026-02-30` is rejected) |
| `status` | `0` = new (default), `1` = in progress, `2` = closed |

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/admin/customers` | Newest first. Optional `?status=0\|1\|2` (anything else → 400) |
| GET | `/api/admin/customers/:id` | One lead + all its `logs`, newest first |
| POST | `/api/admin/customers` | Create |
| PUT | `/api/admin/customers/:id` | All fields optional |
| DELETE | `/api/admin/customers/:id` | Logs are removed with it (cascade) |
| POST | `/api/admin/customers/:id/logs` | `{ "note" }` — blank → `400`, unknown customer → `404` |
| DELETE | `/api/admin/customers/:id/logs/:logId` | `404` if the log does not belong to that customer |

### 8. Report (tenants, leases, billing)

| Method | Endpoint | Body / Description |
|---|---|---|
| GET | `/api/admin/report/unpaid` | Rooms not paid yet: name, leaseTime, overdue (months), status |
| PUT | `/api/admin/report/rooms/:id/status` | `{ "status": 0 \| 1 }` — Not paid → Paid saves the bill into `payments` and resets it |
| POST | `/api/admin/report/rooms/:id/tenant` | `{ "name", "lastname", "tel", "link"? }` |
| PUT | `/api/admin/report/rooms/:id/tenant` | Edit tenant |
| DELETE | `/api/admin/report/rooms/:id/tenant` | Delete tenant |
| GET | `/api/admin/report/leases` | All leases: roomID, name, startDate, endDate |
| POST | `/api/admin/report/rooms/:id/lease` | `{ "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }` — end must be after start |
| PUT | `/api/admin/report/rooms/:id/lease` | Edit / reset lease dates |
| POST | `/api/admin/report/rooms/:id/bill` | `{ "roomPrice", "electricityPrice", "waterPrice", "wasteFees" }` → `total` is calculated server-side |
| GET | `/api/admin/report/rooms/:id/info` | Tenant + rentalPeriod + dates + priceDetail |

**Overdue** = whole months elapsed since `lastPaidDate` (or the lease start date if never paid) while the room is unpaid. It is computed on read, never stored, so it is always current.

**Monthly flow:** create room → add tenant → add lease → each month `POST .../bill` with the readings → tenant pays → `PUT .../status` `{ "status": 1 }` (bill is archived into `payments` and reset) → next month set status back to `0`.

---

## Project Structure

```
apartment-api/
├── server.js                  # entry point + route mounting
├── apartment.db               # SQLite database (created on first run)
├── config/
│   ├── db.js                  # schema, migrations, connection
│   └── seed.js                # default admin + About Us row
├── middleware/
│   ├── auth.js                # JWT verify + admin guard
│   └── upload.js              # Multer: roomUpload, bannerUpload, iconUpload
├── routes/
│   ├── public.js              # website APIs + contact form
│   ├── auth.js                # login + user management
│   ├── dashboard.js
│   ├── rooms.js               # room CRUD + amenities
│   ├── banners.js
│   ├── contact.js             # About Us
│   ├── contact-messages.js    # visitor inbox (read + delete only)
│   ├── customers.js           # CRM leads + contact logs
│   └── report.js              # unpaid report, tenants, leases, billing
├── utils/
│   └── payment.js             # archive bill into payments + reset
└── uploads/                   # uploaded images, served at /uploads/...
```

`postman_collection.json` in the project root covers every endpoint; import it into Postman, log in once, and the token is stored automatically.

## Design Notes

- **Status change is `PUT`**, not POST — it updates an existing resource.
- **Bill totals are calculated server-side**, never trusted from the client.
- **Deleting cascades all the way down.** Removing a room takes its images, amenities, tenant, lease and bill with it, and deletes the files from `uploads/` so nothing is orphaned.
- **A rejected upload cleans up after itself.** If validation fails after Multer has already written the file (bad `type`, non-numeric `size`, missing `name`, unknown room), the file is deleted before the error is returned.
- **`create_date` is only second-precision**, so listings that must be strictly newest-first order by `create_date DESC, id DESC`.
- **Dates are validated by round-trip**, not just `Date.parse` — JavaScript rolls `2026-02-30` over into March instead of failing, so the parsed value is compared back against the input.
- **`available` accepts `true`/`false`/`1`/`0`** in form-data and is returned as a real boolean.
- **Passwords are bcrypt-hashed**, and the admin account cannot be deleted.
