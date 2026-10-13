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
    content:
        "Welcome to your personal writing space.\n\nCapture your ideas, organize your thoughts, and keep everything that matters in one place.\n\nStart writing something amazing today!",
    updatedAt: Date.now(),
    isPublic: true,
    password: ""
};

function readNotes() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : [initialNote];
    } catch {
        return [initialNote];
    }
}

function getInitialActiveId() {
    const savedId = localStorage.getItem(ACTIVE_NOTE_KEY);
    const savedNotes = readNotes();

    if (savedId && savedNotes.some((note) => note.id === savedId)) {
        return savedId;
    }

    return savedNotes[0]?.id || "";
}

function getPlainText(content = "") {
    const element = document.createElement("div");
    element.innerHTML = content;
    return element.innerText || element.textContent || "";
}

function getEditorHtml(content = "") {
    if (/<\/?[a-z][\s\S]*>/i.test(content)) {
        return content;
    }

    return content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\r?\n/g, "<br>");
}

// Current page ka URL bina note query parameter ke return karta hai.
function getCleanCurrentUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("note");
    return url.toString();
}

export default function NoteNest() {
    const [notes, setNotes] = useState(readNotes);
    const [activeId, setActiveId] = useState(getInitialActiveId);

    const [dark, setDark] = useState(
        () => localStorage.getItem(THEME_KEY) === "dark"
    );

    const [message, setMessage] = useState("");
    const [modal, setModal] = useState("");
    const [passwordInput, setPasswordInput] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [urlInput, setUrlInput] = useState("");
    const [searchQuery, setSearchQuery] = useState("");

    const editorRef = useRef(null);
    const messageTimer = useRef(null);

    // Backend se saved notes load karo.
    // Database ID ko dbId mein preserve karte hain.
    // Backend se notes load karo.
    // Agar backend empty array return kare, to localStorage ki notes preserve karo.
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

                // Backend mein notes nahi hain, to local notes ko empty mat karo.
                if (serverNotes.length === 0) {
                    const localNotes = readNotes();

                    setNotes(localNotes);
                    setActiveId((currentId) =>
                        localNotes.some((note) => note.id === currentId)
                            ? currentId
                            : localNotes[0]?.id || ""
                    );

                    return;
                }

                const normalizedNotes = serverNotes.map((note) => ({
                    ...note,
                    id: note.id,
                    dbId: note.id,
                    isPersisted: true,
                    updatedAt: note.updatedAt
                        ? new Date(note.updatedAt).getTime()
                        : Date.now(),
                    isPublic: note.isPublic ?? true,
                    password: note.password ?? ""
                }));

                setNotes(normalizedNotes);
                setActiveId((currentId) =>
                    normalizedNotes.some((note) => note.id === currentId)
                        ? currentId
                        : normalizedNotes[0]?.id || ""
                );

                localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify(normalizedNotes)
                );
            } catch (error) {
                console.error("Failed to load notes:", error);

                if (!cancelled) {
                    // Backend unavailable ho to local notes dikhate raho.
                    const localNotes = readNotes();
                    setNotes(localNotes);
                    setActiveId((currentId) =>
                        localNotes.some((note) => note.id === currentId)
                            ? currentId
                            : localNotes[0]?.id || ""
                    );
                    notify("Local notes loaded; backend connection check karo.");
                }
            }
        }

        loadNotes();

        return () => {
            cancelled = true;
        };
    }, []);

    const activeNote =
        notes.find((note) => note.id === activeId) || notes[0] || null;

    const plainContent = getPlainText(activeNote?.content || "");

    const words = plainContent.trim()
        ? plainContent.trim().split(/\s+/).length
        : 0;

    const characters = plainContent.length;

    const filteredNotes = notes.filter((note) => {
        const query = searchQuery.trim().toLowerCase();

        if (!query) return false;

        const title = (note.title || "").toLowerCase();
        const content = getPlainText(note.content || "").toLowerCase();

        return title.includes(query) || content.includes(query);
    });

    // Notes ko browser storage mein save karta hai.
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    }, [notes]);

    // Theme preference save karta hai.
    useEffect(() => {
        localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    }, [dark]);

    // Purana ?note=... parameter remove karta hai.
    // Naya query parameter add nahi karta.
    useEffect(() => {
        const url = new URL(window.location.href);

        if (url.searchParams.has("note")) {
            url.searchParams.delete("note");

            window.history.replaceState(
                {},
                "",
                url.pathname + url.search + url.hash
            );
        }
    }, []);

    // Active note ID localStorage mein save karta hai
    // aur selected note ka content editor mein dikhata hai.
    useEffect(() => {
        if (!activeId) {
            localStorage.removeItem(ACTIVE_NOTE_KEY);
            return;
        }

        localStorage.setItem(ACTIVE_NOTE_KEY, activeId);

        if (activeNote && editorRef.current) {
            editorRef.current.innerHTML = getEditorHtml(
                activeNote.content || ""
            );
        }
    }, [activeId]);

    useEffect(() => {
        return () => window.clearTimeout(messageTimer.current);
    }, []);

    function notify(text) {
        setMessage(text);
        window.clearTimeout(messageTimer.current);

        messageTimer.current = window.setTimeout(() => {
            setMessage("");
        }, 2500);
    }

    function updateNote(field, value) {
        if (!activeNote) return;

        setNotes((previous) =>
            previous.map((note) =>
                note.id === activeNote.id
                    ? { ...note, [field]: value, updatedAt: Date.now() }
                    : note
            )
        );
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
        notify("Note opened");
    }

    async function removeNote() {
        if (!activeNote || !window.confirm("Delete this note?")) return;

        // Database mein saved note ko backend se delete karo.
        if (activeNote.dbId || activeNote.isPersisted) {
            try {
                await api.delete(
                    `/notes/${activeNote.dbId || activeNote.id}`
                );
            } catch (error) {
                console.error("Failed to delete note:", error);

                notify(
                    error.response?.data?.message || "Note delete nahi hui"
                );

                return;
            }
        }

        const remaining = notes.filter(
            (note) => note.id !== activeNote.id
        );

        setNotes(remaining);
        setActiveId(remaining[0]?.id || "");

        notify("Note deleted");
    }

    function clearText() {
        if (
            !activeNote ||
            !window.confirm("Clear all text in this note?")
        ) {
            return;
        }

        updateNote("content", "");

        if (editorRef.current) {
            editorRef.current.innerHTML = "";
        }

        notify("Note text cleared");
    }

    function downloadNote() {
        if (!activeNote) return;

        const blob = new Blob(
            [
                `${activeNote.title}\n\n${getPlainText(
                    activeNote.content
                )}`
            ],
            { type: "text/plain;charset=utf-8" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;

        link.download = `${(
            activeNote.title || "notenest-note"
        ).replace(/[\\/:*?"<>|]/g, "-")}.txt`;

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);

        notify("Note downloaded");
    }

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(getCleanCurrentUrl());
            notify("Clean page URL copied");
        } catch {
            notify(
                "Clipboard access unavailable. Copy the URL from your browser."
            );
        }
    }

    async function shareNote() {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: activeNote?.title || "NoteNest",
                    text: "A note from NoteNest",
                    url: getCleanCurrentUrl()
                });
            } catch {
                // Share dialog close hone par koi action zaroori nahi.
            }
        } else {
            await copyLink();
        }
    }

    function formatText(command) {
        if (!editorRef.current) return;

        editorRef.current.focus();
        document.execCommand(command, false, null);

        updateNote("content", editorRef.current.innerHTML);
    }

    function savePassword() {
        if (!passwordInput.trim()) {
            notify("Please enter a password");
            return;
        }

        updateNote("password", passwordInput);
        setPasswordInput("");
        setModal("");

        notify("Password setting saved on this browser");
    }

    function changeUrl() {
        const nextId = urlInput
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");

        if (!nextId) {
            notify("Enter a valid note identifier");
            return;
        }

        if (
            notes.some(
                (note) => note.id === nextId && note.id !== activeId
            )
        ) {
            notify("That note identifier is already used");
            return;
        }

        setNotes((previous) =>
            previous.map((note) =>
                note.id === activeId
                    ? { ...note, id: nextId }
                    : note
            )
        );

        setActiveId(nextId);
        setUrlInput("");
        setModal("");

        notify("Note identifier updated");
    }

    function togglePrivacy() {
        if (!activeNote) return;

        updateNote("isPublic", !activeNote.isPublic);

        notify(
            activeNote.isPublic
                ? "Marked private on this browser"
                : "Marked public on this browser"
        );
    }

    // Note ko database mein create ya update karta hai.
    async function saveNow() {
        if (!activeNote) return;

        const content =
            editorRef.current?.innerHTML ?? activeNote.content ?? "";

        const payload = {
            title:
                (activeNote.title || "Untitled Note").trim() ||
                "Untitled Note",
            content
        };

        try {
            const isAlreadySaved = Boolean(
                activeNote.dbId || activeNote.isPersisted
            );

            const response = isAlreadySaved
                ? await api.put(
                    `/notes/${activeNote.dbId || activeNote.id}`,
                    payload
                )
                : await api.post("/notes", payload);

            const responseData =
                response.data?.note ||
                response.data?.data ||
                response.data;

            const databaseId =
                responseData?.id ||
                activeNote.dbId ||
                activeNote.id;

            const savedAt = responseData?.updatedAt
                ? new Date(responseData.updatedAt).getTime()
                : Date.now();

            const updatedNote = {
                ...activeNote,
                ...(responseData && typeof responseData === "object"
                    ? responseData
                    : {}),
                id: activeNote.id,
                dbId: databaseId,
                isPersisted: true,
                title: payload.title,
                content,
                updatedAt: savedAt
            };

            const updatedNotes = notes.map((note) =>
                note.id === activeNote.id ? updatedNote : note
            );

            setNotes(updatedNotes);

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(updatedNotes)
            );

            notify(
                isAlreadySaved
                    ? "Note database mein update ho gayi"
                    : "Note database mein save ho gayi"
            );
        } catch (error) {
            console.error("Failed to save note:", error);

            notify(
                error.response?.data?.message ||
                "Note save nahi hui. Backend check karo."
            );
        }
    }

    if (!activeNote) {
        return (
            <div className={`notenest-app ${dark ? "dark-mode" : ""}`}>
                <header className="nn-header">
                    <a className="nn-brand" href="/">
                        <span className="nn-brand-icon">
                            <BookOpen size={21} />
                        </span>
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
                <a
                    className="nn-brand"
                    href="/"
                    aria-label="NoteNest home"
                >
                    <span className="nn-brand-icon">
                        <BookOpen size={21} />
                    </span>
                    Note<span>Nest</span>
                </a>

                <div className="nn-saved">
                    <i /> Auto-saved in this browser
                </div>

                <div className="nn-header-actions">
                    <button
                        className="nn-url-pill"
                        onClick={copyLink}
                        title="Copy clean page URL"
                    >
                        <Link2 size={15} />
                        <span>
                            {window.location.host}
                            {window.location.pathname}
                        </span>
                        <Copy size={14} />
                    </button>

                    <button
                        className="nn-icon-btn"
                        onClick={shareNote}
                        title="Share note"
                    >
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
                        <span>My Notes</span>
                        <span>/</span>
                        <span>Current Note</span>

                        <span className="nn-edit-time">
                            <Clock size={13} /> Edited recently
                        </span>
                    </div>

                    <input
                        className="nn-title-input"
                        value={activeNote.title}
                        onChange={(event) =>
                            updateNote("title", event.target.value)
                        }
                        placeholder="Give your note a title..."
                        aria-label="Note title"
                    />

                    <div className="nn-toolbar">
                        <button
                            onClick={() => formatText("bold")}
                            title="Bold"
                        >
                            <Bold size={17} />
                        </button>

                        <button
                            onClick={() => formatText("italic")}
                            title="Italic"
                        >
                            <Italic size={17} />
                        </button>

                        <button
                            onClick={() => formatText("underline")}
                            title="Underline"
                        >
                            <Underline size={17} />
                        </button>

                        <span />

                        <button
                            onClick={() => formatText("justifyLeft")}
                            title="Align left"
                        >
                            <AlignLeft size={17} />
                        </button>

                        <button
                            onClick={() => formatText("insertUnorderedList")}
                            title="Bullet list"
                        >
                            <List size={17} />
                        </button>

                        <button
                            onClick={() => formatText("insertOrderedList")}
                            title="Numbered list"
                        >
                            <ListOrdered size={17} />
                        </button>

                        <span />

                        <button
                            onClick={() => formatText("removeFormat")}
                            title="Remove formatting"
                        >
                            <Type size={17} />
                        </button>
                    </div>

                    <div
                        ref={editorRef}
                        className="nn-writing-area"
                        contentEditable
                        suppressContentEditableWarning
                        role="textbox"
                        aria-label="Note content"
                        data-placeholder="Start writing your thoughts here..."
                        onInput={(event) =>
                            updateNote(
                                "content",
                                event.currentTarget.innerHTML
                            )
                        }
                    />

                    <footer className="nn-editor-footer">
                        <div className="nn-counts">
                            <span>{words} words</span>
                            <b>·</b>
                            <span>{characters} characters</span>
                        </div>

                        <div className="nn-footer-actions">
                            <button
                                className="nn-secondary"
                                onClick={clearText}
                            >
                                Clear text
                            </button>

                            <button
                                className="nn-primary"
                                onClick={saveNow}
                            >
                                <Save size={16} /> Save note
                            </button>
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

                    <button className="nn-new-note" onClick={addNote}>
                        <Plus size={17} /> New note
                    </button>

                    {/* SEARCH NOTES */}
                    <div className="nn-search-box">
                        <label
                            className="nn-search-label"
                            htmlFor="nn-note-search"
                        >
                            SEARCH NOTES
                        </label>

                        <div className="nn-search-input-wrap">
                            <Search size={17} />

                            <input
                                id="nn-note-search"
                                type="search"
                                value={searchQuery}
                                onChange={(event) =>
                                    setSearchQuery(event.target.value)
                                }
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
                                    {filteredNotes.length}{" "}
                                    {filteredNotes.length === 1
                                        ? "result"
                                        : "results"}{" "}
                                    found
                                </p>

                                {filteredNotes.length > 0 ? (
                                    filteredNotes.map((note) => {
                                        const snippet = getPlainText(
                                            note.content || ""
                                        )
                                            .replace(/\s+/g, " ")
                                            .trim();

                                        return (
                                            <button
                                                key={note.id}
                                                type="button"
                                                className={`nn-search-result ${note.id === activeNote.id
                                                    ? "active"
                                                    : ""
                                                    }`}
                                                onClick={() =>
                                                    openSearchResult(note)
                                                }
                                            >
                                                <span className="nn-search-result-icon">
                                                    <FileText size={16} />
                                                </span>

                                                <span className="nn-search-result-text">
                                                    <strong>
                                                        {note.title ||
                                                            "Untitled Note"}
                                                    </strong>

                                                    <small>
                                                        {snippet
                                                            ? `${snippet.slice(
                                                                0,
                                                                85
                                                            )}${snippet.length > 85
                                                                ? "..."
                                                                : ""
                                                            }`
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
                                        <small>
                                            Try another title or keyword.
                                        </small>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="nn-option-group">
                        <p className="nn-group-label">NOTE ACTIONS</p>

                        <button className="nn-option" onClick={downloadNote}>
                            <Download size={17} />
                            <span>Download as .txt</span>
                        </button>

                        <button className="nn-option" onClick={copyLink}>
                            <Copy size={17} />
                            <span>Copy note link</span>
                        </button>

                        <button className="nn-option" onClick={shareNote}>
                            <Share2 size={17} />
                            <span>Share note</span>
                        </button>

                        <button className="nn-option" onClick={removeNote}>
                            <Trash2 size={17} />
                            <span>Delete note</span>
                        </button>
                    </div>

                    <div className="nn-option-group">
                        <p className="nn-group-label">PRIVACY & URL</p>

                        <button className="nn-option" onClick={togglePrivacy}>
                            {activeNote.isPublic ? (
                                <Eye size={17} />
                            ) : (
                                <EyeOff size={17} />
                            )}

                            <span>
                                {activeNote.isPublic
                                    ? "Public note"
                                    : "Private note"}
                            </span>

                            <small>
                                {activeNote.isPublic ? "Public" : "Private"}
                            </small>
                        </button>

                        <button
                            className="nn-option"
                            onClick={() => setModal("password")}
                        >
                            <LockKeyhole size={17} />
                            <span>Set note password</span>
                        </button>

                        {activeNote.password && (
                            <button
                                className="nn-option"
                                onClick={() => {
                                    updateNote("password", "");
                                    notify("Password setting removed");
                                }}
                            >
                                <EyeOff size={17} />
                                <span>Remove password</span>
                            </button>
                        )}

                        <button
                            className="nn-option"
                            onClick={() => {
                                setUrlInput(activeNote.id);
                                setModal("url");
                            }}
                        >
                            <Link2 size={17} />
                            <span>Change note URL</span>
                        </button>
                    </div>

                    <div className="nn-stats">
                        <h3>
                            <FileText size={16} /> Note statistics
                        </h3>

                        <div>
                            <span>Words</span>
                            <strong>{words}</strong>
                        </div>

                        <div>
                            <span>Characters</span>
                            <strong>{characters}</strong>
                        </div>

                        <div>
                            <span>All notes</span>
                            <strong>{notes.length}</strong>
                        </div>
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
                <div className="nn-toast">
                    <Check size={16} />
                    {message}
                </div>
            )}

            {modal && (
                <div
                    className="nn-modal-backdrop"
                    onClick={() => setModal("")}
                >
                    <section
                        className="nn-modal"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            className="nn-modal-close"
                            onClick={() => setModal("")}
                            aria-label="Close"
                        >
                            <X size={18} />
                        </button>

                        {modal === "password" ? (
                            <>
                                <div className="nn-modal-icon">
                                    <LockKeyhole size={22} />
                                </div>

                                <h2>Set note password</h2>

                                <p>
                                    This is only a local demo setting. It does
                                    not encrypt or protect the note yet.
                                </p>

                                <div className="nn-password-input">
                                    <input
                                        type={
                                            showPassword ? "text" : "password"
                                        }
                                        value={passwordInput}
                                        onChange={(event) =>
                                            setPasswordInput(
                                                event.target.value
                                            )
                                        }
                                        placeholder="Enter a password"
                                    />

                                    <button
                                        onClick={() =>
                                            setShowPassword((value) => !value)
                                        }
                                        aria-label="Show password"
                                    >
                                        {showPassword ? (
                                            <EyeOff size={17} />
                                        ) : (
                                            <Eye size={17} />
                                        )}
                                    </button>
                                </div>

                                <button
                                    className="nn-primary nn-modal-submit"
                                    onClick={savePassword}
                                >
                                    Save password setting
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="nn-modal-icon">
                                    <Link2 size={22} />
                                </div>

                                <h2>Change note URL</h2>

                                <p>
                                    Choose a short identifier for this note.
                                    It will be saved in this browser and will
                                    not be added to the browser URL.
                                </p>

                                <label className="nn-field-label">
                                    Note identifier
                                </label>

                                <input
                                    className="nn-modal-text-input"
                                    value={urlInput}
                                    onChange={(event) =>
                                        setUrlInput(event.target.value)
                                    }
                                    placeholder="my-new-note"
                                />

                                <button
                                    className="nn-primary nn-modal-submit"
                                    onClick={changeUrl}
                                >
                                    Update identifier
                                </button>
                            </>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}