const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "..", "data", "users.json");

// Ensure data directory + file exist
function ensureDB() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, "[]", "utf-8");
}

function readUsers() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeUsers(users) {
  ensureDB();
  fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2), "utf-8");
}

/** Find a user by username (case-insensitive) */
function findByUsername(username) {
  const users = readUsers();
  return users.find((u) => u.username.toLowerCase() === username.toLowerCase());
}

/** Create a new user. Returns the user object (without password). Throws on duplicate. */
async function createUser(username, password) {
  const users = readUsers();

  if (users.find((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("Username already taken");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    username,
    password: hashedPassword,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  writeUsers(users);

  const { password: _, ...safe } = user;
  return safe;
}

/** Verify credentials. Returns user (without password) or null. */
async function verifyUser(username, password) {
  const user = findByUsername(username);
  if (!user) return null;

  const match = await bcrypt.compare(password, user.password);
  if (!match) return null;

  const { password: _, ...safe } = user;
  return safe;
}

module.exports = { findByUsername, createUser, verifyUser };
