const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const { auth } = require("../middleware/auth");
const { roomUpload, uploadDir } = require("../middleware/upload");
const { recordPaymentAndResetBill } = require("../utils/payment");

const router = express.Router();

const toBool = (v) =>
  v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true" ? 1 : 0;

// discount_price is optional — null / "" clears the promotion,
// anything else must be numeric and lower than the room's price
function resolveDiscount(value, price) {
  if (value === null || String(value).trim() === "") return { value: null };
  const discount = Number(value);
  if (Number.isNaN(discount))
    return { error: "discount_price must be a number" };
  if (discount >= Number(price))
    return { error: "discount_price must be lower than price" };
  return { value: discount };
}

function deleteFile(relPath) {
  if (!relPath) return;
  const full = path.join(uploadDir, path.basename(relPath));
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

// [GET] /api/admin/rooms -> cover, images, name, roomType, available, price, discount_price, create_date
router.get("/", auth, (req, res) => {
  const imgStmt = db.prepare("SELECT path FROM room_images WHERE room_id = ?");
  const rooms = db
    .prepare(
      `SELECT id, cover, name, roomType, available, price, discount_price, status, create_date
       FROM rooms ORDER BY create_date DESC`
    )
    .all()
    .map((r) => ({
      ...r,
      available: !!r.available,
      images: imgStmt.all(r.id).map((i) => i.path),
    }));
  res.json({ success: true, data: rooms });
});

// [POST] /api/admin/rooms  (multipart/form-data)
// fields: name, descriptions, price, discount_price, roomType(0|1), status(0|1), available(bool)
// files: cover (1), images (max 3)
router.post("/", auth, (req, res) => {
  roomUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });

    const { name, descriptions, price, discount_price, roomType, status, available } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "name is required" });

    const roomPrice = price || "0";
    let discount = null;
    if (discount_price !== undefined) {
      const result = resolveDiscount(discount_price, roomPrice);
      if (result.error) return res.status(400).json({ success: false, message: result.error });
      discount = result.value;
    }

    const cover = req.files?.cover?.[0] ? "/uploads/" + req.files.cover[0].filename : null;

    const info = db
      .prepare(
        `INSERT INTO rooms (cover, name, descriptions, price, discount_price, roomType, status, available)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cover,
        name,
        descriptions || "",
        roomPrice,
        discount,
        Number(roomType) === 1 ? 1 : 0,
        Number(status) === 1 ? 1 : 0,
        toBool(available)
      );

    const roomId = info.lastInsertRowid;
    const imgStmt = db.prepare("INSERT INTO room_images (room_id, path) VALUES (?, ?)");
    (req.files?.images || []).slice(0, 3).forEach((f) =>
      imgStmt.run(roomId, "/uploads/" + f.filename)
    );

    // create an empty bill row so price detail always exists
    db.prepare("INSERT INTO bills (room_id) VALUES (?)").run(roomId);

    res.status(201).json({ success: true, data: { id: roomId } });
  });
});

// [PUT] /api/admin/rooms/:id  (multipart/form-data, same fields as POST — all optional)
router.put("/:id", auth, (req, res) => {
  roomUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });

    const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(req.params.id);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    const body = req.body;
    const oldStatus = room.status;
    const newStatus = body.status !== undefined ? (Number(body.status) === 1 ? 1 : 0) : room.status;

    // validate against the incoming price when it is being changed in the same request
    const newPrice = body.price ?? room.price;
    let discount = room.discount_price;
    if (body.discount_price !== undefined) {
      const result = resolveDiscount(body.discount_price, newPrice);
      if (result.error) return res.status(400).json({ success: false, message: result.error });
      discount = result.value;
    }

    let cover = room.cover;
    if (req.files?.cover?.[0]) {
      deleteFile(room.cover);
      cover = "/uploads/" + req.files.cover[0].filename;
    }

    db.prepare(
      `UPDATE rooms SET cover = ?, name = ?, descriptions = ?, price = ?, discount_price = ?,
       roomType = ?, status = ?, available = ? WHERE id = ?`
    ).run(
      cover,
      body.name ?? room.name,
      body.descriptions ?? room.descriptions,
      newPrice,
      discount,
      body.roomType !== undefined ? (Number(body.roomType) === 1 ? 1 : 0) : room.roomType,
      newStatus,
      body.available !== undefined ? toBool(body.available) : room.available,
      room.id
    );

    // replace gallery images if new ones uploaded
    if (req.files?.images?.length) {
      db.prepare("SELECT path FROM room_images WHERE room_id = ?")
        .all(room.id)
        .forEach((i) => deleteFile(i.path));
      db.prepare("DELETE FROM room_images WHERE room_id = ?").run(room.id);
      const imgStmt = db.prepare("INSERT INTO room_images (room_id, path) VALUES (?, ?)");
      req.files.images.slice(0, 3).forEach((f) => imgStmt.run(room.id, "/uploads/" + f.filename));
    }

    // if status flipped Not paid -> Paid, save to payment history + reset the bill
    if (oldStatus === 0 && newStatus === 1) {
      recordPaymentAndResetBill(room.id);
    }

    res.json({ success: true, message: "Room updated" });
  });
});

// [DELETE] /api/admin/rooms/:id
router.delete("/:id", auth, (req, res) => {
  const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });

  deleteFile(room.cover);
  db.prepare("SELECT path FROM room_images WHERE room_id = ?")
    .all(room.id)
    .forEach((i) => deleteFile(i.path));

  db.prepare("DELETE FROM rooms WHERE id = ?").run(room.id); // cascades to images/tenant/lease/bill
  res.json({ success: true, message: "Room deleted" });
});

module.exports = router;
