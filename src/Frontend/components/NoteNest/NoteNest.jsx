import { useEffect, useRef, useState } from "react";
import {
    BookOpen, Check, Copy, Download, FileText, Link2, LockKeyhole,
    Moon, Plus, Save, Share2, Sun, Trash2, Eye, EyeOff, Bold, Italic,
    Underline, AlignLeft, List, ListOrdered, Type, Settings2, Clock, X, Search
} from "lucide-react";
import "./NoteNest.css";
import api from "../../../Api/axios";

const STORAGE_KEY = "notenest-notes";
const THEME_KEY = "notenest-theme";
const ACTIVE_NOTE_KEY = "notenest-active-note";
const UNLOCKED_TOKENS_KEY = "notenest-unlocked-tokens";
const UNLOCK_SESSION_FALLBACK_MS = 30 * 60 * 1000;

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
        isPersisted: false,
        title: "Untitled Note",
        content: "",
        updatedAt: Date.now(),
        isPublic: true,
        password: ""
    };
}

const initialNote = {
    id: "welcome",
    dbId: null,
    isPersisted: false,
    title: "Welcome to NoteNest",
    content: "Welcome to your personal writing space.\n\nCapture your ideas, organize your thoughts, and keep everything that matters in one place.\n\nStart writing something amazing today!",
    updatedAt: Date.now(),
    isPublic: true,
    password: ""
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

function getShareUrl(noteId) {
    const url = new URL(window.location.href);
    url.searchParams.set("note", noteId);
    return url.toString();
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
    const [searchQuery, setSearchQuery] = useState("");

    const editorRef = useRef(null);
    const messageTimer = useRef(null);

    useEffect(() => {
        let cancelled = false;

        async function loadNotes() {
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

                // FIX: Save the active local note's DB ID before normalizing IDs.
                const localNotesBeforeLoad = readNotes();
                const savedActiveId = localStorage.getItem(ACTIVE_NOTE_KEY);
                const savedActiveNote = localNotesBeforeLoad.find(
                    (note) => note.id === savedActiveId || note.dbId === savedActiveId
                );
                const savedActiveDatabaseId = savedActiveNote?.dbId ||
                    (savedActiveNote?.isPersisted ? savedActiveNote.id : null);

                const normalizedNotes = serverNotes.map((note) => {
                    const isPasswordProtected = Boolean(note.isPasswordProtected);
                    const savedSession = isPasswordProtected
                        ? readUnlockedNoteSession(note.id)
                        : null;

                    return {
                        ...note,
                        id: note.id,
                        dbId: note.id,
                        isPersisted: true,
                        updatedAt: note.updatedAt
                            ? new Date(note.updatedAt).getTime()
                            : Date.now(),
                        isPublic: note.isPublic ?? true,
                        password: "",
                        isPasswordProtected,
                        content: isPasswordProtected
                            ? (savedSession?.content ?? "")
                            : (note.content || "")
                    };
                });

                setNotes(normalizedNotes);
                setBackendLoaded(true);

                setActiveId((currentId) => {
                    const sharedId = new URL(window.location.href).searchParams.get("note");
                    const sharedNote = normalizedNotes.find(
                        (note) => note.dbId === sharedId || note.id === sharedId
                    );
                    if (sharedNote) return sharedNote.id;

                    // FIX: Match the previous note by its DB ID, not just its old local ID.
                    const previousActiveDatabaseNote = normalizedNotes.find(
                        (note) => note.id === savedActiveDatabaseId ||
                            note.dbId === savedActiveDatabaseId
                    );
                    if (previousActiveDatabaseNote) return previousActiveDatabaseNote.id;

                    const exactIdMatch = normalizedNotes.find(
                        (note) => note.id === currentId || note.dbId === currentId
                    );
                    if (exactIdMatch) return exactIdMatch.id;

                    return normalizedNotes[0]?.id || "";
                });

                localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify(normalizedNotes.map((note) => {
                        const { password, passwordHash, ...safeNote } = note;
                        if (safeNote.isPasswordProtected) safeNote.content = "";
                        return safeNote;
                    }))
                );
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

    const activeNote = notes.find((note) => note.id === activeId) || notes[0] || null;
    const activeDatabaseId = activeNote?.dbId || activeNote?.id;
    const activeToken = activeDatabaseId ? unlockedTokens[activeDatabaseId] : null;
    const isLocked = Boolean(activeNote?.isPasswordProtected && !activeToken);
    const plainContent = getPlainText(activeNote?.content || "");
    const words = plainContent.trim() ? plainContent.trim().split(/\s+/).length : 0;
    const characters = plainContent.length;

    const filteredNotes = notes.filter((note) => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return false;
        return (note.title || "").toLowerCase().includes(query) ||
            getPlainText(note.content || "").toLowerCase().includes(query);
    });

    useEffect(() => {
        const safeNotes = notes.map((note) => {
            const { password, passwordHash, ...safeNote } = note;
            if (safeNote.isPasswordProtected) safeNote.content = "";
            return safeNote;
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(safeNotes));
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

    // Keep valid unlock tokens and note content through same-tab refreshes.
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
        return () => window.clearTimeout(messageTimer.current);
    }, []);

    function notify(text) {
        setMessage(text);
        window.clearTimeout(messageTimer.current);
        messageTimer.current = window.setTimeout(() => setMessage(""), 2500);
    }

    function updateNote(field, value) {
        if (!activeNote || isLocked) return;

        setNotes((previous) => previous.map((note) =>
            note.id === activeNote.id
                ? { ...note, [field]: value, updatedAt: Date.now() }
                : note
        ));
    }

    function addNote() {
        const note = createNewNote();
        setNotes((previous) => [note, ...previous]);
        setActiveId(note.id);
        setSearchQuery("");
        notify("New note created");
    }

    function openSearchResult(note) {
        setActiveId(note.id);
        setSearchQuery("");
        setPasswordInput("");

        if (note.isPasswordProtected && !unlockedTokens[note.dbId || note.id]) {
            setModal("unlock");
        } else {
            setModal("");
        }

        notify("Note opened");
    }

    async function removeNote() {
        if (!activeNote || isLocked) {
            if (isLocked) notify("Delete karne se pehle note unlock karo.");
            return;
        }

        if (window.confirm("Delete this note?") !== true) return;

        if (activeNote.dbId || activeNote.isPersisted) {
            try {
                await api.delete(`/notes/${activeDatabaseId}`, {
                    headers: activeToken
                        ? { Authorization: `Bearer ${activeToken}` }
                        : {}
                });
            } catch (error) {
                console.error("Failed to delete note:", error);
                notify(
                    error.response?.data?.error ||
                    error.response?.data?.message ||
                    "Note delete nahi hui"
                );
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
        const noteId = activeNote?.dbId ||
            (activeNote?.isPersisted ? activeNote.id : null);

        if (!noteId) {
            notify("Share link banane se pehle note ko Save note se save karo.");
            return;
        }

        try {
            await navigator.clipboard.writeText(getShareUrl(noteId));
            notify("Password-protected note link copied.");
        } catch {
            notify("Clipboard access unavailable. Browser URL se link copy karo.");
        }
    }

    async function shareNote() {
        const noteId = activeNote?.dbId ||
            (activeNote?.isPersisted ? activeNote.id : null);

        if (!noteId) {
            notify("Share karne se pehle note ko Save note se save karo.");
            return;
        }

        const url = getShareUrl(noteId);

        if (navigator.share) {
            try {
                await navigator.share({
                    title: activeNote?.title || "NoteNest",
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
            let databaseId = activeNote.dbId ||
                (activeNote.isPersisted ? activeNote.id : null);
            const isNewNote = !databaseId;
            const currentContent = editorRef.current?.innerHTML ?? activeNote.content ?? "";
            const currentTitle = (activeNote.title || "Untitled Note").trim() || "Untitled Note";

            if (!databaseId) {
                const createResponse = await api.post("/notes", {
                    title: currentTitle,
                    content: currentContent
                });

                const created = createResponse.data?.note ||
                    createResponse.data?.data ||
                    createResponse.data;
                databaseId = created?.id;

                if (!databaseId) throw new Error("Backend ne note ID return nahi ki.");

                setNotes((previous) => previous.map((note) =>
                    note.id === activeNote.id
                        ? {
                            ...note,
                            dbId: databaseId,
                            isPersisted: true,
                            title: currentTitle,
                            content: currentContent
                        }
                        : note
                ));
            }

            const token = unlockedTokens[databaseId];

            if (!isNewNote) {
                await api.put(`/notes/${databaseId}`, {
                    title: currentTitle,
                    content: currentContent
                }, {
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

            saveUnlockedNoteSession(
                databaseId,
                newToken,
                returnedNote.content ?? currentContent
            );

            setUnlockedTokens((previous) => ({
                ...previous,
                [databaseId]: newToken
            }));

            setNotes((previous) => previous.map((note) =>
                note.id === activeNote.id
                    ? {
                        ...note,
                        dbId: databaseId,
                        isPersisted: true,
                        isPasswordProtected: true,
                        title: returnedNote.title || currentTitle,
                        content: returnedNote.content ?? currentContent,
                        updatedAt: returnedNote.updatedAt
                            ? new Date(returnedNote.updatedAt).getTime()
                            : Date.now(),
                        password: ""
                    }
                    : note
            ));

            if (editorRef.current) {
                editorRef.current.innerHTML = getEditorHtml(
                    returnedNote.content ?? currentContent
                );
            }

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

            // Save first; React state updates after this line.
            saveUnlockedNoteSession(databaseId, token, note.content || "");

            setUnlockedTokens((previous) => ({
                ...previous,
                [databaseId]: token
            }));

            setNotes((previous) => previous.map((item) =>
                item.id === activeNote.id
                    ? {
                        ...item,
                        content: note.content || "",
                        isPasswordProtected: true,
                        password: ""
                    }
                    : item
            ));

            if (editorRef.current) {
                editorRef.current.innerHTML = getEditorHtml(note.content || "");
            }

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

        try {
            await api.delete(`/notes/${activeDatabaseId}/password`, {
                headers: activeToken
                    ? { Authorization: `Bearer ${activeToken}` }
                    : {}
            });

            setNotes((previous) => previous.map((note) =>
                note.id === activeNote.id
                    ? { ...note, isPasswordProtected: false, password: "" }
                    : note
            ));

            setUnlockedTokens((previous) => {
                const next = { ...previous };
                delete next[activeDatabaseId];
                return next;
            });

            notify("Note password removed.");
        } catch (error) {
            console.error("Remove password error:", error);
            notify(
                error.response?.data?.error ||
                error.response?.data?.message ||
                "Password remove nahi ho saka."
            );
        }
    }

    function changeUrl() {
        const nextId = urlInput.trim().toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");

        if (!nextId) {
            notify("Enter a valid note identifier");
            return;
        }

        if (notes.some((note) => note.id === nextId && note.id !== activeId)) {
            notify("That note identifier is already used");
            return;
        }

        setNotes((previous) => previous.map((note) =>
            note.id === activeId ? { ...note, id: nextId } : note
        ));
        setActiveId(nextId);
        setUrlInput("");
        setModal("");
        notify("Note identifier updated");
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
            const isAlreadySaved = Boolean(activeNote.dbId || activeNote.isPersisted);
            const headers = activeToken
                ? { Authorization: `Bearer ${activeToken}` }
                : {};

            const response = isAlreadySaved
                ? await api.put(`/notes/${activeDatabaseId}`, payload, { headers })
                : await api.post("/notes", payload);

            const responseData = response.data?.note ||
                response.data?.data ||
                response.data;
            const databaseId = responseData?.id || activeDatabaseId || activeNote.id;
            const savedAt = responseData?.updatedAt
                ? new Date(responseData.updatedAt).getTime()
                : Date.now();

            const updatedNote = {
                ...activeNote,
                ...(responseData && typeof responseData === "object" ? responseData : {}),
                id: activeNote.id,
                dbId: databaseId,
                isPersisted: true,
                title: payload.title,
                content,
                isPasswordProtected: Boolean(
                    activeNote.isPasswordProtected || responseData?.isPasswordProtected
                ),
                password: "",
                updatedAt: savedAt
            };

            setNotes((previous) => previous.map((note) =>
                note.id === activeNote.id ? updatedNote : note
            ));

            notify(isAlreadySaved
                ? "Notes Are Update In Database"
                : "Notes Are Save in Database"
            );
        } catch (error) {
            console.error("Failed to save note:", error);
            notify(
                error.response?.data?.error ||
                error.response?.data?.message ||
                "Notes Are Not Save, Please Check Backend ."
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
                    <button
                        className="nn-icon-btn"
                        onClick={() => setDark((value) => !value)}
                        aria-label="Toggle theme"
                    >
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

                <div className="nn-saved"><i /> Auto-saved in this browser</div>

                <div className="nn-header-actions">
                    <button className="nn-url-pill" onClick={copyLink} title="Copy clean page URL">
                        <Link2 size={15} />
                        <span>{window.location.host}{window.location.pathname}</span>
                        <Copy size={14} />
                    </button>
                    <button className="nn-icon-btn" onClick={shareNote} title="Share note">
                        <Share2 size={18} />
                    </button>
                    <button
                        className="nn-icon-btn"
                        onClick={() => setDark((value) => !value)}
                        title="Toggle theme"
                    >
                        {dark ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                </div>
            </header>

            <main className="nn-layout">
                <section className="nn-editor-card">
                    <div className="nn-breadcrumb">
                        <span>My Notes</span><span>/</span><span>Current Note</span>
                        <span className="nn-edit-time"><Clock size={13} /> Edited recently</span>
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
                        <div className="nn-footer-actions">
                            <button className="nn-secondary" onClick={clearText}>Clear text</button>
                            <button className="nn-primary" onClick={saveNow} disabled={isLocked}>
                                <Save size={16} /> Save note
                            </button>
                        </div>
                    </footer>
                </section>

                <aside className="nn-options-card">
                    <div className="nn-panel-title">
                        <div><h2>Note options</h2><p>Manage your writing space</p></div>
                        <Settings2 size={19} />
                    </div>

                    <button className="nn-new-note" onClick={addNote}>
                        <Plus size={17} /> New note
                    </button>

                    <div className="nn-search-box">
                        <label className="nn-search-label" htmlFor="nn-note-search">SEARCH NOTES</label>
                        <div className="nn-search-input-wrap">
                            <Search size={17} />
                            <input
                                id="nn-note-search"
                                type="search"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder="Search title or content..."
                                autoComplete="off"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    className="nn-search-clear"
                                    onClick={() => setSearchQuery("")}
                                    aria-label="Clear search"
                                    title="Clear search"
                                >
                                    <X size={15} />
                                </button>
                            )}
                        </div>

                        {searchQuery.trim() && (
                            <div className="nn-search-results">
                                <p className="nn-search-heading">
                                    {filteredNotes.length} {filteredNotes.length === 1 ? "result" : "results"} found
                                </p>
                                {filteredNotes.length > 0 ? (
                                    filteredNotes.map((note) => {
                                        const snippet = note.isPasswordProtected
                                            ? ""
                                            : getPlainText(note.content || "").replace(/\s+/g, " ").trim();

                                        return (
                                            <button
                                                key={note.id}
                                                type="button"
                                                className={`nn-search-result ${note.id === activeNote.id ? "active" : ""}`}
                                                onClick={() => openSearchResult(note)}
                                            >
                                                <span className="nn-search-result-icon"><FileText size={16} /></span>
                                                <span className="nn-search-result-text">
                                                    <strong>{note.title || "Untitled Note"}</strong>
                                                    <small>
                                                        {snippet
                                                            ? `${snippet.slice(0, 85)}${snippet.length > 85 ? "..." : ""}`
                                                            : "No content yet"}
                                                    </small>
                                                </span>
                                            </button>
                                        );
                                    })
                                ) : (
                                    <div className="nn-search-empty">
                                        <Search size={20} />
                                        <span>No matching notes found.</span>
                                        <small>Try another title or keyword.</small>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="nn-option-group">
                        <p className="nn-group-label">NOTE ACTIONS</p>
                        <button className="nn-option" onClick={downloadNote}>
                            <Download size={17} /><span>Download as .txt</span>
                        </button>
                        <button className="nn-option" onClick={copyLink}>
                            <Copy size={17} /><span>Copy note link</span>
                        </button>
                        <button className="nn-option" onClick={shareNote}>
                            <Share2 size={17} /><span>Share note</span>
                        </button>
                        <button className="nn-option" onClick={removeNote}>
                            <Trash2 size={17} /><span>Delete note</span>
                        </button>
                    </div>

                    <div className="nn-option-group">
                        <p className="nn-group-label">PRIVACY & URL</p>
                        <button className="nn-option" onClick={togglePrivacy}>
                            {activeNote.isPublic ? <Eye size={17} /> : <EyeOff size={17} />}
                            <span>{activeNote.isPublic ? "Public note" : "Private note"}</span>
                            <small>{activeNote.isPublic ? "Public" : "Private"}</small>
                        </button>
                        <button
                            className="nn-option"
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
                            <span>{activeNote.isPasswordProtected ? "Change note password" : "Set note password"}</span>
                        </button>
                        {activeNote.isPasswordProtected && (
                            <button className="nn-option" onClick={removePassword} disabled={isLocked}>
                                <EyeOff size={17} /><span>Remove password</span>
                            </button>
                        )}
                        <button
                            className="nn-option"
                            onClick={() => {
                                setUrlInput(activeNote.id);
                                setModal("url");
                            }}
                        >
                            <Link2 size={17} /><span>Change note URL</span>
                        </button>
                    </div>

                    <div className="nn-stats">
                        <h3><FileText size={16} /> Note statistics</h3>
                        <div><span>Words</span><strong>{words}</strong></div>
                        <div><span>Characters</span><strong>{characters}</strong></div>
                        <div><span>All notes</span><strong>{notes.length}</strong></div>
                    </div>

                    <div className="nn-tip">
                        <BookOpen size={18} />
                        <div>
                            <strong>Your thoughts, your space.</strong>
                            <p>Notes are currently stored in this browser.</p>
                        </div>
                    </div>
                </aside>
            </main>

            {message && (
                <div className="nn-toast"><Check size={16} />{message}</div>
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
                                <p>Choose a short identifier for this note. It will be saved in this browser and will not be added to the browser URL.</p>
                                <label className="nn-field-label">Note identifier</label>
                                <input
                                    className="nn-modal-text-input"
                                    value={urlInput}
                                    onChange={(event) => setUrlInput(event.target.value)}
                                    placeholder="my-new-note"
                                />
                                <button className="nn-primary nn-modal-submit" onClick={changeUrl}>Update identifier</button>
                            </>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}