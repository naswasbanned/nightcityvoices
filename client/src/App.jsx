import { useState, useEffect } from "react";
import Auth from "./components/Auth";
import Lobby from "./components/Lobby";
import Room from "./components/Room";
import GlobalChat from "./components/GlobalChat";
import { apiGet } from "./api";
import "./App.css";

export default function App() {
  const [user, setUser] = useState(null);         // { id, username }
  const [token, setToken] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("vc-token");
    if (!savedToken) { setAuthChecked(true); return; }

    apiGet("/me", savedToken)
      .then((u) => {
        setUser(u);
        setToken(savedToken);
      })
      .catch(() => {
        localStorage.removeItem("vc-token");
        localStorage.removeItem("vc-user");
      })
      .finally(() => setAuthChecked(true));
  }, []);

  function handleAuth(userData, tokenStr) {
    setUser(userData);
    setToken(tokenStr);
  }

  function handleLogout() {
    setUser(null);
    setToken(null);
    setCurrentRoom(null);
    localStorage.removeItem("vc-token");
    localStorage.removeItem("vc-user");
  }

  if (!authChecked) {
    return (
      <div className="app">
        <div className="app-loading">
          <div className="loader-icon" />
          <span>Night City Voices</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🌃</span>
          <h1>Night City <span className="brand-accent">Voices</span></h1>
        </div>
        {user && (
          <div className="header-right">
            <span className="username-tag">
              <span className="online-dot" />
              {user.username}
            </span>
            <button className="logout-btn" onClick={handleLogout}>Log out</button>
          </div>
        )}
      </header>

      {!user ? (
        <main className="app-main">
          <Auth onAuth={handleAuth} />
        </main>
      ) : (
        <div className="app-body">
          {/* Voice / Lobby — main feature */}
          <section className="app-panel app-panel-voice">
            {!currentRoom ? (
              <Lobby
                username={user.username}
                onJoinRoom={(roomId) => setCurrentRoom(roomId)}
              />
            ) : (
              <Room
                roomId={currentRoom}
                username={user.username}
                onLeave={() => setCurrentRoom(null)}
              />
            )}
          </section>

          {/* Global broadcast chat */}
          <section className="app-panel app-panel-chat">
            <GlobalChat username={user.username} />
          </section>
        </div>
      )}
    </div>
  );
}
