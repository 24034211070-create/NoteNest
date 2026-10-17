import { useEffect, useRef, useState } from "react";
import {
    BookOpen, Check, Copy, Download, FileText, Link2, LockKeyhole,
    Moon, Plus, Save, Share2, Sun, Trash2, Eye, EyeOff, Bold, Italic,
    Underline, AlignLeft, List, ListOrdered, Type, Settings2, Clock, X,
    Search
} from "lucide-react";
import "./NoteNest.css";
import api from "../../../Api/axios";

const STORAGE_KEY = "notenest-notes";
const THEME_KEY = "notenest-theme";
const ACTIVE_NOTE_KEY = "notenest-active-note";
const UNLOCKED_TOKENS_KEY = "notenest-unlocked-tokens";

function getTokenExpiry(token) {
    try {
        const encoded = token?.split(".")[1];
        if (!encoded) return 0;
        const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
        return Number(payload.exp || 0) * 1000;
    } catch {
        return 0;
    }
}

function readUnlockedNoteSession(noteId) {
    try {
        const saved = JSON.parse(sessionStorage.getItem(UNLOCKED_TOKENS_KEY) || "{}");
        const session = saved[noteId];
        if (session?.token && Number(session.expiresAt) > Date.now() && getTokenExpiry(session.token) > Date.now()) return session;
        return null;
    } catch {
        return null;
    }
}

function readUnlockedTokens() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(UNLOCKED_TOKENS_KEY) || "{}");
        const validTokens = {};
        for (const [noteId, item] of Object.entries(saved)) {
            if (item?.token && Number(item.expiresAt) > Date.now() && getTokenExpiry(item.token) > Date.now()) {
                validTokens[noteId] = item;
            }
        }
        sessionStorage.setItem(UNLOCKED_TOKENS_KEY, JSON.stringify(validTokens));
        return validTokens;
    } catch {
        return {};
    }
}

function getPlainText(html = "") {
    const element = document.createElement("div");
    element.innerHTML = html;
    return element.textContent || element.innerText || "";
}

function createLocalNote(title = "Untitled Note") {
    const now = new Date().toISOString();
    return {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dbId: null,
        isPersisted: false,
        title,
        content: "",
        createdAt: now,
        updatedAt: now,
        isPasswordProtected: false
    };
}

function normalizeNote(note) {
    return {
        ...note,
        id: String(note.id),
        dbId: note.dbId || (String(note.id).startsWith("local-") ? null : note.id),
        isPersisted: Boolean(note.isPersisted || (!String(note.id).startsWith("local-") && note.dbId)),
        title: note.title || "Untitled Note",
        content: note.content || "",
        isPasswordProtected: Boolean(note.isPasswordProtected)
    };
}

