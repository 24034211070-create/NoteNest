require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const app = express();
const PORT = process.env.PORT || 5000;

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  throw new Error("DATABASE_URL aur JWT_SECRET .env mein required hain.");
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET kam se kam 32 characters ka hona chahiye.");
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Production mein FRONTEND_URL mein deployed frontend origin set karo.
const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    ...(process.env.NODE_ENV !== "production"
      ? ["http://localhost:5173", "http://localhost:3000"]
      : []),
  ]
    .filter(Boolean)
    .map((origin) => origin.replace(/\/$/, "")),
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }
      return callback(new Error("Origin allowed nahi hai."));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Simple per-process rate limiter.
// Multiple backend instances ke liye shared Redis/database limiter use karo.
const rateBuckets = new Map();

function rateLimit({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const now = Date.now();
    const ip = (req.ip || req.socket.remoteAddress || "unknown").slice(0, 100);
    const key = `${keyPrefix}:${ip}`;
    let bucket = rateBuckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
    }

    bucket.count += 1;
    rateBuckets.set(key, bucket);

    if (rateBuckets.size > 10000) {
      for (const [k, v] of rateBuckets) {
        if (now >= v.resetAt) rateBuckets.delete(k);
      }
    }

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, max - bucket.count)),
    );

    if (bucket.count > max) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((bucket.resetAt - now) / 1000)),
      );
      return res.status(429).json({
        error: "Bahut zyada requests. Thodi der baad dobara try karo.",
      });
    }

    next();
  };
}

const adminLoginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: "admin-login",
});

const noteUnlockLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "note-unlock",
});

// SINGLE ACTIVE SUPER ADMIN SESSION.
// Session maximum 2 hours tak active rahega.
// In-memory session server restart par reset hoti hai.
// Multiple backend instances ke liye shared persistent storage zaroori hai.
let activeAdminJti = null;
let activeAdminExpiresAt = 0;

// Concurrent login requests ko ek saath session create karne se roko.
let adminLoginInProgress = false;

function clearActiveAdminSession() {
  activeAdminJti = null;
  activeAdminExpiresAt = 0;
}

// Slug normalization
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

// Public responses: password hash aur protected content hide karo.
function safeNote(note) {
  const { passwordHash, ...publicNote } = note;
  if (note.isPasswordProtected) publicNote.content = "";
  return publicNote;
}

// Admin response: complete note content, lekin password hash nahi.
function adminSafeNote(note) {
  const { passwordHash, ...adminNote } = note;
  return adminNote;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

// Note unlock token verification.
function hasNoteAccess(req, noteId) {
  const token = getBearerToken(req);
  if (!token) return false;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.tokenType === "note_unlock" && payload.noteId === noteId;
  } catch {
    return false;
  }
}

// Admin authentication + role authorization + single active session.
function requireSuperAdmin(req, res, next) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({
      error: "Admin login required hai.",
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (
      payload.role !== "superadmin" ||
      payload.tokenType !== "admin" ||
      typeof payload.jti !== "string"
    ) {
      return res.status(403).json({
        error: "Admin access denied.",
      });
    }

    // Session expire ho chuka ho toh active session clear karo.
    if (activeAdminExpiresAt && Date.now() >= activeAdminExpiresAt) {
      clearActiveAdminSession();
    }

    // Sirf current active session ka token allowed hai.
    if (!activeAdminJti || payload.jti !== activeAdminJti) {
      return res.status(401).json({
        error:
          "Admin session revoke ho chuka hai ya expire ho gaya. Dobara login karo.",
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
// Sirf .env ke fixed ADMIN_USERNAME aur ADMIN_PASSWORD_HASH valid hain.
app.post("/api/admin/login", adminLoginLimit, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    const { username, password } = req.body || {};
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

    if (
      typeof adminUsername !== "string" ||
      !adminUsername ||
      typeof adminPasswordHash !== "string" ||
      !adminPasswordHash
    ) {
      console.error("Admin environment credentials configured nahi hain.");
      return res.status(500).json({
        error: "Admin login configure nahi hai.",
      });
    }

    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({
        error: "Username aur password required hain.",
      });
    }

    // Username fixed configuration se exact match hona chahiye.
    if (username !== adminUsername) {
      return res.status(401).json({
        error: "Username ya password galat hai.",
      });
    }

    // Simultaneous login attempts ko serialize karo.
    if (adminLoginInProgress) {
      return res.status(409).json({
        error: "Login request process ho rahi hai. Dobara try karo.",
        code: "ADMIN_LOGIN_IN_PROGRESS",
      });
    }

    adminLoginInProgress = true;

    try {
      const passwordMatches = await bcrypt.compare(password, adminPasswordHash);

      if (!passwordMatches) {
        return res.status(401).json({
          error: "Username ya password galat hai.",
        });
      }

      // Credentials valid hain, lekin session pehle se active hai.
      if (activeAdminJti && Date.now() < activeAdminExpiresAt) {
        return res.status(409).json({
          error:
            "Super Admin already logged in hai. Pehle existing session se logout karo.",
          code: "ADMIN_SESSION_ALREADY_ACTIVE",
        });
      }

      // Purana expired session clear karo.
      clearActiveAdminSession();

      const jti = crypto.randomUUID();
      const expiresInMs = 2 * 60 * 60 * 1000;

      const token = jwt.sign(
        { role: "superadmin", tokenType: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "2h", jwtid: jti },
      );

      activeAdminJti = jti;
      activeAdminExpiresAt = Date.now() + expiresInMs;

      return res.status(200).json({
        message: "Login successful!",
        token,
        expiresIn: 7200,
      });
    } finally {
      adminLoginInProgress = false;
    }
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({
      error: "Login nahi ho saka.",
    });
  }
});

// VERIFY CURRENT ADMIN SESSION
app.get("/api/admin/verify", requireSuperAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    authenticated: true,
    role: "superadmin",
  });
});

