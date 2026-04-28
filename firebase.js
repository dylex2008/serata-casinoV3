// firebase.refactored.js
// Refactored version: modular, grouped responsibilities, removed duplicate exports, cleaner structure

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  get,
  getDatabase,
  onValue,
  ref,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/***********************
 * CONFIG & INIT
 ************************/

const firebaseConfig = {
  apiKey: "AIzaSyAjkMFxgofR9_XTRLb92BiRJWo9NMinbbw",
  authDomain: "serata-casino.firebaseapp.com",
  databaseURL: "https://serata-casino-default-rtdb.firebaseio.com",
  projectId: "serata-casino",
  storageBucket: "serata-casino.firebasestorage.app",
  messagingSenderId: "1003841692597",
  appId: "1:1003841692597:web:b2a29461a423f281ebaffc",
  measurementId: "G-6ZZSTW92CY",
};

const STORAGE_KEY = "live-ranking-current-room";
const ADMIN_SESSION_KEY = "live-ranking-admin";

const DEFAULT_CHIPS_PER_EURO = 10;
const CHIP_DENOMINATIONS = [10, 5, 1];
const GAME_KEYS = ["poker", "blackjack", "roulette", "horse_racing"];
const CHIP_GAMES = new Set(["poker", "blackjack"]);

const hasPlaceholderConfig = Object.values(firebaseConfig).some((v) =>
  String(v).startsWith("INSERISCI_")
);

const app = !hasPlaceholderConfig ? initializeApp(firebaseConfig) : null;
const db = app ? getDatabase(app) : null;

function ensureDatabase() {
  if (!db) throw new Error("Firebase non configurato");
  return db;
}

/***********************
 * UTIL: ROOM & PLAYER
 ************************/

function normalizeRoomCode(value = "") {
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function normalizePlayersList(list = []) {
  return [...new Set(list.map((p) => String(p).trim()).filter(Boolean))];
}

function buildRoomCode() {
  return normalizeRoomCode(
    Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6)
  );
}

function getStoredRoom() {
  return localStorage.getItem(STORAGE_KEY);
}

function setStoredRoom(code) {
  code
    ? localStorage.setItem(STORAGE_KEY, code)
    : localStorage.removeItem(STORAGE_KEY);
}

/***********************
 * LEDGER & GAME STATE
 ************************/

function emptyGames() {
  return GAME_KEYS.reduce((a, k) => {
    a[k] = 0;
    return a;
  }, {});
}

function ledgerTemplate() {
  return {
    total: 0,
    locked: 0,
    available: 0,
    games: emptyGames(),
    activeGame: null,
  };
}

function getChipBreakdown(value = 0) {
  let remaining = Math.round(value);
  const out = [];

  for (const chip of CHIP_DENOMINATIONS) {
    const count = Math.floor(remaining / chip);
    if (count) out.push({ value: chip, count });
    remaining -= count * chip;
  }

  return out.length ? out : [{ value: 1, count: 0 }];
}

/***********************
 * ROOM NORMALIZATION
 ************************/

function hydrateRoom(room = {}) {
  return {
    createdAt: room.createdAt || Date.now(),
    status: room.status || "active",
    playersList: normalizePlayersList(room.playersList),
    players: room.players || {},
    games: room.games || {},
    adjustments: room.adjustments || {},
    activeGame: room.activeGame || null,
  };
}

/***********************
 * FIREBASE CORE
 ************************/

export async function getCurrentRoom() {
  const snap = await get(ref(ensureDatabase(), "currentRoom"));
  return snap.exists() ? snap.val() : null;
}

export async function setCurrentRoom(code) {
  const normalized = normalizeRoomCode(code);
  await set(ref(ensureDatabase(), "currentRoom"), normalized);
  setStoredRoom(normalized);
  return normalized;
}

export async function getRoom(code) {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return null;

  const snap = await get(ref(ensureDatabase(), `rooms/${normalized}`));
  return snap.exists() ? hydrateRoom(snap.val()) : null;
}

export async function createRoom(players = []) {
  const db = ensureDatabase();
  const list = normalizePlayersList(players);

  let code;
  while (true) {
    code = buildRoomCode();
    if (!(await getRoom(code))) break;
  }

  await set(ref(db, `rooms/${code}`), {
    createdAt: Date.now(),
    status: "active",
    playersList: list,
    players: list.reduce((a, p) => {
      a[p] = ledgerTemplate();
      return a;
    }, {}),
    games: {},
    adjustments: {},
  });

  await setCurrentRoom(code);
  return code;
}

