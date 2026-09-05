const MODULE_ID = "split-player-chat";
const FLAG_SCOPE = MODULE_ID;
const SCHEMA_VERSION = 3;

const state = {
  selected: new Set(),
  drafts: new Map(),
  baseDraft: "",
  baseDraftReady: false,
  root: null,
  chatInput: null,
  captureHandler: null,
  baseInputHandler: null,
  sending: false,
  syncingHistory: false,
  historySyncChain: Promise.resolve()
};

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "selectedPlayers", {
    scope: "world",
    config: false,
    type: Object,
    default: { ids: [] }
  });
});

Hooks.once("ready", async () => {
  if (!game.user.isGM) return;

  const saved = game.settings.get(MODULE_ID, "selectedPlayers") ?? { ids: [] };
  state.selected = new Set(Array.isArray(saved.ids) ? saved.ids : []);

  mount();
  await queueContentSync();
});

Hooks.on("renderChatLog", () => {
  if (!game.user?.isGM) return;
  queueMicrotask(mount);
});

// schema v3의 플레이어용 고정 로그는 GM 화면에서는 숨긴다.
// 플레이어 화면에서는 실제 whisper 권한은 유지하되, 이 모듈이 만든 자기 전용 로그에 한해서
// Foundry 기본 "To: 이름" 표기와 whisper 전용 색상만 제거해 일반 채팅처럼 보이게 한다.
Hooks.on("renderChatMessage", (message, html) => {
  const flags = message.flags?.[FLAG_SCOPE];
  if (flags?.schemaVersion !== SCHEMA_VERSION || flags?.kind !== "player-slot") return;

  const element = html?.[0] ?? html;
  if (!(element instanceof HTMLElement)) return;

  if (game.user?.isGM) {
    element.style.display = "none";
    return;
  }

  // 다른 플레이어용 슬롯은 원래 whisper 권한 때문에 렌더되지 않지만,
  // 혹시 렌더 훅이 호출되더라도 자기 슬롯에만 외형 변경을 적용한다.
  if (flags.targetUserId !== game.user?.id) return;

  element.classList.remove("whisper");
  element.classList.add("spc-player-visible-message");
  element.querySelectorAll(".whisper-to").forEach(node => node.remove());
});

Hooks.on("createUser", refreshPlayers);
Hooks.on("updateUser", refreshPlayers);
Hooks.on("deleteUser", refreshPlayers);

function refreshPlayers() {
  if (!game.user?.isGM) return;
  queueMicrotask(async () => {
    mount();
    renderPlayerList();
    renderPrivateInputs();
    await persistSelection();
    await queueContentSync();
  });
}

function getPlayers() {
  return Array.from(game.users ?? [])
    .filter(user => !user.isGM)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang || undefined));
}

function getGmIds() {
  return Array.from(game.users ?? [])
    .filter(user => user.isGM)
    .map(user => user.id);
}

function mount() {
  if (!game.user?.isGM) return;

  let root = document.getElementById(`${MODULE_ID}-root`);
  if (!root) {
    root = document.createElement("section");
    root.id = `${MODULE_ID}-root`;
    root.className = "spc-root";
    root.innerHTML = `
      <div class="spc-header">
        <span class="spc-title">개인 채팅 분기</span>
        <span class="spc-help">체크 후 기본 채팅창에서 Enter</span>
      </div>
      <div class="spc-players" data-spc-players></div>
      <div class="spc-inputs" data-spc-inputs></div>
    `;
    document.body.appendChild(root);
  }
  state.root = root;

  renderPlayerList();
  renderPrivateInputs();
  bindChatInput();
}

function renderPlayerList() {
  if (!state.root) return;

  const playersHost = state.root.querySelector("[data-spc-players]");
  if (!playersHost) return;

  const validIds = new Set(getPlayers().map(p => p.id));
  for (const id of Array.from(state.selected)) {
    if (!validIds.has(id)) state.selected.delete(id);
  }

  playersHost.replaceChildren();

  const players = getPlayers();
  if (!players.length) {
    const empty = document.createElement("span");
    empty.className = "spc-empty";
    empty.textContent = "등록된 플레이어가 없습니다.";
    playersHost.appendChild(empty);
    return;
  }

  for (const player of players) {
    const label = document.createElement("label");
    label.className = "spc-player";
    label.title = player.active ? `${player.name} (접속 중)` : `${player.name} (오프라인)`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.userId = player.id;
    checkbox.checked = state.selected.has(player.id);

    checkbox.addEventListener("change", async () => {
      saveVisibleDrafts();

      if (checkbox.checked) {
        state.selected.add(player.id);
        if (!state.drafts.has(player.id)) {
          state.drafts.set(player.id, state.baseDraft);
        }
      } else {
        state.selected.delete(player.id);
      }

      restoreBaseDraft();
      renderPrivateInputs();

      try {
        await persistSelection();
        // whisper/recipient는 절대 바꾸지 않는다.
        // 해당 플레이어에게 이미 존재하는 고정 ChatMessage의 content만 교체한다.
        await queueContentSync(player.id);
      } catch (error) {
        console.error(`${MODULE_ID} | 체크 상태 반영 실패`, error);
        ui.notifications?.error(`채팅 로그 내용 전환 실패: ${error.message}`);
      }
    });

    const dot = document.createElement("span");
    dot.className = `spc-status ${player.active ? "is-active" : ""}`;

    const name = document.createElement("span");
    name.className = "spc-player-name";
    name.textContent = player.name;

    label.append(checkbox, dot, name);
    playersHost.appendChild(label);
  }
}

