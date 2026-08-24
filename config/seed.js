const bcrypt = require("bcryptjs");
const db = require("./db");

// Default admin: phone 0201234567 / password admin123
const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
if (!admin) {
  db.prepare("INSERT INTO users (phone, password, role) VALUES (?, ?, 'admin')")
    .run("0201234567", bcrypt.hashSync("admin123", 10));
  console.log("Admin created -> phone: 0201234567, password: admin123");
} else {
  console.log("Admin already exists, skipping.");
}

// Default contact
const contact = db.prepare("SELECT id FROM contacts").get();
if (!contact) {
  db.prepare("INSERT INTO contacts (tel, email, link) VALUES (?, ?, ?)")
    .run("02055512345", "owner@example.com", "https://wa.me/8562055512345");
  console.log("Default contact created.");
}

console.log("Seed done.");
