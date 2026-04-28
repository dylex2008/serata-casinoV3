import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  get,
  getDatabase,
  onValue,
  ref,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

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
const DEFAULT_CHIPS_PER_EURO = 10;
const CHIP_DENOMINATIONS = [10, 5, 1];
const GAME_KEYS = ["poker", "blackjack", "roulette", "horse_racing"];
const CHIP_GAMES = new Set(["poker", "blackjack"]);

const hasPlaceholderConfig = Object.values(firebaseConfig).some((value) =>
  String(value).startsWith("INSERISCI_")
);

let app;
let db;

if (!hasPlaceholderConfig) {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
}

function ensureDatabase() {
  if (!db) {
    throw new Error(
      "Config Firebase mancante. Apri firebase.js e incolla i dati del tuo progetto."
    );
  }

  return db;
}

function normalizeRoomCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function buildRoomCode() {
  const timePart = Date.now().toString(36).toUpperCase().slice(-4);
  const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
  return normalizeRoomCode(`${timePart}${randomPart}`).slice(0, 8);
}

function normalizePlayersList(playersList) {
  return [...new Set(playersList.map((player) => String(player || "").trim()).filter(Boolean))];
}

function buildGameTotalsSeed() {
  return GAME_KEYS.reduce((accumulator, gameKey) => {
    accumulator[gameKey] = 0;
    return accumulator;
  }, {});
}

function normalizeLedgerEntry(value) {
  if (typeof value === "number") {
    return {
      total: value,
      locked: 0,
      available: value,
      games: buildGameTotalsSeed(),
      activeGame: null,
    };
  }

  const total = Number(value?.total || 0);
  const locked = Number(value?.locked || 0);
  const available =
    value?.available !== undefined ? Number(value.available) : total - locked;
  const games = GAME_KEYS.reduce((accumulator, gameKey) => {
    accumulator[gameKey] = Number(value?.games?.[gameKey] || 0);
    return accumulator;
  }, {});

  return {
    total,
    locked,
    available,
    games,
    activeGame: value?.activeGame || null,
  };
}

function normalizePlayersMap(players = {}, playersList = []) {
  const playerNames = new Set([...playersList, ...Object.keys(players || {})]);
  const normalizedPlayers = {};

  playerNames.forEach((playerName) => {
    normalizedPlayers[playerName] = normalizeLedgerEntry(players?.[playerName]);
  });

  return normalizedPlayers;
}

function normalizeSession(session, gameKey) {
  if (!session || typeof session !== "object") {
    return null;
  }

  const participants = Object.entries(session.participants || {}).reduce(
    (accumulator, [playerName, participant]) => {
      const investedEuro = Number(participant?.investedEuro || 0);
      const startChips = Number(participant?.startChips || 0);
      const currentChips = Number(
        participant?.currentChips ?? participant?.startChips ?? 0
      );

      accumulator[playerName] = {
        investedEuro,
        startChips,
        currentChips,
        chipBreakdown:
          participant?.chipBreakdown || getChipBreakdown(startChips || investedEuro),
      };
      return accumulator;
    },
    {}
  );

  return {
    startedAt: Number(session.startedAt || Date.now()),
    chipsPerEuro: Number(session.chipsPerEuro || DEFAULT_CHIPS_PER_EURO),
    participants,
    gameKey,
  };
}

function normalizeGamesMap(games = {}) {
  return GAME_KEYS.reduce((accumulator, gameKey) => {
    const rawGame = games?.[gameKey] || {};
    accumulator[gameKey] = {
      status: rawGame.status === "active" ? "active" : "idle",
      chipsPerEuro: Number(rawGame.chipsPerEuro || DEFAULT_CHIPS_PER_EURO),
      session: normalizeSession(rawGame.session, gameKey),
      updatedAt: Number(rawGame.updatedAt || 0),
      lastSettlement: rawGame.lastSettlement || null,
      lastResults: rawGame.lastResults || {},
      useChips: CHIP_GAMES.has(gameKey),
    };
    return accumulator;
  }, {});
}

