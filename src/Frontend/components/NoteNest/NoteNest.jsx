
import { useEffect, useRef, useState } from "react";
import {
    BookOpen, Check, Copy, Download, Link2, LockKeyhole,
    Moon, Plus, Share2, Sun, Eye, EyeOff, Bold, Italic,
    Underline, AlignLeft, List, ListOrdered, Type, Settings2, X
} from "lucide-react";
import "./NoteNest.css";
import api from "../../../Api/axios";

const STORAGE_KEY = "notenest-notes";
const THEME_KEY = "notenest-theme";
const ACTIVE_NOTE_KEY = "notenest-active-note";
const UNLOCKED_TOKENS_KEY = "notenest-unlocked-tokens";
const UNLOCK_SESSION_FALLBACK_MS = 30 * 60 * 1000;
const AUTO_SAVE_DELAY = 700;

function getTokenExpiry(token) {
    try {
        if (typeof token !== "string") return 0;
        const parts = token.split(".");
        if (parts.length !== 3 || !parts[1]) return 0;
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
        const payload = JSON.parse(atob(padded));
        const exp = Number(payload.exp);
        return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
    } catch {
        return 0;
    }
}

function getSessionExpiry(session, tokenOverride) {
    const token = tokenOverride || (typeof session === "string" ? session : session?.token);
    const tokenExpiry = getTokenExpiry(token);
    if (tokenExpiry > 0) return tokenExpiry;
    const savedExpiry = Number(typeof session === "object" && session ? session.expiresAt : 0);
    return Number.isFinite(savedExpiry) ? savedExpiry : 0;
}

function readStoredUnlockSessions() {
    try {
        const stored = sessionStorage.getItem(UNLOCKED_TOKENS_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
}

function readUnlockedNoteSession(noteId) {
    try {
        const saved = readStoredUnlockSessions();
        const session = saved[noteId];
        const token = typeof session === "string" ? session : session?.token;
        const expiresAt = getSessionExpiry(session, token);
        if (token && expiresAt > Date.now()) {
            return {
                ...(typeof session === "object" && session ? session : {}),
                token,
                expiresAt,
                content: typeof session?.content === "string" ? session.content : ""
            };
        }
        return null;
    } catch {
        return null;
    }
}

function readUnlockedTokens() {
    const saved = readStoredUnlockSessions();
    const validTokens = {};
    for (const [noteId, session] of Object.entries(saved)) {
        const token = typeof session === "string" ? session : session?.token;
        const expiresAt = getSessionExpiry(session, token);
        if (token && expiresAt > Date.now()) validTokens[noteId] = token;
    }
    return validTokens;
}

function saveUnlockedNoteSession(noteId, token, content) {
    try {
        if (!noteId || !token) return;
        const saved = readStoredUnlockSessions();
        const decodedExpiry = getTokenExpiry(token);
        const expiresAt = decodedExpiry > 0
            ? decodedExpiry
            : Date.now() + UNLOCK_SESSION_FALLBACK_MS;
        if (expiresAt <= Date.now()) return;
        saved[noteId] = { token, expiresAt, content: content ?? "" };
        sessionStorage.setItem(UNLOCKED_TOKENS_KEY, JSON.stringify(saved));
    } catch (error) {
        console.error("Could not save the note session:", error);
    }
}

function createNewNote() {
    return {
        id: crypto.randomUUID(),
        dbId: null,
        slug: null,
        isPersisted: false,
        title: "Untitled Note",
        content: "",
        updatedAt: Date.now(),
        isPublic: true,
        password: "",
        isPasswordProtected: false
    };
}

const initialNote = {
    id: "welcome",
    dbId: null,
    slug: null,
    isPersisted: false,
    title: "Welcome to NoteNest",
    content: "Welcome to your personal writing space.\n\nCapture your ideas, organize your thoughts, and keep everything that matters in one place.\n\nStart writing something amazing today!",
    updatedAt: Date.now(),
    isPublic: true,
    password: "",
    isPasswordProtected: false
};

function readNotes() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return [initialNote];
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [initialNote];
        return parsed.map((note) => {
            const { password, passwordHash, ...safeNote } = note;
            return {
                ...safeNote,
                password: "",
                isPasswordProtected: Boolean(safeNote.isPasswordProtected)
            };
        });
    } catch {
        return [initialNote];
    }
}

function getInitialActiveId() {
    const savedId = localStorage.getItem(ACTIVE_NOTE_KEY);
    const savedNotes = readNotes();
    if (savedId && savedNotes.some((note) => note.id === savedId)) return savedId;
    return savedNotes[0]?.id || "";
}

function getPlainText(content = "") {
    const element = document.createElement("div");
    element.innerHTML = content;
    return element.innerText || element.textContent || "";
}

function getEditorHtml(content = "") {
    if (/<\/?[a-z][\s\S]*>/i.test(content)) return content;
    return content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\r?\n/g, "<br>");
}

function normalizeSlug(value) {
    return String(value || "")
        .normalize("NFKD")
        .toLowerCase()
        .trim()
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 100)
        .replace(/-+$/g, "");
}

function getPathSlug() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
    if (!path || path === "admin" || path.startsWith("admin/")) return "";
    return normalizeSlug(decodeURIComponent(path));
}

function getShareUrl(note) {
    const url = new URL(window.location.origin);
    const slug = note?.slug || "";
    if (slug) {
        url.pathname = `/${slug}`;
    } else if (note?.dbId) {
        url.searchParams.set("note", note.dbId);
    }
    return url.toString();
}

function getApiNote(data) {
    return data?.note || data?.data || data;
}

