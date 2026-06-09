const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
require("dotenv").config();
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Подключение SQLite через Volume
const db = new Database(process.env.SQLITE_PATH || "./database.sqlite");

// Создание таблиц
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

// Регистрация
app.post("/api/register", (req, res) => {
  const { name, username, password, role } = req.body;
  if (!name || !username || !password || !role) return res.status(400).json({ message: "Заполните все поля" });
  if (!["teacher","student"].includes(role)) return res.status(400).json({ message: "Неверная роль" });

  const exists = db.prepare("SELECT id FROM users WHERE username=?").get(username);
  if (exists) return res.status(400).json({ message: "Логин уже занят" });

  const info = db.prepare("INSERT INTO users (name, username, password, role) VALUES (?,?,?,?)")
    .run(name, username, password, role);
  res.json({ id: info.lastInsertRowid, name, username, role });
});

// Логин
app.post("/api/login", (req, res) => {
  const { username, password, role } = req.body;
  const user = db.prepare("SELECT id,name,username,role FROM users WHERE username=? AND password=? AND role=?")
    .get(username,password,role);
  if (!user) return res.status(401).json({ message: "Неверный логин, пароль или роль" });
  res.json(user);
});

// Создание теста через Groq API
app.post("/api/generate-test", async (req,res)=>{
  try{
    const { apiKey, topic, context, count, language, difficulty, qtype } = req.body;
    const key = apiKey || process.env.GROQ_API_KEY;
    if (!key) return res.status(400).json({message:"API ключ Groq не указан"});
    if (!topic) return res.status(400).json({message:"Тема не указана"});

    const prompt = `
Создай учебный тест.
Тема: ${topic}
Контекст: ${context || "нет"}
Количество вопросов: ${count || 5}
Язык: ${language || "ru"}
Сложность: ${difficulty || "medium"}
Тип вопросов: ${qtype || "multiple_choice"}

Верни строго JSON без markdown и лишнего текста.

Формат:
{
  "title": "Название теста",
  "topic": "${topic}",
  "questions": [
    {
      "text": "Вопрос",
      "options": ["Вариант 1","Вариант 2","Вариант 3","Вариант 4"],
      "correct": 0,
      "hint": "Пояснение"
    }
  ]
}
`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model:"llama-3.3-70b-versatile",
        messages:[{role:"user",content:prompt}],
        temperature:0.7,
        response_format:{type:"json_object"}
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({message:data.error?.message || "Ошибка Groq API"});

    let text = data.choices?.[0]?.message?.content || "";
    text = text.replace(/```json/g,"").replace(/```/g,"").trim();
    const test = JSON.parse(text);

    if (!test.questions || !Array.isArray(test.questions)) return res.status(500).json({message:"Groq вернул неверный формат теста"});
    res.json(test);

  }catch(err){
    res.status(500).json({message:err.message});
  }
});

// Получить открытые тесты
app.get("/api/tests",(req,res)=>{
  const tests = db.prepare(`
    SELECT t.id,t.title,t.topic,t.code,t.is_open,t.created_at,u.name AS authorName,
      (SELECT COUNT(*) FROM questions q WHERE q.test_id=t.id) AS questionCount
    FROM tests t
    LEFT JOIN users u ON t.teacher_id=u.id
    WHERE t.is_open=1
    ORDER BY t.created_at DESC
  `).all();
  res.json(tests);
});

// Главная
app.get("/",(req,res)=>{
  res.sendFile(__dirname + "/public/index.html");
});

app.listen(PORT,()=>console.log(`Сервер запущен на порту ${PORT}`));
