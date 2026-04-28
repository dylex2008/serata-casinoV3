import {
  CHIP_GAMES,
  createRoom,
  DEFAULT_CHIPS_PER_EURO,
  addAdjustment,
  endSubGame,
  GAME_KEYS,
  getChipBreakdown,
  getRoom,
  hasPlaceholderConfig,
  isAdminUnlocked,
  joinRoom,
  listenRoom,
  normalizePlayersList,
  normalizeRoomCode,
  resolveCurrentRoom,
  startGame,
  subscribeToCurrentRoom,
  unlockAdminSession,
  updateGameChips,
} from "./firebase.js";

const GAME_LABELS = {
  poker: "POKER",
  blackjack: "BJ",
  roulette: "RULETTE",
  horse_racing: "CAVALLI",
};

const GAME_LONG_LABELS = {
  poker: "POKER",
  blackjack: "BLACK JACK",
  roulette: "RULETTE",
  horse_racing: "CAVALLI",
};

const PASTEL_CLASSES = [
  "pastel-1",
  "pastel-2",
  "pastel-3",
  "pastel-4",
  "pastel-5",
  "pastel-6",
  "pastel-7",
  "pastel-8",
];

const ADMIN_PIN = "SETCOMADMIN";

const currencyFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 0,
});

const pageState = {
  currentRoomCode: null,
  currentRoom: null,
  roomUnsubscribe: null,
  currentGamePage: document.body.dataset.gamePage || null,
};

document.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("#create-room-form")) {
    initHomePage();
  }

  if (document.querySelector(".games-selection-grid")) {
    initGameSelectionPage();
  }

  if (document.querySelector(".leaderboard-mockup-layout")) {
    initRankingPage();
  }

  if (document.querySelector("#game-form")) {
    initGamePage();
  }

  if (document.querySelector("#stats-player-name")) {
    initStatsPage();
  }

  if (document.querySelector("#admin-adjustment-form")) {
    initAdminPage();
  }
});

