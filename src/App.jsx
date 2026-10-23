
import { useEffect, useState, useCallback } from "react";
import NoteNest from "./Frontend/components/NoteNest/NoteNest";
import AdminLogin from "./Admin/AdminLogin";
import AdminDashboard from "./AdminDashboard/AdminDashboard";

const API_URL = "https://notenest-api-tdwq.onrender.com/api";
const TOKEN_KEY = "notenest-admin-token";

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

        if (!response.ok) {
          throw new Error(`Admin verification failed: ${response.status}`);
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
        <AdminLogin
          onLogin={newToken => {
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
