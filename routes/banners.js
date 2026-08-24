const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const { auth } = require("../middleware/auth");
const { bannerUpload, uploadDir } = require("../middleware/upload");

const router = express.Router();

// query params are always strings — reject "" / "abc" before Number() turns them into 0 / NaN
const isValidType = (v) => v !== "" && (Number(v) === 0 || Number(v) === 1);

function deleteFile(relPath) {
  if (!relPath) return;
  const full = path.join(uploadDir, path.basename(relPath));
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

// [GET] /api/admin/banners?type=0|1 -> id, type, image, link_url, create_date
router.get("/", auth, (req, res) => {
  const { type } = req.query;
  if (type !== undefined && !isValidType(type))
    return res.status(400).json({ success: false, message: "type must be 0 or 1" });

  const banners =
    type !== undefined
      ? db
          .prepare(
            `SELECT id, type, image, link_url, create_date
             FROM banners WHERE type = ? ORDER BY create_date DESC`
          )
          .all(Number(type))
      : db
          .prepare(
            `SELECT id, type, image, link_url, create_date
             FROM banners ORDER BY create_date DESC`
          )
          .all();

  res.json({ success: true, data: banners });
});

// [POST] /api/admin/banners  (multipart/form-data)
// fields: type(0|1), link_url
// file: image (1)
router.post("/", auth, (req, res) => {
  bannerUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });

    const { type, link_url } = req.body;
    const image = req.file ? "/uploads/" + req.file.filename : null;

    if (!isValidType(type)) {
      deleteFile(image);
      return res.status(400).json({ success: false, message: "type must be 0 or 1" });
    }
    if (!image) return res.status(400).json({ success: false, message: "image is required" });

    const info = db
      .prepare("INSERT INTO banners (type, image, link_url) VALUES (?, ?, ?)")
      .run(Number(type), image, link_url || null);

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
    if (body.type !== undefined && !isValidType(body.type)) {
      deleteFile(newImage);
      return res.status(400).json({ success: false, message: "type must be 0 or 1" });
    }

    let image = banner.image;
    if (newImage) {
      deleteFile(banner.image);
      image = newImage;
    }

    db.prepare("UPDATE banners SET type = ?, image = ?, link_url = ? WHERE id = ?").run(
      body.type !== undefined ? Number(body.type) : banner.type,
      image,
      body.link_url ?? banner.link_url,
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
