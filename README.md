# Apartment Booking API

Node.js + Express REST API for an apartment room booking website with monthly payment management. Uses **Node's built-in SQLite** (`node:sqlite`) so it runs with **zero database setup and no native compilation** (no Visual Studio / build tools needed on Windows), JWT authentication, and Multer 2.x for image uploads.

> **Requires Node.js 22.5 or newer** (fully stable on Node 24).

## Quick Start

```bash
npm install
npm run seed     # creates default admin + contact
npm start        # http://localhost:3000
```

**Default admin login:** phone `0201234567` / password `admin123` (change after first login).

Config in `.env` — copy the template and edit it:
```bash
cp .env.example .env
```
```
PORT=3000
JWT_SECRET=super-secret-change-me
```
Both have fallbacks so the app runs without a `.env`, but the `JWT_SECRET` fallback is a public default — change it before deploying.

## Authentication

Login to get a token, then send it in the header on every `/api/admin/*` request:

```
Authorization: Bearer <token>
```

---

## I. Public Website APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/rooms` | All rooms: cover, name, roomType, available, price, descriptions |
| GET | `/api/rooms/latest` | 3 newest rooms (returns fewer if there are fewer than 3) |
| GET | `/api/rooms/recommended` | 3 random rooms, **available ones only** |
| GET | `/api/rooms/promotions` | Rooms that have a `discount_price`, newest first |
| GET | `/api/rooms/:id` | Room detail: cover, images, name, descriptions, price, roomType, available, tel, link |
| GET | `/api/contact` | Contact: tel, link |
| GET | `/api/banners` | Banners: id, type, image, link_url. Optional `?type=0\|1` (anything else → 400) |
| GET | `/api/locations` | Locations: id, address, latitude, longitude |

The three `/rooms/*` list endpoints return the same fields as `/api/rooms` plus `discount_price` (`null` when there is no promotion). They are declared **above** `/rooms/:id` in `routes/public.js` — otherwise `latest` would be matched as an `:id`.

## II. Admin APIs

### 1. Login
| Method | Endpoint | Body |
|---|---|---|
| POST | `/api/admin/login` | `{ "phone": "...", "password": "..." }` → returns `token` |

### 2. Dashboard
| Method | Endpoint | Returns |
|---|---|---|
| GET | `/api/admin/dashboard` | Everything: 4 totals + occupancyRate (%), incomeThisMonth, outstanding, incomeHistory (last 6 months), expiringLeases (within 30 days), topOverdue (top 5), recentPayments (last 5), roomTypeBreakdown, totalTenants |
| GET | `/api/admin/dashboard/total` | total of all apartments |
| GET | `/api/admin/dashboard/available` | total of available apartments |
| GET | `/api/admin/dashboard/not-paid` | total of apartments not paid yet |
| GET | `/api/admin/dashboard/paid` | total of apartments paid |

Every time a room's status changes from Not paid → Paid, the bill is saved into the `payments` history table before being reset — this powers the income figures and monthly chart.

### 3. Manage Users (apartment owners)
| Method | Endpoint | Body |
|---|---|---|
| POST | `/api/admin/users` | `{ "phone", "password" }` |
| GET | `/api/admin/users` | — |
| PUT | `/api/admin/users/:id` | `{ "phone"?, "password"? }` |
| DELETE | `/api/admin/users/:id` | — |

### 4. Manage Website

**Rooms** — send as `multipart/form-data`:
- `cover` — 1 image file
- `images` — up to 3 image files
- `name` (string), `descriptions` (string), `price` (string)
- `discount_price` (number, optional) — promotion price. Must be **lower than `price`**, otherwise `400`. Send it empty (or `null`) to clear the promotion. Rooms with a value here appear in `GET /api/rooms/promotions`.
- `roomType` — number `0` or `1`
- `status` — `0` = not paid, `1` = paid
- `available` — boolean

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/admin/rooms` | cover, images, name, roomType, available, price, discount_price, status, create_date |
| POST | `/api/admin/rooms` | Create room (multipart) |
| PUT | `/api/admin/rooms/:id` | Edit room (multipart, all fields optional; new `images` replace old ones) |
| DELETE | `/api/admin/rooms/:id` | Deletes room + its images, tenant, lease, bill |

**Contact:**
| Method | Endpoint | Body |
|---|---|---|
| GET | `/api/admin/contact` | — |
| POST | `/api/admin/contact` | `{ "tel", "email", "link" }` |
| PUT | `/api/admin/contact` | `{ "tel"?, "email"?, "link"? }` |
| DELETE | `/api/admin/contact` | — |

**Banners** — send as `multipart/form-data`:
- `image` — 1 image file (required on create)
- `type` — number `0` = home page, `1` = rooms page (required, anything else → 400)
- `link_url` (string, optional) — where the banner links to when clicked

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/admin/banners` | id, type, image, link_url, create_date. Optional `?type=0\|1` |
| POST | `/api/admin/banners` | Create banner (multipart) |
| PUT | `/api/admin/banners/:id` | Edit banner (multipart, all fields optional; a new `image` deletes the old file) |
| DELETE | `/api/admin/banners/:id` | Deletes the row **and** its image file |