function initHomePage() {
  const createForm = document.querySelector("#create-room-form");
  const joinForm = document.querySelector("#join-room-form");
  const createStatus = document.querySelector("#create-room-status");
  const joinStatus = document.querySelector("#join-room-status");
  const createdRoomNode = document.querySelector("#created-room-code");
  const heroButtons = [...document.querySelectorAll("[data-home-panel]")];
  const heroPanels = [...document.querySelectorAll("[data-panel]")];

  if (hasPlaceholderConfig) {
    setStatus(createStatus, "Configurazione Firebase mancante.", true);
    setStatus(joinStatus, "Configurazione Firebase mancante.", true);
    return;
  }

  const activatePanel = (panelId) => {
    heroButtons.forEach((button) => {
      button.dataset.active = String(button.dataset.homePanel === panelId);
    });

    heroPanels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== panelId;
    });
  };

  heroButtons.forEach((button) => {
    button.addEventListener("click", () => activatePanel(button.dataset.homePanel));
  });

  activatePanel("create");

  createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = createForm.querySelector('button[type="submit"]');
    const players = normalizePlayersList(
      String(createForm.querySelector("#players-list")?.value || "").split(",")
    );

    button.disabled = true;
    try {
      const roomCode = await createRoom(players);
      createdRoomNode.textContent = roomCode;
      setStatus(createStatus, `Partita creata: ${roomCode}`, false);
      window.location.href = "input.html";
    } catch (error) {
      setStatus(createStatus, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  joinForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = joinForm.querySelector('button[type="submit"]');
    const roomCode = normalizeRoomCode(joinForm.querySelector("#room-code-input")?.value || "");

    button.disabled = true;
    try {
      await joinRoom(roomCode);
      setStatus(joinStatus, `Ingresso effettuato nella stanza ${roomCode}`, false);
      window.location.href = "input.html";
    } catch (error) {
      setStatus(joinStatus, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

async function initGameSelectionPage() {
  const statusNode = document.querySelector("#dashboard-status");
  const roomCodeNode = document.querySelector("#current-room-code");
  const roomStateNode = document.querySelector("#room-state");

  if (hasPlaceholderConfig) {
    setStatus(statusNode, "Configurazione Firebase mancante.", true);
    return;
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  attachRoomWatcher(
    roomCode,
    (room) => {
      roomCodeNode.textContent = roomCode;
      setRoomBadge(roomStateNode, room.status === "ended" ? "CHIUSA" : "ATTIVA", room.status);
      updateGameLinks(room);
    },
    statusNode
  );
}

async function initRankingPage() {
  const listNode = document.querySelector("#leaderboard-list");
  const miniBoardsRoot = document.querySelector("#mini-leaderboards");
  const liveIndicatorNode = document.querySelector("#live-indicator");
  const movementCountNode = document.querySelector("#movement-count");
  const roomNode = document.querySelector("#leaderboard-game-id");
  const roomStateNode = document.querySelector("#leaderboard-game-state");
  const activeGameNode = document.querySelector("#leaderboard-active-games");

  if (hasPlaceholderConfig) {
    liveIndicatorNode.textContent = "Firebase non configurato";
    return;
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  liveIndicatorNode.textContent = "Realtime attivo";

  attachRoomWatcher(roomCode, (room) => {
    roomNode.textContent = roomCode;
    activeGameNode.textContent = room.activeGame
      ? `Gioco attivo: ${GAME_LONG_LABELS[room.activeGame]}`
      : "Nessun gioco attivo";
    movementCountNode.textContent = `${Object.keys(room.players || {}).length} Giocatori`;
    setRoomBadge(roomStateNode, room.status === "ended" ? "CHIUSA" : "ATTIVA", room.status);
    renderMainRanking(listNode, buildMainRanking(room.players || {}));
    renderMiniBoards(miniBoardsRoot, room.players || {});
  });
}

async function initGamePage() {
  const gameKey = pageState.currentGamePage;
  const formNode = document.querySelector("#game-form");
  const statusNode = document.querySelector("#game-status-text");
  const roomCodeNode = document.querySelector("#game-room-code");
  const roomStateNode = document.querySelector("#game-room-state");
  const summaryPlayersNode = document.querySelector("#game-selected-players");
  const summaryLockedNode = document.querySelector("#game-selected-locked");
  const summaryRateNode = document.querySelector("#game-selected-rate");
  const summaryStatusNode = document.querySelector("#game-selected-status");
  const chipsRateInput = document.querySelector("#chips-rate");
  const startButton = document.querySelector("#start-subgame");
  const updateChipsButton = document.querySelector("#update-chips");
  const calculateButton = document.querySelector("#calculate-results");
  const finishButton = document.querySelector("#finish-subgame");
  const useChips = CHIP_GAMES.has(gameKey);

  buildPlayerCards(formNode, useChips);

  if (hasPlaceholderConfig) {
    setStatus(statusNode, "Configurazione Firebase mancante.", true);
    return;
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  attachRoomWatcher(roomCode, (room) => {
    roomCodeNode.textContent = roomCode;
    setRoomBadge(roomStateNode, room.status === "ended" ? "CHIUSA" : "ATTIVA", room.status);
    populateGameCards(formNode, room, gameKey);
    updateGameSummary({
      room,
      gameKey,
      summaryPlayersNode,
      summaryLockedNode,
      summaryRateNode,
      summaryStatusNode,
      chipsRateInput,
    });
    syncGameControls({
      room,
      gameKey,
      formNode,
      startButton,
      updateChipsButton,
      calculateButton,
      finishButton,
      chipsRateInput,
    });
  }, statusNode);

  formNode.addEventListener("input", () => {
    if (useChips) {
      updateChipVisuals(formNode);
    }
  });

  calculateButton?.addEventListener("click", () => {
    calculateResults(formNode, gameKey, Number(chipsRateInput?.value || DEFAULT_CHIPS_PER_EURO));
    setStatus(statusNode, "Risultati calcolati.", false);
  });

  startButton?.addEventListener("click", async () => {
    startButton.disabled = true;
    try {
      const entries = collectStartEntries(formNode);
      const rate = Number(chipsRateInput?.value || DEFAULT_CHIPS_PER_EURO);
      await startGame(roomCode, gameKey, entries, rate);
      setStatus(statusNode, `${GAME_LONG_LABELS[gameKey]} avviato.`, false);
    } catch (error) {
      setStatus(statusNode, error.message, true);
    } finally {
      startButton.disabled = false;
    }
  });

  updateChipsButton?.addEventListener("click", async () => {
    updateChipsButton.disabled = true;
    try {
      const updates = collectChipUpdates(formNode);
      await updateGameChips(roomCode, gameKey, updates);
      setStatus(statusNode, "Fiches aggiornate.", false);
    } catch (error) {
      setStatus(statusNode, error.message, true);
    } finally {
      updateChipsButton.disabled = false;
    }
  });

  finishButton?.addEventListener("click", async () => {
    finishButton.disabled = true;
    try {
      calculateResults(formNode, gameKey, Number(chipsRateInput?.value || DEFAULT_CHIPS_PER_EURO));
      const results = collectEndResults(formNode);
      await endSubGame(roomCode, gameKey, results);
      setStatus(statusNode, `${GAME_LONG_LABELS[gameKey]} terminato.`, false);
    } catch (error) {
      setStatus(statusNode, error.message, true);
    } finally {
      finishButton.disabled = false;
    }
  });
}

async function initStatsPage() {
  const playerName = new URLSearchParams(window.location.search).get("player");
  const roomCodeNode = document.querySelector("#stats-room-code");
  const roomStateNode = document.querySelector("#stats-room-state");

  if (!playerName) {
    window.location.href = "leaderboard.html";
    return;
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  attachRoomWatcher(roomCode, (room) => {
    roomCodeNode.textContent = roomCode;
    setRoomBadge(roomStateNode, room.status === "ended" ? "CHIUSA" : "ATTIVA", room.status);
    renderStatsPage(room, playerName);
  });
}

async function initAdminPage() {
  const statusNode = document.querySelector("#admin-status");
  const playerSelect = document.querySelector("#admin-player-select");
  const valueInput = document.querySelector("#admin-adjustment-value");
  const reasonInput = document.querySelector("#admin-adjustment-reason");
  const roomCodeNode = document.querySelector("#admin-room-code");
  const roomStateNode = document.querySelector("#admin-room-state");
  const form = document.querySelector("#admin-adjustment-form");

  if (!isAdminUnlocked()) {
    const pin = window.prompt("Inserisci il codice admin");
    if (pin !== ADMIN_PIN) {
      window.location.href = "leaderboard.html";
      return;
    }
    unlockAdminSession();
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  attachRoomWatcher(roomCode, (room) => {
    roomCodeNode.textContent = roomCode;
    setRoomBadge(roomStateNode, room.status === "ended" ? "CHIUSA" : "ATTIVA", room.status);
    populatePlayerSelect(playerSelect, room.playersList);
  }, statusNode);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#admin-apply-button");
    button.disabled = true;

    try {
      await addAdjustment(roomCode, {
        player: playerSelect.value,
        value: Number(valueInput.value),
        reason: reasonInput.value,
      });

      form.reset();
      setStatus(statusNode, "Correzione applicata correttamente.", false);
    } catch (error) {
      setStatus(statusNode, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

function attachRoomWatcher(roomCode, onRoomUpdate, statusNode) {
  pageState.currentRoomCode = normalizeRoomCode(roomCode);

  if (pageState.roomUnsubscribe) {
    pageState.roomUnsubscribe();
  }

  pageState.roomUnsubscribe = listenRoom(
    pageState.currentRoomCode,
    (room) => {
      if (!room) {
        window.location.href = "index.html";
        return;
      }

      pageState.currentRoom = room;
      onRoomUpdate(room);
    },
    (error) => setStatus(statusNode, error.message, true)
  );

  subscribeToCurrentRoom(async (firebaseCurrentRoom) => {
    const normalizedCode = normalizeRoomCode(firebaseCurrentRoom);
    if (normalizedCode && normalizedCode !== pageState.currentRoomCode) {
      const currentRoom = await getRoom(pageState.currentRoomCode);
      if (!currentRoom) {
        window.location.href = "index.html";
      }
    }
  });
}

function updateGameLinks(room) {
  GAME_KEYS.forEach((gameKey) => {
    const node = document.querySelector(`#game-status-${gameKey}`);
    const link = document.querySelector(`[data-game-link="${gameKey}"]`);
    const active = room.games?.[gameKey]?.status === "active";

    if (node) {
      node.textContent = GAME_LONG_LABELS[gameKey];
    }

    if (link) {
      link.dataset.state = active ? "active" : "idle";
    }
  });
}

function buildPlayerCards(container, useChips) {
  container.innerHTML = Array.from({ length: 8 }, (_, index) => {
    const pastelClass = PASTEL_CLASSES[index % PASTEL_CLASSES.length];
    return `
      <article class="player-entry-card ${pastelClass}">
        <span class="player-card-index">${index + 1}</span>
        <label>
          <span>Nome</span>
          <select name="player">
            <option value="">Seleziona giocatore</option>
          </select>
        </label>
        <label>
          <span>Buy-in €</span>
          <input type="number" name="investment" step="0.01" placeholder="0" />
        </label>
        <label>
          <span>${useChips ? "Fiches finali" : "Importo finale €"}</span>
          <input type="number" name="value" step="${useChips ? "1" : "0.01"}" placeholder="0" />
        </label>
        <label>
          <span>Risultato €</span>
          <input type="number" name="result" step="0.01" placeholder="0" readonly />
        </label>
        ${useChips ? '<div class="chips-visual" data-chip-stack></div>' : ""}
      </article>
    `;
  }).join("");
}

function populateGameCards(container, room, gameKey) {
  const selects = container.querySelectorAll('select[name="player"]');
  const cards = [...container.querySelectorAll(".player-entry-card")];
  const sessionEntries = Object.entries(room.games?.[gameKey]?.session?.participants || {});

  selects.forEach((select) => populatePlayerSelect(select, room.playersList));

  cards.forEach((card, index) => {
    const select = card.querySelector('select[name="player"]');
    const investment = card.querySelector('input[name="investment"]');
    const value = card.querySelector('input[name="value"]');
    const result = card.querySelector('input[name="result"]');
    const chipStack = card.querySelector("[data-chip-stack]");
    const sessionEntry = sessionEntries[index];

    if (sessionEntry) {
      const [playerName, participant] = sessionEntry;
      select.value = playerName;
      investment.value = participant.investedEuro;
      value.value = participant.currentChips;

      if (chipStack) {
        renderChipStack(
          chipStack,
          participant.chipBreakdown || getChipBreakdown(participant.currentChips)
        );
      }
    } else {
      select.value = "";
      investment.value = "";
      value.value = "";
      if (!result.matches(":focus")) {
        result.value = "";
      }
      if (chipStack) {
        chipStack.innerHTML = "";
      }
    }
  });
}

function populatePlayerSelect(select, players) {
  const currentValue = select.value;
  select.innerHTML = `
    <option value="">Seleziona giocatore</option>
    ${players
      .map((player) => `<option value="${escapeHtml(player)}">${escapeHtml(player)}</option>`)
      .join("")}
  `;

  if (players.includes(currentValue)) {
    select.value = currentValue;
  }
}

function updateGameSummary({
  room,
  gameKey,
  summaryPlayersNode,
  summaryLockedNode,
  summaryRateNode,
  summaryStatusNode,
  chipsRateInput,
}) {
  const game = room.games?.[gameKey];
  const participants = Object.values(game?.session?.participants || {});
  const locked = participants.reduce((sum, player) => sum + Number(player.investedEuro || 0), 0);

  summaryPlayersNode.textContent = String(participants.length);
  summaryLockedNode.textContent = currencyFormatter.format(locked);
  summaryRateNode.textContent = CHIP_GAMES.has(gameKey)
    ? `${integerFormatter.format(game?.chipsPerEuro || DEFAULT_CHIPS_PER_EURO)} fiches / €1`
    : "Diretto";
  summaryStatusNode.textContent = game?.status === "active" ? "In gioco" : "Pronto";

  if (chipsRateInput) {
    chipsRateInput.value = String(game?.chipsPerEuro || DEFAULT_CHIPS_PER_EURO);
  }
}

function syncGameControls({
  room,
  gameKey,
  formNode,
  startButton,
  updateChipsButton,
  calculateButton,
  finishButton,
  chipsRateInput,
}) {
  const game = room.games?.[gameKey];
  const active = game?.status === "active";
  const roomEnded = room.status === "ended";
  const useChips = CHIP_GAMES.has(gameKey);

  formNode.querySelectorAll(".player-entry-card").forEach((card) => {
    const select = card.querySelector('select[name="player"]');
    const investment = card.querySelector('input[name="investment"]');
    const value = card.querySelector('input[name="value"]');

    select.disabled = roomEnded || active;
    investment.disabled = roomEnded || active;
    value.disabled = roomEnded || !active;
  });

  if (chipsRateInput) {
    chipsRateInput.disabled = roomEnded || active || !useChips;
    chipsRateInput.closest(".compact-field").style.display = useChips ? "" : "none";
  }

  if (startButton) {
    startButton.disabled = roomEnded || active;
  }

  if (updateChipsButton) {
    updateChipsButton.disabled = roomEnded || !active || !useChips;
    updateChipsButton.style.display = useChips ? "" : "none";
  }

  if (calculateButton) {
    calculateButton.disabled = roomEnded;
  }

  if (finishButton) {
    finishButton.disabled = roomEnded || !active;
  }
}

function calculateResults(container, gameKey, chipsRate) {
  const useChips = CHIP_GAMES.has(gameKey);

  [...container.querySelectorAll(".player-entry-card")].forEach((card) => {
    const investment = parseNumber(card.querySelector('input[name="investment"]')?.value) || 0;
    const value = parseNumber(card.querySelector('input[name="value"]')?.value) || 0;
    const resultNode = card.querySelector('input[name="result"]');
    const chipStack = card.querySelector("[data-chip-stack]");

    const result = useChips
      ? value / (chipsRate || DEFAULT_CHIPS_PER_EURO) - investment
      : value - investment;

    resultNode.value = Number.isFinite(result) ? result.toFixed(2) : "";

    if (chipStack && useChips) {
      renderChipStack(chipStack, getChipBreakdown(value));
    }
  });
}

function updateChipVisuals(container) {
  [...container.querySelectorAll(".player-entry-card")].forEach((card) => {
    const chipStack = card.querySelector("[data-chip-stack]");
    const value = parseNumber(card.querySelector('input[name="value"]')?.value) || 0;
    if (chipStack) {
      renderChipStack(chipStack, getChipBreakdown(value));
    }
  });
}

function collectStartEntries(container) {
  return [...container.querySelectorAll(".player-entry-card")]
    .map((card) => ({
      playerName: card.querySelector('select[name="player"]')?.value || "",
      investedEuro: parseNumber(card.querySelector('input[name="investment"]')?.value),
    }))
    .filter(
      (entry) => entry.playerName && Number.isFinite(entry.investedEuro) && entry.investedEuro > 0
    );
}

function collectChipUpdates(container) {
  return [...container.querySelectorAll(".player-entry-card")]
    .map((card) => ({
      playerName: card.querySelector('select[name="player"]')?.value || "",
      currentChips: parseNumber(card.querySelector('input[name="value"]')?.value),
    }))
    .filter((entry) => entry.playerName && Number.isFinite(entry.currentChips));
}

function collectEndResults(container) {
  return [...container.querySelectorAll(".player-entry-card")].reduce((accumulator, card) => {
    const playerName = card.querySelector('select[name="player"]')?.value || "";
    const result = parseNumber(card.querySelector('input[name="result"]')?.value);

    if (playerName && Number.isFinite(result)) {
      accumulator[playerName] = result;
    }

    return accumulator;
  }, {});
}

function buildMainRanking(playersMap) {
  return Object.entries(playersMap)
    .map(([name, ledger]) => ({
      name,
      total: Number(ledger?.total || 0),
      locked: Number(ledger?.locked || 0),
      available: Number(ledger?.available || 0),
      activeGame: ledger?.activeGame || null,
    }))
    .sort((first, second) => second.total - first.total);
}

function buildMiniRanking(playersMap, gameKey) {
  return Object.entries(playersMap)
    .map(([name, ledger]) => ({
      name,
      value: Number(ledger?.games?.[gameKey] || 0),
    }))
    .sort((first, second) => second.value - first.value)
    .slice(0, 1);
}

function renderMainRanking(container, ranking) {
  if (!ranking.length) {
    container.innerHTML = Array.from({ length: 6 }, (_, index) => `
      <div class="leaderboard-bar-row leaderboard-bar-row-empty">
        <span class="leaderboard-bar-rank">${index + 1}</span>
        <div class="leaderboard-bar-fill"></div>
      </div>
    `).join("");
    return;
  }

  const filledRows = ranking
    .slice(0, 6)
    .map((player, index) => {
      const topClass = index === 0 ? "top-gold" : index === 1 ? "top-blue" : index === 2 ? "top-pink" : "";
      const prefix = index === 0 ? "♛" : index + 1;
      return `
        <a class="leaderboard-bar-row ${topClass}" href="stats.html?player=${encodeURIComponent(player.name)}">
          <span class="leaderboard-bar-rank">${prefix}</span>
          <div class="leaderboard-bar-fill">
            <span class="leaderboard-bar-name">${escapeHtml(player.name)}</span>
            <strong class="leaderboard-bar-total">${currencyFormatter.format(player.total)}</strong>
          </div>
        </a>
      `;
    });

  const emptyRows = Array.from(
    { length: Math.max(0, 6 - filledRows.length) },
    (_, offset) => `
      <div class="leaderboard-bar-row leaderboard-bar-row-empty">
        <span class="leaderboard-bar-rank">${filledRows.length + offset + 1}</span>
        <div class="leaderboard-bar-fill"></div>
      </div>
    `
  );

  container.innerHTML = [...filledRows, ...emptyRows].join("");
}

function renderMiniBoards(container, playersMap) {
  container.querySelectorAll("[data-mini-board]").forEach((board) => {
    const gameKey = board.dataset.miniBoard;
    const ranking = buildMiniRanking(playersMap, gameKey);
    const winner = ranking[0];

    board.innerHTML = `
      <h3>${GAME_LONG_LABELS[gameKey]}</h3>
      <div class="mini-mockup-line"></div>
      <div class="mini-mockup-body">
        <span class="mini-mockup-crown">♛</span>
        <strong>${winner ? escapeHtml(winner.name) : "-"}</strong>
        <span>${winner ? currencyFormatter.format(winner.value) : "€0,00"}</span>
      </div>
    `;
  });
}

function renderStatsPage(room, playerName) {
  const ranking = buildMainRanking(room.players || {});
  const player = room.players?.[playerName];

  if (!player) {
    window.location.href = "leaderboard.html";
    return;
  }

  document.querySelector("#stats-player-name").textContent = playerName.toUpperCase();
  document.querySelector("#stats-global-rank").textContent = `#${findGeneralRank(ranking, playerName)}`;
  document.querySelector("#stats-total").textContent = formatMoney(player.total);
  document.querySelector("#stats-rank-poker").textContent = `#${findGameRank(room.players, "poker", playerName)}`;
  document.querySelector("#stats-rank-blackjack").textContent = `#${findGameRank(room.players, "blackjack", playerName)}`;
  document.querySelector("#stats-rank-horse_racing").textContent = `#${findGameRank(room.players, "horse_racing", playerName)}`;
  document.querySelector("#stats-rank-roulette").textContent = `#${findGameRank(room.players, "roulette", playerName)}`;
  document.querySelector("#stats-available").textContent = formatMoney(player.available);
  document.querySelector("#stats-locked").textContent = formatMoney(player.locked);
  document.querySelector("#stats-status").textContent = player.activeGame ? "IN GIOCO" : "FUORI GIOCO";
  document.querySelector("#stats-status").dataset.state = player.activeGame ? "active" : "idle";
  document.querySelector("#stats-log").innerHTML = buildPlayerLog(room, playerName);
}

function findGeneralRank(ranking, playerName) {
  return Math.max(
    1,
    ranking.findIndex((player) => player.name === playerName) + 1
  );
}

function findGameRank(playersMap, gameKey, playerName) {
  const ranking = Object.entries(playersMap)
    .map(([name, ledger]) => ({
      name,
      value: Number(ledger?.games?.[gameKey] || 0),
    }))
    .sort((first, second) => second.value - first.value);

  return Math.max(
    1,
    ranking.findIndex((player) => player.name === playerName) + 1
  )
    .toString()
    .padStart(2, "0");
}

function buildPlayerLog(room, playerName) {
  const rows = [];

  GAME_KEYS.forEach((gameKey) => {
    const value = Number(room.players?.[playerName]?.games?.[gameKey] || 0);
    if (value !== 0) {
      rows.push(`
        <div class="stats-log-row">
          <span>${GAME_LONG_LABELS[gameKey]}</span>
          <strong class="${value >= 0 ? "stats-log-positive" : "stats-log-negative"}">
            ${value >= 0 ? "+" : ""}${formatMoney(value)}
          </strong>
        </div>
      `);
    }
  });

  room.adjustments
    .filter((adjustment) => adjustment.player === playerName)
    .forEach((adjustment) => {
      rows.push(`
        <div class="stats-log-row">
          <span>Correzione${adjustment.reason ? ` · ${escapeHtml(adjustment.reason)}` : ""}</span>
          <strong class="${adjustment.value >= 0 ? "stats-log-positive" : "stats-log-negative"}">
            ${adjustment.value >= 0 ? "+" : ""}${formatMoney(adjustment.value)}
          </strong>
        </div>
      `);
    });

  return rows.length ? rows.join("") : `<p class="mini-empty">Nessuna partita registrata</p>`;
}

function renderChipStack(container, breakdown) {
  container.innerHTML = breakdown
    .filter((chip) => chip.count > 0)
    .map(
      (chip) => `
        <div class="chip-stack-item">
          <span class="chip-mark chip-${chip.value}">${chip.value}</span>
          <strong>${chip.count}</strong>
        </div>
      `
    )
    .join("");
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function setStatus(node, message, isError) {
  if (!node) {
    return;
  }

  node.textContent = message;
  node.style.color = isError ? "#000000" : "#444444";
}

function setRoomBadge(node, label, state) {
  if (!node) {
    return;
  }

  node.textContent = label;
  node.dataset.state = state || "idle";
}

function formatMoney(value) {
  return currencyFormatter.format(Number(value || 0)).replace("€", "") + "€";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
