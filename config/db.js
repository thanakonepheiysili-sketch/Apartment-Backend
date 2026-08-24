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
  name TEXT NOT NULL,
  descriptions TEXT,
  price TEXT,
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

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tel TEXT,
  email TEXT,
  link TEXT
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
  image TEXT,                                   -- uploaded image path
  link_url TEXT,                                -- nullable, target when clicked
  create_date TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// locations — apartment address / map pins, shown on both pages
db.exec(`
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  latitude REAL,                                -- nullable
  longitude REAL,                               -- nullable
  create_date TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- Migrations ----------
// CREATE TABLE IF NOT EXISTS never adds columns to a table that already exists,
// so new columns on old tables go here. Table/column names are literals, not user input.
function addColumnIfMissing(table, column, definition) {
  const exists = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing("rooms", "discount_price", "REAL"); // nullable — NULL = no promotion
