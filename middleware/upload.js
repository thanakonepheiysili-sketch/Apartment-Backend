const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname).toLowerCase());
  },
});

const fileFilter = (req, file, cb) => {
  const ok = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.originalname);
  cb(ok ? null : new Error("Only image files are allowed"), ok);
};

// cover: 1 file, images: max 3 files
const roomUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: "cover", maxCount: 1 },
  { name: "images", maxCount: 3 },
]);

// banner: 1 image
const bannerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("image");

module.exports = { roomUpload, bannerUpload, uploadDir };