function hydrateRoomData(room) {
  const playersList = normalizePlayersList(room?.playersList || []);
  const players = normalizePlayersMap(room?.players || {}, playersList);

  return {
    createdAt: Number(room?.createdAt || Date.now()),
    status: room?.status === "ended" ? "ended" : "active",
    playersList,
    activeGame: room?.activeGame || null,
    players,
    games: normalizeGamesMap(room?.games || {}),
  };
}

function buildPlayersSeed(playersList) {
  return playersList.reduce((accumulator, playerName) => {
    accumulator[playerName] = {
      total: 0,
      locked: 0,
      available: 0,
      games: buildGameTotalsSeed(),
      activeGame: null,
    };
    return accumulator;
  }, {});
}

function buildGamesSeed() {
  return GAME_KEYS.reduce((accumulator, gameKey) => {
    accumulator[gameKey] = {
      status: "idle",
      chipsPerEuro: DEFAULT_CHIPS_PER_EURO,
      session: null,
      updatedAt: Date.now(),
      lastSettlement: null,
      lastResults: {},
      useChips: CHIP_GAMES.has(gameKey),
    };
    return accumulator;
  }, {});
}

function assertGameKey(gameKey) {
  if (!GAME_KEYS.includes(gameKey)) {
    throw new Error("Gioco non supportato.");
  }
}

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function setStoredCurrentRoom(roomCode) {
  if (roomCode) {
    localStorage.setItem(STORAGE_KEY, roomCode);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function getStoredCurrentRoom() {
  return localStorage.getItem(STORAGE_KEY);
}

function getChipBreakdown(value) {
  let remaining = Math.max(0, Math.round(Number(value || 0)));
  const breakdown = CHIP_DENOMINATIONS.map((chipValue) => {
    const count = Math.floor(remaining / chipValue);
    remaining -= count * chipValue;
    return {
      value: chipValue,
      count,
    };
  }).filter((chip) => chip.count > 0);

  return breakdown.length
    ? breakdown
    : [
        {
          value: 1,
          count: 0,
        },
      ];
}

export async function getCurrentRoom() {
  const database = ensureDatabase();
  const snapshot = await get(ref(database, "currentRoom"));
  return snapshot.exists() ? snapshot.val() : null;
}

export async function setCurrentRoom(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const database = ensureDatabase();
  await set(ref(database, "currentRoom"), normalizedRoomCode);
  setStoredCurrentRoom(normalizedRoomCode);
  return normalizedRoomCode;
}

export async function getRoom(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!normalizedRoomCode) {
    return null;
  }

  const database = ensureDatabase();
  const snapshot = await get(ref(database, `rooms/${normalizedRoomCode}`));
  return snapshot.exists() ? hydrateRoomData(snapshot.val()) : null;
}

export async function createRoom(playersList = []) {
  const database = ensureDatabase();
  const normalizedPlayersList = normalizePlayersList(playersList);

  let roomCode = "";
  let existingRoom = true;

  while (existingRoom) {
    roomCode = buildRoomCode();
    existingRoom = await getRoom(roomCode);
  }

  await set(ref(database, `rooms/${roomCode}`), {
    createdAt: Date.now(),
    status: "active",
    activeGame: null,
    playersList: normalizedPlayersList,
    players: buildPlayersSeed(normalizedPlayersList),
    games: buildGamesSeed(),
  });

  await setCurrentRoom(roomCode);
  return roomCode;
}

export async function joinRoom(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const room = await getRoom(normalizedRoomCode);

  if (!room) {
    throw new Error("Codice stanza non trovato.");
  }

  await setCurrentRoom(normalizedRoomCode);
  return { roomCode: normalizedRoomCode, room };
}

export async function endRoom(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!normalizedRoomCode) {
    throw new Error("Nessuna stanza corrente da terminare.");
  }

  const database = ensureDatabase();
  await update(ref(database, `rooms/${normalizedRoomCode}`), {
    status: "ended",
  });
}

export async function resetRoom(playersList = []) {
  return createRoom(playersList);
}

