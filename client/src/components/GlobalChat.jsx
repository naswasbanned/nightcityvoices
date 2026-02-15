import { useState, useEffect, useRef } from "react";
import { socket } from "../socket";
import "./GlobalChat.css";

export default function GlobalChat({ username }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    // Ensure socket is connected so we receive global messages everywhere
    if (!socket.connected) socket.connect();

    function onGlobalMessage(msg) {
      setMessages((prev) => {
        const next = [...prev, msg];
        return next.length > 200 ? next.slice(-200) : next;
      });
    }

    socket.on("global-message", onGlobalMessage);
    return () => socket.off("global-message", onGlobalMessage);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    socket.emit("set-username", username);
    socket.emit("global-message", text);
    setInput("");
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="global-chat">
      <div className="global-chat-header">
        <span>🌐 Global Chat</span>
        <span className="gc-online-hint">visible to everyone</span>
      </div>

      <div className="global-chat-messages">
        {messages.length === 0 && (
          <p className="global-chat-empty">No messages yet. Say something to everyone.</p>
        )}
        {messages.map((msg) => {
          const isMe = msg.username === username;
          return (
            <div key={msg.id} className={`gc-msg ${isMe ? "gc-me" : ""}`}>
              <div className="gc-meta">
                <span className="gc-author">{isMe ? "You" : msg.username}</span>
                <span className="gc-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="gc-text">{msg.text}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="global-chat-input" onSubmit={handleSend}>
        <input
          type="text"
          placeholder="Broadcast to everyone..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
        />
        <button type="submit" disabled={!input.trim()}>Send</button>
      </form>
    </div>
  );
}
