// Uses Node's built-in SQLite (node:sqlite) — no native compilation needed.
// Requires Node.js >= 22.5 (stable in Node 24+).
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const db = new DatabaseSync(path.join(__dirname, "..", "apartment.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',           -- 'admin' | 'owner'
  create_date TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cover TEXT,                                   -- 1 cover image path
  code TEXT,                                    -- room code shown on the card, e.g. "A-01"
  name TEXT NOT NULL,
  descriptions TEXT,
  address TEXT,
  price TEXT,
  size REAL,                                    -- square metres
  bedrooms INTEGER,
  bathrooms INTEGER,
  phone TEXT,                                   -- per-room call button
  whatsapp TEXT,                                -- per-room WhatsApp button
  roomType INTEGER NOT NULL DEFAULT 0 CHECK (roomType IN (0,1)),
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0,1)),  -- 0 = not paid, 1 = paid
  available INTEGER NOT NULL DEFAULT 1,         -- boolean 0/1
  create_date TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room_images (        -- max 3 per room (enforced in code)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_amenities (     -- icon + label, managed one at a time
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  icon TEXT,                                    -- uploaded icon path
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (        -- single row, powers the About Us block
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tel TEXT,
  email TEXT,
  address TEXT,
  link TEXT                                   -- map link
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lastname TEXT NOT NULL,
  tel TEXT NOT NULL,
  link TEXT                                     -- nullable
);

CREATE TABLE IF NOT EXISTS leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  startDate TEXT NOT NULL,                      -- YYYY-MM-DD
  endDate TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bills (              -- current month's price detail per room
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
  roomPrice REAL NOT NULL DEFAULT 0,
  electricityPrice REAL NOT NULL DEFAULT 0,
  waterPrice REAL NOT NULL DEFAULT 0,
  wasteFees REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  lastPaidDate TEXT                             -- set when status flips to paid
);
`);

module.exports = db;

// payment history — one row every time a room's status flips Not paid -> Paid
db.exec(`
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  roomPrice REAL NOT NULL DEFAULT 0,
  electricityPrice REAL NOT NULL DEFAULT 0,
  waterPrice REAL NOT NULL DEFAULT 0,
  wasteFees REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paidDate TEXT NOT NULL DEFAULT (date('now'))
);
`);

// banners — homepage / rooms-page hero images
db.exec(`
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type INTEGER NOT NULL DEFAULT 0 CHECK (type IN (0,1)),  -- 0 = home page, 1 = rooms page
  topic TEXT,                                   -- headline, e.g. "Promotion 20%"
  image TEXT,                                   -- uploaded image path
  link_url TEXT,                                -- nullable, target when clicked
  display_order INTEGER DEFAULT 0,              -- lower shows first
  status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0,1)),  -- 1 = shown, 0 = hidden
  create_date TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// contact_messages — what visitors send through the website contact form.
// Separate from `contacts`, which holds the single About Us record.
db.exec(`
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  topic TEXT,                                   -- nullable, e.g. "สอบถาม"
  detail TEXT,                                  -- nullable
  create_date TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// customers — CRM leads, admin-only. room_interest stays free text on purpose:
// a lead should survive the room it was interested in being deleted.
db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  channel TEXT,                                 -- how they reached us, e.g. "Website"
  room_interest TEXT,                           -- e.g. "ห้อง A01", not an FK
  first_contact TEXT,                           -- YYYY-MM-DD
  next_appointment TEXT,                        -- YYYY-MM-DD
  assigned_to TEXT,
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0,1,2)),  -- 0 = new, 1 = in progress, 2 = closed
  create_date TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_logs (      -- contact history, append-only from the UI
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  create_date TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- Migrations ----------
// CREATE TABLE IF NOT EXISTS never adds columns to a table that already exists,
// so new columns on old tables go here. Table/column names are literals, not user input.
function hasColumn(table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
}

function addColumnIfMissing(table, column, definition) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// mirror of the above, for columns a design change took away
function dropColumnIfExists(table, column) {
  if (hasColumn(table, column)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}

// banners — headline, ordering and an on/off switch
addColumnIfMissing("banners", "topic", "TEXT");
addColumnIfMissing("banners", "display_order", "INTEGER DEFAULT 0");
addColumnIfMissing("banners", "status", "INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0,1))");

// contacts — About Us shows a street address next to tel / email / map link
addColumnIfMissing("contacts", "address", "TEXT");

// rooms — everything the HomHuen room card shows
addColumnIfMissing("rooms", "code", "TEXT");
addColumnIfMissing("rooms", "address", "TEXT");
addColumnIfMissing("rooms", "size", "REAL");
addColumnIfMissing("rooms", "bedrooms", "INTEGER");
addColumnIfMissing("rooms", "bathrooms", "INTEGER");
addColumnIfMissing("rooms", "phone", "TEXT");
addColumnIfMissing("rooms", "whatsapp", "TEXT");

// promotions are advertised through banners now, so the per-room discount is gone
dropColumnIfExists("rooms", "discount_price");

// locations were replaced by the About Us block (contacts.address + contacts.link)
db.exec("DROP TABLE IF EXISTS locations;");
