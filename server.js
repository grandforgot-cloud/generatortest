const express = require("express");
const sql = require("mssql/msnodesqlv8");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

const dbConfig = {
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_DATABASE || "testai_db",
  driver: "msnodesqlv8",
  options: {
    trustedConnection: true,
    trustServerCertificate: true
  }
};

async function getPool() {
  return await sql.connect(dbConfig);
}

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

app.post("/api/generate-test", async (req, res) => {
  try {
    const { apiKey, topic, context, count, language, difficulty, qtype } = req.body;

    if (!apiKey) {
      return res.status(400).json({ message: "API-ключ Groq не указан" });
    }

    if (!topic) {
      return res.status(400).json({ message: "Тема не указана" });
    }

    const prompt = `
Создай учебный тест.

Тема: ${topic}
Контекст: ${context || "нет"}
Количество вопросов: ${count || 5}
Язык: ${language || "ru"}
Сложность: ${difficulty || "medium"}
Тип вопросов: ${qtype || "multiple_choice"}

Верни строго JSON без markdown, без пояснений и без лишнего текста.

Формат:
{
  "title": "Название теста",
  "topic": "${topic}",
  "questions": [
    {
      "text": "Текст вопроса",
      "options": ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"],
      "correct": 0,
      "hint": "Краткое пояснение правильного ответа"
    }
  ]
}

Важно:
- correct — это индекс правильного ответа, начиная с 0.
- options должно быть массивом.
- questions должно содержать ровно ${count || 5} вопросов.
- JSON должен быть валидным, без текста до и после.
`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        message: data.error?.message || "Ошибка Groq API"
      });
    }

    let text = data.choices?.[0]?.message?.content || "";

    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const test = JSON.parse(text);

    if (!test.questions || !Array.isArray(test.questions)) {
      return res.status(500).json({ message: "Groq вернул неверный формат теста" });
    }

    res.json(test);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/tests", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT 
        t.id,
        t.title,
        t.topic,
        t.code,
        t.is_open,
        t.created_at,
        u.name AS authorName,
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

