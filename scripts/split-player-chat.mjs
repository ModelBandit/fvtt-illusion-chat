const MODULE_ID = "split-player-chat";

const state = {
  selected: new Set(),
  drafts: new Map(),
  baseDraft: "",
  baseDraftReady: false,
  root: null,
  chatInput: null,
  captureHandler: null,
  baseInputHandler: null,
  composing: false,
  sending: false
};

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  mount();
});

Hooks.on("renderChatLog", () => {
  if (!game.user?.isGM) return;
  queueMicrotask(mount);
});

Hooks.on("createUser", refreshPlayers);
Hooks.on("updateUser", refreshPlayers);
Hooks.on("deleteUser", refreshPlayers);

function refreshPlayers() {
  if (!game.user?.isGM) return;
  queueMicrotask(() => {
    mount();
    renderPlayerList();
    renderPrivateInputs();
  });
}

function getPlayers() {
  return Array.from(game.users ?? [])
    .filter(user => !user.isGM)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang || undefined));
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

    checkbox.addEventListener("change", () => {
      // 토글 직전의 모든 문자열을 먼저 저장한다.
      // 기본 채팅과 개인 채팅은 서로 완전히 별개의 draft로 유지한다.
      saveVisibleDrafts();

      if (checkbox.checked) {
        state.selected.add(player.id);
        if (!state.drafts.has(player.id)) {
          // 처음 체크하는 순간에는 현재 기본 채팅 문자열을 개인 draft의 출발점으로 복제한다.
          // 이후 체크를 풀었다 다시 켜면 이 값을 덮어쓰지 않고 마지막 개인 문자열을 복원한다.
          state.drafts.set(player.id, state.baseDraft);
        }
      } else {
        state.selected.delete(player.id);
      }

      restoreBaseDraft();
      renderPrivateInputs();
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

  // 화면에서 사라질 때도 textarea의 최신 값을 먼저 보존한다.
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
    textarea.value = state.drafts.get(player.id) ?? "";
    textarea.spellcheck = false;

    textarea.addEventListener("input", () => {
      state.drafts.set(player.id, textarea.value);
    });

    // 개인 입력창에서는 Enter를 줄바꿈으로만 쓴다.
    // 실제 전송 트리거는 기존 Foundry 기본 채팅창의 Enter이다.
    textarea.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.stopPropagation();
      }
    });

    card.append(label, textarea);
    inputsHost.appendChild(card);
  }
}

function bindChatInput() {
  const input = document.querySelector("#chat-message");
  if (!input) return;
  if (state.chatInput === input && state.captureHandler) return;

  // Foundry가 채팅 UI를 다시 그려 input 노드가 교체되는 경우에도 기존 기본 문자열을 보존한다.
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


async function onBaseChatKeyDown(event) {
  if (!game.user?.isGM) return;
  if (event.isComposing || event.keyCode === 229) return;

  const isEnter = (event.code === "Enter" || event.code === "NumpadEnter") && !event.shiftKey;
  if (!isEnter) return;
  if (!state.selected.size) return; // 아무도 체크되지 않았다면 Foundry 원래 채팅 동작을 그대로 둔다.

  const players = getPlayers();
  const checked = players.filter(player => state.selected.has(player.id));
  if (!checked.length) return;

  // 코어 ChatLog의 Enter 핸들러보다 먼저 잡아서 public 메시지가 새어 나가지 않게 한다.
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (state.sending) return;

  saveVisibleDrafts();
  const baseText = state.baseDraft;

  const hasPrivateText = checked.some(player => (state.drafts.get(player.id) ?? "").trim().length > 0);
  const unchecked = players.filter(player => !state.selected.has(player.id));
  const hasDefaultText = unchecked.length > 0 && baseText.trim().length > 0;
  if (!hasPrivateText && !hasDefaultText) return;

  state.sending = true;
  try {
    // 체크된 플레이어: 각각 완전히 별도의 whisper 메시지를 보낸다.
    for (const player of checked) {
      const text = state.drafts.get(player.id) ?? "";
      if (!text.trim()) continue;
      await sendWhisper([player.id], text, player.name);
    }

    // 체크되지 않은 플레이어: 기존 채팅창 문자열을 한 그룹으로 보낸다.
    // public 메시지로 만들지 않기 때문에 체크된 플레이어에게 기본 문자열이 노출되지 않는다.
    if (hasDefaultText) {
      await sendWhisper(unchecked.map(player => player.id), baseText, null);
    }
  } catch (error) {
    console.error(`${MODULE_ID} | 메시지 전송 실패`, error);
    ui.notifications?.error(`개인 채팅 분기 전송 실패: ${error.message}`);
  } finally {
    state.sending = false;
  }
}

async function sendWhisper(recipientIds, text, targetName) {
  const cls = ChatMessage.implementation ?? ChatMessage;
  const content = escapeHtml(text).replace(/\n/g, "<br>");
  const chatData = {
    user: game.user.id,
    speaker: cls.getSpeaker(),
    content,
    whisper: recipientIds,
    sound: CONFIG.sounds.notification
  };

  if (CONST.CHAT_MESSAGE_STYLES?.OOC !== undefined) {
    chatData.style = CONST.CHAT_MESSAGE_STYLES.OOC;
    delete chatData.speaker;
  }

  await cls.create(chatData);

  // 로그 추적용 훅. 다른 모듈에서 필요하면 이 훅만 받아도 된다.
  Hooks.callAll(`${MODULE_ID}.sent`, {
    recipients: recipientIds,
    targetName,
    text
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
