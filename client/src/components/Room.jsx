import { useEffect, useRef, useState, useCallback } from "react";
import { socket } from "../socket";
import { playJoinSound, playLeaveSound, playPeerJoinSound, playPeerLeaveSound } from "../sounds";
import ChatBox from "./ChatBox";
import "./Room.css";

// ─── Constants ───────────────────────────────────────────────────────
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // Free TURN relay servers (metered.ca OpenRelay) for NAT traversal
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
};

// High-quality audio constraints (Opus-friendly)
const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,   // Opus native sample rate
  channelCount: 1,     // Mono — best for voice
  latency: 0.01,       // Request low latency
};

// Target Opus bitrate (bits/sec) — 96kbps gives excellent voice quality
const AUDIO_BITRATE = 96_000;

// Ping interval (ms)
const PING_INTERVAL = 3000;

// ─── Component ───────────────────────────────────────────────────────
export default function Room({ roomId, username, onLeave }) {
  const [peers, setPeers] = useState([]);          // [socketId, ...]
  const [peerNames, setPeerNames] = useState({});   // { socketId: username }
  const [peerStates, setPeerStates] = useState({}); // { socketId: "connecting"|"connected"|"failed" }
  const [muted, setMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [ping, setPing] = useState(null);          // latency in ms

  // Refs survive re-renders and hold mutable WebRTC state
  const localStream = useRef(null);
  const peerConnections = useRef({});              // { socketId: RTCPeerConnection }
  const candidateQueues = useRef({});              // { socketId: RTCIceCandidate[] } — buffered before remoteDescription
  const audioContainer = useRef(null);             // DOM node to attach <audio> elements
  const cleanedUp = useRef(false);
  const pingInterval = useRef(null);

  // ─── Peer-connection factory ─────────────────────────────────────
  const makePeerConnection = useCallback((peerId) => {
    if (peerConnections.current[peerId]) return peerConnections.current[peerId];

    const pc = new RTCPeerConnection(ICE_CONFIG);
    peerConnections.current[peerId] = pc;
    candidateQueues.current[peerId] = [];

    // Attach local audio tracks so the remote side hears us
    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStream.current);
      });

      // Boost Opus bitrate for higher voice quality
      try {
        const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
        if (sender) {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = AUDIO_BITRATE;
          sender.setParameters(params).catch(() => {});
        }
      } catch (_) { /* some browsers don't support setParameters yet */ }
    }

    // When a remote track arrives, create a <audio> element in the DOM
    pc.ontrack = (event) => {
      const container = audioContainer.current;
      if (!container) return;

      // Avoid duplicates
      const existingAudio = container.querySelector(`[data-peer="${peerId}"]`);
      if (existingAudio) { existingAudio.srcObject = null; existingAudio.remove(); }

      const audio = document.createElement("audio");
      audio.dataset.peer = peerId;
      audio.autoplay = true;
      audio.srcObject = event.streams[0];
      container.appendChild(audio);

      // Explicit play() to handle autoplay-policy in some browsers
      audio.play().catch(() => {
        console.warn(`Autoplay blocked for peer ${peerId}`);
      });
    };

    // Trickle ICE — send candidates to the remote peer via signaling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", { to: peerId, candidate: event.candidate });
      }
    };

    // Track connection state for UI + ICE restart on failure
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setPeerStates((prev) => ({ ...prev, [peerId]: state }));

      if (state === "failed") {
        console.warn(`Peer ${peerId} failed — attempting ICE restart...`);
        try {
          pc.restartIce();
          // Re-create offer with iceRestart flag
          pc.createOffer({ iceRestart: true }).then((offer) => {
            pc.setLocalDescription(offer).then(() => {
              socket.emit("offer", { to: peerId, offer });
            });
          }).catch(() => {
            console.warn(`ICE restart failed for ${peerId} — closing.`);
            closePeer(peerId);
          });
        } catch (_) {
          closePeer(peerId);
        }
      }
    };

    // Also watch ICE connection state for disconnected peers
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "disconnected") {
        // Give it a few seconds, then try restart
        setTimeout(() => {
          if (pc.iceConnectionState === "disconnected") {
            try { pc.restartIce(); } catch (_) {}
          }
        }, 3000);
      }
    };

    return pc;
  }, []);

  // ─── Close one peer connection + its audio element ───────────────
  const closePeer = useCallback((peerId) => {
    const pc = peerConnections.current[peerId];
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
      delete peerConnections.current[peerId];
    }
    delete candidateQueues.current[peerId];

    // Remove DOM audio — stop playback explicitly
    const audio = audioContainer.current?.querySelector(`[data-peer="${peerId}"]`);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }

    setPeerStates((prev) => {
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });
  }, []);

  // ─── Flush queued ICE candidates once remoteDescription is set ───
  const flushCandidates = useCallback(async (peerId) => {
    const pc = peerConnections.current[peerId];
    const queue = candidateQueues.current[peerId];
    if (!pc || !queue) return;

    while (queue.length > 0) {
      const c = queue.shift();
      try { await pc.addIceCandidate(c); } catch (e) { console.warn("addIceCandidate error", e); }
    }
  }, []);

  // ─── Full cleanup (leave room) ──────────────────────────────────
  const cleanup = useCallback(() => {
    if (cleanedUp.current) return;
    cleanedUp.current = true;

    // Stop ping
    if (pingInterval.current) { clearInterval(pingInterval.current); pingInterval.current = null; }

    socket.emit("leave-room", roomId);

    // Stop all audio elements FIRST (before closing connections)
    const container = audioContainer.current;
    if (container) {
      const audios = container.querySelectorAll("audio");
      audios.forEach((a) => { a.pause(); a.srcObject = null; a.remove(); });
    }

    // Tear down every peer connection
    Object.keys(peerConnections.current).forEach((peerId) => {
      const pc = peerConnections.current[peerId];
      if (pc) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
      }
    });
    peerConnections.current = {};
    candidateQueues.current = {};

    // Stop mic
    if (localStream.current) {
      localStream.current.getTracks().forEach((t) => t.stop());
      localStream.current = null;
    }

    // Remove socket listeners
    socket.off("room-peers");
    socket.off("user-joined");
    socket.off("user-left");
    socket.off("offer");
    socket.off("answer");
    socket.off("ice-candidate");

    // Do NOT call socket.disconnect() — the socket is shared.
    // Leaving the room via "leave-room" event is sufficient.

    setConnected(false);
    setPeers([]);
    setPeerStates({});
    setPeerNames({});
  }, [roomId]);

  // ─── Main effect: mic → socket → signaling ─────────────────────
  useEffect(() => {
    let cancelled = false;
    cleanedUp.current = false;

    async function init() {
      try {
        // 1. Acquire microphone with high-quality audio constraints
        const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStream.current = stream;

        // 2. Ensure socket is connected, then join the room
        if (!socket.connected) socket.connect();
        socket.emit("join-room", { roomId, username });
        setConnected(true);
        playJoinSound();

        // 3. Start ping measurement
        pingInterval.current = setInterval(() => {
          const start = Date.now();
          socket.emit("ping-check", () => {
            if (!cleanedUp.current) setPing(Date.now() - start);
          });
        }, PING_INTERVAL);
      } catch (err) {
        console.error("getUserMedia failed:", err);
        setError("Microphone access denied. Please allow mic permissions and try again.");
      }
    }

    // ── Socket event handlers ──────────────────────────────────────

    // Received list of peers already in the room → we are the initiator (send offers)
    // Each peer is { id, username }
    socket.on("room-peers", (peerList) => {
      const ids = peerList.map((p) => p.id);
      setPeers(ids);
      setPeerNames((prev) => {
        const next = { ...prev };
        peerList.forEach((p) => { next[p.id] = p.username; });
        return next;
      });
      peerList.forEach(async (p) => {
        const pc = makePeerConnection(p.id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { to: p.id, offer });
      });
    });

    // A new user joined after us → { id, username }
    // The new user is the initiator (they received room-peers). We just record & pre-create.
    socket.on("user-joined", ({ id: peerId, username: peerUsername }) => {
      setPeers((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));
      setPeerNames((prev) => ({ ...prev, [peerId]: peerUsername }));
      playPeerJoinSound();
      // Pre-create the connection so it's ready when offer arrives
      makePeerConnection(peerId);
    });

    // A peer left — { id, username }
    socket.on("user-left", ({ id: peerId }) => {
      setPeers((prev) => prev.filter((id) => id !== peerId));
      setPeerNames((prev) => { const next = { ...prev }; delete next[peerId]; return next; });
      playPeerLeaveSound();
      closePeer(peerId);
    });

    // Received an offer → set remote desc, create & send answer
    socket.on("offer", async ({ from, offer }) => {
      try {
        const pc = makePeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushCandidates(from);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("answer", { to: from, answer });
      } catch (err) {
        console.error("Error handling offer from", from, err);
      }
    });

    // Received an answer to our offer
    socket.on("answer", async ({ from, answer }) => {
      try {
        const pc = peerConnections.current[from];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await flushCandidates(from);
        }
      } catch (err) {
        console.error("Error handling answer from", from, err);
      }
    });

    // Received an ICE candidate — buffer if remote description not yet set
    socket.on("ice-candidate", async ({ from, candidate }) => {
      if (!candidate) return;
      const pc = peerConnections.current[from];
      if (!pc) return;

      if (pc.remoteDescription && pc.remoteDescription.type) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn("addIceCandidate", e); }
      } else {
        // Queue it — will be flushed after setRemoteDescription
        if (!candidateQueues.current[from]) candidateQueues.current[from] = [];
        candidateQueues.current[from].push(new RTCIceCandidate(candidate));
      }
    });

    init();

    // Cleanup on unmount or roomId change
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [roomId, makePeerConnection, closePeer, flushCandidates, cleanup]);

  // ─── UI actions ──────────────────────────────────────────────────
  function toggleMute() {
    if (!localStream.current) return;
    const nowMuted = !muted;
    localStream.current.getAudioTracks().forEach((t) => (t.enabled = !nowMuted));
    setMuted(nowMuted);
  }

  function handleLeave() {
    playLeaveSound();
    cleanup();
    onLeave();
  }

  // ─── Error state ─────────────────────────────────────────────────
  if (error) {
    return (
      <div className="room">
        <div className="room-card">
          <div className="room-error">
            <p>{error}</p>
            <button className="control-btn leave-btn" onClick={onLeave}>Go Back</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="room animate-in">
      <div className="room-card">
        <div className="room-header">
          <span className="room-name">🔊 {roomId}</span>
          <div className="room-header-right">
            {ping !== null && (
              <span className={`ping-badge ${ping < 80 ? "ping-good" : ping < 150 ? "ping-ok" : "ping-bad"}`}>
                {ping} ms
              </span>
            )}
            <span className={`room-status ${connected ? "online" : ""}`}>
              {connected ? "● Connected" : "◌ Connecting…"}
            </span>
          </div>
        </div>

        <div className="members">
          {/* You */}
          <div className="member you" style={{ animationDelay: "0.1s" }}>
            <div className={`avatar ${muted ? "muted" : "speaking"}`}>
              {username.charAt(0).toUpperCase()}
            </div>
            <span className="member-name">{username} (You)</span>
            {muted && <span className="badge muted-badge">Muted</span>}
          </div>

          {/* Remote peers */}
          {peers.map((peerId, i) => {
            const state = peerStates[peerId] || "connecting";
            const name = peerNames[peerId] || "Anonymous";
            return (
              <div key={peerId} className="member" style={{ animationDelay: `${(i + 1) * 0.08 + 0.1}s` }}>
                <div className={`avatar ${state === "connected" ? "speaking" : "connecting-peer"}`}>
                  {name.charAt(0).toUpperCase()}
                </div>
                <span className="member-name">{name}</span>
                <span className={`badge ${state}-badge`}>{state}</span>
              </div>
            );
          })}

          {peers.length === 0 && (
            <p className="empty-hint">Waiting for others to jack in…</p>
          )}
        </div>

        <div className="controls">
          <button
            className={`control-btn ${muted ? "muted-btn" : ""}`}
            onClick={toggleMute}
          >
            {muted ? "🔇 Unmute" : "🎤 Mute"}
          </button>
          <button className="control-btn leave-btn" onClick={handleLeave}>
            📴 Leave
          </button>
        </div>
      </div>

      {/* Room text chat */}
      <ChatBox username={username} />

      {/* Hidden container for <audio> elements created by ontrack */}
      <div ref={audioContainer} style={{ display: "none" }} />
    </div>
  );
}
