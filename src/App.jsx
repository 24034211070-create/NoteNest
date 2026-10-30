import { useEffect, useState, useCallback } from "react";
import NoteNest from "./Frontend/components/NoteNest/NoteNest";
import AdminLogin from "./Admin/AdminLogin";
import "./App.css";

const API_URL = "https://notenest-api-tdwq.onrender.com/api";
const TOKEN_KEY = "notenest-admin-token";

function AdminDashboard({ token, onLogout }) {
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openingNote, setOpeningNote] = useState(false);
  const [error, setError] = useState("");
  const [deletingNoteId, setDeletingNoteId] = useState(null);
  const [noteToDelete, setNoteToDelete] = useState(null);
  const [activeView, setActiveView] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/admin/notes`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.status === 401 || response.status === 403) {
        onLogout();
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || "Notes load nahi ho sake.");
      const loadedNotes = Array.isArray(data) ? data : data.notes || [];
      setNotes(loadedNotes);
      setSelectedNote(current => current ? loadedNotes.find(note => note.id === current.id) || null : null);
    } catch (err) {
      setError(err.message || "Server se connect nahi ho paya.");
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (!selectedNote) return;
    const handleEscape = event => {
      if (event.key === "Escape" && !openingNote) setSelectedNote(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedNote, openingNote]);

  const openNote = async note => {
    setSelectedNote({ ...note, content: "" });
    setOpeningNote(true);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/admin/notes/${encodeURIComponent(note.id)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.status === 401 || response.status === 403) {
        onLogout();
        setSelectedNote(null);
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || "Note open nahi hua.");
      setSelectedNote(data.note || data);
    } catch (err) {
      setError(err.message || "Note open nahi ho paya.");
      setSelectedNote(null);
    } finally {
      setOpeningNote(false);
    }
  };

  const deleteNote = async note => {
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete "${note.title || "Untitled"}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingNoteId(note.id);
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/admin/notes/${encodeURIComponent(note.id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (response.status === 401 || response.status === 403) {
        onLogout();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || "Note delete nahi ho saka.");
      }

      setNotes(currentNotes =>
        currentNotes.filter(item => item.id !== note.id)
      );

      setSelectedNote(current =>
        current?.id === note.id ? null : current
      );
    } catch (err) {
      setError(err.message || "Note delete nahi ho saka.");
    } finally {
      setDeletingNoteId(null);
    }
  };

  const protectedCount = notes.filter(note => note.isPasswordProtected).length;
  const filteredNotes = notes.filter(note => {
    const matchesSearch = `${note.title || ""} ${note.id || ""}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (activeView !== "protected" || note.isPasswordProtected);
  });

  const formatDate = date => {
    if (!date) return "Not available";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "Not available";
    return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const navigate = view => {
    setActiveView(view);
    setSearch("");
    setSelectedNote(null);
    setSidebarOpen(false);
    setError("");
  };

  const renderNotesTable = (items, limit) => {
    const displayedNotes = limit ? items.slice(0, limit) : items;
    if (loading) {
      return <div className="admin-empty-state"><span className="admin-loader" />Loading notes...</div>;
    }
    if (!displayedNotes.length) {
      return (
        <div className="admin-empty-state">
          <span className="admin-empty-icon">▤</span>
          <strong>{search ? "No matching notes" : "No notes found"}</strong>
          <p>{search ? "Try a different title or note ID." : "Notes will appear here when available."}</p>
        </div>
      );
    }
    return (
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr><th>NOTE</th><th>SECURITY</th><th>LAST UPDATED</th><th>ACTION</th></tr>
          </thead>
          <tbody>
            {displayedNotes.map(note => (
              <tr key={note.id}>
                <td>
                  <div className="admin-table-note">
                    <div className="admin-file-icon">▤</div>
                    <div>
                      <strong>{note.title || "Untitled"}</strong>
                      <span>ID: {note.id}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`admin-badge ${note.isPasswordProtected ? "protected" : "standard"}`}>
                    {note.isPasswordProtected ? "♙ Protected" : "Standard"}
                  </span>
                </td>
                <td>{formatDate(note.updatedAt || note.createdAt)}</td>
                <td>
                  <div className="admin-actions">
                    <button
                      className="admin-view-button"
                      onClick={() => openNote(note)}
                    >
                      View →
                    </button>

                    <button
                      className="admin-delete-button"
                      onClick={() => deleteNote(note)}
                      disabled={deletingNoteId === note.id}
                    >
                      {deletingNoteId === note.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="admin-app">
      {sidebarOpen && <button className="admin-mobile-overlay" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <aside className={`admin-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="admin-brand">
          <div className="admin-brand-icon">N</div>
          <div><h2>NoteNest</h2><span>ADMIN PANEL</span></div>
          <button className="admin-sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">×</button>
        </div>

        <div className="admin-menu-label">MAIN MENU</div>
        <nav className="admin-navigation">
          <button className={`admin-nav-item ${activeView === "dashboard" ? "active" : ""}`} onClick={() => navigate("dashboard")}>
            <span className="admin-nav-icon">▦</span>Dashboard
          </button>
          <button className={`admin-nav-item ${activeView === "notes" ? "active" : ""}`} onClick={() => navigate("notes")}>
            <span className="admin-nav-icon">▤</span>All Notes<span className="admin-nav-count">{notes.length}</span>
          </button>
          <button className={`admin-nav-item ${activeView === "protected" ? "active" : ""}`} onClick={() => navigate("protected")}>
            <span className="admin-nav-icon">♙</span>Protected Notes
          </button>
        </nav>

        <div className="admin-sidebar-bottom">
          <div className="admin-admin-profile">
            <div className="admin-avatar">SA</div>
            <div className="admin-profile-info"><strong>Super Admin</strong><span>Administrator</span></div>
            <span className="admin-online-dot" />
          </div>
          <button className="admin-logout-button" onClick={onLogout}><span>↪</span>Logout</button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button className="admin-menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">☰</button>
            <div>
              <div className="admin-breadcrumb">NoteNest / Admin</div>
              <h1>{activeView === "dashboard" ? "Dashboard" : activeView === "protected" ? "" : ""}</h1>
            </div>
          </div>
          <div className="admin-topbar-right"><span className="admin-status-dot" /><span>Admin Session Active</span><div className="admin-top-avatar">SA</div></div>
        </header>

        <div className="admin-page-content">
          {error && (
            <div className="admin-alert" role="alert">
              <span>!</span><div>{error}</div>
              <button onClick={() => setError("")} aria-label="Dismiss error">×</button>
            </div>
          )}

          {activeView === "dashboard" && (
            <>
              <section className="admin-welcome">
                <div><h2>Welcome back, Super Admin!</h2><p>Manage your notes and monitor your NoteNest workspace.</p></div>
                <button className="admin-primary-button" onClick={loadNotes} disabled={loading}><span>↻</span>{loading ? "Refreshing..." : "Refresh Data"}</button>
              </section>

              <section className="admin-stats-grid">
                <article className="admin-stat-card">
                  <div className="admin-stat-top"><div className="admin-stat-icon blue">▤</div><span className="admin-stat-tag">All records</span></div>
                  <p>Total Notes</p><h3>{loading ? "—" : notes.length}</h3><span className="admin-stat-description">Notes stored in NoteNest</span>
                </article>
                <article className="admin-stat-card">
                  <div className="admin-stat-top"><div className="admin-stat-icon amber">♙</div><span className="admin-stat-tag">Security</span></div>
                  <p>Protected Notes</p><h3>{loading ? "—" : protectedCount}</h3><span className="admin-stat-description">Notes with password protection</span>
                </article>
                <article className="admin-stat-card">
                  <div className="admin-stat-top"><div className="admin-stat-icon green">✓</div><span className="admin-stat-tag">Connection</span></div>
                  <p>Workspace</p><h3 className="admin-stat-text">NoteNest</h3><span className="admin-stat-description">Admin workspace overview</span>
                </article>
              </section>

              <section className="admin-content-card">
                <div className="admin-card-heading">
                  <div><h2>Recent Notes</h2><p>Browse and open your latest available notes.</p></div>
                  <button className="admin-outline-button" onClick={() => navigate("notes")}>View All Notes →</button>
                </div>
                {renderNotesTable(notes, 5)}
              </section>
            </>
          )}

          {(activeView === "notes" || activeView === "protected") && (
            <>
              <section className="admin-welcome">
                <div>
                  <h2>{activeView === "protected" ? "" : "Notes Management"}</h2>
                  <p>{activeView === "protected" ? "Browse notes marked as password protected." : "Search, browse and inspect notes in your workspace."}</p>
                </div>
                <button className="admin-primary-button" onClick={loadNotes} disabled={loading}><span>↻</span>{loading ? "Refreshing..." : "Refresh"}</button>
              </section>
              <section className="admin-content-card">
                <div className="admin-card-heading admin-notes-toolbar">
                  <div><h2>{activeView === "protected" ? "Protected Notes" : "All Notes"}</h2><p>{filteredNotes.length} {filteredNotes.length === 1 ? "note" : "notes"} found</p></div>
                  <div className="admin-search">
                    <span>⌕</span>
                    <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by title or ID..." aria-label="Search notes" />
                    {search && <button onClick={() => setSearch("")} aria-label="Clear search">×</button>}
                  </div>
                </div>
                {renderNotesTable(filteredNotes)}
              </section>
            </>
          )}
        </div>
      </main>

      {selectedNote && (
        <div className="admin-modal-overlay" onMouseDown={event => {
          if (event.target === event.currentTarget && !openingNote) setSelectedNote(null);
        }}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
            <div className="admin-modal-header">
              <div><h2 id="admin-modal-title">Note Details</h2><p>View note information and content.</p></div>
              <button className="admin-modal-close" onClick={() => !openingNote && setSelectedNote(null)} disabled={openingNote} aria-label="Close note">×</button>
            </div>
            <div className="admin-detail-meta">
              <div><span>NOTE TITLE</span><strong>{selectedNote.title || "Untitled"}</strong></div>
              <div><span>NOTE ID</span><strong className="admin-id-text">{selectedNote.id}</strong></div>
              <div><span>SECURITY</span><strong>{selectedNote.isPasswordProtected ? "Password Protected" : "Standard"}</strong></div>
            </div>
            {selectedNote.isPasswordProtected && (
              <div className="admin-protected-notice">
                <span>♙</span><div><strong>Password-protected note</strong><p>Content is displayed only as returned by the admin API.</p></div>
              </div>
            )}
            <div className="admin-note-preview">
              <h3>Note Content</h3>
              {openingNote ? (
                <div className="admin-modal-loading"><span className="admin-loader" />Loading note content...</div>
              ) : (
                <div className="admin-note-content">
                  {selectedNote.content ? (
                    <div dangerouslySetInnerHTML={{
                      __html: selectedNote.content
                    }}
                    />
                  ) : ("This note is empty or its content is not available.")}
                </div>
              )}
            </div>
            <div className="admin-modal-footer">
              <span>{formatDate(selectedNote.updatedAt || selectedNote.createdAt)}</span>
              <button className="admin-primary-button" onClick={() => setSelectedNote(null)} disabled={openingNote}>Close</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function App() {
  const currentPath = window.location.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  const isAdminRoute = currentPath === "/admin";
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [checking, setChecking] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)));

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setChecking(false);
  }, []);

  useEffect(() => {
    if (!isAdminRoute || !token) {
      setChecking(false);
      return;
    }
    let active = true;
    const controller = new AbortController();

    const verifyAdmin = async () => {
      try {
        const response = await fetch(`${API_URL}/admin/verify`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Admin verification failed: ${response.status}`);
        if (active) setChecking(false);
      } catch (error) {
        if (!active || error.name === "AbortError") return;
        console.error("Admin verification error:", error);
        sessionStorage.removeItem(TOKEN_KEY);
        setToken("");
        setChecking(false);
      }
    };

    verifyAdmin();
    return () => {
      active = false;
      controller.abort();
    };
  }, [isAdminRoute, token]);

  if (isAdminRoute) {
    if (checking) {
      return (
        <div className="admin-checking">
          <div className="admin-checking-inner">
            <span className="admin-checking-spinner" />
            Checking admin session...
          </div>
        </div>
      );
    }

    if (!token) {
      return (
        <AdminLogin onLogin={newToken => {
          sessionStorage.setItem(TOKEN_KEY, newToken);
          setToken(newToken);
          setChecking(true);
        }} />
      );
    }

    return <AdminDashboard token={token} onLogout={logout} />;
  }

  return <NoteNest />;
}

export default App;