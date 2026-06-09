const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// Подключение SQLite через Volume
const db = new Database(process.env.SQLITE_PATH || "./database.sqlite");

// Создание таблиц, если их нет
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

db.prepare(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER,
    text TEXT,
    options TEXT,
    correct INTEGER,
    hint TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    test_id INTEGER,
    score INTEGER,
    answers TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// ----------------- Маршруты -----------------

// Регистрация
app.post("/api/register", (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password || !role)
      return res.status(400).json({ message: "Заполните все поля" });
    if (!["teacher", "student"].includes(role))
      return res.status(400).json({ message: "Неверная роль" });

    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (exists) return res.status(400).json({ message: "Логин уже занят" });

    const stmt = db.prepare("INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)");
    const info = stmt.run(name, username, password, role);

    res.json({ id: info.lastInsertRowid, name, username, role });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Логин
app.post("/api/login", (req, res) => {
  try {
    const { username, password, role } = req.body;
    const user = db.prepare("SELECT id, name, username, role FROM users WHERE username = ? AND password = ? AND role = ?")
      .get(username, password, role);

    if (!user) return res.status(401).json({ message: "Неверный логин, пароль или роль" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Получение открытых тестов
app.get("/api/tests", (req, res) => {
  try {
    const tests = db.prepare(`
      SELECT t.id, t.title, t.topic, t.code, t.is_open, t.created_at, u.name AS authorName,
        (SELECT COUNT(*) FROM questions q WHERE q.test_id = t.id) AS questionCount
      FROM tests t
      LEFT JOIN users u ON t.teacher_id = u.id
      WHERE t.is_open = 1
      ORDER BY t.created_at DESC
    `).all();
    res.json(tests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Главная страница
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});