export async function resolveCurrentRoom() {
  const storedRoom = normalizeRoomCode(getStoredCurrentRoom());
  if (storedRoom) {
    const room = await getRoom(storedRoom);
    if (room) {
      return storedRoom;
    }
  }

  const firebaseRoom = normalizeRoomCode(await getCurrentRoom());
  if (firebaseRoom) {
    const room = await getRoom(firebaseRoom);
    if (room) {
      setStoredCurrentRoom(firebaseRoom);
      return firebaseRoom;
    }
  }

  return null;
}

export async function startGame(roomCode, gameKey, entries, chipsPerEuro = DEFAULT_CHIPS_PER_EURO) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  assertGameKey(gameKey);

  const room = await getRoom(normalizedRoomCode);
  if (!room) {
    throw new Error("La stanza selezionata non esiste.");
  }

  if (room.status === "ended") {
    throw new Error("La stanza è terminata. Crea una nuova partita per continuare.");
  }

  const game = room.games[gameKey];
  if (game.status === "active" && game.session) {
    throw new Error("Questo gioco è già in corso.");
  }

  const normalizedRate = parsePositiveNumber(chipsPerEuro) || DEFAULT_CHIPS_PER_EURO;
  const normalizedEntries = entries
    .map((entry) => ({
      playerName: String(entry.playerName || "").trim(),
      investedEuro: parsePositiveNumber(entry.investedEuro),
    }))
    .filter((entry) => entry.playerName && entry.investedEuro);

  if (normalizedEntries.length === 0) {
    throw new Error("Inserisci almeno un giocatore con investimento valido.");
  }

  const uniqueNames = new Set();
  const participants = {};
  const updates = {};

  normalizedEntries.forEach((entry) => {
    if (uniqueNames.has(entry.playerName)) {
      throw new Error("Non puoi inserire lo stesso giocatore due volte nello stesso tavolo.");
    }

    uniqueNames.add(entry.playerName);
    const ledger = room.players[entry.playerName];

    if (!ledger) {
      throw new Error(`Il giocatore ${entry.playerName} non appartiene a questa stanza.`);
    }

    const nextLocked = ledger.locked + entry.investedEuro;
    const nextAvailable = ledger.total - nextLocked;

    updates[`rooms/${normalizedRoomCode}/players/${entry.playerName}`] = {
      total: ledger.total,
      locked: nextLocked,
      available: nextAvailable,
      games: ledger.games,
      activeGame: gameKey,
    };

    const chipBase = CHIP_GAMES.has(gameKey)
      ? entry.investedEuro * normalizedRate
      : entry.investedEuro;

    participants[entry.playerName] = {
      investedEuro: entry.investedEuro,
      startChips: chipBase,
      currentChips: chipBase,
      chipBreakdown: getChipBreakdown(chipBase),
    };
  });

  updates[`rooms/${normalizedRoomCode}/activeGame`] = gameKey;
  updates[`rooms/${normalizedRoomCode}/games/${gameKey}`] = {
    status: "active",
    chipsPerEuro: normalizedRate,
    updatedAt: Date.now(),
    lastSettlement: game.lastSettlement || null,
    lastResults: game.lastResults || {},
    useChips: CHIP_GAMES.has(gameKey),
    session: {
      startedAt: Date.now(),
      chipsPerEuro: normalizedRate,
      participants,
    },
  };

  const database = ensureDatabase();
  await update(ref(database), updates);
}

