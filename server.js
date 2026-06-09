const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Подключение к SQLite через Volume
const db = new Database(process.env.SQLITE_PATH || "./database.sqlite");

// Таблицы пользователей и тестов
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    topic TEXT,
    code TEXT,
    is_open INTEGER DEFAULT 1,
    teacher_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Регистрация
app.post("/api/register", (req, res) => {
  const { name, username, password, role } = req.body;
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(400).json({ message: "Логин уже занят" });
  const info = db.prepare("INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)")
    .run(name, username, password, role);
  res.json({ id: info.lastInsertRowid, name, username, role });
});

// Логин
app.post("/api/login", (req, res) => {
  const { username, password, role } = req.body;
  const user = db.prepare("SELECT id, name, username, role FROM users WHERE username = ? AND password = ? AND role = ?")
    .get(username, password, role);
  if (!user) return res.status(401).json({ message: "Неверный логин, пароль или роль" });
  res.json(user);
});

// Получение открытых тестов
app.get("/api/tests", (req, res) => {
  const tests = db.prepare(`
    SELECT t.id, t.title, t.topic, t.code, t.is_open, t.created_at, u.name AS authorName,
      (SELECT COUNT(*) FROM questions q WHERE q.test_id = t.id) AS questionCount
    FROM tests t
    LEFT JOIN users u ON t.teacher_id = u.id
    WHERE t.is_open = 1
    ORDER BY t.created_at DESC
  `).all();
  res.json(tests);
});

// Главная страница
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});