function renderPrivateInputs() {
  if (!state.root) return;
  const inputsHost = state.root.querySelector("[data-spc-inputs]");
  if (!inputsHost) return;

  for (const textarea of inputsHost.querySelectorAll("textarea[data-user-id]")) {
    state.drafts.set(textarea.dataset.userId, textarea.value);
  }

  inputsHost.replaceChildren();

  const players = getPlayers().filter(player => state.selected.has(player.id));
  state.root.classList.toggle("has-private-inputs", players.length > 0);

  for (const player of players) {
    const card = document.createElement("div");
    card.className = "spc-input-card";

    const label = document.createElement("div");
    label.className = "spc-input-label";
    label.textContent = player.name;

    const textarea = document.createElement("textarea");
    textarea.dataset.userId = player.id;
    textarea.placeholder = `${player.name}에게만 보낼 문자열`;
    textarea.value = state.drafts.get(player.id) ?? state.baseDraft;
    textarea.spellcheck = false;

    textarea.addEventListener("input", () => {
      state.drafts.set(player.id, textarea.value);
    });

    textarea.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) event.stopPropagation();
    });

    card.append(label, textarea);
    inputsHost.appendChild(card);
  }
}

function bindChatInput() {
  const input = document.querySelector("#chat-message");
  if (!input) return;
  if (state.chatInput === input && state.captureHandler) return;

  if (state.chatInput) {
    if (state.baseInputHandler) state.chatInput.removeEventListener("input", state.baseInputHandler);
    if (state.captureHandler) state.chatInput.removeEventListener("keydown", state.captureHandler, true);
    if (state.chatInput.isConnected) saveBaseDraft();
  }

  state.chatInput = input;

  if (!state.baseDraftReady) {
    state.baseDraft = input.value ?? "";
    state.baseDraftReady = true;
  } else {
    input.value = state.baseDraft;
  }

  state.baseInputHandler = () => {
    state.baseDraft = input.value ?? "";
    state.baseDraftReady = true;
  };
  state.captureHandler = onBaseChatKeyDown;

  input.addEventListener("input", state.baseInputHandler);
  input.addEventListener("keydown", state.captureHandler, true);
}

function saveBaseDraft() {
  if (!state.chatInput) return;
  state.baseDraft = state.chatInput.value ?? "";
  state.baseDraftReady = true;
}

function saveVisibleDrafts() {
  saveBaseDraft();
  for (const textarea of state.root?.querySelectorAll("textarea[data-user-id]") ?? []) {
    state.drafts.set(textarea.dataset.userId, textarea.value);
  }
}

function restoreBaseDraft() {
  if (!state.chatInput || !state.baseDraftReady) return;
  state.chatInput.value = state.baseDraft;
}

async function persistSelection() {
  const validIds = new Set(getPlayers().map(player => player.id));
  for (const id of Array.from(state.selected)) {
    if (!validIds.has(id)) state.selected.delete(id);
  }
  await game.settings.set(MODULE_ID, "selectedPlayers", { ids: Array.from(state.selected) });
}