export async function joinRoom(code) {
  const room = await getRoom(code);
  if (!room) throw new Error("Stanza non trovata");

  await setCurrentRoom(code);
  return { roomCode: code, room };
}

export async function endRoom(code) {
  const normalized = normalizeRoomCode(code);
  await update(ref(ensureDatabase(), `rooms/${normalized}`), {
    status: "ended",
  });
}

/***********************
 * GAME ACTIONS
 ************************/

function assertGame(key) {
  if (!GAME_KEYS.includes(key)) throw new Error("Gioco non valido");
}

function parsePositive(n) {
  n = Number(n);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function startGame(roomCode, gameKey, entries, rate = DEFAULT_CHIPS_PER_EURO) {
  assertGame(gameKey);
  const room = await getRoom(roomCode);
  if (!room) throw new Error("Stanza inesistente");

  const participants = {};
  const updates = {};

  for (const e of entries) {
    const name = String(e.playerName).trim();
    const invest = parsePositive(e.investedEuro);
    if (!name || !invest) continue;

    const chipBase = CHIP_GAMES.has(gameKey) ? invest * rate : invest;

    participants[name] = {
      investedEuro: invest,
      startChips: chipBase,
      currentChips: chipBase,
      chipBreakdown: getChipBreakdown(chipBase),
    };

    updates[`rooms/${roomCode}/players/${name}/activeGame`] = gameKey;
  }

  updates[`rooms/${roomCode}/games/${gameKey}`] = {
    status: "active",
    chipsPerEuro: rate,
    session: { startedAt: Date.now(), participants },
  };

  await update(ref(ensureDatabase()), updates);
}

export async function updateGameChips(roomCode, gameKey, updatesArr) {
  const updates = {};

  for (const u of updatesArr) {
    if (!u.playerName) continue;

    updates[
      `rooms/${roomCode}/games/${gameKey}/session/participants/${u.playerName}/currentChips`
    ] = u.currentChips;

    updates[
      `rooms/${roomCode}/games/${gameKey}/session/participants/${u.playerName}/chipBreakdown`
    ] = getChipBreakdown(u.currentChips);
  }

  updates[`rooms/${roomCode}/games/${gameKey}/updatedAt`] = Date.now();

  await update(ref(ensureDatabase()), updates);
}

export async function endSubGame(roomCode, gameKey, results) {
  const room = await getRoom(roomCode);
  if (!room) throw new Error("Stanza non trovata");

  const updates = {};

  for (const [player, val] of Object.entries(results)) {
    const ledger = room.players[player] || ledgerTemplate();

    const newTotal = ledger.total + Number(val);

    updates[`rooms/${roomCode}/players/${player}`] = {
      ...ledger,
      total: newTotal,
      activeGame: null,
    };
  }

  updates[`rooms/${roomCode}/games/${gameKey}`] = {
    status: "idle",
    session: null,
  };

  await update(ref(ensureDatabase()), updates);
}

/***********************
 * SUBSCRIPTIONS
 ************************/

export function listenRoom(code, cb) {
  return onValue(ref(ensureDatabase(), `rooms/${code}`), (snap) =>
    cb(snap.exists() ? hydrateRoom(snap.val()) : null)
  );
}

export function subscribeToCurrentRoom(cb) {
  return onValue(ref(ensureDatabase(), "currentRoom"), (snap) =>
    cb(snap.exists() ? snap.val() : null)
  );
}

/***********************
 * ADMIN
 ************************/

export function isAdminUnlocked() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
}

export function unlockAdminSession() {
  sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
}

/***********************
 * EXPORTS (CLEAN)
 ************************/

export {
  CHIP_DENOMINATIONS,
  CHIP_GAMES,
  DEFAULT_CHIPS_PER_EURO,
  GAME_KEYS,
  db,
  getChipBreakdown,
  normalizeRoomCode,
  resolveCurrentRoom,
  setCurrentRoom,
  getRoom,
  getCurrentRoom,
  joinRoom,
  createRoom,
  endRoom,
  startGame,
  updateGameChips,
  endSubGame,
  listenRoom,
  subscribeToCurrentRoom,
  isAdminUnlocked,
  unlockAdminSession,
};
