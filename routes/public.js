const express = require("express");
const db = require("../config/db");
const router = express.Router();

// query params are always strings — reject "" / "abc" before Number() turns them into 0 / NaN
const isValidType = (v) => v !== "" && (Number(v) === 0 || Number(v) === 1);

// [GET] /api/rooms -> all rooms: cover, name, roomType, available, price, descriptions
router.get("/rooms", (req, res) => {
  const rooms = db
    .prepare(
      `SELECT id, cover, name, roomType, available, price, descriptions
       FROM rooms ORDER BY create_date DESC`
    )
    .all()
    .map((r) => ({ ...r, available: !!r.available }));
  res.json({ success: true, data: rooms });
});

// shared column list for the public room listings
const ROOM_LIST_FIELDS = `id, cover, name, roomType, available, price, descriptions, discount_price`;

// NOTE: these three must stay ABOVE /rooms/:id, otherwise "latest" is matched as an :id
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

// [GET] /api/rooms/promotions -> rooms that have a discount price
router.get("/rooms/promotions", (req, res) => {
  const rooms = db
    .prepare(
      `SELECT ${ROOM_LIST_FIELDS} FROM rooms
       WHERE discount_price IS NOT NULL ORDER BY create_date DESC`
    )
    .all()
    .map((r) => ({ ...r, available: !!r.available }));
  res.json({ success: true, data: rooms });
});

// [GET] /api/rooms/:id -> cover, images, name, descriptions, price, roomType, available, tel, link
router.get("/rooms/:id", (req, res) => {
  const room = db
    .prepare(
      `SELECT id, cover, name, descriptions, price, roomType, available
       FROM rooms WHERE id = ?`
    )
    .get(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });

  const images = db
    .prepare("SELECT path FROM room_images WHERE room_id = ?")
    .all(room.id)
    .map((i) => i.path);

  const contact = db.prepare("SELECT tel, link FROM contacts LIMIT 1").get() || {};

  res.json({
    success: true,
    data: {
      ...room,
      available: !!room.available,
      images,
      tel: contact.tel || null,
      link: contact.link || null,
    },
  });
});

// [GET] /api/contact -> tel, link
router.get("/contact", (req, res) => {
  const contact = db.prepare("SELECT tel, link FROM contacts LIMIT 1").get();
  if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
  res.json({ success: true, data: contact });
});

// [GET] /api/banners?type=0|1 -> id, type, image, link_url
router.get("/banners", (req, res) => {
  const { type } = req.query;
  if (type !== undefined && !isValidType(type))
    return res.status(400).json({ success: false, message: "type must be 0 or 1" });

  const banners =
    type !== undefined
      ? db
          .prepare(
            `SELECT id, type, image, link_url
             FROM banners WHERE type = ? ORDER BY create_date DESC`
          )
          .all(Number(type))
      : db
          .prepare(
            `SELECT id, type, image, link_url
             FROM banners ORDER BY create_date DESC`
          )
          .all();

  res.json({ success: true, data: banners });
});

// [GET] /api/locations -> id, address, latitude, longitude
router.get("/locations", (req, res) => {
  const locations = db
    .prepare(
      `SELECT id, address, latitude, longitude
       FROM locations ORDER BY create_date DESC`
    )
    .all();
  res.json({ success: true, data: locations });
});

module.exports = router;