async function onBaseChatKeyDown(event) {
  if (!game.user?.isGM) return;
  if (event.isComposing || event.keyCode === 229) return;

  const isEnter = (event.code === "Enter" || event.code === "NumpadEnter") && !event.shiftKey;
  if (!isEnter) return;
  if (!state.selected.size) return;

  const players = getPlayers();
  const checked = players.filter(player => state.selected.has(player.id));
  if (!checked.length) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (state.sending) return;

  saveVisibleDrafts();
  const baseText = state.baseDraft;
  const hasAnyText = players.some(player => {
    const privateText = state.drafts.get(player.id) ?? "";
    return baseText.trim().length > 0 || privateText.trim().length > 0;
  });
  if (!hasAnyText) return;

  state.sending = true;
  try {
    const batchId = foundry?.utils?.randomID?.() ?? crypto.randomUUID();
    const encodedDefault = toChatHtml(baseText);

    // GM 화면에는 한 배치당 요약 로그 하나만 만든다.
    // 플레이어 슬롯 메시지는 GM 렌더에서 숨기므로 GM 로그가 플레이어 수만큼 늘어나 보이지 않는다.
    await createGmSummaryMessage({ batchId, defaultHtml: encodedDefault });

    // 각 플레이어는 처음부터 자기 전용 ChatMessage 하나를 고정으로 갖는다.
    // 이 메시지의 whisper 대상은 영구히 [해당 플레이어]로 유지한다.
    // 이후 체크 토글은 동일 메시지의 content만 public/private 사이에서 교체한다.
    for (const player of players) {
      const privateText = state.drafts.get(player.id) ?? baseText;
      const defaultHtml = encodedDefault;
      const privateHtml = toChatHtml(privateText);
      const usePrivate = state.selected.has(player.id);
      const visibleHtml = chooseVisibleHtml({ defaultHtml, privateHtml, usePrivate });

      await createPlayerSlotMessage({
        batchId,
        player,
        defaultHtml,
        privateHtml,
        visibleHtml
      });
    }
  } catch (error) {
    console.error(`${MODULE_ID} | 메시지 전송 실패`, error);
    ui.notifications?.error(`개인 채팅 분기 전송 실패: ${error.message}`);
  } finally {
    state.sending = false;
  }
}

async function createGmSummaryMessage({ batchId, defaultHtml }) {
  const cls = ChatMessage.implementation ?? ChatMessage;
  const chatData = baseChatData({
    content: defaultHtml || "&nbsp;",
    whisper: getGmIds(),
    flags: {
      [FLAG_SCOPE]: {
        batchId,
        kind: "gm-summary",
        managed: true,
        schemaVersion: SCHEMA_VERSION
      }
    }
  });

  await cls.create(chatData);
}

async function createPlayerSlotMessage({ batchId, player, defaultHtml, privateHtml, visibleHtml }) {
  const cls = ChatMessage.implementation ?? ChatMessage;
  const chatData = baseChatData({
    content: visibleHtml,
    whisper: [player.id],
    flags: {
      [FLAG_SCOPE]: {
        batchId,
        kind: "player-slot",
        targetUserId: player.id,
        managed: true,
        schemaVersion: SCHEMA_VERSION,
        defaultHtml,
        privateHtml
      }
    }
  });

  await cls.create(chatData);

  Hooks.callAll(`${MODULE_ID}.sent`, {
    recipients: [player.id],
    targetName: player.name,
    batchId,
    targetUserId: player.id,
    defaultHtml,
    privateHtml
  });
}

function baseChatData({ content, whisper, flags }) {
  const cls = ChatMessage.implementation ?? ChatMessage;
  const chatData = {
    user: game.user.id,
    speaker: cls.getSpeaker(),
    content,
    whisper,
    sound: CONFIG.sounds.notification,
    flags
  };

  if (CONST.CHAT_MESSAGE_STYLES?.OOC !== undefined) {
    chatData.style = CONST.CHAT_MESSAGE_STYLES.OOC;
    delete chatData.speaker;
  }

  return chatData;
}

function queueContentSync(targetUserId = null) {
  state.historySyncChain = state.historySyncChain
    .catch(error => console.error(`${MODULE_ID} | 이전 로그 내용 동기화 실패`, error))
    .then(() => synchronizeStoredMessageContent(targetUserId));
  return state.historySyncChain;
}

async function synchronizeStoredMessageContent(targetUserId = null) {
  if (!game.user?.isGM || state.syncingHistory) return;

  const slots = Array.from(game.messages ?? []).filter(message => {
    const flags = message.flags?.[FLAG_SCOPE];
    if (flags?.schemaVersion !== SCHEMA_VERSION || flags?.kind !== "player-slot") return false;
    if (!flags.targetUserId) return false;
    return targetUserId ? flags.targetUserId === targetUserId : true;
  });
  if (!slots.length) return;

  state.syncingHistory = true;
  try {
    // game.messages 순서를 그대로 순회한다. update는 content 하나만 바꾸며
    // whisper, id, timestamp, sort, speaker, flags를 전혀 수정하지 않는다.
    for (const message of slots) {
      const flags = message.flags?.[FLAG_SCOPE];
      const usePrivate = state.selected.has(flags.targetUserId);
      const desired = chooseVisibleHtml({
        defaultHtml: flags.defaultHtml ?? "",
        privateHtml: flags.privateHtml ?? "",
        usePrivate
      });

      if ((message.content ?? "") === desired) continue;
      await message.update(
        { content: desired },
        { splitPlayerChatContentSwap: true }
      );
    }
  } finally {
    state.syncingHistory = false;
  }
}

function chooseVisibleHtml({ defaultHtml, privateHtml, usePrivate }) {
  if (usePrivate && privateHtml) return privateHtml;
  if (defaultHtml) return defaultHtml;
  if (privateHtml) return privateHtml;
  return "&nbsp;";
}

function toChatHtml(value) {
  const text = String(value ?? "");
  if (!text.length) return "";
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
