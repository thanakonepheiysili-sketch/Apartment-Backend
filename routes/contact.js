const express = require("express");
const db = require("../config/db");
const { auth } = require("../middleware/auth");

const router = express.Router();

// [GET] /api/admin/contact -> tel, email, link
router.get("/", auth, (req, res) => {
  const contact = db.prepare("SELECT * FROM contacts LIMIT 1").get();
  if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
  res.json({ success: true, data: contact });
});

// [POST] /api/admin/contact  { tel, email, link }
router.post("/", auth, (req, res) => {
  const { tel, email, link } = req.body;
  const existing = db.prepare("SELECT id FROM contacts LIMIT 1").get();
  if (existing)
    return res
      .status(409)
      .json({ success: false, message: "Contact already exists, use PUT to update" });
  const info = db
    .prepare("INSERT INTO contacts (tel, email, link) VALUES (?, ?, ?)")
    .run(tel || null, email || null, link || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid, tel, email, link } });
});

// [PUT] /api/admin/contact
router.put("/", auth, (req, res) => {
  const contact = db.prepare("SELECT * FROM contacts LIMIT 1").get();
  if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
  const { tel, email, link } = req.body;
  db.prepare("UPDATE contacts SET tel = ?, email = ?, link = ? WHERE id = ?").run(
    tel ?? contact.tel,
    email ?? contact.email,
    link ?? contact.link,
    contact.id
  );
  res.json({ success: true, message: "Contact updated" });
});

// [DELETE] /api/admin/contact
router.delete("/", auth, (req, res) => {
  const contact = db.prepare("SELECT id FROM contacts LIMIT 1").get();
  if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
  db.prepare("DELETE FROM contacts WHERE id = ?").run(contact.id);
  res.json({ success: true, message: "Contact deleted" });
});

module.exports = router;
