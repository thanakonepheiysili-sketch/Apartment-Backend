const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const { auth } = require("../middleware/auth");
const { bannerUpload, uploadDir } = require("../middleware/upload");

const router = express.Router();

// query params and multipart fields are always strings — reject "" / "abc"
// before Number() turns them into 0 / NaN
const isZeroOrOne = (v) => v !== "" && (Number(v) === 0 || Number(v) === 1);
const isNumeric = (v) => v !== "" && v !== null && Number.isFinite(Number(v));

// shared column list — admin sees everything, including the hidden banners
const BANNER_FIELDS = `id, type, topic, image, link_url, display_order, status, create_date`;

// design order: display_order first, newest wins the tie
const BANNER_ORDER = `ORDER BY display_order ASC, create_date DESC`;

// returns an error message when a field is off, otherwise null.
// type is required on create; topic / link_url / display_order / status are always optional.
function validateFields({ type, display_order, status }, { typeRequired } = {}) {
  if ((typeRequired || type !== undefined) && !isZeroOrOne(type)) return "type must be 0 or 1";
  if (display_order !== undefined && !isNumeric(display_order))
    return "display_order must be a number";
  if (status !== undefined && !isZeroOrOne(status)) return "status must be 0 or 1";
  return null;
}

function deleteFile(relPath) {
  if (!relPath) return;
  const full = path.join(uploadDir, path.basename(relPath));
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

// [GET] /api/admin/banners?type=0|1 -> id, type, topic, image, link_url, display_order, status, create_date
router.get("/", auth, (req, res) => {
  const { type } = req.query;
  if (type !== undefined && !isZeroOrOne(type))
    return res.status(400).json({ success: false, message: "type must be 0 or 1" });

  const banners =
    type !== undefined
      ? db
          .prepare(`SELECT ${BANNER_FIELDS} FROM banners WHERE type = ? ${BANNER_ORDER}`)
          .all(Number(type))
      : db.prepare(`SELECT ${BANNER_FIELDS} FROM banners ${BANNER_ORDER}`).all();

  res.json({ success: true, data: banners });
});

// [POST] /api/admin/banners  (multipart/form-data)
// fields: type(0|1), topic, link_url, display_order, status(0|1)
// file: image (1)
router.post("/", auth, (req, res) => {
  bannerUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });

    const { type, topic, link_url, display_order, status } = req.body;
    const image = req.file ? "/uploads/" + req.file.filename : null;

    const invalid = validateFields(req.body, { typeRequired: true });
    if (invalid) {
      deleteFile(image);
      return res.status(400).json({ success: false, message: invalid });
    }
    if (!image) return res.status(400).json({ success: false, message: "image is required" });

    const info = db
      .prepare(
        `INSERT INTO banners (type, topic, image, link_url, display_order, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        Number(type),
        topic || null,
        image,
        link_url || null,
        display_order !== undefined ? Number(display_order) : 0,
        status !== undefined ? Number(status) : 1
      );

    res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
  });
});

// [PUT] /api/admin/banners/:id  (multipart/form-data, same fields as POST — all optional)
router.put("/:id", auth, (req, res) => {
  bannerUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });

    const banner = db.prepare("SELECT * FROM banners WHERE id = ?").get(req.params.id);
    const newImage = req.file ? "/uploads/" + req.file.filename : null;

    if (!banner) {
      deleteFile(newImage);
      return res.status(404).json({ success: false, message: "Banner not found" });
    }

    const body = req.body;
    const invalid = validateFields(body);
    if (invalid) {
      deleteFile(newImage);
      return res.status(400).json({ success: false, message: invalid });
    }

    let image = banner.image;
    if (newImage) {
      deleteFile(banner.image);
      image = newImage;
    }

    db.prepare(
      `UPDATE banners SET type = ?, topic = ?, image = ?, link_url = ?, display_order = ?, status = ?
       WHERE id = ?`
    ).run(
      body.type !== undefined ? Number(body.type) : banner.type,
      body.topic ?? banner.topic,
      image,
      body.link_url ?? banner.link_url,
      body.display_order !== undefined ? Number(body.display_order) : banner.display_order,
      body.status !== undefined ? Number(body.status) : banner.status,
      banner.id
    );

    res.json({ success: true, message: "Banner updated" });
  });
});

// [DELETE] /api/admin/banners/:id
router.delete("/:id", auth, (req, res) => {
  const banner = db.prepare("SELECT * FROM banners WHERE id = ?").get(req.params.id);
  if (!banner) return res.status(404).json({ success: false, message: "Banner not found" });

  deleteFile(banner.image);
  db.prepare("DELETE FROM banners WHERE id = ?").run(banner.id);
  res.json({ success: true, message: "Banner deleted" });
});

module.exports = router;
