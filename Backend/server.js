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

// CORS CONFIGURATION
const allowedOrigins = [
  "http://localhost:5173",
  "https://notenest-owd2.onrender.com",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  }),
);

app.use(express.json({ limit: "1mb" }));

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

app.disable("x-powered-by");
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

function normalizeSlug(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
}

function safeNote(note) {
  const { passwordHash, ...publicNote } = note;
  if (note.isPasswordProtected) publicNote.content = "";
  return publicNote;
}

function adminSafeNote(note) {
  const { passwordHash, ...adminNote } = note;
  return adminNote;
}

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

function requireSuperAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({
      error: "Admin login required hai.",
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.role !== "superadmin" || payload.tokenType !== "admin") {
      return res.status(403).json({
        error: "Admin access denied.",
      });
    }

    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({
      error: "Admin token invalid ya expire ho gaya. Dobara login karo.",
    });
  }
}

async function findNote(id) {
  return prisma.note.findUnique({ where: { id } });
}

app.get("/", (req, res) => {
  res.json({ message: "NoteNest API is running!" });
});

// SUPER ADMIN LOGIN
app.post("/api/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

    if (!adminUsername || !adminPasswordHash) {
      console.error("Admin credentials environment mein configured nahi hain.");
      return res.status(500).json({
        error: "Admin login configure nahi hai.",
      });
    }

    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({
        error: "Username aur password required hain.",
      });
    }

    const usernameMatches = username === adminUsername;
    const passwordMatches = await bcrypt.compare(password, adminPasswordHash);

    if (!usernameMatches || !passwordMatches) {
      return res.status(401).json({
        error: "Username ya password galat hai.",
      });
    }

    const token = jwt.sign(
      { role: "superadmin", tokenType: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "2h" },
    );

    return res.json({
      message: "Login successful!",
      token,
      expiresIn: 7200,
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({
      error: "Login nahi ho saka.",
    });
  }
});

// ADMIN TOKEN VERIFY
app.get("/api/admin/verify", requireSuperAdmin, (req, res) => {
  res.json({
    authenticated: true,
    role: "superadmin",
  });
});

// ADMIN: ALL NOTES
app.get("/api/admin/notes", requireSuperAdmin, async (req, res) => {
  try {
    const notes = await prisma.note.findMany({
      orderBy: { updatedAt: "desc" },
    });
    res.json(notes.map(adminSafeNote));
  } catch (error) {
    console.error("Admin fetch notes error:", error);
    res.status(500).json({
      error: "Admin notes fetch nahi ho sake.",
    });
  }
});

// ADMIN: NOTE DETAILS
app.get("/api/admin/notes/:id", requireSuperAdmin, async (req, res) => {
  try {
    const note = await findNote(req.params.id);

    if (!note) {
      return res.status(404).json({ error: "Note nahi mila." });
    }

    res.json(adminSafeNote(note));
  } catch (error) {
    console.error("Admin note detail error:", error);
    res.status(500).json({
      error: "Note fetch nahi ho saka.",
    });
  }
});

app.delete("/api/admin/notes/:id", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await findNote(id);

    if (!existing) {
      return res.status(404).json({ error: "Note nahi mila." });
    }

    await prisma.note.delete({ where: { id } });

    return res.json({ message: "Note successfully deleted!" });
  } catch (error) {
    console.error("Admin delete note error:", error);
    return res.status(500).json({
      error: "Note delete nahi ho saka.",
    });
  }
});

// PUBLIC NOTES LIST
app.get("/api/notes", async (req, res) => {
  try {
    const notes = await prisma.note.findMany({
      orderBy: { updatedAt: "desc" },
    });
    res.json(notes.map(safeNote));
  } catch (error) {
    console.error("Fetch notes error:", error);
    res.status(500).json({
      error: "Notes fetch nahi ho sake.",
    });
  }
});

// GET OR CREATE NOTE BY SLUG
app.get("/api/notes/by-slug/:slug", async (req, res) => {
  try {
    const slug = normalizeSlug(req.params.slug);

    if (!slug) {
      return res.status(400).json({
        error: "Valid URL slug required hai.",
      });
    }

    let note = await prisma.note.findUnique({ where: { slug } });

    if (note) return res.json(safeNote(note));

    try {
      note = await prisma.note.create({
        data: { slug, title: "Untitled", content: "" },
      });
      return res.status(201).json(safeNote(note));
    } catch (createError) {
      if (createError.code === "P2002") {
        note = await prisma.note.findUnique({ where: { slug } });
        if (note) return res.json(safeNote(note));
      }
      throw createError;
    }
  } catch (error) {
    console.error("Get/create note by slug error:", error);
    res.status(500).json({
      error: "URL se note fetch ya create nahi ho saka.",
    });
  }
});

// CREATE NOTE
app.post("/api/notes", async (req, res) => {
  try {
    const { title, content } = req.body || {};

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
    res.status(500).json({
      error: "Note save nahi ho saka.",
    });
  }
});

// CHANGE NOTE SLUG
app.put("/api/notes/:id/slug", async (req, res) => {
  try {
    const { id } = req.params;
    const slug = normalizeSlug(req.body?.slug);
    if (!slug) {
      return res.status(400).json({
        error: "Valid URL slug enter karo.",
      });
    }

    const existing = await findNote(id);
    if (!existing) {
      return res.status(404).json({ error: "Note nahi mila." });
    }

    if (existing.isPasswordProtected && !hasNoteAccess(req, id)) {
      return res.status(401).json({
        error: "URL change karne se pehle note unlock karo.",
      });
    }

    const slugOwner = await prisma.note.findUnique({ where: { slug } });
    if (slugOwner && slugOwner.id !== id) {
      return res.status(409).json({
        error: "Yeh URL pehle se kisi doosre note ko diya gaya hai.",
      });
    }

    const note = await prisma.note.update({
      where: { id },
      data: { slug },
    });

    res.json(safeNote(note));
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        error: "Yeh URL pehle se use ho raha hai.",
      });
    }
    console.error("Change note slug error:", error);
    res.status(500).json({
      error: "Note URL change nahi ho saka.",
    });
  }
});

// SET OR CHANGE NOTE PASSWORD
app.post("/api/notes/:id/password", async (req, res) => {
  try {
    const { id } = req.params;
    const { password, confirmPassword } = req.body || {};

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
      data: { isPasswordProtected: true, passwordHash },
    });

    res.json({
      message: "Note password successfully set!",
      note: safeNote(note),
    });
  } catch (error) {
    console.error("Set password error:", error);
    res.status(500).json({
      error: "Password set nahi ho saka.",
    });
  }
});

// UNLOCK NOTE
app.post("/api/notes/:id/unlock", async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};
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
      note: { ...safeNote(note), content: note.content },
    });
  } catch (error) {
    console.error("Unlock note error:", error);
    res.status(500).json({
      error: "Note unlock nahi ho saka.",
    });
  }
});

// UPDATE NOTE / AUTOSAVE
app.put("/api/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body || {};
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
    res.status(500).json({
      error: "Note update nahi ho saka.",
    });
  }
});

// REMOVE NOTE PASSWORD
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
      data: { isPasswordProtected: false, passwordHash: null },
    });

    res.json({
      message: "Note password removed.",
      note: safeNote(note),
    });
  } catch (error) {
    console.error("Remove password error:", error);
    res.status(500).json({
      error: "Password remove nahi ho saka.",
    });
  }
});

// DELETE PUBLIC NOTE
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
    res.status(500).json({
      error: "Note delete nahi ho saka.",
    });
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`NoteNest API running on port ${PORT}`);
});
