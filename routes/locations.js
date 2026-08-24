const express = require("express");
const db = require("../config/db");
const { auth } = require("../middleware/auth");

const router = express.Router();

// latitude/longitude are optional — but reject "" / null / "abc" when they are sent
const isNumeric = (v) => v !== "" && v !== null && !Number.isNaN(Number(v));

// [GET] /api/admin/locations -> id, address, latitude, longitude, create_date
router.get("/", auth, (req, res) => {
  const locations = db
    .prepare(
      `SELECT id, address, latitude, longitude, create_date
       FROM locations ORDER BY create_date DESC`
    )
    .all();
  res.json({ success: true, data: locations });
});

// [POST] /api/admin/locations  (application/json)
// body: address, latitude, longitude
router.post("/", auth, (req, res) => {
  const { address, latitude, longitude } = req.body;

  if (!address || !String(address).trim())
    return res.status(400).json({ success: false, message: "address is required" });
  if (latitude !== undefined && !isNumeric(latitude))
    return res.status(400).json({ success: false, message: "latitude must be a number" });
  if (longitude !== undefined && !isNumeric(longitude))
    return res.status(400).json({ success: false, message: "longitude must be a number" });

  const info = db
    .prepare("INSERT INTO locations (address, latitude, longitude) VALUES (?, ?, ?)")
    .run(
      address,
      latitude !== undefined ? Number(latitude) : null,
      longitude !== undefined ? Number(longitude) : null
    );

  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

// [PUT] /api/admin/locations/:id  (application/json, same fields as POST — all optional)
router.put("/:id", auth, (req, res) => {
  const location = db.prepare("SELECT * FROM locations WHERE id = ?").get(req.params.id);
  if (!location) return res.status(404).json({ success: false, message: "Location not found" });

  const body = req.body;
  if (body.address !== undefined && !String(body.address).trim())
    return res.status(400).json({ success: false, message: "address is required" });
  if (body.latitude !== undefined && !isNumeric(body.latitude))
    return res.status(400).json({ success: false, message: "latitude must be a number" });
  if (body.longitude !== undefined && !isNumeric(body.longitude))
    return res.status(400).json({ success: false, message: "longitude must be a number" });

  db.prepare("UPDATE locations SET address = ?, latitude = ?, longitude = ? WHERE id = ?").run(
    body.address ?? location.address,
    body.latitude !== undefined ? Number(body.latitude) : location.latitude,
    body.longitude !== undefined ? Number(body.longitude) : location.longitude,
    location.id
  );

  res.json({ success: true, message: "Location updated" });
});

// [DELETE] /api/admin/locations/:id
router.delete("/:id", auth, (req, res) => {
  const location = db.prepare("SELECT * FROM locations WHERE id = ?").get(req.params.id);
  if (!location) return res.status(404).json({ success: false, message: "Location not found" });

  db.prepare("DELETE FROM locations WHERE id = ?").run(location.id);
  res.json({ success: true, message: "Location deleted" });
});

module.exports = router;
