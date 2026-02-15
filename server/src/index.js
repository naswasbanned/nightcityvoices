const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { createUser, verifyUser } = require("./users");

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const JWT_SECRET = process.env.JWT_SECRET || "voicechat-secret-change-me";
const IS_PROD = process.env.NODE_ENV === "production";

// Express
const app = express();
app.use(cors({ origin: IS_PROD ? true : CLIENT_URL }));
app.use(express.json());

// In production, serve the built React app from /public
if (IS_PROD) {
  app.use(express.static(path.join(__dirname, "..", "public")));
}

// HTTP + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: IS_PROD
    ? {}
    : { origin: CLIENT_URL, methods: ["GET", "POST"] },
});

// In-memory state
const rooms = new Map();          // roomId → Set<socketId>
const socketRooms = new Map();    // socketId → roomId  (each socket in at most one room)
const socketNames = new Map();    // socketId → username

// ---- REST endpoints ----
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/rooms", (_req, res) => {
  const list = [];
  for (const [roomId, members] of rooms) {
    list.push({ id: roomId, memberCount: members.size });
  }
  res.json(list);
});

// ---- Auth endpoints ----
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    if (username.length < 2 || username.length > 20) {
      return res.status(400).json({ error: "Username must be 2–20 characters" });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters" });
    }

    const user = await createUser(username.trim(), password);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({ user, token });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const user = await verifyUser(username.trim(), password);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/me", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });

  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    res.json({ id: payload.id, username: payload.username });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

// ---- Helper: broadcast current room list to all connected sockets ----
function broadcastRooms() {
  const list = [];
  for (const [roomId, members] of rooms) {
    list.push({ id: roomId, memberCount: members.size });
  }
  io.emit("rooms-update", list);
}

// ---- Socket.IO signaling ----
io.on("connection", (socket) => {
  console.log(`⚡ Connected: ${socket.id}`);

  // ---- Ping / latency check (client sends, we ack via callback) ----
  socket.on("ping-check", (cb) => {
    if (typeof cb === "function") cb();
  });

  // ---- Set username (for global chat from lobby, before joining a room) ----
  socket.on("set-username", (username) => {
    if (username && typeof username === "string") {
      socketNames.set(socket.id, username.slice(0, 20));
    }
  });

  // Join a voice room — payload: { roomId, username }
  socket.on("join-room", ({ roomId, username }) => {
    // Leave previous room first (if any)
    const prev = socketRooms.get(socket.id);
    if (prev) leaveRoom(socket, prev);

    // Store username
    socketNames.set(socket.id, username || "Anonymous");

    socket.join(roomId);
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(socket.id);
    socketRooms.set(socket.id, roomId);

    // Send existing peer list to the joiner — include usernames
    const peers = [...rooms.get(roomId)]
      .filter((id) => id !== socket.id)
      .map((id) => ({ id, username: socketNames.get(id) || "Anonymous" }));
    socket.emit("room-peers", peers);

    // Notify existing members about the new user — include username
    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      username: socketNames.get(socket.id),
    });

    console.log(`🔊 ${socket.id} (${username}) joined room "${roomId}" (${rooms.get(roomId).size} members)`);
    broadcastRooms();
  });

  // Leave a voice room
  socket.on("leave-room", (roomId) => {
    leaveRoom(socket, roomId);
  });

  // ---- WebRTC signaling relays (all targeted, never broadcast) ----

  socket.on("offer", ({ to, offer }) => {
    io.to(to).emit("offer", { from: socket.id, offer });
  });

  socket.on("answer", ({ to, answer }) => {
    io.to(to).emit("answer", { from: socket.id, answer });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", { from: socket.id, candidate });
  });

  // ---- Room text chat ----
  socket.on("chat-message", (text) => {
    const roomId = socketRooms.get(socket.id);
    if (!roomId || !text || typeof text !== "string") return;

    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      from: socket.id,
      username: socketNames.get(socket.id) || "Anonymous",
      text: text.slice(0, 500), // limit length
      timestamp: Date.now(),
    };

    // Send to everyone in the room (including sender for confirmation)
    io.to(roomId).emit("chat-message", msg);
  });

  // ---- Global broadcast chat (visible everywhere, not room-specific) ----
  socket.on("global-message", (text) => {
    const uname = socketNames.get(socket.id);
    if (!uname || !text || typeof text !== "string") return;

    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      from: socket.id,
      username: uname,
      text: text.slice(0, 500),
      timestamp: Date.now(),
    };

    io.emit("global-message", msg);
  });

  // Disconnect — clean up whatever room this socket was in
  socket.on("disconnect", () => {
    console.log(`💤 Disconnected: ${socket.id} (${socketNames.get(socket.id)})`);
    const roomId = socketRooms.get(socket.id);
    if (roomId) leaveRoom(socket, roomId);
    socketNames.delete(socket.id);
  });
});

function leaveRoom(socket, roomId) {
  socket.leave(roomId);
  socketRooms.delete(socket.id);

  const members = rooms.get(roomId);
  if (!members) return;

  members.delete(socket.id);
  if (members.size === 0) {
    rooms.delete(roomId);
    console.log(`🗑️  Room "${roomId}" deleted (empty)`);
  } else {
    // Tell remaining peers so they can close this peer connection
    socket.to(roomId).emit("user-left", {
      id: socket.id,
      username: socketNames.get(socket.id) || "Anonymous",
    });
  }
  console.log(`👋 ${socket.id} left room "${roomId}"`);
  broadcastRooms();
}

// ---- Start ----

// In production, serve React app for any non-API route (SPA fallback)
if (IS_PROD) {
  app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });
}

server.listen(PORT, () => {
  console.log(`🚀 Night City Voices running on http://localhost:${PORT} [${IS_PROD ? "production" : "development"}]`);
});
