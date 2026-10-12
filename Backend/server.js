require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const app = express();
const PORT = process.env.PORT || 5000;

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "NoteNest API is running!" });
});

app.get("/api/notes", async (req, res) => {
  try {
    const notes = await prisma.note.findMany({
      orderBy: { updatedAt: "desc" },
    });
    res.json(notes);
  } catch (error) {
    console.error("Fetch notes error:", error);
    res.status(500).json({ error: "Notes fetch nahi ho sake." });
  }
});

app.post("/api/notes", async (req, res) => {
  try {
    const { title, content } = req.body;
    const note = await prisma.note.create({
      data: { title, content },
    });
    res.status(201).json(note);
  } catch (error) {
    console.error("Create note error:", error);
    res.status(500).json({ error: "Note save nahi ho saka." });
  }
});

app.put("/api/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const note = await prisma.note.update({
      where: { id },
      data: { title, content },
    });

    res.json(note);
  } catch (error) {
    console.error("Update note error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({ error: "Note nahi mila." });
    }

    res.status(500).json({ error: "Note update nahi ho saka." });
  }
});

app.delete("/api/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const note = await prisma.note.delete({
      where: { id },
    });

    res.json({
      message: "Note successfully deleted!",
      note,
    });
  } catch (error) {
    console.error("Delete note error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({ error: "Note nahi mila." });
    }

    res.status(500).json({ error: "Note delete nahi ho saka." });
  }
});

app.listen(PORT, () => {
  console.log(`NoteNest API running at http://localhost:${PORT}`);
});
