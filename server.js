const express = require("express");
const sql = require("mssql");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

async function getPool() {
  return await sql.connect(dbConfig);
}

// Регистрация
app.post("/api/register", async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password || !role) {
      return res.status(400).json({ message: "Заполните все поля" });
    }
    if (!["teacher", "student"].includes(role)) {
      return res.status(400).json({ message: "Неверная роль" });
    }
    const pool = await getPool();
    const exists = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT id FROM users WHERE username = @username");

    if (exists.recordset.length > 0) {
      return res.status(400).json({ message: "Логин уже занят" });
    }

    const result = await pool.request()
      .input("name", sql.NVarChar, name)
      .input("username", sql.NVarChar, username)
      .input("password", sql.NVarChar, password)
      .input("role", sql.NVarChar, role)
      .query(`
        INSERT INTO users (name, username, password, role)
        OUTPUT INSERTED.id, INSERTED.name, INSERTED.username, INSERTED.role
        VALUES (@name, @username, @password, @role)
      `);

    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Логин
app.post("/api/login", async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const pool = await getPool();
    const result = await pool.request()
      .input("username", sql.NVarChar, username)
      .input("password", sql.NVarChar, password)
      .input("role", sql.NVarChar, role)
      .query(`
        SELECT id, name, username, role
        FROM users
        WHERE username = @username
        AND password = @password
        AND role = @role
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ message: "Неверный логин, пароль или роль" });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Генерация теста через Groq API
app.post("/api/generate-test", async (req, res) => {
  try {
    const { apiKey, topic, context, count, language, difficulty, qtype } = req.body;
    if (!apiKey) return res.status(400).json({ message: "API-ключ Groq не указан" });
    if (!topic) return res.status(400).json({ message: "Тема не указана" });

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
      "options": ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"],
      "correct": 0,
      "hint": "Пояснение"
    }
  ]
}
`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(500).json({ message: data.error?.message || "Ошибка Groq API" });
    }

    let text = data.choices?.[0]?.message?.content || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const test = JSON.parse(text);

    if (!test.questions || !Array.isArray(test.questions)) {
      return res.status(500).json({ message: "Groq вернул неверный формат теста" });
    }

    res.json(test);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Получить открытые тесты
app.get("/api/tests", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT t.id, t.title, t.topic, t.code, t.is_open, t.created_at, u.name AS authorName,
      COUNT(q.id) AS questionCount
      FROM tests t
      JOIN users u ON t.teacher_id = u.id
      LEFT JOIN questions q ON q.test_id = t.id
      WHERE t.is_open = 1
      GROUP BY t.id, t.title, t.topic, t.code, t.is_open, t.created_at, u.name
      ORDER BY t.created_at DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Остальные маршруты (my-tests, add test, test by id/code, results)
app.get("/api/my-tests/:teacherId", async (req, res) => { /* ... оставляем без изменений ... */ });
app.post("/api/tests", async (req, res) => { /* ... оставляем без изменений ... */ });
app.get("/api/test/:id", async (req, res) => { /* ... оставляем без изменений ... */ });
app.get("/api/test/code/:code", async (req, res) => { /* ... оставляем без изменений ... */ });
app.post("/api/results", async (req, res) => { /* ... оставляем без изменений ... */ });
app.get("/api/results/teacher/:teacherId", async (req, res) => { /* ... оставляем без изменений ... */ });
app.get("/api/results/student/:studentId", async (req, res) => { /* ... оставляем без изменений ... */ });
app.patch("/api/tests/:id/open", async (req, res) => { /* ... оставляем без изменений ... */ });

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});