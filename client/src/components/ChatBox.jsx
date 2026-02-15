import { useState, useEffect, useRef } from "react";
import { socket } from "../socket";
import "./ChatBox.css";

export default function ChatBox({ username }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    function onMessage(msg) {
      setMessages((prev) => [...prev, msg]);
    }

    socket.on("chat-message", onMessage);
    return () => socket.off("chat-message", onMessage);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    socket.emit("chat-message", text);
    setInput("");
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="chatbox">
      <div className="chatbox-header">💬 Chat</div>

      <div className="chatbox-messages">
        {messages.length === 0 && (
          <p className="chat-empty">No messages yet. Break the ice, choom.</p>
        )}
        {messages.map((msg) => {
          const isMe = msg.username === username;
          return (
            <div key={msg.id} className={`chat-msg ${isMe ? "me" : ""}`}>
              <div className="chat-meta">
                <span className="chat-author">{isMe ? "You" : msg.username}</span>
                <span className="chat-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="chat-text">{msg.text}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="chatbox-input" onSubmit={handleSend}>
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
        />
        <button type="submit" disabled={!input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
