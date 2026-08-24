const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { auth, adminOnly, SECRET } = require("../middleware/auth");

const router = express.Router();

// [POST] /api/admin/login  { phone, password }
router.post("/login", (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password)
    return res.status(400).json({ success: false, message: "phone and password are required" });

  const user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ success: false, message: "Invalid phone or password" });

  const token = jwt.sign({ id: user.id, phone: user.phone, role: user.role }, SECRET, {
    expiresIn: "1d",
  });
  res.json({ success: true, token, user: { id: user.id, phone: user.phone, role: user.role } });
});

// ----- Manage users (apartment owners) — admin only -----

// [POST] /api/admin/users  { phone, password }
router.post("/users", auth, adminOnly, (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password)
    return res.status(400).json({ success: false, message: "phone and password are required" });
  try {
    const info = db
      .prepare("INSERT INTO users (phone, password, role) VALUES (?, ?, 'owner')")
      .run(phone, bcrypt.hashSync(password, 10));
    res.status(201).json({ success: true, data: { id: info.lastInsertRowid, phone } });
  } catch (e) {
    if (String(e.message).includes("UNIQUE"))
      return res.status(409).json({ success: false, message: "Phone already exists" });
    throw e;
  }
});

// [GET] /api/admin/users
router.get("/users", auth, adminOnly, (req, res) => {
  const users = db
    .prepare("SELECT id, phone, role, create_date FROM users ORDER BY id")
    .all();
  res.json({ success: true, data: users });
});

// [PUT] /api/admin/users/:id  { phone?, password? }
router.put("/users/:id", auth, adminOnly, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  const phone = req.body.phone ?? user.phone;
  const password = req.body.password ? bcrypt.hashSync(req.body.password, 10) : user.password;

  db.prepare("UPDATE users SET phone = ?, password = ? WHERE id = ?").run(
    phone,
    password,
    user.id
  );
  res.json({ success: true, data: { id: user.id, phone } });
});

// [DELETE] /api/admin/users/:id
router.delete("/users/:id", auth, adminOnly, (req, res) => {
  const user = db.prepare("SELECT id, role FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  if (user.role === "admin")
    return res.status(400).json({ success: false, message: "Cannot delete admin account" });
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  res.json({ success: true, message: "User deleted" });
});

module.exports = router;
