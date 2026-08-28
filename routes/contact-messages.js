const express = require("express");
const db = require("../config/db");
const { auth } = require("../middleware/auth");

const router = express.Router();

// Read-only inbox: rows arrive from the public form at POST /api/contact-messages,
// so there is deliberately no POST or PUT here.

// [GET] /api/admin/contact-messages -> id, name, phone, topic, detail, create_date
router.get("/", auth, (req, res) => {
  const messages = db
    .prepare(
      // create_date is only second-precision, so id breaks the tie within the same second
      `SELECT id, name, phone, topic, detail, create_date
       FROM contact_messages ORDER BY create_date DESC, id DESC`
    )
    .all();
  res.json({ success: true, data: messages });
});

// [DELETE] /api/admin/contact-messages/:id
router.delete("/:id", auth, (req, res) => {
  const message = db.prepare("SELECT id FROM contact_messages WHERE id = ?").get(req.params.id);
  if (!message) return res.status(404).json({ success: false, message: "Message not found" });

  db.prepare("DELETE FROM contact_messages WHERE id = ?").run(message.id);
  res.json({ success: true, message: "Message deleted" });
});

module.exports = router;