// ADMIN LOGOUT: server-side session revoke karo.
app.post("/api/admin/logout", requireSuperAdmin, (req, res) => {
  clearActiveAdminSession();
  res.setHeader("Cache-Control", "no-store");
  res.json({ message: "Admin session logout ho gaya." });
});

// ADMIN: all notes
app.get("/api/admin/notes", requireSuperAdmin, async (req, res) => {
  try {
    const notes = await prisma.note.findMany({
      orderBy: { updatedAt: "desc" },
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(notes.map(adminSafeNote));
  } catch (error) {
    console.error("Admin fetch notes error:", error);
    res.status(500).json({ error: "Admin notes fetch nahi ho sake." });
  }
});

// ADMIN: single note details
app.get("/api/admin/notes/:id", requireSuperAdmin, async (req, res) => {
  try {
    const note = await findNote(req.params.id);
    if (!note) {
      return res.status(404).json({ error: "Note nahi mila." });
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(adminSafeNote(note));
  } catch (error) {
    console.error("Admin note detail error:", error);
    res.status(500).json({ error: "Note fetch nahi ho saka." });
  }
});

// ADMIN: DELETE NOTE
// Sirf current active Super Admin session note delete kar sakti hai.
// Password-protected notes ko bhi admin delete kar sakta hai.
app.delete("/api/admin/notes/:id", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await findNote(id);

    if (!existing) {
      return res.status(404).json({
        error: "Note nahi mila ya pehle hi delete ho chuka hai.",
      });
    }

    await prisma.note.delete({
      where: { id },
    });

    res.setHeader("Cache-Control", "no-store");

    return res.status(200).json({
      message: "Note successfully deleted!",
      deletedId: id,
    });
  } catch (error) {
    // Agar note kisi concurrent request mein delete ho gaya ho.
    if (error.code === "P2025") {
      return res.status(404).json({
        error: "Note nahi mila ya pehle hi delete ho chuka hai.",
      });
    }

    console.error("Admin delete note error:", error);

    return res.status(500).json({
      error: "Admin note delete nahi ho saka.",
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
    res.status(500).json({ error: "Notes fetch nahi ho sake." });
  }
});

// GET OR CREATE NOTE BY SLUG
app.get("/api/notes/by-slug/:slug", async (req, res) => {
  try {
    const slug = normalizeSlug(req.params.slug);
    if (!slug) {
      return res.status(400).json({ error: "Valid URL slug required hai." });
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
    res.status(500).json({ error: "Note save nahi ho saka." });
  }
});

// CHANGE NOTE SLUG
app.put("/api/notes/:id/slug", async (req, res) => {
  try {
    const { id } = req.params;
    const slug = normalizeSlug(req.body?.slug);

    if (!slug) {
      return res.status(400).json({ error: "Valid URL slug enter karo." });
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
      return res
        .status(409)
        .json({ error: "Yeh URL pehle se use ho raha hai." });
    }
    console.error("Change note slug error:", error);
    res.status(500).json({ error: "Note URL change nahi ho saka." });
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
    res.status(500).json({ error: "Password set nahi ho saka." });
  }
});

// UNLOCK NOTE
app.post("/api/notes/:id/unlock", noteUnlockLimit, async (req, res) => {
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

    const token = jwt.sign(
      { noteId: note.id, tokenType: "note_unlock" },
      process.env.JWT_SECRET,
      { expiresIn: "30m" },
    );

    res.setHeader("Cache-Control", "no-store");
    res.json({
      token,
      note: { ...safeNote(note), content: note.content },
    });
  } catch (error) {
    console.error("Unlock note error:", error);
    res.status(500).json({ error: "Note unlock nahi ho saka." });
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

    const note = await prisma.note.update({ where: { id }, data });
    res.json(safeNote(note));
  } catch (error) {
    console.error("Update note error:", error);
    res.status(500).json({ error: "Note update nahi ho saka." });
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

    res.json({ message: "Note password removed.", note: safeNote(note) });
  } catch (error) {
    console.error("Remove password error:", error);
    res.status(500).json({ error: "Password remove nahi ho saka." });
  }
});

// PUBLIC DELETE NOTE
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

// Generic error handler, including rejected CORS origins.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err) {
    console.error("Request error:", err.message);
    return res.status(500).json({ error: "Request process nahi ho saki." });
  }
  next();
});

const server = app.listen(PORT, () => {
  console.log(`NoteNest API listening on port ${PORT}`);
});

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