app.get("/api/my-tests/:teacherId", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input("teacherId", sql.Int, req.params.teacherId)
      .query(`
        SELECT 
          t.id,
          t.title,
          t.topic,
          t.code,
          t.is_open,
          t.created_at,
          COUNT(q.id) AS questionCount
        FROM tests t
        LEFT JOIN questions q ON q.test_id = t.id
        WHERE t.teacher_id = @teacherId
        GROUP BY t.id, t.title, t.topic, t.code, t.is_open, t.created_at
        ORDER BY t.created_at DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/tests", async (req, res) => {
  try {
    const { teacherId, title, topic, questions } = req.body;

    if (!teacherId || !title || !questions || !Array.isArray(questions)) {
      return res.status(400).json({ message: "Некорректные данные теста" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      const testResult = await new sql.Request(transaction)
        .input("teacherId", sql.Int, teacherId)
        .input("title", sql.NVarChar, title)
        .input("topic", sql.NVarChar, topic || "")
        .input("code", sql.NVarChar, code)
        .query(`
          INSERT INTO tests (teacher_id, title, topic, code)
          OUTPUT INSERTED.id, INSERTED.code
          VALUES (@teacherId, @title, @topic, @code)
        `);

      const testId = testResult.recordset[0].id;

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];

        const questionResult = await new sql.Request(transaction)
          .input("testId", sql.Int, testId)
          .input("questionText", sql.NVarChar, q.text)
          .input("correctOption", sql.Int, Number(q.correct))
          .input("hint", sql.NVarChar, q.hint || "")
          .input("positionNum", sql.Int, i + 1)
          .query(`
            INSERT INTO questions 
            (test_id, question_text, correct_option, hint, position_num)
            OUTPUT INSERTED.id
            VALUES 
            (@testId, @questionText, @correctOption, @hint, @positionNum)
          `);

        const questionId = questionResult.recordset[0].id;

        for (let j = 0; j < q.options.length; j++) {
          await new sql.Request(transaction)
            .input("questionId", sql.Int, questionId)
            .input("optionText", sql.NVarChar, q.options[j])
            .input("positionNum", sql.Int, j)
            .query(`
              INSERT INTO options 
              (question_id, option_text, position_num)
              VALUES 
              (@questionId, @optionText, @positionNum)
            `);
        }
      }

      await transaction.commit();

      res.json({
        id: testId,
        code,
        message: "Тест сохранён"
      });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/test/:id", async (req, res) => {
  try {
    const pool = await getPool();

    const testResult = await pool.request()
      .input("id", sql.Int, req.params.id)
      .query(`
        SELECT 
          t.id,
          t.title,
          t.topic,
          t.code,
          t.is_open,
          t.created_at,
          u.name AS authorName
        FROM tests t
        JOIN users u ON t.teacher_id = u.id
        WHERE t.id = @id
      `);

    if (testResult.recordset.length === 0) {
      return res.status(404).json({ message: "Тест не найден" });
    }

    const test = testResult.recordset[0];

    const questionsResult = await pool.request()
      .input("testId", sql.Int, test.id)
      .query(`
        SELECT *
        FROM questions
        WHERE test_id = @testId
        ORDER BY position_num
      `);

    const questions = [];

    for (const q of questionsResult.recordset) {
      const optionsResult = await pool.request()
        .input("questionId", sql.Int, q.id)
        .query(`
          SELECT option_text
          FROM options
          WHERE question_id = @questionId
          ORDER BY position_num
        `);

      questions.push({
        id: q.id,
        text: q.question_text,
        correct: q.correct_option,
        hint: q.hint,
        options: optionsResult.recordset.map(o => o.option_text)
      });
    }

    test.questions = questions;

    res.json(test);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/test/code/:code", async (req, res) => {
  try {
    const pool = await getPool();

    const found = await pool.request()
      .input("code", sql.NVarChar, req.params.code)
      .query("SELECT id FROM tests WHERE code = @code AND is_open = 1");

    if (found.recordset.length === 0) {
      return res.status(404).json({ message: "Тест не найден или закрыт" });
    }

    req.params.id = found.recordset[0].id;

    const testResult = await pool.request()
      .input("id", sql.Int, req.params.id)
      .query(`
        SELECT 
          t.id,
          t.title,
          t.topic,
          t.code,
          t.is_open,
          t.created_at,
          u.name AS authorName
        FROM tests t
        JOIN users u ON t.teacher_id = u.id
        WHERE t.id = @id
      `);

    const test = testResult.recordset[0];

    const questionsResult = await pool.request()
      .input("testId", sql.Int, test.id)
      .query(`
        SELECT *
        FROM questions
        WHERE test_id = @testId
        ORDER BY position_num
      `);

    const questions = [];

    for (const q of questionsResult.recordset) {
      const optionsResult = await pool.request()
        .input("questionId", sql.Int, q.id)
        .query(`
          SELECT option_text
          FROM options
          WHERE question_id = @questionId
          ORDER BY position_num
        `);

      questions.push({
        id: q.id,
        text: q.question_text,
        correct: q.correct_option,
        hint: q.hint,
        options: optionsResult.recordset.map(o => o.option_text)
      });
    }

    test.questions = questions;

    res.json(test);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/results", async (req, res) => {
  try {
    const { testId, studentId, score, total, percentResult, answers } = req.body;

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      const resultInsert = await new sql.Request(transaction)
        .input("testId", sql.Int, testId)
        .input("studentId", sql.Int, studentId)
        .input("score", sql.Int, score)
        .input("total", sql.Int, total)
        .input("percentResult", sql.Int, percentResult)
        .query(`
          INSERT INTO results 
          (test_id, student_id, score, total, percent_result)
          OUTPUT INSERTED.id
          VALUES 
          (@testId, @studentId, @score, @total, @percentResult)
        `);

      const resultId = resultInsert.recordset[0].id;

      if (answers && Array.isArray(answers)) {
        for (const answer of answers) {
          await new sql.Request(transaction)
            .input("resultId", sql.Int, resultId)
            .input("questionId", sql.Int, answer.questionId)
            .input("selectedOption", sql.Int, answer.selectedOption)
            .input("isCorrect", sql.Bit, answer.isCorrect)
            .query(`
              INSERT INTO result_answers 
              (result_id, question_id, selected_option, is_correct)
              VALUES 
              (@resultId, @questionId, @selectedOption, @isCorrect)
            `);
        }
      }

      await transaction.commit();

      res.json({
        id: resultId,
        message: "Результат сохранён"
      });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/results/teacher/:teacherId", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input("teacherId", sql.Int, req.params.teacherId)
      .query(`
        SELECT 
          r.id,
          r.score,
          r.total,
          r.percent_result,
          r.created_at,
          s.name AS studentName,
          t.title AS testTitle
        FROM results r
        JOIN users s ON r.student_id = s.id
        JOIN tests t ON r.test_id = t.id
        WHERE t.teacher_id = @teacherId
        ORDER BY r.created_at DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/results/student/:studentId", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input("studentId", sql.Int, req.params.studentId)
      .query(`
        SELECT 
          r.id,
          r.score,
          r.total,
          r.percent_result,
          r.created_at,
          t.title AS testTitle,
          t.topic
        FROM results r
        JOIN tests t ON r.test_id = t.id
        WHERE r.student_id = @studentId
        ORDER BY r.created_at DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/tests/:id/open", async (req, res) => {
  try {
    const { isOpen } = req.body;

    const pool = await getPool();

    await pool.request()
      .input("id", sql.Int, req.params.id)
      .input("isOpen", sql.Bit, isOpen)
      .query(`
        UPDATE tests
        SET is_open = @isOpen
        WHERE id = @id
      `);

    res.json({ message: "Статус теста изменён" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
