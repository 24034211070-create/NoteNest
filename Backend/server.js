require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const app = express();
const PORT = process.env.PORT || 5000;

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  throw new Error("DATABASE_URL aur JWT_SECRET .env mein required hain.");
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Password hash aur protected content ko public responses se hide karo.
function safeNote(note) {
  const { passwordHash, ...publicNote } = note;

  if (note.isPasswordProtected) {
    publicNote.content = "";
  }

  return publicNote;
}

// Protected note ke liye valid, note-specific JWT verify karo.
function hasNoteAccess(req, noteId) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) return false;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.noteId === noteId;
  } catch {
    return false;
  }
}

async function findNote(id) {
  return prisma.note.findUnique({ where: { id } });
}

app.get("/", (req, res) => {
  res.json({ message: "NoteNest API is running!" });
});

// Notes list: protected notes ka content kabhi expose nahi hoga.
app.get("/api/notes", async (req, res) => {
  try {
    const notes = await prisma.note.findMany({
      orderBy: { updatedAt: "desc" },
    });

    res.json(notes.map(safeNote));
  } catch (error) {
    console.error("Fetch notes error:", error);
    res.status(500).json({ error: "Notes fetch nahi ho sake." });
  }
});

// Create note. New notes default mein unprotected rahengi.
app.post("/api/notes", async (req, res) => {
  try {
    const { title, content } = req.body;

    const note = await prisma.note.create({
      data: {
        title:
          typeof title === "string" && title.trim() ? title.trim() : "Untitled",
        content: typeof content === "string" ? content : "",
      },
    });

    res.status(201).json(safeNote(note));
  } catch (error) {
    console.error("Create note error:", error);
    res.status(500).json({ error: "Note save nahi ho saka." });
  }
});

// Password set/change. Existing protected note ke liye unlock token required.
app.post("/api/notes/:id/password", async (req, res) => {
  try {
    const { id } = req.params;
    const { password, confirmPassword } = req.body;

    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({
        error: "Password kam se kam 8 characters ka hona chahiye.",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        error: "Password aur Confirm Password match nahi karte.",
      });
    }

    const existing = await findNote(id);

    if (!existing) {
      return res.status(404).json({ error: "Note nahi mila." });
    }

    if (existing.isPasswordProtected && !hasNoteAccess(req, id)) {
      return res.status(401).json({
        error: "Password change karne se pehle note unlock karo.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const note = await prisma.note.update({
      where: { id },
      data: {
        isPasswordProtected: true,
        passwordHash,
      },
    });

    res.json({
      message: "Note password successfully set!",
      note: safeNote(note),
    });
  } catch (error) {
    console.error("Set password error:", error);
    res.status(500).json({ error: "Password set nahi ho saka." });
  }
});

// Unlock note. Correct password par short-lived token aur content return hoga.
app.post("/api/notes/:id/unlock", async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    const note = await findNote(id);

    if (!note) {
      return res.status(404).json({ error: "Note nahi mila." });
    }

    if (!note.isPasswordProtected || !note.passwordHash) {
      return res.status(400).json({
        error: "Is note par password protection enabled nahi hai.",
      });
    }

    if (typeof password !== "string") {
      return res.status(400).json({ error: "Password required hai." });
    }

    const matches = await bcrypt.compare(password, note.passwordHash);

    if (!matches) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const token = jwt.sign({ noteId: note.id }, process.env.JWT_SECRET, {
      expiresIn: "30m",
    });

    res.json({
      token,
      note: {
        ...safeNote(note),
        content: note.content,
      },
    });
  } catch (error) {
    console.error("Unlock note error:", error);
    res.status(500).json({ error: "Note unlock nahi ho saka." });
  }
});

// Update note. Protected note ke liye unlock token required.
app.put("/api/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const existing = await findNote(id);

    if (!existing) {
      return res.status(404).json({ error: "Note nahi mila." });
    }

    if (existing.isPasswordProtected && !hasNoteAccess(req, id)) {
      return res.status(401).json({
        error: "Note update karne se pehle unlock karo.",
      });
    }

    const data = {};

    if (typeof title === "string") data.title = title;
    if (typeof content === "string") data.content = content;

    const note = await prisma.note.update({
      where: { id },
      data,
    });

    res.json(safeNote(note));
  } catch (error) {
    console.error("Update note error:", error);
    res.status(500).json({ error: "Note update nahi ho saka." });
  }
});

// Password remove karne ke liye protected note unlock hona chahiye.
app.delete("/api/notes/:id/password", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await findNote(id);

    if (!existing) {
      return res.status(404).json({ error: "Note nahi mila." });
    }

    if (existing.isPasswordProtected && !hasNoteAccess(req, id)) {
      return res.status(401).json({
        error: "Password remove karne se pehle note unlock karo.",
      });
    }

    const note = await prisma.note.update({
      where: { id },
      data: {
        isPasswordProtected: false,
        passwordHash: null,
      },
    });

    res.json({
      message: "Note password removed.",
      note: safeNote(note),
    });
  } catch (error) {
    console.error("Remove password error:", error);
    res.status(500).json({ error: "Password remove nahi ho saka." });
  }
});

// Delete note. Protected note ke liye unlock token required.
app.delete("/api/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await findNote(id);

    if (!existing) {
      return res.status(404).json({ error: "Note nahi mila." });
    }

    if (existing.isPasswordProtected && !hasNoteAccess(req, id)) {
      return res.status(401).json({
        error: "Note delete karne se pehle unlock karo.",
      });
    }

    await prisma.note.delete({ where: { id } });

    res.json({ message: "Note successfully deleted!" });
  } catch (error) {
    console.error("Delete note error:", error);
    res.status(500).json({ error: "Note delete nahi ho saka." });
  }
});

app.listen(PORT, () => {
  console.log(`NoteNest API running at http://localhost:${PORT}`);
});
