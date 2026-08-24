const express = require("express");
const db = require("../config/db");
const { auth } = require("../middleware/auth");
const { recordPaymentAndResetBill } = require("../utils/payment");

const router = express.Router();
router.use(auth);

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// overdue = number of whole months elapsed since lease start (or last paid date) while unpaid
function calcOverdueMonths(room, lease, bill) {
  const from = bill?.lastPaidDate || lease?.startDate;
  if (!from) return 0;
  const start = new Date(from);
  const now = new Date();
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

// ---------- Unpaid room report ----------

// [GET] /api/admin/report/unpaid -> name, leaseTime, overdue, status
router.get("/unpaid", (req, res) => {
  const rooms = db.prepare("SELECT * FROM rooms").all();
  const data = rooms.map((room) => {
    const lease = db.prepare("SELECT * FROM leases WHERE room_id = ?").get(room.id);
    const bill = db.prepare("SELECT * FROM bills WHERE room_id = ?").get(room.id);
    return {
      roomId: room.id,
      name: room.name,
      leaseTime: lease ? `${lease.startDate} to ${lease.endDate}` : null,
      overdue: calcOverdueMonths(room, lease, bill),
      status: room.status, // 0 = not paid
    };
  });
  res.json({ success: true, data });
});

// [PUT] /api/admin/report/rooms/:id/status  { status: 0 | 1 }
// Changing Not paid -> Paid resets the bill price detail
router.put("/rooms/:id/status", (req, res) => {
  const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });

  const newStatus = Number(req.body.status) === 1 ? 1 : 0;
  db.prepare("UPDATE rooms SET status = ? WHERE id = ?").run(newStatus, room.id);

  if (room.status === 0 && newStatus === 1) {
    recordPaymentAndResetBill(room.id);
  }
  res.json({ success: true, message: `Status changed to ${newStatus === 1 ? "Paid" : "Not paid"}` });
});

// ---------- Room tenant ----------

// [POST] /api/admin/report/rooms/:id/tenant  { name, lastname, tel, link? }
router.post("/rooms/:id/tenant", (req, res) => {
  const room = db.prepare("SELECT id FROM rooms WHERE id = ?").get(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });

  const { name, lastname, tel, link } = req.body;
  if (!name || !lastname || !tel)
    return res
      .status(400)
      .json({ success: false, message: "name, lastname and tel are required" });

  const existing = db.prepare("SELECT id FROM tenants WHERE room_id = ?").get(room.id);
  if (existing)
    return res
      .status(409)
      .json({ success: false, message: "Tenant already exists for this room, use PUT" });

  const info = db
    .prepare("INSERT INTO tenants (room_id, name, lastname, tel, link) VALUES (?, ?, ?, ?, ?)")
    .run(room.id, name, lastname, String(tel), link || null);
  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

// [PUT] /api/admin/report/rooms/:id/tenant
router.put("/rooms/:id/tenant", (req, res) => {
  const tenant = db.prepare("SELECT * FROM tenants WHERE room_id = ?").get(req.params.id);
  if (!tenant) return res.status(404).json({ success: false, message: "Tenant not found" });

  const { name, lastname, tel, link } = req.body;
  db.prepare(
    "UPDATE tenants SET name = ?, lastname = ?, tel = ?, link = ? WHERE id = ?"
  ).run(
    name ?? tenant.name,
    lastname ?? tenant.lastname,
    tel !== undefined ? String(tel) : tenant.tel,
    link !== undefined ? link : tenant.link,
    tenant.id
  );
  res.json({ success: true, message: "Tenant updated" });
});

// [DELETE] /api/admin/report/rooms/:id/tenant
router.delete("/rooms/:id/tenant", (req, res) => {
  const tenant = db.prepare("SELECT id FROM tenants WHERE room_id = ?").get(req.params.id);
  if (!tenant) return res.status(404).json({ success: false, message: "Tenant not found" });
  db.prepare("DELETE FROM tenants WHERE id = ?").run(tenant.id);
  res.json({ success: true, message: "Tenant deleted" });
});

// ---------- Lease agreement ----------

// [GET] /api/admin/report/leases -> roomID, name, startDate, endDate
router.get("/leases", (req, res) => {
  const data = db
    .prepare(
      `SELECT l.room_id AS roomID, r.name, l.startDate, l.endDate
       FROM leases l JOIN rooms r ON r.id = l.room_id`
    )
    .all();
  res.json({ success: true, data });
});

// [POST] /api/admin/report/rooms/:id/lease  { startDate, endDate }  (YYYY-MM-DD)
router.post("/rooms/:id/lease", (req, res) => {
  const room = db.prepare("SELECT id FROM rooms WHERE id = ?").get(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });

  const { startDate, endDate } = req.body;
  if (!startDate || !endDate)
    return res.status(400).json({ success: false, message: "startDate and endDate are required" });
  if (isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate)))
    return res.status(400).json({ success: false, message: "Invalid date format, use YYYY-MM-DD" });
  if (new Date(endDate) <= new Date(startDate))
    return res.status(400).json({ success: false, message: "endDate must be after startDate" });

  const existing = db.prepare("SELECT id FROM leases WHERE room_id = ?").get(room.id);
  if (existing)
    return res
      .status(409)
      .json({ success: false, message: "Lease already exists for this room, use PUT" });

  db.prepare("INSERT INTO leases (room_id, startDate, endDate) VALUES (?, ?, ?)").run(
    room.id,
    startDate,
    endDate
  );
  res.status(201).json({ success: true, message: "Lease created" });
});

