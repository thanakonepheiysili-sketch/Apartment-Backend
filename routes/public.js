const express = require("express");
const db = require("../config/db");
const router = express.Router();

// query params are always strings — reject "" / "abc" before Number() turns them into 0 / NaN
const isValidType = (v) => v !== "" && (Number(v) === 0 || Number(v) === 1);

// shared column list for the public room listings — everything the room card shows.
// phone / whatsapp stay out: the call and WhatsApp buttons live on the detail page.
const ROOM_LIST_FIELDS = `id, cover, code, name, roomType, available, price, descriptions,
                          address, size, bedrooms, bathrooms`;

// [GET] /api/rooms -> all rooms
router.get("/rooms", (req, res) => {
  const rooms = db
    .prepare(`SELECT ${ROOM_LIST_FIELDS} FROM rooms ORDER BY create_date DESC`)
    .all()
    .map((r) => ({ ...r, available: !!r.available }));
  res.json({ success: true, data: rooms });
});

// NOTE: these two must stay ABOVE /rooms/:id, otherwise "latest" is matched as an :id
// [GET] /api/rooms/latest -> 3 newest rooms
router.get("/rooms/latest", (req, res) => {
  const rooms = db
    .prepare(`SELECT ${ROOM_LIST_FIELDS} FROM rooms ORDER BY create_date DESC LIMIT 3`)
    .all()
    .map((r) => ({ ...r, available: !!r.available }));
  res.json({ success: true, data: rooms });
});

// [GET] /api/rooms/recommended -> 3 random rooms, available ones only
router.get("/rooms/recommended", (req, res) => {
  const rooms = db
    .prepare(`SELECT ${ROOM_LIST_FIELDS} FROM rooms WHERE available = 1 ORDER BY RANDOM() LIMIT 3`)
    .all()
    .map((r) => ({ ...r, available: !!r.available }));
  res.json({ success: true, data: rooms });
});

// [GET] /api/rooms/:id -> every card field + phone, whatsapp, images, amenities, tel, link
router.get("/rooms/:id", (req, res) => {
  const room = db
    .prepare(
      `SELECT id, cover, code, name, descriptions, address, price, size, bedrooms, bathrooms,
              phone, whatsapp, roomType, available
       FROM rooms WHERE id = ?`
    )
    .get(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });

  const images = db
    .prepare("SELECT path FROM room_images WHERE room_id = ?")
    .all(room.id)
    .map((i) => i.path);

  const amenities = db
    .prepare("SELECT id, icon, name, amount FROM room_amenities WHERE room_id = ?")
    .all(room.id);

  const contact = db.prepare("SELECT tel, link FROM contacts LIMIT 1").get() || {};

  res.json({
    success: true,
    data: {
      ...room,
      available: !!room.available,
      images,
      amenities,
      tel: contact.tel || null,
      link: contact.link || null,
    },
  });
});

// [GET] /api/contact -> tel, email, address, link  (About Us)
router.get("/contact", (req, res) => {
  const contact = db.prepare("SELECT tel, email, address, link FROM contacts LIMIT 1").get();
  if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
  res.json({ success: true, data: contact });
});

// [GET] /api/banners?type=0|1 -> id, type, topic, image, link_url  (only status = 1)
router.get("/banners", (req, res) => {
  const { type } = req.query;
  if (type !== undefined && !isValidType(type))
    return res.status(400).json({ success: false, message: "type must be 0 or 1" });

  const fields = `id, type, topic, image, link_url`;
  const order = `ORDER BY display_order ASC, create_date DESC`;

  const banners =
    type !== undefined
      ? db
          .prepare(
            `SELECT ${fields} FROM banners WHERE status = 1 AND type = ? ${order}`
          )
          .all(Number(type))
      : db.prepare(`SELECT ${fields} FROM banners WHERE status = 1 ${order}`).all();

  res.json({ success: true, data: banners });
});

// contact form limits — a bot should not be able to stuff the table
const MESSAGE_LIMITS = { name: 200, phone: 200, topic: 200, detail: 2000 };

const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

function validateMessage(body) {
  for (const key of ["name", "phone"]) {
    if (!trimmed(body[key])) return `${key} is required`;
  }
  for (const [key, max] of Object.entries(MESSAGE_LIMITS)) {
    if (trimmed(body[key]).length > max) return `${key} must be at most ${max} characters`;
  }
  return null;
}

// [POST] /api/contact-messages  { name, phone, topic, detail }
// Visitors write here; only admins can read or delete afterwards.
router.post("/contact-messages", (req, res) => {
  const invalid = validateMessage(req.body || {});
  if (invalid) return res.status(400).json({ success: false, message: invalid });

  const { name, phone, topic, detail } = req.body;
  db.prepare("INSERT INTO contact_messages (name, phone, topic, detail) VALUES (?, ?, ?, ?)").run(
    trimmed(name),
    trimmed(phone),
    trimmed(topic) || null,
    trimmed(detail) || null
  );

  res.status(201).json({ success: true });
});

module.exports = router;