export default function NoteNest() {
    const [notes, setNotes] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
            return Array.isArray(saved) ? saved.map(normalizeNote) : [];
        } catch {
            return [];
        }
    });
    const [activeNoteId, setActiveNoteId] = useState(() => localStorage.getItem(ACTIVE_NOTE_KEY) || "");
    const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === "dark");
    const [message, setMessage] = useState("");
    const [modal, setModal] = useState("");
    const [passwordInput, setPasswordInput] = useState("");
    const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
    const [urlInput, setUrlInput] = useState("");
    const [unlockTokens, setUnlockTokens] = useState(() => readUnlockedTokens());
    const [searchQuery, setSearchQuery] = useState("");
    const [backendLoaded, setBackendLoaded] = useState(false);
    const [saveStatus, setSaveStatus] = useState("All changes saved");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [showRemovePasswordConfirm, setShowRemovePasswordConfirm] = useState(false);
    const editorRef = useRef(null);
    const dirtyNotesRef = useRef(new Set());
    const lastSavedRef = useRef({});
    const saveTimersRef = useRef({});
    const messageTimerRef = useRef(null);
    const activeNoteRef = useRef(null);

    const activeNote = notes.find((note) => note.id === activeNoteId) || notes[0] || null;
    activeNoteRef.current = activeNote;

    const isLocked = Boolean(
        activeNote?.isPasswordProtected &&
        !readUnlockedNoteSession(activeNote.id)
    );

    const words = activeNote && !isLocked
        ? getPlainText(activeNote.content || "").trim().split(/\s+/).filter(Boolean).length
        : 0;

    const characters = activeNote && !isLocked
        ? getPlainText(activeNote.content || "").length
        : 0;

    const filteredNotes = notes.filter((note) => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return false;
        if ((note.title || "").toLowerCase().includes(query)) return true;
        if (note.isPasswordProtected) return false;
        return getPlainText(note.content || "").toLowerCase().includes(query);
    });

    function notify(text) {
        setMessage(text);
        if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
        messageTimerRef.current = setTimeout(() => setMessage(""), 2600);
    }

    function persistLocalNotes(nextNotes) {
        try {
            const safeNotes = nextNotes.map((note) => ({
                ...note,
                content: note.isPasswordProtected ? "" : note.content
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(safeNotes));
        } catch (error) {
            console.error("Could not save notes locally:", error);
        }
    }

    function setActiveNote(note) {
        setActiveNoteId(note.id);
        localStorage.setItem(ACTIVE_NOTE_KEY, note.id);
    }

    function getAuthConfig(note) {
        const session = readUnlockedNoteSession(note.id);
        return session?.token
            ? { headers: { Authorization: `Bearer ${session.token}` } }
            : {};
    }

    async function saveNoteToBackend(note) {
        if (!note || note.isPasswordProtected && isLocked) return;
        try {
            setSaveStatus("Saving...");
            const payload = {
                title: note.title || "Untitled Note",
                content: note.content || ""
            };
            let response;
            if (note.dbId || note.isPersisted) {
                response = await api.patch(`/notes/${note.dbId || note.id}`, payload, getAuthConfig(note));
            } else {
                response = await api.post("/notes", payload);
            }
            const savedData = response?.data?.note || response?.data;
            if (savedData && savedData.id) {
                setNotes((previous) => {
                    const updated = previous.map((item) => item.id === note.id
                        ? normalizeNote({
                            ...item,
                            ...savedData,
                            id: item.id,
                            dbId: savedData.id,
                            isPersisted: true,
                            isPasswordProtected: Boolean(savedData.isPasswordProtected ?? item.isPasswordProtected)
                        })
                        : item);
                    persistLocalNotes(updated);
                    return updated;
                });
            }
            dirtyNotesRef.current.delete(note.id);
            lastSavedRef.current[note.id] = `${note.title}|${note.content}`;
            setSaveStatus("All changes saved");
        } catch (error) {
            console.error("Note save failed:", error);
            setSaveStatus("Save failed");
            notify("Note save nahi ho paaya. Connection check karo.");
        }
    }

    function scheduleAutosave(note) {
        if (!note || isLocked) return;
        dirtyNotesRef.current.add(note.id);
        setSaveStatus("Unsaved changes");
        if (saveTimersRef.current[note.id]) clearTimeout(saveTimersRef.current[note.id]);
        saveTimersRef.current[note.id] = setTimeout(() => {
            const latest = activeNoteRef.current;
            const target = notes.find((item) => item.id === note.id);
            if (target) saveNoteToBackend({ ...target, ...(latest?.id === note.id ? latest : {}) });
        }, 700);
    }

    function updateNote(field, value) {
        if (!activeNote || isLocked) return;
        const updatedAt = new Date().toISOString();
        setNotes((previous) => {
            const updated = previous.map((note) => note.id === activeNote.id
                ? { ...note, [field]: value, updatedAt }
                : note);
            persistLocalNotes(updated);
            return updated;
        });
        const updatedNote = { ...activeNote, [field]: value, updatedAt };
        activeNoteRef.current = updatedNote;
        scheduleAutosave(updatedNote);
    }

    async function saveNow() {
        if (!activeNote || isLocked) return;
        if (saveTimersRef.current[activeNote.id]) clearTimeout(saveTimersRef.current[activeNote.id]);
        await saveNoteToBackend(activeNoteRef.current || activeNote);
    }

    async function loadNotesFromBackend() {
        try {
            const response = await api.get("/notes");
            const remoteNotes = Array.isArray(response.data) ? response.data : response.data?.notes || [];
            const normalized = remoteNotes.map((note) => normalizeNote({
                ...note,
                dbId: note.id,
                isPersisted: true,
                content: note.isPasswordProtected ? "" : note.content
            }));
            setNotes((previous) => {
                const localUnsaved = previous.filter((note) => !note.isPersisted);
                const combined = [...normalized];
                localUnsaved.forEach((note) => {
                    if (!combined.some((item) => item.id === note.id)) combined.push(note);
                });
                if (!combined.length) combined.push(createLocalNote("Welcome to NoteNest"));
                persistLocalNotes(combined);
                const storedActive = localStorage.getItem(ACTIVE_NOTE_KEY);
                const chosen = combined.find((note) => note.id === storedActive) || combined[0];
                if (chosen) {
                    setActiveNoteId(chosen.id);
                    localStorage.setItem(ACTIVE_NOTE_KEY, chosen.id);
                }
                return combined;
            });
        } catch (error) {
            console.error("Could not load notes:", error);
            setSaveStatus("Offline mode");
        } finally {
            setBackendLoaded(true);
        }
    }

    useEffect(() => {
        loadNotesFromBackend();
        return () => {
            Object.values(saveTimersRef.current).forEach((timer) => clearTimeout(timer));
            if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
        };
    }, []);

    useEffect(() => {
        localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    }, [dark]);

    useEffect(() => {
        if (!activeNote || !editorRef.current) return;
        if (isLocked) {
            editorRef.current.innerHTML = "";
            return;
        }
        if (editorRef.current.innerHTML !== activeNote.content) {
            editorRef.current.innerHTML = activeNote.content || "";
        }
    }, [activeNote?.id, activeNote?.content, isLocked]);

    useEffect(() => {
        if (activeNote) {
            localStorage.setItem(ACTIVE_NOTE_KEY, activeNote.id);
        }
    }, [activeNote?.id]);

    function formatText(command) {
        if (isLocked) {
            notify("Pehle note unlock karo.");
            return;
        }
        editorRef.current?.focus();
        document.execCommand(command, false, null);
        if (editorRef.current) updateNote("content", editorRef.current.innerHTML);
    }

    function addNote() {
        const note = createLocalNote(`Note ${notes.length + 1}`);
        setNotes((previous) => {
            const updated = [...previous, note];
            persistLocalNotes(updated);
            return updated;
        });
        setActiveNote(note);
        if (editorRef.current) editorRef.current.innerHTML = "";
        notify("New note created");
    }

    function openSearchResult(note) {
        setActiveNote(note);
        setSearchQuery("");
        if (note.isPasswordProtected && !readUnlockedNoteSession(note.id)) {
            setPasswordInput("");
            setModal("unlock");
        }
    }

    async function removeNote() {
        if (!activeNote) return;
        if (activeNote.isPasswordProtected && isLocked) {
            notify("Delete karne se pehle note unlock karo.");
            return;
        }
        const confirmed = window.confirm("Are you sure you want to delete this note?");
        if (!confirmed) return;
        try {
            if (activeNote.dbId || activeNote.isPersisted) {
                await api.delete(`/notes/${activeNote.dbId || activeNote.id}`, getAuthConfig(activeNote));
            }
            const remaining = notes.filter((note) => note.id !== activeNote.id);
            if (!remaining.length) remaining.push(createLocalNote("Welcome to NoteNest"));
            setNotes(remaining);
            persistLocalNotes(remaining);
            setActiveNote(remaining[0]);
            notify("Note deleted");
        } catch (error) {
            console.error("Note delete failed:", error);
            notify("Note delete nahi ho paaya.");
        }
    }

    function downloadNote() {
        if (!activeNote || isLocked) {
            notify("Download karne se pehle note unlock karo.");
            return;
        }
        const blob = new Blob([getPlainText(activeNote.content || "")], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${(activeNote.title || "NoteNest").replace(/[^\w\- ]/g, "").trim() || "NoteNest"}.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    async function copyLink() {
        if (!activeNote) return;
        const url = new URL(window.location.href);
        url.searchParams.set("note", activeNote.id);
        try {
            await navigator.clipboard.writeText(url.toString());
            notify("Note link copied");
        } catch {
            notify("Link copy nahi hua.");
        }
    }

    async function shareNote() {
        if (!activeNote) return;
        if (isLocked) {
            notify("Share karne se pehle note unlock karo.");
            return;
        }
        const url = new URL(window.location.href);
        url.searchParams.set("note", activeNote.id);
        if (navigator.share) {
            try {
                await navigator.share({ title: activeNote.title || "NoteNest note", text: getPlainText(activeNote.content || "").slice(0, 200), url: url.toString() });
            } catch (error) {
                if (error?.name !== "AbortError") notify("Share nahi ho paaya.");
            }
        } else {
            copyLink();
        }
    }

    function togglePrivacy() {
        notify("Privacy settings server par password protection ke through manage hoti hain.");
    }

    async function savePassword() {
        if (!activeNote) return;
        if (passwordInput.length < 8) {
            notify("Password kam se kam 8 characters ka hona chahiye.");
            return;
        }
        if (passwordInput !== confirmPasswordInput) {
            notify("Dono passwords match nahi kar rahe.");
            return;
        }
        try {
            const response = await api.post(`/notes/${activeNote.dbId || activeNote.id}/password`, {
                password: passwordInput
            }, getAuthConfig(activeNote));
            const updatedNote = response.data?.note || response.data;
            setNotes((previous) => {
                const updated = previous.map((note) => note.id === activeNote.id
                    ? { ...note, isPasswordProtected: true, content: note.content, dbId: updatedNote?.id || note.dbId, isPersisted: true }
                    : note);
                persistLocalNotes(updated);
                return updated;
            });
            setPasswordInput("");
            setConfirmPasswordInput("");
            setModal("");
            notify("Password protection enabled");
            await loadNotesFromBackend();
        } catch (error) {
            console.error("Set password failed:", error);
            notify(error.response?.data?.message || "Password set nahi ho paaya.");
        }
    }

    async function unlockNote() {
        if (!activeNote) return;
        try {
            const response = await api.post(`/notes/${activeNote.dbId || activeNote.id}/unlock`, {
                password: passwordInput
            });
            const data = response.data || {};
            if (!data.token) throw new Error("Unlock token missing");
            const session = {
                token: data.token,
                expiresAt: getTokenExpiry(data.token)
            };
            const nextTokens = { ...readUnlockedTokens(), [activeNote.id]: session };
            sessionStorage.setItem(UNLOCKED_TOKENS_KEY, JSON.stringify(nextTokens));
            setUnlockTokens(nextTokens);
            const unlockedNote = data.note || data;
            setNotes((previous) => {
                const updated = previous.map((note) => note.id === activeNote.id
                    ? { ...note, content: unlockedNote.content || note.content, isPasswordProtected: true }
                    : note);
                persistLocalNotes(updated);
                return updated;
            });
            setPasswordInput("");
            setModal("");
            notify("Note unlocked");
        } catch (error) {
            console.error("Unlock failed:", error);
            notify(error.response?.data?.message || "Password incorrect hai.");
        }
    }

    async function removePassword() {
        if (!activeNote) return;
        if (isLocked) {
            notify("Password remove karne se pehle note unlock karo.");
            return;
        }
        try {
            await api.delete(`/notes/${activeNote.dbId || activeNote.id}/password`, getAuthConfig(activeNote));
            setUnlockTokens((previous) => {
                const updated = { ...previous };
                delete updated[activeNote.id];
                sessionStorage.setItem(UNLOCKED_TOKENS_KEY, JSON.stringify(updated));
                return updated;
            });
            setNotes((previous) => {
                const updated = previous.map((note) => note.id === activeNote.id
                    ? { ...note, isPasswordProtected: false }
                    : note);
                persistLocalNotes(updated);
                return updated;
            });
            setShowRemovePasswordConfirm(false);
            notify("Password protection removed");
            await loadNotesFromBackend();
        } catch (error) {
            console.error("Remove password failed:", error);
            notify(error.response?.data?.message || "Password remove nahi ho paaya.");
        }
    }

    async function changeUrl() {
        if (!activeNote) return;
        const newId = urlInput.trim();
        if (!newId) {
            notify("Note identifier khaali nahi ho sakta.");
            return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(newId)) {
            notify("Sirf letters, numbers, hyphen aur underscore use karo.");
            return;
        }
        if (notes.some((note) => note.id === newId && note.id !== activeNote.id)) {
            notify("Ye identifier already use ho raha hai.");
            return;
        }
        if (activeNote.isPersisted && activeNote.dbId && newId !== activeNote.id) {
            notify("Saved database note ka URL identifier is version mein change nahi hota.");
            return;
        }
        setNotes((previous) => {
            const updated = previous.map((note) => note.id === activeNote.id ? { ...note, id: newId } : note);
            persistLocalNotes(updated);
            return updated;
        });
        setActiveNoteId(newId);
        localStorage.setItem(ACTIVE_NOTE_KEY, newId);
        setModal("");
        notify("Note URL updated");
    }

    function clearText() {
        if (!activeNote || isLocked) {
            notify("Pehle note unlock karo.");
            return;
        }
        if (!window.confirm("Clear all content from this note?")) return;
        if (editorRef.current) editorRef.current.innerHTML = "";
        updateNote("content", "");
        notify("Note content cleared");
    }

    if (!activeNote && backendLoaded) {
        return (
            <div className={`notenest-app ${dark ? "dark-mode" : ""}`}>
                <div className="nn-empty">
                    <BookOpen size={42} />
                    <h2>No notes yet</h2>
                    <button className="nn-primary" onClick={addNote}><Plus size={17} /> Create your first note</button>
                </div>
            </div>
        );
    }

    if (!activeNote) return <div className="notenest-app"><p>Loading NoteNest...</p></div>;

    return (
        <div className={`notenest-app ${dark ? "dark-mode" : ""}`}>
            <header className="nn-header">
                <a className="nn-brand" href="/" aria-label="NoteNest home">
                    <span className="nn-brand-icon"><BookOpen size={21} /></span>
                    Note<span>Nest</span>
                </a>
                <div className="nn-saved"><i /> {saveStatus}</div>
                <div className="nn-header-actions">
                    <button className="nn-url-pill" onClick={copyLink} title="Copy clean page URL">
                        <Link2 size={15} />
                        <span>{window.location.host}{window.location.pathname}</span>
                        <Copy size={14} />
                    </button>
                    <button className="nn-icon-btn" onClick={shareNote} title="Share note"><Share2 size={18} /></button>
                    <button className="nn-icon-btn" onClick={() => setDark((value) => !value)} title="Toggle theme">
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
                        <button type="button" onClick={() => formatText("bold")} title="Bold"><Bold size={17} /></button>
                        <button type="button" onClick={() => formatText("italic")} title="Italic"><Italic size={17} /></button>
                        <button type="button" onClick={() => formatText("underline")} title="Underline"><Underline size={17} /></button>
                        <span className="nn-toolbar-divider" />
                        <button type="button" onClick={() => formatText("justifyLeft")} title="Align left"><AlignLeft size={17} /></button>
                        <button type="button" onClick={() => formatText("insertUnorderedList")} title="Bullet list"><List size={17} /></button>
                        <button type="button" onClick={() => formatText("insertOrderedList")} title="Numbered list"><ListOrdered size={17} /></button>
                        <span className="nn-toolbar-divider" />
                        <button type="button" onClick={() => formatText("removeFormat")} title="Remove formatting"><Type size={17} /></button>
                        <span className="nn-toolbar-divider" />
                        <button type="button" onClick={downloadNote} title="Download note"><Download size={17} /></button>
                        <button type="button" onClick={copyLink} title="Copy note link"><Copy size={17} /></button>
                        <button type="button" onClick={shareNote} title="Share note"><Share2 size={17} /></button>
                        <button type="button" onClick={() => setDark(value => !value)} title="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
                        <button type="button" onClick={() => {
                            if (activeNote.isPasswordProtected && isLocked) {
                                setPasswordInput("");
                                setModal("unlock");
                                notify("Password change karne se pehle note unlock karo.");
                                return;
                            }
                            setPasswordInput("");
                            setConfirmPasswordInput("");
                            setModal("password");
                        }} title={activeNote.isPasswordProtected ? "Change password" : "Set password"}><LockKeyhole size={17} /></button>
                        <button type="button" onClick={() => {
                            setUrlInput(activeNote.id);
                            setModal("url");
                        }} title="Change note URL"><Link2 size={17} /></button>
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
                            <button className="nn-primary" onClick={saveNow} disabled={isLocked}><Save size={16} /> Save note</button>
                        </div>
                    </footer>
                </section>
            </main>
            {message && <div className="nn-toast"><Check size={16} />{message}</div>}
            {modal && (
                <div className="nn-modal-backdrop" onClick={() => setModal("")}>
                    <section className="nn-modal" onClick={(event) => event.stopPropagation()}>
                        <button className="nn-modal-close" onClick={() => setModal("")} aria-label="Close"><X size={18} /></button>
                        {modal === "password" ? (
                            <>
                                <div className="nn-modal-icon"><LockKeyhole size={22} /></div>
                                <h2>{activeNote.isPasswordProtected ? "Change note password" : "Set note password"}</h2>
                                <p>Use at least 8 characters. The password is securely hashed on the server; the original password is never saved in your notes.</p>
                                <label className="nn-field-label">Password</label>
                                <div className="nn-password-input">
                                    <input type={showPassword ? "text" : "password"} value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} placeholder="Enter password" autoComplete="new-password" />
                                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Toggle password visibility">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                                </div>
                                <label className="nn-field-label">Confirm password</label>
                                <div className="nn-password-input">
                                    <input type={showConfirmPassword ? "text" : "password"} value={confirmPasswordInput} onChange={(event) => setConfirmPasswordInput(event.target.value)} placeholder="Confirm password" autoComplete="new-password" />
                                    <button type="button" onClick={() => setShowConfirmPassword((value) => !value)} aria-label="Toggle confirm password visibility">{showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                                </div>
                                <button className="nn-primary nn-modal-submit" onClick={savePassword}>Save password</button>
                            </>
                        ) : modal === "unlock" ? (
                            <>
                                <div className="nn-modal-icon"><LockKeyhole size={22} /></div>
                                <h2>Unlock protected note</h2>
                                <p>Enter the password to view and edit this note. Cancelling keeps the content hidden.</p>
                                <label className="nn-field-label">Password</label>
                                <div className="nn-password-input">
                                    <input type={showPassword ? "text" : "password"} value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} placeholder="Enter note password" autoComplete="current-password" />
                                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Toggle password visibility">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                                </div>
                                <button className="nn-primary nn-modal-submit" onClick={unlockNote}>Unlock note</button>
                            </>
                        ) : (
                            <>
                                <div className="nn-modal-icon"><Link2 size={22} /></div>
                                <h2>Change note URL</h2>
                                <p>Choose a short identifier for this note. It will be saved in this browser and will not be added to the browser URL.</p>
                                <label className="nn-field-label">Note identifier</label>
                                <input className="nn-modal-text-input" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="my-new-note" />
                                <button className="nn-primary nn-modal-submit" onClick={changeUrl}>Update identifier</button>
                            </>
                        )}
                    </section>
                </div>
            )}
            {showRemovePasswordConfirm && (
                <div className="nn-modal-backdrop" onClick={() => setShowRemovePasswordConfirm(false)}>
                    <section className="nn-modal" onClick={(event) => event.stopPropagation()}>
                        <button className="nn-modal-close" onClick={() => setShowRemovePasswordConfirm(false)} aria-label="Close"><X size={18} /></button>
                        <div className="nn-modal-icon"><LockKeyhole size={22} /></div>
                        <h2>Remove password?</h2>
                        <p>Are you sure you want to remove password protection from this note?</p>
                        <div className="nn-confirm-actions">
                            <button className="nn-primary" onClick={removePassword}>Yes, remove password</button>
                            <button className="nn-secondary" onClick={() => setShowRemovePasswordConfirm(false)}>Cancel</button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}