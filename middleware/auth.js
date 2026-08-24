const jwt = require("jsonwebtoken");
const SECRET = process.env.JWT_SECRET || "change-this-secret";

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: "No token provided" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin")
    return res.status(403).json({ success: false, message: "Admin access required" });
  next();
}

module.exports = { auth, adminOnly, SECRET };
