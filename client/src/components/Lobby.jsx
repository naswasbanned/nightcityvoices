import { useState, useEffect } from "react";
import { socket } from "../socket";
import { playClickSound } from "../sounds";
import { apiGet } from "../api";
import "./Lobby.css";

const DEFAULT_ROOMS = ["General", "Gaming", "Music", "Chill"];

export default function Lobby({ username, onJoinRoom }) {
  const [customRoom, setCustomRoom] = useState("");
  const [activeRooms, setActiveRooms] = useState([]);   // [{ id, memberCount }]

  // Fetch active rooms on mount & poll every 5s
  useEffect(() => {
    let alive = true;

    async function fetchRooms() {
      try {
        const rooms = await apiGet("/rooms");
        if (alive) setActiveRooms(rooms);
      } catch (_) { /* ignore */ }
    }

    fetchRooms();
    const interval = setInterval(fetchRooms, 5000);

    // Also listen for real-time room updates if the server sends them
    socket.connect();
    socket.on("rooms-update", (rooms) => {
      if (alive) setActiveRooms(rooms);
    });

    return () => {
      alive = false;
      clearInterval(interval);
      socket.off("rooms-update");
    };
  }, []);

  // Merge: default rooms + any custom active rooms not in defaults
  const customActiveRooms = activeRooms.filter(
    (r) => !DEFAULT_ROOMS.includes(r.id)
  );

  function getMemberCount(roomId) {
    const found = activeRooms.find((r) => r.id === roomId);
    return found ? found.memberCount : 0;
  }

  const handleJoin = (roomId) => {
    playClickSound();
    onJoinRoom(roomId);
  };

  const handleCustomJoin = (e) => {
    e.preventDefault();
    if (customRoom.trim()) handleJoin(customRoom.trim());
  };

  return (
    <div className="lobby animate-in">
      <div className="lobby-card">
        <h2>Select a Channel</h2>
        <p className="lobby-greeting">Welcome back, <strong>{username}</strong></p>

        <div className="room-list">
          {DEFAULT_ROOMS.map((room, i) => {
            const count = getMemberCount(room);
            return (
              <button
                key={room}
                className="room-btn"
                style={{ animationDelay: `${i * 0.06}s` }}
                onClick={() => handleJoin(room)}
              >
                <span className="room-btn-icon">🔊</span>
                <span className="room-btn-label">{room}</span>
                {count > 0 && (
                  <span className="room-btn-count">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Custom rooms created by users that are currently active */}
        {customActiveRooms.length > 0 && (
          <>
            <p className="section-label">Active Rooms</p>
            <div className="room-list">
              {customActiveRooms.map((room, i) => (
                <button
                  key={room.id}
                  className="room-btn custom-room-btn"
                  style={{ animationDelay: `${i * 0.06}s` }}
                  onClick={() => handleJoin(room.id)}
                >
                  <span className="room-btn-icon">📡</span>
                  <span className="room-btn-label">{room.id}</span>
                  <span className="room-btn-count">{room.memberCount}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <form className="custom-room" onSubmit={handleCustomJoin}>
          <input
            type="text"
            placeholder="Create or join a room..."
            value={customRoom}
            onChange={(e) => setCustomRoom(e.target.value)}
            maxLength={30}
          />
          <button type="submit" className="join-btn" disabled={!customRoom.trim()}>
            Join
          </button>
        </form>
      </div>
    </div>
  );
}