**Locations** — send as `application/json`:
- `address` (string, required — cannot be blank)
- `latitude`, `longitude` (number, optional) — if sent they must be numeric, otherwise `400`

| Method | Endpoint | Body |
|---|---|---|
| GET | `/api/admin/locations` | — |
| POST | `/api/admin/locations` | `{ "address", "latitude"?, "longitude"? }` |
| PUT | `/api/admin/locations/:id` | `{ "address"?, "latitude"?, "longitude"? }` |
| DELETE | `/api/admin/locations/:id` | — |

Locations are shown on both pages, so unlike banners they have no `type` filter.

### 5. Report Room

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/report/unpaid` | Rooms not paid yet: name, leaseTime, overdue (months), status |
| PUT | `/api/admin/report/rooms/:id/status` | `{ "status": 0 or 1 }` — changing Not paid → Paid **resets the price detail** and records lastPaidDate |
| POST | `/api/admin/report/rooms/:id/tenant` | `{ "name", "lastname", "tel", "link"? }` (link can be null) |
| PUT | `/api/admin/report/rooms/:id/tenant` | Edit tenant |
| DELETE | `/api/admin/report/rooms/:id/tenant` | Delete tenant |
| GET | `/api/admin/report/leases` | All leases: roomID, name, startDate, endDate |
| POST | `/api/admin/report/rooms/:id/lease` | `{ "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }` |
| PUT | `/api/admin/report/rooms/:id/lease` | Edit / reset lease dates |
| POST | `/api/admin/report/rooms/:id/bill` | `{ "roomPrice", "electricityPrice", "waterPrice", "wasteFees" }` → calculates and saves `total` |
| GET | `/api/admin/report/rooms/:id/info` | Full detail: tenant {name, lastname, phone}, rentalPeriod (days, e.g. "30"), startDate, endDate, priceDetail {roomPrice, electricityPrice, waterPrice, wasteFees, total} |

**Overdue calculation:** whole months elapsed since the last paid date (or lease start date if never paid) while the room is unpaid.

**Example flow:**
1. Create a room → add tenant → add lease
2. Each month: `POST .../bill` with the meter readings → total is calculated
3. Tenant pays → `PUT .../status` with `{ "status": 1 }` → bill resets to 0 for next month
4. Next month: set status back to 0 and repeat

## Project Structure

```
apartment-api/
├── server.js              # entry point
├── config/
│   ├── db.js              # SQLite schema + connection
│   └── seed.js            # default admin + contact
├── middleware/
│   ├── auth.js            # JWT verify + admin guard
│   └── upload.js          # Multer (room: cover ×1 + images ×3, banner: image ×1)
├── routes/
│   ├── public.js          # website APIs
│   ├── auth.js            # login + user management
│   ├── dashboard.js
│   ├── rooms.js           # room CRUD with images
│   ├── banners.js         # banner CRUD with image
│   ├── locations.js       # location CRUD (JSON, no upload)
│   ├── contact.js
│   └── report.js          # unpaid report, tenants, leases, billing
└── uploads/               # uploaded images (served at /uploads/...)
```

## Notes & Improvements Made

Your spec said "if it's not good, you can fix it" — a few things I adjusted:

- **Status change endpoint** is `PUT` (not POST) since it updates an existing resource.
- **Overdue** is computed from lastPaidDate/lease start rather than stored, so it's always current.
- **Bill total** is calculated server-side, never trusted from the client.
- **Deleting a room** cascades to its tenant, lease, bill, and image files so nothing is orphaned.
- Passwords are hashed with bcrypt; admin account cannot be deleted.
- `available` accepts `true/false/1/0` in form-data and is returned as a real boolean.
- **Schema changes on existing tables** go through `addColumnIfMissing()` at the bottom of `config/db.js`. It checks `PRAGMA table_info` before running `ALTER TABLE ADD COLUMN`, so it is safe to re-run and never drops existing data — `CREATE TABLE IF NOT EXISTS` alone would silently skip new columns.
- **`/rooms/latest`, `/rooms/recommended` and `/rooms/promotions` are declared before `/rooms/:id`** in `routes/public.js`. Express matches in order, so putting them after would make `:id` capture the literal word `latest`.
- **Editing or deleting a banner removes its old image file** from `uploads/`, same as rooms. A rejected upload (bad `type`, wrong file kind) also deletes the file Multer already wrote, so failed requests leave nothing behind.
- **`discount_price` is validated against the incoming `price`** when both are changed in the same request, not against the stored one.
