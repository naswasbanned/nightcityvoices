import { io } from "socket.io-client";

// In production the client is served from the same origin as the API,
// so we connect to "/" (relative). In dev we hit the local server.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";

export const socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ["websocket", "polling"],
});
