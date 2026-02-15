import { useState } from "react";
import { apiPost } from "../api";
import "./Auth.css";

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isRegister = mode === "register";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password) {
      setError("Please fill in all fields");
      return;
    }

    if (isRegister) {
      if (username.trim().length < 2 || username.trim().length > 20) {
        setError("Username must be 2–20 characters");
        return;
      }
      if (password.length < 4) {
        setError("Password must be at least 4 characters");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    setLoading(true);
    try {
      const endpoint = isRegister ? "/register" : "/login";
      const { user, token } = await apiPost(endpoint, {
        username: username.trim(),
        password,
      });

      // Persist token
      localStorage.setItem("vc-token", token);
      localStorage.setItem("vc-user", JSON.stringify(user));

      onAuth(user, token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth animate-in">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-icon">🌃</span>
          <h2>Night City Voices</h2>
        </div>
        <p className="auth-sub">
          {isRegister
            ? "No Jews allowed this time."
            : "Just hop in, no Jews inside."}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="auth-username">Username</label>
            <input
              id="auth-username"
              type="text"
              placeholder="Enter username..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={20}
              autoComplete="username"
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              placeholder="Enter password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? "new-password" : "current-password"}
            />
          </div>

          {isRegister && (
            <div className="field">
              <label htmlFor="auth-confirm">Confirm Password</label>
              <input
                id="auth-confirm"
                type="password"
                placeholder="Repeat password..."
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? "Please wait..." : isRegister ? "Create Account" : "Log In"}
          </button>
        </form>

        <p className="auth-switch">
          {isRegister ? "Already have an account?" : "Don't have an account?"}
          <button
            className="switch-btn"
            onClick={() => {
              setMode(isRegister ? "login" : "register");
              setError("");
            }}
          >
            {isRegister ? "Log in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>
  );
}