export default function NoteNest() {
    const [notes, setNotes] = useState(readNotes);
    const [activeId, setActiveId] = useState(getInitialActiveId);
    const [backendLoaded, setBackendLoaded] = useState(false);
    const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === "dark");
    const [message, setMessage] = useState("");
    const [modal, setModal] = useState("");
    const [passwordInput, setPasswordInput] = useState("");
    const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
    const [unlockedTokens, setUnlockedTokens] = useState(readUnlockedTokens);
    const [showPassword, setShowPassword] = useState(false);
    const [urlInput, setUrlInput] = useState("");
    const [showRemovePasswordConfirm, setShowRemovePasswordConfirm] = useState(false);
    const [removingPassword, setRemovingPassword] = useState(false);
    const [saving, setSaving] = useState(false);
    const [autosaveRetry, setAutosaveRetry] = useState(0);
    const [currentPathSlug, setCurrentPathSlug] = useState(getPathSlug);

    const editorRef = useRef(null);
    const messageTimer = useRef(null);
    const autoSaveTimer = useRef(null);
    const lastSavedRef = useRef({});
    const saveInProgressRef = useRef(false);
    const activeIdRef = useRef(activeId);
    const pathLoadRef = useRef("");

    useEffect(() => {
        activeIdRef.current = activeId;
    }, [activeId]);

    function notify(text) {
        setMessage(text);
        window.clearTimeout(messageTimer.current);
        messageTimer.current = window.setTimeout(() => setMessage(""), 2500);
    }

    function makeFrontendNote(serverNote, savedSession) {
        const protectedNote = Boolean(serverNote.isPasswordProtected);
        return {
            ...serverNote,
            id: serverNote.id,
            dbId: serverNote.id,
            slug: serverNote.slug || null,
            isPersisted: true,
            updatedAt: serverNote.updatedAt
                ? new Date(serverNote.updatedAt).getTime()
                : Date.now(),
            isPublic: serverNote.isPublic ?? true,
            password: "",
            isPasswordProtected: protectedNote,
            content: protectedNote
                ? (savedSession?.content ?? "")
                : (serverNote.content || "")
        };
    }

    function storeSafeNotes(noteList) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(noteList.map((note) => {
                const { password, passwordHash, ...safeNote } = note;
                if (safeNote.isPasswordProtected) safeNote.content = "";
                return safeNote;
            })));
        } catch (error) {
            console.error("Could not store local notes:", error);
        }
    }

    async function loadPathNote(slug, { updateUrl = false } = {}) {
        if (!slug) return;
        const requestKey = `${slug}:${Date.now()}`;
        pathLoadRef.current = requestKey;

        try {
            const response = await api.get(`/notes/by-slug/${encodeURIComponent(slug)}`);
            if (pathLoadRef.current !== requestKey) return;

            const serverNote = getApiNote(response.data);
            if (!serverNote?.id) throw new Error("Backend ne note ID return nahi ki.");

            const session = serverNote.isPasswordProtected
                ? readUnlockedNoteSession(serverNote.id)
                : null;
            const note = makeFrontendNote(serverNote, session);

            setNotes((previous) => {
                const withoutDuplicate = previous.filter(
                    (item) => item.dbId !== note.dbId && item.id !== note.id
                );
                const next = [note, ...withoutDuplicate];
                storeSafeNotes(next);
                return next;
            });

            setActiveId(note.id);
            setCurrentPathSlug(note.slug || slug);
            localStorage.setItem(ACTIVE_NOTE_KEY, note.id);

            if (updateUrl) {
                window.history.pushState({}, "", `/${note.slug || slug}`);
            }

            const token = session?.token;
            if (token) {
                setUnlockedTokens((previous) => ({
                    ...previous,
                    [note.dbId]: token
                }));
            }
        } catch (error) {
            console.error("Failed to load URL note:", error);
            notify(
                error.response?.data?.error ||
                "URL wala note load nahi ho saka. Backend connection check karo."
            );
        }
    }

    useEffect(() => {
        let cancelled = false;

        async function loadNotes() {
            const pathSlug = getPathSlug();

            if (pathSlug) {
                setCurrentPathSlug(pathSlug);
                try {
                    const response = await api.get(`/notes/by-slug/${encodeURIComponent(pathSlug)}`);
                    if (cancelled) return;

                    const serverNote = getApiNote(response.data);
                    if (!serverNote?.id) throw new Error("Invalid note response.");

                    const session = serverNote.isPasswordProtected
                        ? readUnlockedNoteSession(serverNote.id)
                        : null;
                    const note = makeFrontendNote(serverNote, session);

                    setNotes((previous) => {
                        const next = [
                            note,
                            ...previous.filter((item) => item.dbId !== note.dbId)
                        ];
                        storeSafeNotes(next);
                        return next;
                    });
                    setActiveId(note.id);
                    localStorage.setItem(ACTIVE_NOTE_KEY, note.id);

                    if (session?.token) {
                        setUnlockedTokens((previous) => ({
                            ...previous,
                            [note.dbId]: session.token
                        }));
                    }
                } catch (error) {
                    console.error("Failed to load URL note:", error);
                    if (!cancelled) notify(
                        error.response?.data?.error ||
                        "URL wala note load nahi ho saka. Backend connection check karo."
                    );
                } finally {
                    if (!cancelled) setBackendLoaded(true);
                }
                return;
            }

            try {
                const response = await api.get("/notes");
                if (cancelled) return;

                const data = response.data;
                const serverNotes = Array.isArray(data)
                    ? data
                    : Array.isArray(data?.notes)
                        ? data.notes
                        : Array.isArray(data?.data)
                            ? data.data
                            : [];

                if (serverNotes.length === 0) {
                    const localNotes = readNotes();
                    setNotes(localNotes);
                    setActiveId((currentId) =>
                        localNotes.some((note) => note.id === currentId)
                            ? currentId
                            : localNotes[0]?.id || ""
                    );
                    setBackendLoaded(true);
                    return;
                }

                const localNotes = readNotes();
                const savedActiveId = localStorage.getItem(ACTIVE_NOTE_KEY);
                const savedActiveNote = localNotes.find(
                    (note) => note.id === savedActiveId || note.dbId === savedActiveId
                );
                const savedDatabaseId = savedActiveNote?.dbId ||
                    (savedActiveNote?.isPersisted ? savedActiveNote.id : null);

                const normalizedNotes = serverNotes.map((note) => {
                    const session = note.isPasswordProtected
                        ? readUnlockedNoteSession(note.id)
                        : null;
                    return makeFrontendNote(note, session);
                });

                setNotes(normalizedNotes);
                setBackendLoaded(true);

                setActiveId((currentId) => {
                    const sharedId = new URL(window.location.href).searchParams.get("note");
                    const sharedNote = normalizedNotes.find(
                        (note) => note.dbId === sharedId || note.id === sharedId
                    );
                    if (sharedNote) return sharedNote.id;

                    const previousNote = normalizedNotes.find(
                        (note) => note.dbId === savedDatabaseId || note.id === savedDatabaseId
                    );
                    if (previousNote) return previousNote.id;

                    const exactMatch = normalizedNotes.find(
                        (note) => note.id === currentId || note.dbId === currentId
                    );
                    return exactMatch?.id || normalizedNotes[0]?.id || "";
                });

                storeSafeNotes(normalizedNotes);
            } catch (error) {
                console.error("Failed to load notes:", error);
                if (!cancelled) {
                    const localNotes = readNotes();
                    setNotes(localNotes);
                    setActiveId((currentId) =>
                        localNotes.some((note) => note.id === currentId)
                            ? currentId
                            : localNotes[0]?.id || ""
                    );
                    setBackendLoaded(true);
                    notify("Local notes loaded; backend connection check karo.");
                }
            }
        }

        loadNotes();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        function handlePopState() {
            const slug = getPathSlug();
            setCurrentPathSlug(slug);
            if (slug) {
                loadPathNote(slug);
            } else {
                window.location.reload();
            }
        }
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, []);

    const activeNote = notes.find((note) => note.id === activeId) || notes[0] || null;
    const activeDatabaseId = activeNote?.dbId || (activeNote?.isPersisted ? activeNote.id : null);
    const activeToken = activeDatabaseId ? unlockedTokens[activeDatabaseId] : null;
    const isLocked = Boolean(activeNote?.isPasswordProtected && !activeToken);
    const plainContent = getPlainText(activeNote?.content || "");
    const words = plainContent.trim() ? plainContent.trim().split(/\s+/).length : 0;
    const characters = plainContent.length;

    useEffect(() => {
        storeSafeNotes(notes);
    }, [notes]);

    useEffect(() => {
        localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    }, [dark]);

    useEffect(() => {
        if (!activeId) {
            localStorage.removeItem(ACTIVE_NOTE_KEY);
            return;
        }

        localStorage.setItem(ACTIVE_NOTE_KEY, activeId);
        if (activeNote && editorRef.current) {
            editorRef.current.innerHTML = getEditorHtml(
                isLocked ? "" : (activeNote.content || "")
            );
        }
    }, [activeId, isLocked, backendLoaded]);

    useEffect(() => {
        if (!backendLoaded) return;

        if (!activeNote?.isPasswordProtected) {
            if (modal === "unlock") setModal("");
            return;
        }

        const savedSession = activeDatabaseId
            ? readUnlockedNoteSession(activeDatabaseId)
            : null;
        const rememberedToken = activeToken || savedSession?.token;

        if (rememberedToken) {
            if (!activeToken && activeDatabaseId) {
                setUnlockedTokens((previous) => ({
                    ...previous,
                    [activeDatabaseId]: rememberedToken
                }));
            }
            if (modal === "unlock") setModal("");
        } else {
            setPasswordInput("");
            if (modal !== "unlock") setModal("unlock");
        }
    }, [
        backendLoaded,
        activeNote?.id,
        activeNote?.isPasswordProtected,
        activeDatabaseId,
        activeToken,
        modal
    ]);

    useEffect(() => {
        if (!backendLoaded) return;
        try {
            const existing = readStoredUnlockSessions();
            const savedTokens = {};

            for (const [noteId, session] of Object.entries(existing)) {
                const token = typeof session === "string" ? session : session?.token;
                const expiresAt = getSessionExpiry(session, token);
                if (token && expiresAt > Date.now()) {
                    savedTokens[noteId] = {
                        ...(typeof session === "object" && session ? session : {}),
                        token,
                        expiresAt,
                        content: typeof session?.content === "string" ? session.content : ""
                    };
                }
            }

            for (const [noteId, token] of Object.entries(unlockedTokens)) {
                const decodedExpiry = getTokenExpiry(token);
                const previousSession = savedTokens[noteId];
                const expiresAt = decodedExpiry > 0
                    ? decodedExpiry
                    : Number(previousSession?.expiresAt) > Date.now()
                        ? Number(previousSession.expiresAt)
                        : Date.now() + UNLOCK_SESSION_FALLBACK_MS;

                if (expiresAt <= Date.now()) continue;
                const note = notes.find((item) => (item.dbId || item.id) === noteId);
                savedTokens[noteId] = {
                    token,
                    expiresAt,
                    content: note ? (note.content ?? "") : (previousSession?.content ?? "")
                };
            }

            sessionStorage.setItem(UNLOCKED_TOKENS_KEY, JSON.stringify(savedTokens));
        } catch (error) {
            console.error("Could not persist unlock session:", error);
        }
    }, [unlockedTokens, notes, backendLoaded]);

    useEffect(() => {
        return () => {
            window.clearTimeout(messageTimer.current);
            window.clearTimeout(autoSaveTimer.current);
        };
    }, []);

    function updateNote(field, value) {
        if (!activeNote || isLocked) return;
        setNotes((previous) => previous.map((note) =>
            note.id === activeNote.id
                ? { ...note, [field]: value, updatedAt: Date.now() }
                : note
        ));
    }

    // Debounced autosave. Path-based notes keep their existing slug.
    useEffect(() => {
        if (!backendLoaded || !activeNote || isLocked) return;

        const title = (activeNote.title || "Untitled Note").trim() || "Untitled Note";
        const content = activeNote.content ?? "";
        const localId = activeNote.id;
        const snapshot = JSON.stringify({ title, content });
        const databaseId = activeNote.dbId ||
            (activeNote.isPersisted ? activeNote.id : null);
        const savedKey = databaseId || localId;

        if (lastSavedRef.current[savedKey] === snapshot) return;

        window.clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = window.setTimeout(async () => {
            if (saveInProgressRef.current) {
                setAutosaveRetry((value) => value + 1);
                return;
            }

            saveInProgressRef.current = true;
            setSaving(true);
            try {
                const headers = activeToken
                    ? { Authorization: `Bearer ${activeToken}` }
                    : {};
                const payload = { title, content };
                const response = databaseId
                    ? await api.put(`/notes/${databaseId}`, payload, { headers })
                    : await api.post("/notes", payload);

                const saved = getApiNote(response.data);
                const newDatabaseId = saved?.id || databaseId || localId;
                const key = newDatabaseId || localId;

                lastSavedRef.current[key] = snapshot;
                lastSavedRef.current[localId] = snapshot;

                setNotes((previous) => previous.map((note) => {
                    if (note.id !== localId) return note;
                    const latest = JSON.stringify({
                        title: (note.title || "Untitled Note").trim() || "Untitled Note",
                        content: note.content ?? ""
                    });
                    return {
                        ...note,
                        dbId: newDatabaseId,
                        slug: saved?.slug || note.slug || null,
                        isPersisted: true,
                        updatedAt: saved?.updatedAt
                            ? new Date(saved.updatedAt).getTime()
                            : Date.now(),
                        ...(latest === snapshot ? { title, content } : {})
                    };
                }));
            } catch (error) {
                console.error("Autosave failed:", error);
                autoSaveTimer.current = window.setTimeout(() => {
                    setAutosaveRetry((value) => value + 1);
                }, AUTO_SAVE_DELAY);
            } finally {
                saveInProgressRef.current = false;
                setSaving(false);
            }
        }, AUTO_SAVE_DELAY);

        return () => window.clearTimeout(autoSaveTimer.current);
    }, [
        backendLoaded,
        activeNote?.id,
        activeNote?.dbId,
        activeNote?.isPersisted,
        activeNote?.title,
        activeNote?.content,
        activeNote?.isPasswordProtected,
        activeNote?.slug,
        activeToken,
        isLocked,
        autosaveRetry
    ]);

    function addNote() {
        const note = createNewNote();
        setNotes((previous) => [note, ...previous]);
        setActiveId(note.id);
        notify("New note created");
    }

    async function removeNote() {
        if (!activeNote || isLocked) {
            if (isLocked) notify("Delete karne se pehle note unlock karo.");
            return;
        }
        if (!window.confirm("Delete this note?")) return;

        if (activeNote.dbId || activeNote.isPersisted) {
            try {
                await api.delete(`/notes/${activeDatabaseId}`, {
                    headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {}
                });
            } catch (error) {
                console.error("Failed to delete note:", error);
                notify(error.response?.data?.error || "Note delete nahi hui");
                return;
            }
        }

        const remaining = notes.filter((note) => note.id !== activeNote.id);
        setNotes(remaining);
        setActiveId(remaining[0]?.id || "");
        setUnlockedTokens((previous) => {
            const next = { ...previous };
            delete next[activeDatabaseId];
            return next;
        });
        delete lastSavedRef.current[activeDatabaseId];
        delete lastSavedRef.current[activeNote.id];

        if (activeNote.slug && getPathSlug() === activeNote.slug) {
            window.history.pushState({}, "", "/");
            setCurrentPathSlug("");
        }
        notify("Note deleted");
    }

    function clearText() {
        if (isLocked) {
            notify("Text clear karne se pehle note unlock karo.");
            return;
        }
        if (!activeNote || !window.confirm("Clear all text in this note?")) return;
        updateNote("content", "");
        if (editorRef.current) editorRef.current.innerHTML = "";
        notify("Note text cleared");
    }

    function downloadNote() {
        if (!activeNote || isLocked) {
            if (isLocked) notify("Download karne se pehle note unlock karo.");
            return;
        }
        const blob = new Blob(
            [`${activeNote.title}\n\n${getPlainText(activeNote.content)}`],
            { type: "text/plain;charset=utf-8" }
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${(activeNote.title || "notenest-note").replace(/[\\/:*?"<>|]/g, "-")}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        notify("Note downloaded");
    }

    async function copyLink() {
        if (!activeNote) return;
        if (!activeNote.dbId && !activeNote.slug) {
            notify("Share link banane se pehle note save hone do.");
            return;
        }
        try {
            await navigator.clipboard.writeText(getShareUrl(activeNote));
            notify("Note link copied.");
        } catch {
            notify("Clipboard access unavailable. Browser URL se link copy karo.");
        }
    }

    async function shareNote() {
        if (!activeNote) return;
        if (!activeNote.dbId && !activeNote.slug) {
            notify("Share karne se pehle note save hone do.");
            return;
        }
        const url = getShareUrl(activeNote);
        if (navigator.share) {
            try {
                await navigator.share({
                    title: activeNote.title || "NoteNest",
                    text: "A note from NoteNest",
                    url
                });
            } catch {
                // User closed the share dialog.
            }
        } else {
            try {
                await navigator.clipboard.writeText(url);
                notify("Note link copied.");
            } catch {
                notify("Link copy nahi ho saka. Browser URL se copy karo.");
            }
        }
    }

    function formatText(command) {
        if (isLocked) {
            notify("Formatting ke liye pehle note unlock karo.");
            return;
        }
        if (!editorRef.current) return;
        editorRef.current.focus();
        document.execCommand(command, false, null);
        updateNote("content", editorRef.current.innerHTML);
    }

    async function savePassword() {
        if (!activeNote) return;
        if (passwordInput.length < 8) {
            notify("Password kam se kam 8 characters ka hona chahiye.");
            return;
        }
        if (passwordInput !== confirmPasswordInput) {
            notify("Password aur Confirm Password match nahi karte.");
            return;
        }

        try {
            const content = editorRef.current?.innerHTML ?? activeNote.content ?? "";
            const title = (activeNote.title || "Untitled Note").trim() || "Untitled Note";
            let databaseId = activeNote.dbId ||
                (activeNote.isPersisted ? activeNote.id : null);
            const isNewNote = !databaseId;

            if (!databaseId) {
                const createResponse = await api.post("/notes", { title, content });
                const created = getApiNote(createResponse.data);
                databaseId = created?.id;
                if (!databaseId) throw new Error("Backend ne note ID return nahi ki.");
                setNotes((previous) => previous.map((note) =>
                    note.id === activeNote.id
                        ? { ...note, dbId: databaseId, isPersisted: true, title, content }
                        : note
                ));
            }

            const token = unlockedTokens[databaseId];
            if (!isNewNote) {
                await api.put(`/notes/${databaseId}`, { title, content }, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                });
            }

            await api.post(`/notes/${databaseId}/password`, {
                password: passwordInput,
                confirmPassword: confirmPasswordInput
            }, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });

            const unlockResponse = await api.post(`/notes/${databaseId}/unlock`, {
                password: passwordInput
            });
            const newToken = unlockResponse.data?.token;
            const returnedNote = unlockResponse.data?.note;
            if (!newToken || !returnedNote) {
                throw new Error("Backend se unlock response sahi nahi mila.");
            }

            const finalContent = returnedNote.content ?? content;
            saveUnlockedNoteSession(databaseId, newToken, finalContent);
            setUnlockedTokens((previous) => ({ ...previous, [databaseId]: newToken }));

            setNotes((previous) => previous.map((note) =>
                note.id === activeNote.id
                    ? {
                        ...note,
                        dbId: databaseId,
                        slug: returnedNote.slug || note.slug || null,
                        isPersisted: true,
                        isPasswordProtected: true,
                        title: returnedNote.title || title,
                        content: finalContent,
                        updatedAt: returnedNote.updatedAt
                            ? new Date(returnedNote.updatedAt).getTime()
                            : Date.now(),
                        password: ""
                    }
                    : note
            ));

            const snapshot = JSON.stringify({
                title: returnedNote.title || title,
                content: finalContent
            });
            lastSavedRef.current[databaseId] = snapshot;
            lastSavedRef.current[activeNote.id] = snapshot;
            if (editorRef.current) editorRef.current.innerHTML = getEditorHtml(finalContent);

            setPasswordInput("");
            setConfirmPasswordInput("");
            setModal("");
            notify("Password securely set. Note is protected.");
        } catch (error) {
            console.error("Set note password error:", error);
            notify(
                error.response?.data?.error ||
                error.response?.data?.message ||
                error.message ||
                "Password set nahi ho saka."
            );
        }
    }

    async function unlockNote() {
        if (!activeNote || !passwordInput) {
            notify("Note password enter karo.");
            return;
        }

        const databaseId = activeNote.dbId || activeNote.id;
        try {
            const response = await api.post(`/notes/${databaseId}/unlock`, {
                password: passwordInput
            });
            const { token, note } = response.data;
            const content = note.content || "";

            saveUnlockedNoteSession(databaseId, token, content);
            setUnlockedTokens((previous) => ({ ...previous, [databaseId]: token }));
            setNotes((previous) => previous.map((item) =>
                item.id === activeNote.id
                    ? { ...item, content, isPasswordProtected: true, password: "" }
                    : item
            ));
            if (editorRef.current) editorRef.current.innerHTML = getEditorHtml(content);

            const snapshot = JSON.stringify({
                title: note.title || activeNote.title || "Untitled Note",
                content
            });
            lastSavedRef.current[databaseId] = snapshot;
            lastSavedRef.current[activeNote.id] = snapshot;
            setPasswordInput("");
            setModal("");
            notify("Note unlocked successfully.");
        } catch (error) {
            console.error("Unlock note error:", error);
            notify(
                error.response?.data?.error ||
                error.response?.data?.message ||
                "Incorrect password or note unlock failed."
            );
        }
    }

    async function removePassword() {
        if (!activeNote || isLocked) {
            notify("Password remove karne se pehle note unlock karo.");
            return;
        }
        if (removingPassword) return;

        setRemovingPassword(true);
        const localId = activeNote.id;
        const databaseId = activeNote.dbId || activeNote.id;
        const title = (activeNote.title || "Untitled Note").trim() || "Untitled Note";
        const content = editorRef.current?.innerHTML ?? activeNote.content ?? "";
        const headers = activeToken ? { Authorization: `Bearer ${activeToken}` } : {};

        try {
            await api.put(`/notes/${databaseId}`, { title, content }, { headers });
            await api.delete(`/notes/${databaseId}/password`, { headers });

            const snapshot = JSON.stringify({ title, content });
            lastSavedRef.current[databaseId] = snapshot;
            lastSavedRef.current[localId] = snapshot;

            setNotes((previous) => previous.map((note) =>
                note.id === localId
                    ? {
                        ...note,
                        dbId: databaseId,
                        isPersisted: true,
                        title,
                        content,
                        isPasswordProtected: false,
                        password: "",
                        updatedAt: Date.now()
                    }
                    : note
            ));

            if (editorRef.current) editorRef.current.innerHTML = getEditorHtml(content);
            setUnlockedTokens((previous) => {
                const next = { ...previous };
                delete next[databaseId];
                return next;
            });

            try {
                const saved = readStoredUnlockSessions();
                delete saved[databaseId];
                sessionStorage.setItem(UNLOCKED_TOKENS_KEY, JSON.stringify(saved));
            } catch (error) {
                console.error("Could not clear unlock session:", error);
            }

            setShowRemovePasswordConfirm(false);
            notify("Password removed. Note content preserved.");
        } catch (error) {
            console.error("Remove password error:", error);
            notify(
                error.response?.data?.error ||
                error.response?.data?.message ||
                "Password remove nahi ho saka. Dobara try karo."
            );
        } finally {
            setRemovingPassword(false);
        }
    }

    async function changeUrl() {
        if (!activeNote) return;
        const slug = normalizeSlug(urlInput);

        if (!slug) {
            notify("Enter a valid URL name.");
            return;
        }
        if (slug === activeNote.slug) {
            setModal("");
            return;
        }

        try {
            let databaseId = activeNote.dbId ||
                (activeNote.isPersisted ? activeNote.id : null);

            // Ensure the note exists in the database before assigning a slug.
            if (!databaseId) {
                const content = editorRef.current?.innerHTML ?? activeNote.content ?? "";
                const title = (activeNote.title || "Untitled Note").trim() || "Untitled Note";
                const createResponse = await api.post("/notes", { title, content });
                const created = getApiNote(createResponse.data);
                databaseId = created?.id;
                if (!databaseId) throw new Error("Note ID backend se nahi mila.");
            }

            const headers = activeToken
                ? { Authorization: `Bearer ${activeToken}` }
                : {};
            const response = await api.put(`/notes/${databaseId}/slug`, { slug }, { headers });
            const saved = getApiNote(response.data);

            const oldId = activeNote.id;
            setNotes((previous) => previous.map((note) =>
                note.id === oldId
                    ? {
                        ...note,
                        dbId: databaseId,
                        isPersisted: true,
                        slug: saved?.slug || slug
                    }
                    : note
            ));

            window.history.pushState({}, "", `/${saved?.slug || slug}`);
            setCurrentPathSlug(saved?.slug || slug);
            setUrlInput("");
            setModal("");
            notify("Note URL updated successfully.");
        } catch (error) {
            console.error("Change note URL error:", error);
            notify(
                error.response?.data?.error ||
                error.response?.data?.message ||
                error.message ||
                "URL update nahi ho saka."
            );
        }
    }

    function togglePrivacy() {
        if (!activeNote) return;
        updateNote("isPublic", !activeNote.isPublic);
        notify(activeNote.isPublic
            ? "Marked private on this browser"
            : "Marked public on this browser"
        );
    }

    async function saveNow() {
        if (!activeNote) return;
        if (isLocked) {
            notify("Note save karne se pehle unlock karo.");
            return;
        }

        const content = editorRef.current?.innerHTML ?? activeNote.content ?? "";
        const payload = {
            title: (activeNote.title || "Untitled Note").trim() || "Untitled Note",
            content
        };

        try {
            const alreadySaved = Boolean(activeNote.dbId || activeNote.isPersisted);
            const headers = activeToken ? { Authorization: `Bearer ${activeToken}` } : {};
            const response = alreadySaved
                ? await api.put(`/notes/${activeDatabaseId}`, payload, { headers })
                : await api.post("/notes", payload);

            const saved = getApiNote(response.data);
            const databaseId = saved?.id || activeDatabaseId || activeNote.id;
            const updatedNote = {
                ...activeNote,
                ...(saved && typeof saved === "object" ? saved : {}),
                id: activeNote.id,
                dbId: databaseId,
                slug: saved?.slug || activeNote.slug || null,
                isPersisted: true,
                title: payload.title,
                content,
                isPasswordProtected: Boolean(
                    activeNote.isPasswordProtected || saved?.isPasswordProtected
                ),
                password: "",
                updatedAt: saved?.updatedAt
                    ? new Date(saved.updatedAt).getTime()
                    : Date.now()
            };

            setNotes((previous) => previous.map((note) =>
                note.id === activeNote.id ? updatedNote : note
            ));
            const snapshot = JSON.stringify({ title: payload.title, content });
            lastSavedRef.current[databaseId] = snapshot;
            lastSavedRef.current[activeNote.id] = snapshot;
            notify(alreadySaved ? "Notes are updated in database" : "Notes are saved in database");
        } catch (error) {
            console.error("Failed to save note:", error);
            notify(
                error.response?.data?.error ||
                error.response?.data?.message ||
                "Notes are not saved. Please check backend."
            );
        }
    }

    if (!activeNote) {
        return (
            <div className={`notenest-app ${dark ? "dark-mode" : ""}`}>
                <header className="nn-header">
                    <a className="nn-brand" href="/">
                        <span className="nn-brand-icon"><BookOpen size={21} /></span>
                        Note<span>Nest</span>
                    </a>
                    <button className="nn-icon-btn" onClick={() => setDark((value) => !value)} aria-label="Toggle theme">
                        {dark ? <Sun size={19} /> : <Moon size={19} />}
                    </button>
                </header>
                <div className="nn-empty">
                    <BookOpen size={42} />
                    <h2>No notes yet</h2>
                    <button className="nn-primary" onClick={addNote}>
                        <Plus size={17} /> Create your first note
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`notenest-app ${dark ? "dark-mode" : ""}`}>
            <header className="nn-header">
                <a className="nn-brand" href="/" aria-label="NoteNest home">
                    <span className="nn-brand-icon"><BookOpen size={21} /></span>
                    Note<span>Nest</span>
                </a>

                <div className="nn-saved">
                    <i />
                    {saving ? "Saving..." : "Autosave enabled"}
                </div>

                <div className="nn-header-actions">
                    <button className="nn-url-pill" onClick={copyLink} title="Copy note URL">
                        <Link2 size={15} />
                        <span>{window.location.host}{window.location.pathname}</span>
                        <Copy size={14} />
                    </button>
                    <button className="nn-icon-btn" onClick={shareNote} title="Share note">
                        <Share2 size={18} />
                    </button>
                    <button className="nn-icon-btn" onClick={() => setDark((value) => !value)} title="Toggle theme">
                        {dark ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                </div>
            </header>

            <main className="nn-layout">
                <section className="nn-editor-card">
                    <div className="nn-breadcrumb">
                        <span>My Notes</span><span>/</span><span>Current Note</span>
                    </div>

                    <input
                        className="nn-title-input"
                        value={activeNote.title}
                        readOnly={isLocked}
                        onChange={(event) => updateNote("title", event.target.value)}
                        placeholder="Give your note a title..."
                        aria-label="Note title"
                    />

                    <div className="nn-toolbar">
                        <button onClick={() => formatText("bold")} title="Bold"><Bold size={17} /></button>
                        <button onClick={() => formatText("italic")} title="Italic"><Italic size={17} /></button>
                        <button onClick={() => formatText("underline")} title="Underline"><Underline size={17} /></button>
                        <span />
                        <button onClick={() => formatText("justifyLeft")} title="Align left"><AlignLeft size={17} /></button>
                        <button onClick={() => formatText("insertUnorderedList")} title="Bullet list"><List size={17} /></button>
                        <button onClick={() => formatText("insertOrderedList")} title="Numbered list"><ListOrdered size={17} /></button>
                        <span />
                        <button onClick={() => formatText("removeFormat")} title="Remove formatting"><Type size={17} /></button>
                    </div>

                    <div
                        ref={editorRef}
                        className="nn-writing-area"
                        contentEditable={!isLocked}
                        aria-readonly={isLocked}
                        suppressContentEditableWarning
                        role="textbox"
                        aria-label="Note content"
                        data-placeholder="Start writing your thoughts here..."
                        onInput={(event) => updateNote("content", event.currentTarget.innerHTML)}
                    />

                    <footer className="nn-editor-footer">
                        <div className="nn-counts">
                            <span>{words} words</span><b>·</b><span>{characters} characters</span>
                        </div>
                    </footer>
                </section>


                <aside className="nn-options-card">
                    <div className="nn-panel-title">
                        <div>
                            <h2>Note options</h2>
                            <p>Manage your writing space</p>
                        </div>
                        <Settings2 size={19} />
                    </div>

                    <div className="nn-option-group">
                        <p className="nn-group-label">NOTE ACTIONS</p>

                        <button
                            type="button"
                            className="nn-option"
                            title="Download note as a text file"
                            data-tooltip="Download note as a text file"
                            onClick={downloadNote}
                        >
                            <Download size={17} />
                            <span>Download note</span>
                        </button>

                        <button
                            type="button"
                            className="nn-option"
                            title="Copy the note URL to clipboard"
                            data-tooltip="Copy note URL"
                            onClick={copyLink}
                        >
                            <Copy size={17} />
                            <span>Copy note URL</span>
                        </button>

                        <button
                            type="button"
                            className="nn-option"
                            title="Share this note"
                            data-tooltip="Share note using available apps"
                            onClick={shareNote}
                        >
                            <Share2 size={17} />
                            <span>Share note</span>
                        </button>

                        <button
                            type="button"
                            className="nn-option"
                            title="Save note immediately"
                            data-tooltip="Save current note immediately"
                            onClick={saveNow}
                            disabled={saving}
                        >
                            <Check size={17} />
                            <span>{saving ? "Saving note..." : "Save note now"}</span>
                        </button>
                    </div>

                    <div className="nn-option-group">
                        <p className="nn-group-label">SECURITY & URL</p>

                        <button
                            type="button"
                            className="nn-option"
                            title={activeNote.isPasswordProtected ? "Change note password" : "Set note password"}
                            data-tooltip={activeNote.isPasswordProtected ? "Change password protection" : "Protect note with a password"}
                            onClick={() => {
                                if (activeNote.isPasswordProtected && isLocked) {
                                    setPasswordInput("");
                                    setModal("unlock");
                                    notify("Password change karne se pehle note unlock karo.");
                                    return;
                                }
                                setPasswordInput("");
                                setConfirmPasswordInput("");
                                setModal("password");
                            }}
                        >
                            <LockKeyhole size={17} />
                            <span>{activeNote.isPasswordProtected ? "Change password" : "Protect with password"}</span>
                        </button>

                        {activeNote.isPasswordProtected && (
                            <button
                                type="button"
                                className="nn-option"
                                title="Remove password protection"
                                data-tooltip="Remove password protection from this note"
                                disabled={removingPassword}
                                onClick={() => {
                                    if (isLocked) {
                                        notify("Password remove karne se pehle note unlock karo.");
                                        return;
                                    }
                                    setShowRemovePasswordConfirm(true);
                                }}
                            >
                                <EyeOff size={17} />
                                <span>{removingPassword ? "Removing password..." : "Remove password"}</span>
                            </button>
                        )}

                        <button
                            type="button"
                            className="nn-option"
                            title="Change the note URL"
                            data-tooltip="Set a different URL for this note"
                            onClick={() => {
                                setUrlInput(activeNote.slug || currentPathSlug || "");
                                setModal("url");
                            }}
                        >
                            <Link2 size={17} />
                            <span>Change note URL</span>
                        </button>
                    </div>
                </aside>

            </main>

            {message && (
                <div className="nn-toast"><Check size={16} />{message}</div>
            )}

            {showRemovePasswordConfirm && (
                <div
                    className="nn-modal-backdrop"
                    onClick={() => {
                        if (!removingPassword) setShowRemovePasswordConfirm(false);
                    }}
                >
                    <section
                        className="nn-modal nn-remove-password-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="nn-remove-password-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            className="nn-modal-close"
                            onClick={() => setShowRemovePasswordConfirm(false)}
                            disabled={removingPassword}
                            aria-label="Close confirmation"
                        >
                            <X size={18} />
                        </button>
                        <div className="nn-modal-icon"><LockKeyhole size={22} /></div>
                        <h2 id="nn-remove-password-title">Remove note password?</h2>
                        <p>
                            Are you sure you want to remove the password protection?
                            Anyone with access to this note link may be able to view the note.
                        </p>
                        <div className="nn-confirm-actions">
                            <button
                                type="button"
                                className="nn-secondary"
                                onClick={() => setShowRemovePasswordConfirm(false)}
                                disabled={removingPassword}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="nn-danger-btn"
                                onClick={removePassword}
                                disabled={removingPassword}
                            >
                                {removingPassword ? "Removing..." : "Yes, Remove Password"}
                            </button>
                        </div>
                    </section>
                </div>
            )}

            {modal && (
                <div className="nn-modal-backdrop" onClick={() => setModal("")}>
                    <section className="nn-modal" onClick={(event) => event.stopPropagation()}>
                        <button className="nn-modal-close" onClick={() => setModal("")} aria-label="Close">
                            <X size={18} />
                        </button>

                        {modal === "password" ? (
                            <>
                                <div className="nn-modal-icon"><LockKeyhole size={22} /></div>
                                <h2>{activeNote.isPasswordProtected ? "Change note password" : "Set note password"}</h2>
                                <p>Use at least 8 characters. The password is securely hashed on the server; the original password is never saved in your notes.</p>
                                <label className="nn-field-label">Password</label>
                                <div className="nn-password-input">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={passwordInput}
                                        onChange={(event) => setPasswordInput(event.target.value)}
                                        placeholder="Enter a password (8+ characters)"
                                        autoComplete="new-password"
                                    />
                                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Show password">
                                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                                    </button>
                                </div>
                                <label className="nn-field-label">Confirm Password</label>
                                <div className="nn-password-input">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={confirmPasswordInput}
                                        onChange={(event) => setConfirmPasswordInput(event.target.value)}
                                        placeholder="Confirm your password"
                                        autoComplete="new-password"
                                    />
                                </div>
                                <button className="nn-primary nn-modal-submit" onClick={savePassword}>Save password</button>
                            </>
                        ) : modal === "unlock" ? (
                            <>
                                <div className="nn-modal-icon"><LockKeyhole size={22} /></div>
                                <h2>Unlock this note</h2>
                                <p>This note is password-protected. Enter its password to view or edit the content.</p>
                                <div className="nn-password-input">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={passwordInput}
                                        onChange={(event) => setPasswordInput(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") unlockNote();
                                        }}
                                        placeholder="Enter note password"
                                        autoComplete="current-password"
                                    />
                                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Show password">
                                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                                    </button>
                                </div>
                                <button className="nn-primary nn-modal-submit" onClick={unlockNote}>Unlock note</button>
                            </>
                        ) : (
                            <>
                                <div className="nn-modal-icon"><Link2 size={22} /></div>
                                <h2>Change note URL</h2>
                                <p>Choose a unique URL name. The change will be saved to the database and reflected in the browser address.</p>
                                <label className="nn-field-label">Note URL</label>
                                <div className="nn-url-edit-preview">
                                    <span>{window.location.host}/</span>
                                    <input
                                        className="nn-modal-text-input"
                                        value={urlInput}
                                        onChange={(event) => setUrlInput(event.target.value)}
                                        placeholder="my-new-note"
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") changeUrl();
                                        }}
                                    />
                                </div>
                                <button className="nn-primary nn-modal-submit" onClick={changeUrl}>Update URL</button>
                            </>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}
