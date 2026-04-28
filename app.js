import {
  CHIP_GAMES,
  createRoom,
  DEFAULT_CHIPS_PER_EURO,
  endRoom,
  endSubGame,
  GAME_KEYS,
  getChipBreakdown,
  getRoom,
  hasPlaceholderConfig,
  joinRoom,
  listenRoom,
  normalizePlayersList,
  normalizeRoomCode,
  resolveCurrentRoom,
  resetRoom,
  startGame,
  subscribeToCurrentRoom,
  updateGameChips,
} from "./firebase.js";

const GAME_LABELS = {
  poker: "Poker",
  blackjack: "Blackjack",
  roulette: "Roulette",
  horse_racing: "Horse Racing",
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

  if (document.querySelector("#leaderboard-list")) {
    initRankingPage();
  }

  if (document.querySelector("#game-form")) {
    initGamePage();
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
    setStatus(createStatus, "Firebase config missing.", true);
    setStatus(joinStatus, "Firebase config missing.", true);
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
      setStatus(createStatus, `Room ${roomCode} created.`, false);
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
    const roomCode = normalizeRoomCode(
      joinForm.querySelector("#room-code-input")?.value || ""
    );

    button.disabled = true;
    try {
      await joinRoom(roomCode);
      setStatus(joinStatus, `Room ${roomCode} joined.`, false);
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
    setStatus(statusNode, "Firebase config missing.", true);
    return;
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  attachRoomWatcher(roomCode, (room) => {
    roomCodeNode.textContent = roomCode;
    setRoomBadge(
      roomStateNode,
      room.status === "ended" ? "Closed" : "Active",
      room.status
    );
    updateGameLinks(room);
  }, statusNode);
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
    liveIndicatorNode.textContent = "Firebase config missing";
    return;
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  liveIndicatorNode.textContent = "Realtime on";

  attachRoomWatcher(roomCode, (room) => {
    roomNode.textContent = roomCode;
    activeGameNode.textContent = room.activeGame ? GAME_LABELS[room.activeGame] : "No active game";
    movementCountNode.textContent = `${Object.keys(room.players || {}).length} Players`;
    setRoomBadge(
      roomStateNode,
      room.status === "ended" ? "Closed" : "Active",
      room.status
    );
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
    setStatus(statusNode, "Firebase config missing.", true);
    return;
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  attachRoomWatcher(roomCode, (room) => {
    roomCodeNode.textContent = roomCode;
    setRoomBadge(
      roomStateNode,
      room.status === "ended" ? "Closed" : "Active",
      room.status
    );

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
    setStatus(statusNode, "Results calculated.", false);
  });

  startButton?.addEventListener("click", async () => {
    startButton.disabled = true;
    try {
      const entries = collectStartEntries(formNode);
      const rate = Number(chipsRateInput?.value || DEFAULT_CHIPS_PER_EURO);
      await startGame(roomCode, gameKey, entries, rate);
      setStatus(statusNode, `${GAME_LABELS[gameKey]} started.`, false);
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
      setStatus(statusNode, "Chips updated.", false);
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
      setStatus(statusNode, `${GAME_LABELS[gameKey]} ended.`, false);
    } catch (error) {
      setStatus(statusNode, error.message, true);
    } finally {
      finishButton.disabled = false;
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
      node.textContent = GAME_LABELS[gameKey];
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
          <span>Name</span>
          <select name="player">
            <option value="">Select player</option>
          </select>
        </label>
        <label>
          <span>Buy-in €</span>
          <input type="number" name="investment" step="0.01" placeholder="0" />
        </label>
        <label>
          <span>${useChips ? "Final chips" : "Final amount €"}</span>
          <input type="number" name="value" step="${useChips ? "1" : "0.01"}" placeholder="0" />
        </label>
        <label>
          <span>Result €</span>
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
      value.value = CHIP_GAMES.has(gameKey)
        ? participant.currentChips
        : participant.currentChips;

      if (chipStack) {
        renderChipStack(chipStack, participant.chipBreakdown || getChipBreakdown(participant.currentChips));
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
    <option value="">Select player</option>
    ${players.map((player) => `<option value="${escapeHtml(player)}">${escapeHtml(player)}</option>`).join("")}
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
    ? `${integerFormatter.format(game?.chipsPerEuro || DEFAULT_CHIPS_PER_EURO)} chips / €1`
    : "Direct";
  summaryStatusNode.textContent = game?.status === "active" ? "Live" : "Ready";

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

    const result = useChips ? value / (chipsRate || DEFAULT_CHIPS_PER_EURO) - investment : value - investment;
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
    .filter((entry) => entry.playerName && Number.isFinite(entry.investedEuro) && entry.investedEuro > 0);
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
    .slice(0, 3);
}

function renderMainRanking(container, ranking) {
  container.innerHTML = ranking.length
    ? ranking
        .map((player, index) => `
          <article class="ranking-row ${index < 3 ? `top-${index + 1}` : ""}">
            <div class="ranking-left">
              <span class="ranking-position">${index + 1}</span>
              <div>
                <h2>${escapeHtml(player.name)}</h2>
                <p>Locked ${currencyFormatter.format(player.locked)} · Available ${currencyFormatter.format(player.available)}</p>
              </div>
            </div>
            <strong>${currencyFormatter.format(player.total)}</strong>
          </article>
        `)
        .join("")
    : `
      <div class="empty-state">
        <h2>No ranking data</h2>
      </div>
    `;
}

function renderMiniBoards(container, playersMap) {
  container.querySelectorAll("[data-mini-board]").forEach((board) => {
    const gameKey = board.dataset.miniBoard;
    const ranking = buildMiniRanking(playersMap, gameKey);

    board.innerHTML = `
      <h3>${GAME_LABELS[gameKey]}</h3>
      ${
        ranking.length
          ? ranking
              .map(
                (player, index) => `
                  <div class="mini-row ${index === 0 ? "mini-top" : ""}">
                    <span>${index + 1}</span>
                    <span>${escapeHtml(player.name)}</span>
                    <strong>${currencyFormatter.format(player.value)}</strong>
                  </div>
                `
              )
              .join("")
          : '<p class="mini-empty">No results</p>'
      }
    `;
  });
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
