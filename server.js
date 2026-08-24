require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

require("./config/db"); // init database

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// serve uploaded images
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ---------- Public (website) ----------
app.use("/api", require("./routes/public"));

// ---------- Admin ----------
app.use("/api/admin", require("./routes/auth"));           // login + user management
app.use("/api/admin/dashboard", require("./routes/dashboard"));
app.use("/api/admin/rooms", require("./routes/rooms"));    // manage website rooms
app.use("/api/admin/banners", require("./routes/banners"));
app.use("/api/admin/locations", require("./routes/locations"));
app.use("/api/admin/report", require("./routes/report"));
app.use("/api/admin/contact", require("./routes/contact"));

app.get("/", (req, res) =>
  res.json({ success: true, message: "Apartment Booking API is running" })
);

// 404
app.use((req, res) => res.status(404).json({ success: false, message: "Route not found" }));

// error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
