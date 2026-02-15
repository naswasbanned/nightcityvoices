// ─── Sound effects using Web Audio API (no external files) ─────────
// Generates short synthetic tones for UI feedback.

let audioCtx = null;

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

/**
 * Play a short tone.
 * @param {number} freq      - Frequency in Hz
 * @param {number} duration  - Duration in seconds
 * @param {string} type      - Oscillator type: "sine" | "triangle" | "square" | "sawtooth"
 * @param {number} volume    - 0–1
 */
function playTone(freq, duration = 0.15, type = "sine", volume = 0.18) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) {
    // Silently fail — audio context may be blocked
  }
}

/** Rising two-note chime — played when YOU join a room */
export function playJoinSound() {
  playTone(523.25, 0.12, "sine",     0.15);  // C5
  setTimeout(() => {
    playTone(659.25, 0.18, "sine",   0.18);  // E5
  }, 100);
}

/** Descending two-note chime — played when YOU leave a room */
export function playLeaveSound() {
  playTone(659.25, 0.12, "sine",     0.13);  // E5
  setTimeout(() => {
    playTone(440.00, 0.2,  "sine",   0.15);  // A4
  }, 100);
}

/** Short blip — played when another user joins */
export function playPeerJoinSound() {
  playTone(880, 0.08, "triangle", 0.10);      // A5 blip
}

/** Short low blip — played when another user leaves */
export function playPeerLeaveSound() {
  playTone(330, 0.12, "triangle", 0.10);      // E4 blip
}

/** Subtle click — for button feedback */
export function playClickSound() {
  playTone(1200, 0.04, "square", 0.06);
}