export async function updateGameChips(roomCode, gameKey, chipUpdates) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  assertGameKey(gameKey);

  const room = await getRoom(normalizedRoomCode);
  if (!room) {
    throw new Error("La stanza selezionata non esiste.");
  }

  const game = room.games[gameKey];
  if (game.status !== "active" || !game.session) {
    throw new Error("Nessuna sessione attiva per questo gioco.");
  }

  const updates = {};
  let touched = 0;

  chipUpdates.forEach((chipUpdate) => {
    const playerName = String(chipUpdate.playerName || "").trim();
    const currentChips = Number(chipUpdate.currentChips);
    if (!playerName || !Number.isFinite(currentChips)) {
      return;
    }

    if (!game.session.participants[playerName]) {
      return;
    }

    updates[
      `rooms/${normalizedRoomCode}/games/${gameKey}/session/participants/${playerName}/currentChips`
    ] = currentChips;
    updates[
      `rooms/${normalizedRoomCode}/games/${gameKey}/session/participants/${playerName}/chipBreakdown`
    ] = getChipBreakdown(currentChips);
    touched += 1;
  });

  if (touched === 0) {
    throw new Error("Inserisci almeno un aggiornamento valido.");
  }

  updates[`rooms/${normalizedRoomCode}/games/${gameKey}/updatedAt`] = Date.now();

  const database = ensureDatabase();
  await update(ref(database), updates);
}

export async function endSubGame(roomCode, gameKey, results) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  assertGameKey(gameKey);

  const room = await getRoom(normalizedRoomCode);
  if (!room) {
    throw new Error("La stanza selezionata non esiste.");
  }

  const game = room.games[gameKey];
  if (game.status !== "active" || !game.session) {
    throw new Error("Nessuna sessione attiva per questo gioco.");
  }

  const updates = {};
  const settlement = {
    endedAt: Date.now(),
    chipsPerEuro: game.session.chipsPerEuro,
    participants: {},
  };
  const gameResults = {};

  Object.entries(game.session.participants).forEach(([playerName, participant]) => {
    const ledger = room.players[playerName] || normalizeLedgerEntry(null);
    const finalNetEuro = Number(results[playerName] || 0);
    const nextLocked = Math.max(0, ledger.locked - participant.investedEuro);
    const nextTotal = ledger.total + finalNetEuro;
    const nextAvailable = nextTotal - nextLocked;
    const nextGames = {
      ...ledger.games,
      [gameKey]: Number(ledger.games?.[gameKey] || 0) + finalNetEuro,
    };

    updates[`rooms/${normalizedRoomCode}/players/${playerName}`] = {
      total: nextTotal,
      locked: nextLocked,
      available: nextAvailable,
      games: nextGames,
      activeGame: null,
    };

    settlement.participants[playerName] = {
      investedEuro: participant.investedEuro,
      finalNetEuro,
      finalChips: participant.currentChips,
    };
    gameResults[playerName] = finalNetEuro;
  });

  updates[`rooms/${normalizedRoomCode}/activeGame`] = null;
  updates[`rooms/${normalizedRoomCode}/games/${gameKey}`] = {
    status: "idle",
    chipsPerEuro: game.session.chipsPerEuro,
    updatedAt: Date.now(),
    lastSettlement: settlement,
    lastResults: gameResults,
    useChips: CHIP_GAMES.has(gameKey),
    session: null,
  };

  const database = ensureDatabase();
  await update(ref(database), updates);
}

export function subscribeToCurrentRoom(callback, errorCallback) {
  const database = ensureDatabase();
  return onValue(
    ref(database, "currentRoom"),
    (snapshot) => callback(snapshot.exists() ? snapshot.val() : null),
    (error) => {
      if (typeof errorCallback === "function") {
        errorCallback(error);
      }
    }
  );
}

export function listenRoom(roomCode, callback, errorCallback) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const database = ensureDatabase();

  if (!normalizedRoomCode) {
    callback(null);
    return () => {};
  }

  return onValue(
    ref(database, `rooms/${normalizedRoomCode}`),
    (snapshot) => callback(snapshot.exists() ? hydrateRoomData(snapshot.val()) : null),
    (error) => {
      if (typeof errorCallback === "function") {
        errorCallback(error);
      }
    }
  );
}

export {
  CHIP_DENOMINATIONS,
  CHIP_GAMES,
  db,
  DEFAULT_CHIPS_PER_EURO,
  GAME_KEYS,
  getChipBreakdown,
  hasPlaceholderConfig,
  normalizePlayersList,
  normalizeRoomCode,
};
