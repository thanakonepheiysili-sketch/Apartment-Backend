const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const { auth } = require("../middleware/auth");
const { roomUpload, iconUpload, uploadDir } = require("../middleware/upload");
const { recordPaymentAndResetBill } = require("../utils/payment");

const router = express.Router();

const toBool = (v) =>
  v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true" ? 1 : 0;

// multipart fields are always strings — reject "" / "abc" before Number() turns them into 0 / NaN
const isNumeric = (v) => v !== "" && v !== null && Number.isFinite(Number(v));

// size / bedrooms / bathrooms are optional, but must be numbers when they are sent
function validateNumbers(body) {
  for (const key of ["size", "bedrooms", "bathrooms"]) {
    if (body[key] !== undefined && !isNumeric(body[key])) return `${key} must be a number`;
  }
  return null;
}

// keeps the stored value when the field is left out of the request
const keep = (value, current) => (value !== undefined ? Number(value) : current);

function deleteFile(relPath) {
  if (!relPath) return;
  const full = path.join(uploadDir, path.basename(relPath));
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

// a rejected request must not leave its uploaded files behind
function deleteUploaded(req) {
  deleteFile(req.files?.cover?.[0] && "/uploads/" + req.files.cover[0].filename);
  (req.files?.images || []).forEach((f) => deleteFile("/uploads/" + f.filename));
}

// [GET] /api/admin/rooms -> every card field + images + amenities
router.get("/", auth, (req, res) => {
  const imgStmt = db.prepare("SELECT path FROM room_images WHERE room_id = ?");
  const amenityStmt = db.prepare("SELECT id, icon, name FROM room_amenities WHERE room_id = ?");
  const rooms = db
    .prepare(
      `SELECT id, cover, code, name, descriptions, address, price, size, bedrooms, bathrooms,
              phone, whatsapp, roomType, available, status, create_date
       FROM rooms ORDER BY create_date DESC`
    )
    .all()
    .map((r) => ({
      ...r,
      available: !!r.available,
      images: imgStmt.all(r.id).map((i) => i.path),
      amenities: amenityStmt.all(r.id),
    }));
  res.json({ success: true, data: rooms });
});

// [POST] /api/admin/rooms  (multipart/form-data)
// fields: name, code, descriptions, address, price, size, bedrooms, bathrooms, phone, whatsapp,
//         roomType(0|1), status(0|1), available(bool)
// files: cover (1), images (max 3)
router.post("/", auth, (req, res) => {
  roomUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });

    const { name, code, descriptions, address, price, size, bedrooms, bathrooms, phone, whatsapp,
      roomType, status, available } = req.body;

    if (!name) {
      deleteUploaded(req);
      return res.status(400).json({ success: false, message: "name is required" });
    }

    const invalid = validateNumbers(req.body);
    if (invalid) {
      deleteUploaded(req);
      return res.status(400).json({ success: false, message: invalid });
    }

    const roomPrice = price || "0";
    const cover = req.files?.cover?.[0] ? "/uploads/" + req.files.cover[0].filename : null;

    const info = db
      .prepare(
        `INSERT INTO rooms (cover, code, name, descriptions, address, price, size, bedrooms,
                            bathrooms, phone, whatsapp, roomType, status, available)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cover,
        code || null,
        name,
        descriptions || "",
        address || null,
        roomPrice,
        keep(size, null),
        keep(bedrooms, null),
        keep(bathrooms, null),
        phone || null,
        whatsapp || null,
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
    if (!room) {
      deleteUploaded(req);
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const body = req.body;
    const invalid = validateNumbers(body);
    if (invalid) {
      deleteUploaded(req);
      return res.status(400).json({ success: false, message: invalid });
    }

    const oldStatus = room.status;
    const newStatus = body.status !== undefined ? (Number(body.status) === 1 ? 1 : 0) : room.status;

    const newPrice = body.price ?? room.price;

    let cover = room.cover;
    if (req.files?.cover?.[0]) {
      deleteFile(room.cover);
      cover = "/uploads/" + req.files.cover[0].filename;
    }

    db.prepare(
      `UPDATE rooms SET cover = ?, code = ?, name = ?, descriptions = ?, address = ?, price = ?,
       size = ?, bedrooms = ?, bathrooms = ?, phone = ?, whatsapp = ?,
       roomType = ?, status = ?, available = ? WHERE id = ?`
    ).run(
      cover,
      body.code ?? room.code,
      body.name ?? room.name,
      body.descriptions ?? room.descriptions,
      body.address ?? room.address,
      newPrice,
      keep(body.size, room.size),
      keep(body.bedrooms, room.bedrooms),
      keep(body.bathrooms, room.bathrooms),
      body.phone ?? room.phone,
      body.whatsapp ?? room.whatsapp,
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
  db.prepare("SELECT icon FROM room_amenities WHERE room_id = ?")
    .all(room.id)
    .forEach((a) => deleteFile(a.icon));

  // cascades to images/amenities/tenant/lease/bill
  db.prepare("DELETE FROM rooms WHERE id = ?").run(room.id);
  res.json({ success: true, message: "Room deleted" });
});

// ----- Amenities — one icon + label at a time, kept out of the room multipart -----

// [POST] /api/admin/rooms/:id/amenities  (multipart/form-data)
// field: name   file: icon (1)
router.post("/:id/amenities", auth, (req, res) => {
  iconUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });

    const icon = req.file ? "/uploads/" + req.file.filename : null;
    const room = db.prepare("SELECT id FROM rooms WHERE id = ?").get(req.params.id);

    if (!room) {
      deleteFile(icon);
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const name = (req.body.name || "").trim();
    if (!name) {
      deleteFile(icon);
      return res.status(400).json({ success: false, message: "name is required" });
    }

    const info = db
      .prepare("INSERT INTO room_amenities (room_id, icon, name) VALUES (?, ?, ?)")
      .run(room.id, icon, name);

    res.status(201).json({ success: true, data: { id: info.lastInsertRowid, icon, name } });
  });
});

// [DELETE] /api/admin/rooms/:id/amenities/:amenityId
router.delete("/:id/amenities/:amenityId", auth, (req, res) => {
  const amenity = db
    .prepare("SELECT * FROM room_amenities WHERE id = ? AND room_id = ?")
    .get(req.params.amenityId, req.params.id);
  if (!amenity) return res.status(404).json({ success: false, message: "Amenity not found" });

  deleteFile(amenity.icon);
  db.prepare("DELETE FROM room_amenities WHERE id = ?").run(amenity.id);
  res.json({ success: true, message: "Amenity deleted" });
});

module.exports = router;
