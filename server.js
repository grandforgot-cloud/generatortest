const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const db = new Database(process.env.SQLITE_PATH || "./database.sqlite");

// Создание таблицы пользователей, если нет
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL
  )
`).run();

app.post("/api/register", (req, res) => {
  const { name, username, password, role } = req.body;
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(400).json({ message: "Логин уже занят" });
  const info = db.prepare("INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)")
    .run(name, username, password, role);
  res.json({ id: info.lastInsertRowid, name, username, role });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});