// [PUT] /api/admin/report/rooms/:id/lease  — edit or reset dates
router.put("/rooms/:id/lease", (req, res) => {
  const lease = db.prepare("SELECT * FROM leases WHERE room_id = ?").get(req.params.id);
  if (!lease) return res.status(404).json({ success: false, message: "Lease not found" });

  const startDate = req.body.startDate ?? lease.startDate;
  const endDate = req.body.endDate ?? lease.endDate;
  if (isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate)))
    return res.status(400).json({ success: false, message: "Invalid date format, use YYYY-MM-DD" });
  if (new Date(endDate) <= new Date(startDate))
    return res.status(400).json({ success: false, message: "endDate must be after startDate" });

  db.prepare("UPDATE leases SET startDate = ?, endDate = ? WHERE id = ?").run(
    startDate,
    endDate,
    lease.id
  );
  res.json({ success: true, message: "Lease updated" });
});

// ---------- Monthly price calculation ----------

// [POST] /api/admin/report/rooms/:id/bill
// { roomPrice, electricityPrice, waterPrice, wasteFees } -> saves and returns total
router.post("/rooms/:id/bill", (req, res) => {
  const room = db.prepare("SELECT id FROM rooms WHERE id = ?").get(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });

  const roomPrice = Number(req.body.roomPrice) || 0;
  const electricityPrice = Number(req.body.electricityPrice) || 0;
  const waterPrice = Number(req.body.waterPrice) || 0;
  const wasteFees = Number(req.body.wasteFees) || 0;
  const total = roomPrice + electricityPrice + waterPrice + wasteFees;

  const existing = db.prepare("SELECT id FROM bills WHERE room_id = ?").get(room.id);
  if (existing) {
    db.prepare(
      `UPDATE bills SET roomPrice = ?, electricityPrice = ?, waterPrice = ?,
       wasteFees = ?, total = ? WHERE room_id = ?`
    ).run(roomPrice, electricityPrice, waterPrice, wasteFees, total, room.id);
  } else {
    db.prepare(
      `INSERT INTO bills (room_id, roomPrice, electricityPrice, waterPrice, wasteFees, total)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(room.id, roomPrice, electricityPrice, waterPrice, wasteFees, total);
  }

  res.json({
    success: true,
    data: { roomPrice, electricityPrice, waterPrice, wasteFees, total },
  });
});

// ---------- Full detail info ----------

// [GET] /api/admin/report/rooms/:id/info
router.get("/rooms/:id/info", (req, res) => {
  const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });

  const tenant = db
    .prepare("SELECT name, lastname, tel AS phone FROM tenants WHERE room_id = ?")
    .get(room.id);
  const lease = db.prepare("SELECT startDate, endDate FROM leases WHERE room_id = ?").get(room.id);
  const bill = db
    .prepare(
      "SELECT roomPrice, electricityPrice, waterPrice, wasteFees, total FROM bills WHERE room_id = ?"
    )
    .get(room.id);

  // rentalPeriod in days, e.g. "30"
  let rentalPeriod = null;
  if (lease) {
    const days = Math.round(
      (new Date(lease.endDate) - new Date(lease.startDate)) / MS_PER_DAY
    );
    rentalPeriod = String(days);
  }

  res.json({
    success: true,
    data: {
      roomId: room.id,
      roomName: room.name,
      status: room.status,
      tenant: tenant || null,
      rentalPeriod,
      startDate: lease?.startDate || null,
      endDate: lease?.endDate || null,
      priceDetail: bill || {
        roomPrice: 0,
        electricityPrice: 0,
        waterPrice: 0,
        wasteFees: 0,
        total: 0,
      },
    },
  });
});

module.exports = router;
