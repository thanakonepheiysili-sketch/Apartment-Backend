const db = require("../config/db");

// Called when a room's status flips Not paid -> Paid:
// 1) save the current bill into payment history
// 2) reset the bill for next month
function recordPaymentAndResetBill(roomId) {
  const bill = db.prepare("SELECT * FROM bills WHERE room_id = ?").get(roomId);
  if (bill && bill.total > 0) {
    db.prepare(
      `INSERT INTO payments (room_id, roomPrice, electricityPrice, waterPrice, wasteFees, total)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(roomId, bill.roomPrice, bill.electricityPrice, bill.waterPrice, bill.wasteFees, bill.total);
  }
  db.prepare(
    `UPDATE bills SET roomPrice = 0, electricityPrice = 0, waterPrice = 0,
     wasteFees = 0, total = 0, lastPaidDate = date('now') WHERE room_id = ?`
  ).run(roomId);
}

module.exports = { recordPaymentAndResetBill };
