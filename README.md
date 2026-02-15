# 🎙️ Voice Chat

A Discord-like voice chat web app focused on audio rooms.

**Tech stack:** React · Node.js + Express · Socket.IO · WebRTC (audio only)

---

## Project Structure

```
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Lobby.jsx   # Room selection UI
│   │   │   ├── Lobby.css
│   │   │   ├── Room.jsx    # Active voice room + WebRTC
│   │   │   └── Room.css
│   │   ├── App.jsx         # Root component
│   │   ├── App.css
│   │   ├── main.jsx        # Entry point
│   │   ├── index.css       # Global styles
│   │   └── socket.js       # Socket.IO client instance
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── server/                 # Express backend
│   ├── src/
│   │   └── index.js        # Express + Socket.IO + signaling
│   ├── .env
│   └── package.json
│
└── README.md
```

---

## Getting Started

### 1. Install dependencies

```bash
# Server
cd server
npm install

# Client
cd ../client
npm install
```

### 2. Run the server

```bash
cd server
npm run dev
# → http://localhost:3001
```

### 3. Run the client

```bash
cd client
npm run dev
# → http://localhost:5173
```

### 4. Use it

1. Open **http://localhost:5173** in two browser tabs.
2. Enter a display name in each tab.
3. Join the same room — voice audio streams via WebRTC peer-to-peer.

> **Note:** Microphone access is required. Both tabs must be in the same room to hear each other.

---

## API Endpoints

| Method | Path          | Description              |
|--------|---------------|--------------------------|
| GET    | `/api/health` | Server health check      |
| GET    | `/api/rooms`  | List active rooms        |

## Socket Events

| Event            | Direction      | Payload                     |
|------------------|----------------|-----------------------------|
| `join-room`      | Client → Server| `roomId`                    |
| `leave-room`     | Client → Server| `roomId`                    |
| `room-peers`     | Server → Client| `[socketId, ...]`           |
| `user-joined`    | Server → Client| `socketId`                  |
| `user-left`      | Server → Client| `socketId`                  |
| `offer`          | Both           | `{ to, from, offer }`       |
| `answer`         | Both           | `{ to, from, answer }`      |
| `ice-candidate`  | Both           | `{ to, from, candidate }`   |
