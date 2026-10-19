import { useEffect, useState, useCallback } from "react";
import NoteNest from "./Frontend/components/NoteNest/NoteNest";
import AdminLogin from "./Admin/AdminLogin";

const API_URL = "https://notenest-api-tdwq.onrender.com/api";
const TOKEN_KEY = "notenest-admin-token";

function AdminDashboard({ token, onLogout }) {
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openingNote, setOpeningNote] = useState(false);
  const [error, setError] = useState("");

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL} /admin/notes`, {
        headers: { Authorization: `Bearer ${token} ` },
      });

      if (response.status === 401 || response.status === 403) {
        onLogout();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || data.message || "Notes load nahi ho sake."
        );
      }

      const loadedNotes = Array.isArray(data)
        ? data
        : data.notes || [];

      setNotes(loadedNotes);

      setSelectedNote((current) => {
        if (!current) return null;
        return loadedNotes.find((note) => note.id === current.id) || null;
      });
    } catch (err) {
      setError(err.message || "Server se connect nahi ho paya.");
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const openNote = async (note) => {
    setSelectedNote(note);
    setOpeningNote(true);
    setError("");

    try {
      const response = await fetch(
        `${API_URL} /admin/notes / ${encodeURIComponent(note.id)} `,
        {
          headers: { Authorization: `Bearer ${token} ` },
        }
      );

      if (response.status === 401 || response.status === 403) {
        onLogout();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || data.message || "Note open nahi hua."
        );
      }

      setSelectedNote(data.note || data);
    } catch (err) {
      setError(err.message || "Note open nahi ho paya.");
    } finally {
      setOpeningNote(false);
    }
  };

  return (
    <div className="admin-dashboard">
      <header className="admin-dashboard-header">
        <div>
          <h1>NoteNest Admin</h1>
          <p>Super Admin Dashboard</p>
        </div>
        <button className="admin-logout-button" onClick={onLogout}>
          Logout
        </button>
      </header>

      {error && (
        <div className="admin-dashboard-error" role="alert">
          {error}
        </div>
      )}

      <div className="admin-dashboard-layout">
        <section className="admin-panel">
          <div className="admin-notes-heading">
            <h2>All Notes ({notes.length})</h2>
            <button
              className="admin-refresh-button"
              onClick={loadNotes}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {loading && <p>Loading notes...</p>}

          {!loading && notes.length === 0 && !error && (
            <p className="admin-muted">No notes found.</p>
          )}

          {notes.map((note) => (
            <button
              className={`admin - note - item ${selectedNote?.id === note.id ? "selected" : ""
                } `}
              key={note.id}
              onClick={() => openNote(note)}
            >
              <strong>{note.title || "Untitled"}</strong>
              <small>ID: {note.id}</small>
              {note.isPasswordProtected && (
                <span className="admin-protected-label">
                  Password Protected
                </span>
              )}
            </button>
          ))}
        </section>

        <section className="admin-panel admin-note-details">
          <h2>Note Details</h2>

          {!selectedNote ? (
            <p className="admin-muted">
              Details dekhne ke liye left side se note select karo.
            </p>
          ) : (
            <>
              <h3>{selectedNote.title || "Untitled"}</h3>
              <p className="admin-muted">Note ID: {selectedNote.id}</p>

              {selectedNote.isPasswordProtected && (
                <p className="admin-protected-info">
                  Password-protected note — Super Admin view
                </p>
              )}

              {openingNote ? (
                <p className="admin-muted">
                  Note content load ho raha hai...
                </p>
              ) : (
                <div className="admin-note-content">
                  {selectedNote.content || "This note is empty."}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <style>{`
  .admin - dashboard {
  min - height: 100vh;
  padding: 24px;
  background: #f3f6fc;
  color: #243047;
  font - family: Arial, sans - serif;
  box - sizing: border - box;
}
        .admin - dashboard * {
  box- sizing: border - box;
        }
        .admin - dashboard - header {
  display: flex;
  justify - content: space - between;
  align - items: center;
  flex - wrap: wrap;
  gap: 16px;
  margin - bottom: 24px;
}
        .admin - dashboard - header h1 {
  margin: 0;
  font - size: 26px;
}
        .admin - dashboard - header p {
  margin: 8px 0 0;
  color: #718096;
}
        .admin - logout - button,
        .admin - refresh - button {
  padding: 10px 18px;
  border: 0;
  border - radius: 6px;
  background: #3978e8;
  color: white;
  cursor: pointer;
}
        .admin - refresh - button:disabled {
  opacity: 0.65;
  cursor: wait;
}
        .admin - dashboard - layout {
  display: grid;
  grid - template - columns: minmax(220px, 0.8fr) minmax(0, 1.5fr);
  gap: 20px;
  align - items: start;
}
        .admin - panel {
  min - width: 0;
  padding: 18px;
  background: white;
  border: 1px solid #e2e8f0;
  border - radius: 10px;
}
        .admin - notes - heading {
  display: flex;
  justify - content: space - between;
  align - items: center;
  flex - wrap: wrap;
  gap: 10px;
  margin - bottom: 16px;
}
        .admin - panel h2 {
  margin: 0 0 16px;
  font - size: 18px;
}
        .admin - notes - heading h2 {
  margin: 0;
}
        .admin - note - item {
  display: block;
  width: 100 %;
  margin - bottom: 8px;
  padding: 12px;
  text - align: left;
  overflow - wrap: anywhere;
  border: 1px solid #e2e8f0;
  border - radius: 7px;
  background: white;
  color: #243047;
  cursor: pointer;
}
        .admin - note - item: hover,
        .admin - note - item.selected {
  background: #edf4ff;
  border - color: #3978e8;
}
        .admin - note - item strong,
        .admin - note - item small {
  display: block;
}
        .admin - note - item small {
  margin - top: 5px;
  color: #718096;
}
        .admin - protected - label {
  display: inline - block;
  margin - top: 8px;
  padding: 4px 7px;
  border - radius: 4px;
  background: #fff3d6;
  color: #8a5a00;
  font - size: 11px;
}
        .admin - protected - info {
  padding: 10px;
  border - radius: 6px;
  background: #fff8e8;
  color: #805500;
  font - size: 13px;
}
        .admin - note - details h3 {
  overflow - wrap: anywhere;
}
        .admin - note - content {
  white - space: pre - wrap;
  overflow - wrap: anywhere;
  line - height: 1.7;
  color: #243047;
}
        .admin - muted {
  color: #718096;
  overflow - wrap: anywhere;
}
        .admin - dashboard - error {
  margin - bottom: 16px;
  padding: 12px;
  background: #fff0f0;
  color: #bd3030;
  border - radius: 6px;
  overflow - wrap: anywhere;
}
@media(max - width: 640px) {
          .admin - dashboard {
    padding: 16px;
  }
          .admin - dashboard - layout {
    grid - template - columns: minmax(0, 1fr);
  }
}
`}</style>
    </div>
  );
}

function App() {
  const currentPath =
    window.location.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  const isAdminRoute = currentPath === "/admin";

  const [token, setToken] = useState(
    () => sessionStorage.getItem(TOKEN_KEY) || ""
  );
  const [checking, setChecking] = useState(
    () => Boolean(sessionStorage.getItem(TOKEN_KEY))
  );

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
        const response = await fetch(`${API_URL} /admin/verify`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token} ` },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Admin verification failed: ${response.status} `);
        }

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
        <div style={{ padding: 40, textAlign: "center" }}>
          Checking admin session...
        </div>
      );
    }

    if (!token) {
      return (
        <AdminLogin
          onLogin={(newToken) => {
            sessionStorage.setItem(TOKEN_KEY, newToken);
            setToken(newToken);
            setChecking(true);
          }}
        />
      );
    }

    return <AdminDashboard token={token} onLogout={logout} />;
  }

  return <NoteNest />;
}

export default App;