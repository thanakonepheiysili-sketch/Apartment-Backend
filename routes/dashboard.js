const express = require("express");
const db = require("../config/db");
const { auth } = require("../middleware/auth");

const router = express.Router();
router.use(auth);

const count = (sql) => db.prepare(sql).get().c;

function overdueMonths(from) {
  if (!from) return 0;
  const start = new Date(from);
  const now = new Date();
  let m = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) m -= 1;
  return Math.max(0, m);
}

// ---------- Individual counters (as per spec) ----------

// [GET] /api/admin/dashboard/total — all rooms
router.get("/total", (req, res) =>
  res.json({ success: true, data: { total: count("SELECT COUNT(*) AS c FROM rooms") } })
);

// [GET] /api/admin/dashboard/available — available rooms
router.get("/available", (req, res) =>
  res.json({
    success: true,
    data: { available: count("SELECT COUNT(*) AS c FROM rooms WHERE available = 1") },
  })
);

// [GET] /api/admin/dashboard/not-paid — not paid yet
router.get("/not-paid", (req, res) =>
  res.json({
    success: true,
    data: { notPaid: count("SELECT COUNT(*) AS c FROM rooms WHERE status = 0") },
  })
);

// [GET] /api/admin/dashboard/paid — already paid
router.get("/paid", (req, res) =>
  res.json({
    success: true,
    data: { paid: count("SELECT COUNT(*) AS c FROM rooms WHERE status = 1") },
  })
);

// ---------- Everything in a single endpoint ----------

// [GET] /api/admin/dashboard
router.get("/", (req, res) => {
  const total = count("SELECT COUNT(*) AS c FROM rooms");
  const available = count("SELECT COUNT(*) AS c FROM rooms WHERE available = 1");
  const notPaid = count("SELECT COUNT(*) AS c FROM rooms WHERE status = 0");
  const paid = count("SELECT COUNT(*) AS c FROM rooms WHERE status = 1");

  // Occupancy rate = occupied rooms / total rooms (%)
  const occupied = total - available;
  const occupancyRate = total > 0 ? Math.round((occupied / total) * 1000) / 10 : 0;

  // Income collected this month, taken from the payment history
  const incomeThisMonth = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS s FROM payments
       WHERE strftime('%Y-%m', paidDate) = strftime('%Y-%m', 'now')`
    )
    .get().s;

  // Total outstanding = sum of the bills of every unpaid room
  const outstanding = db
    .prepare(
      `SELECT COALESCE(SUM(b.total), 0) AS s FROM bills b
       JOIN rooms r ON r.id = b.room_id WHERE r.status = 0`
    )
    .get().s;

  // Income over the last 6 months (ready to be charted)
  const incomeHistory = db
    .prepare(
      `SELECT strftime('%Y-%m', paidDate) AS month, SUM(total) AS income
       FROM payments
       WHERE paidDate >= date('now', 'start of month', '-5 months')
       GROUP BY month ORDER BY month`
    )
    .all();

  // Leases expiring within 30 days
  const expiringLeases = db
    .prepare(
      `SELECT l.room_id AS roomId, r.name, l.startDate, l.endDate,
              CAST(julianday(l.endDate) - julianday('now') AS INTEGER) AS daysLeft
       FROM leases l JOIN rooms r ON r.id = l.room_id
       WHERE julianday(l.endDate) - julianday('now') BETWEEN 0 AND 30
       ORDER BY l.endDate`
    )
    .all();

  // Top 5 rooms with the longest overdue period
  const topOverdue = db
    .prepare(
      `SELECT r.id AS roomId, r.name, COALESCE(b.lastPaidDate, l.startDate) AS since
       FROM rooms r
       LEFT JOIN bills b ON b.room_id = r.id
       LEFT JOIN leases l ON l.room_id = r.id
       WHERE r.status = 0`
    )
    .all()
    .map((r) => ({ roomId: r.roomId, name: r.name, overdue: overdueMonths(r.since) }))
    .sort((a, b) => b.overdue - a.overdue)
    .slice(0, 5);

  // The 5 most recent payments
  const recentPayments = db
    .prepare(
      `SELECT p.room_id AS roomId, r.name, p.total, p.paidDate
       FROM payments p JOIN rooms r ON r.id = p.room_id
       ORDER BY p.id DESC LIMIT 5`
    )
    .all();

  // Breakdown by room type
  const roomTypeBreakdown = {
    type0: count("SELECT COUNT(*) AS c FROM rooms WHERE roomType = 0"),
    type1: count("SELECT COUNT(*) AS c FROM rooms WHERE roomType = 1"),
  };

  const totalTenants = count("SELECT COUNT(*) AS c FROM tenants");

  res.json({
    success: true,
    data: {
      totalApartments: total,
      availableApartments: available,
      notPaidApartments: notPaid,
      paidApartments: paid,
      occupancyRate,          // %
      incomeThisMonth,        // collected so far this month
      outstanding,            // total outstanding amount
      incomeHistory,          // [{month, income}] for 6 months
      expiringLeases,         // leases expiring within 30 days
      topOverdue,             // 5 rooms overdue the longest
      recentPayments,         // 5 most recent payments
      roomTypeBreakdown,
      totalTenants,
    },
  });
});

module.exports = router;
