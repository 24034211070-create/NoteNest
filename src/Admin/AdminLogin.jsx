import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import "./AdminLogin.css";

const API_URL = "https://notenest-api-tdwq.onrender.com/api";

export default function AdminLogin({ onLogin }) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const response = await fetch(`${API_URL}/admin/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || data.error || "Login failed. Details check karo.");
            }

            if (!data.token) {
                throw new Error("Server se login token nahi mila.");
            }

            sessionStorage.setItem("notenest-admin-token", data.token);
            onLogin(data.token);
        } catch (err) {
            setError(err.message || "Server se connect nahi ho paya.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="admin-login-page">
            <form className="admin-login-card" onSubmit={handleLogin}>
                <div className="admin-login-logo">N</div>
                <h1>NoteNest Admin</h1>
                <p>Super Admin account se sign in karein</p>

                <label htmlFor="admin-username">Username</label>
                <input
                    id="admin-username"
                    type="text"
                    placeholder="Enter admin username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                />

                <label htmlFor="admin-password">Password</label>
                <div className="admin-password-wrapper">
                    <input
                        id="admin-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter admin password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                    />
                    <button
                        type="button"
                        className="admin-password-toggle"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        title={showPassword ? "Hide password" : "Show password"}
                    >
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                </div>

                {error && <div className="admin-login-error">{error}</div>}

                <button type="submit" disabled={loading}>
                    {loading ? "Signing in..." : "Sign In"}
                </button>

                <span className="admin-login-footer">Authorized access only</span>
            </form>
        </div>
    );
}
