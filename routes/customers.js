const express = require("express");
const db = require("../config/db");
const { auth } = require("../middleware/auth");

const router = express.Router();

// query params are always strings — reject "" / "abc" before Number() turns them into 0 / NaN
const isValidStatus = (v) => v !== "" && [0, 1, 2].includes(Number(v));

// the design stores plain dates. Date.parse rolls overflow days over ("2026-02-30" becomes
// March 2) instead of failing, so compare the round-trip to catch days that never existed.
function isValidDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(v); // an ISO date-only string parses as UTC
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}

const DATE_FIELDS = ["first_contact", "next_appointment"];

const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

// returns an error message when a field is off, otherwise null.
// name is required on create; everything else is optional in both create and update.
function validateCustomer(body, { nameRequired } = {}) {
  if ((nameRequired || body.name !== undefined) && !trimmed(body.name))
    return "name is required";
  if (body.status !== undefined && !isValidStatus(body.status))
    return "status must be 0, 1 or 2";
  for (const key of DATE_FIELDS) {
    if (body[key] !== undefined && body[key] !== null && !isValidDate(body[key]))
      return `${key} must be a valid date (YYYY-MM-DD)`;
  }
  return null;
}

const CUSTOMER_FIELDS = `id, name, phone, channel, room_interest, first_contact,
                         next_appointment, assigned_to, status, create_date`;

// [GET] /api/admin/customers?status=0|1|2 -> every customer, newest first
router.get("/", auth, (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !isValidStatus(status))
    return res.status(400).json({ success: false, message: "status must be 0, 1 or 2" });

  const customers =
    status !== undefined
      ? db
          .prepare(
            `SELECT ${CUSTOMER_FIELDS} FROM customers
             WHERE status = ? ORDER BY create_date DESC, id DESC`
          )
          .all(Number(status))
      : db
          .prepare(`SELECT ${CUSTOMER_FIELDS} FROM customers ORDER BY create_date DESC, id DESC`)
          .all();

  res.json({ success: true, data: customers });
});

// [GET] /api/admin/customers/:id -> one customer + its contact history
router.get("/:id", auth, (req, res) => {
  const customer = db
    .prepare(`SELECT ${CUSTOMER_FIELDS} FROM customers WHERE id = ?`)
    .get(req.params.id);
  if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

  // create_date is only second-precision, so id breaks the tie within the same second
  const logs = db
    .prepare(
      `SELECT id, note, create_date FROM customer_logs
       WHERE customer_id = ? ORDER BY create_date DESC, id DESC`
    )
    .all(customer.id);

  res.json({ success: true, data: { ...customer, logs } });
});

// [POST] /api/admin/customers  (application/json)
// { name, phone, channel, room_interest, first_contact, next_appointment, assigned_to, status }
router.post("/", auth, (req, res) => {
  const body = req.body || {};
  const invalid = validateCustomer(body, { nameRequired: true });
  if (invalid) return res.status(400).json({ success: false, message: invalid });

  const info = db
    .prepare(
      `INSERT INTO customers (name, phone, channel, room_interest, first_contact,
                              next_appointment, assigned_to, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      trimmed(body.name),
      body.phone || null,
      body.channel || null,
      body.room_interest || null,
      body.first_contact || null,
      body.next_appointment || null,
      body.assigned_to || null,
      body.status !== undefined ? Number(body.status) : 0
    );

  res.status(201).json({ success: true, data: { id: info.lastInsertRowid } });
});

// [PUT] /api/admin/customers/:id  (application/json, same fields as POST — all optional)
router.put("/:id", auth, (req, res) => {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

  const body = req.body || {};
  const invalid = validateCustomer(body);
  if (invalid) return res.status(400).json({ success: false, message: invalid });

  db.prepare(
    `UPDATE customers SET name = ?, phone = ?, channel = ?, room_interest = ?, first_contact = ?,
     next_appointment = ?, assigned_to = ?, status = ? WHERE id = ?`
  ).run(
    body.name !== undefined ? trimmed(body.name) : customer.name,
    body.phone ?? customer.phone,
    body.channel ?? customer.channel,
    body.room_interest ?? customer.room_interest,
    body.first_contact ?? customer.first_contact,
    body.next_appointment ?? customer.next_appointment,
    body.assigned_to ?? customer.assigned_to,
    body.status !== undefined ? Number(body.status) : customer.status,
    customer.id
  );

  res.json({ success: true, message: "Customer updated" });
});

// [DELETE] /api/admin/customers/:id
router.delete("/:id", auth, (req, res) => {
  const customer = db.prepare("SELECT id FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

  db.prepare("DELETE FROM customers WHERE id = ?").run(customer.id); // cascades to logs
  res.json({ success: true, message: "Customer deleted" });
});

// ----- Contact history -----

// [POST] /api/admin/customers/:id/logs  { note }
router.post("/:id/logs", auth, (req, res) => {
  const customer = db.prepare("SELECT id FROM customers WHERE id = ?").get(req.params.id);
  if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

  const note = trimmed((req.body || {}).note);
  if (!note) return res.status(400).json({ success: false, message: "note is required" });

  const info = db
    .prepare("INSERT INTO customer_logs (customer_id, note) VALUES (?, ?)")
    .run(customer.id, note);

  res.status(201).json({ success: true, data: { id: info.lastInsertRowid, note } });
});

// [DELETE] /api/admin/customers/:id/logs/:logId
router.delete("/:id/logs/:logId", auth, (req, res) => {
  const log = db
    .prepare("SELECT id FROM customer_logs WHERE id = ? AND customer_id = ?")
    .get(req.params.logId, req.params.id);
  if (!log) return res.status(404).json({ success: false, message: "Log not found" });

  db.prepare("DELETE FROM customer_logs WHERE id = ?").run(log.id);
  res.json({ success: true, message: "Log deleted" });
});

module.exports = router;
