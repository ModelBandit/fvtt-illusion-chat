import { CORE_ID, FLAG_SCOPE, MODULE_ID, SCHEMA_VERSION } from "./constants.mjs";
import { ChatTransitionController, chooseVisibleHtml } from "./chat/chat-transition-controller.mjs";
import { EffectManager } from "./effects/effect-manager.mjs";
import { registerSettings } from "./settings/settings.mjs";

const state = {
  core: null,
  drafts: new Map(),
  baseDraft: "",
  baseDraftReady: false,
  chatInput: null,
  captureHandler: null,
  baseInputHandler: null,
  sending: false,
  moderationQueue: [],
  moderationBusy: false
};

const transitionController = new ChatTransitionController({
  getIllusionUserIds: () => state.core?.getIllusionUserIds?.() ?? []
});

Hooks.once("init", () => registerSettings());

Hooks.once("ready", async () => {
  EffectManager.registerSocket();
  registerModerationSocket();
  if (!game.user?.isGM) return;

  state.core = game.modules.get(CORE_ID)?.api ?? globalThis.FVTTIllusionCore;
  if (!state.core) {
    ui.notifications?.error("FVTT Illusion Chat requires FVTT Illusion Core.");
    return;
  }

  state.core.registerFeature({
    id: MODULE_ID,
    render: renderChatFeature,
    onSelectionChanged: detail => {
      saveVisibleDrafts();
      for (const userId of detail.selectedUserIds ?? []) {
        if (!state.drafts.has(userId)) state.drafts.set(userId, state.baseDraft);
      }
    },
    onIllusionChanged: async detail => {
      await transitionController.queueSync(detail.changedUserId ?? null);
    }
  });

  bindChatInput();
  await transitionController.queueSync();
});

Hooks.on("preCreateChatMessage", (document, data) => {
  if (game.user?.isGM) return;
  if (data?.flags?.[FLAG_SCOPE]?.managed) return;
  if (!shouldModeratePlayerMessage(data)) return;

  const gm = getModerationGm();
  if (!gm) return;

  const request = {
    type: "moderation-request",
    targetGmId: gm.id,
    requestId: foundry?.utils?.randomID?.() ?? crypto.randomUUID(),
    sourceUserId: game.user.id,
    sourceUserName: game.user.name,
    content: String(data.content ?? ""),
    speaker: cloneSocketData(data.speaker ?? {}),
    style: data.style,
    timestamp: Date.now()
  };

  // 생성 중인 원본 메시지 자체를 발신자 전용으로 바꾼다. 원문, 화자, 스타일과
  // 작성자 정보는 그대로 유지되며, 다른 플레이어에게만 보이지 않게 된다.
  const flags = cloneSocketData(data.flags ?? {});
  flags[FLAG_SCOPE] = {
    requestId: request.requestId,
    kind: "moderation-self-echo",
    targetUserId: request.sourceUserId,
    managed: true,
    schemaVersion: SCHEMA_VERSION,
    sourceUserId: request.sourceUserId
  };
  document.updateSource({
    whisper: [request.sourceUserId],
    flags
  });

  game.socket.emit(`module.${MODULE_ID}`, request);
  ui.notifications?.info("채팅이 GM 검열 대기열로 전송되었습니다.");
});

Hooks.on("renderChatLog", () => {
  if (!game.user?.isGM) return;
  queueMicrotask(() => {
    bindChatInput();
    state.core?.refresh?.();
  });
});

Hooks.on("renderChatMessage", (message, html) => {
  const flags = message.flags?.[FLAG_SCOPE];
  if (flags?.schemaVersion !== SCHEMA_VERSION || !flags?.managed) return;
  if (!["player-slot", "moderation-self-echo"].includes(flags.kind)) return;

  const element = html?.[0] ?? html;
  if (!(element instanceof HTMLElement)) return;

  if (game.user?.isGM) {
    if (flags.kind === "moderation-self-echo") return;
    renderGmPrivatePreview(element, flags);
    return;
  }
  if (flags.targetUserId !== game.user?.id) return;

  element.classList.remove("whisper");
  element.classList.add("spc-player-visible-message");
  element.querySelectorAll(".whisper-to").forEach(node => node.remove());
  if (flags.kind === "player-slot") EffectManager.handleRenderChatMessage(message, element);
});

Hooks.on("updateChatMessage", message => {
  if (!game.user?.isGM) {
    EffectManager.handleUpdateChatMessage(message);
    return;
  }

  const flags = message.flags?.[FLAG_SCOPE];
  if (flags?.schemaVersion !== SCHEMA_VERSION || flags?.kind !== "player-slot" || !flags?.managed) return;

  queueMicrotask(() => {
    for (const element of document.querySelectorAll(`[data-message-id="${message.id}"]`)) {
      if (element instanceof HTMLElement) renderGmPrivatePreview(element, flags);
    }
  });
});

function renderGmPrivatePreview(element, flags) {
  const defaultHtml = flags.defaultHtml ?? "";
  const privateHtml = flags.privateHtml ?? "";

  // GM summary가 원본 문자열을 이미 출력하므로, 실제로 다른 환상 문자열만 추가 출력한다.
  if (!privateHtml || privateHtml === defaultHtml) {
    element.style.display = "none";
    return;
  }

  const contentElement =
    element.querySelector(".message-content")
    ?? element.querySelector(".message-content-wrapper");

  if (contentElement instanceof HTMLElement) {
    // 문서 content는 플레이어용 현재 상태 그대로 두고 GM의 DOM만 환상 문자열로 덮는다.
    contentElement.innerHTML = privateHtml;
  }

  element.style.removeProperty("display");
  element.classList.add("spc-gm-private-preview");
}

function getPlayers() {
  return state.core?.getPlayers?.() ?? Array.from(game.users ?? []).filter(user => !user.isGM);
}

function getSelectedSet() {
  return new Set(state.core?.getSelectedUserIds?.() ?? []);
}

function getIllusionSet() {
  return new Set(state.core?.getIllusionUserIds?.() ?? []);
}

function getGmIds() {
  return Array.from(game.users ?? []).filter(user => user.isGM).map(user => user.id);
}

function renderChatFeature(host) {
  if (!game.user?.isGM) return;

  if (!host.querySelector("[data-spc-chat-feature]")) {
    host.innerHTML = `
      <div class="spc-chat-feature" data-spc-chat-feature>
        <div class="spc-feature-header">
          <span class="spc-feature-title">개인 채팅 분기</span>
          <span class="spc-feature-help">체크한 플레이어의 개인 문자열을 작성 · 환상 ON일 때 적용</span>
        </div>
        <div class="spc-inputs" data-spc-inputs></div>
        <div class="spc-moderation" data-spc-moderation></div>
      </div>
    `;
  }

  const inputsHost = host.querySelector("[data-spc-inputs]");
  const moderationHost = host.querySelector("[data-spc-moderation]");
  if (!inputsHost || !moderationHost) return;

  for (const textarea of inputsHost.querySelectorAll("textarea[data-user-id]")) {
    state.drafts.set(textarea.dataset.userId, textarea.value);
  }

  inputsHost.replaceChildren();
  const selected = getSelectedSet();
  const players = getPlayers().filter(player => selected.has(player.id));

  if (!players.length) {
    const empty = document.createElement("div");
    empty.className = "spc-feature-empty";
    empty.textContent = "플레이어를 선택하면 개인 문자열 입력칸이 나타납니다.";
    inputsHost.appendChild(empty);
  } else {
    for (const player of players) {
      if (!state.drafts.has(player.id)) state.drafts.set(player.id, state.baseDraft);

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
      textarea.addEventListener("input", () => state.drafts.set(player.id, textarea.value));
      textarea.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) event.stopPropagation();
      });

      card.append(label, textarea);
      inputsHost.appendChild(card);
    }
  }
  renderModerationQueue(moderationHost);
}

function renderModerationQueue(host) {
  host.replaceChildren();

  const header = document.createElement("div");
  header.className = "spc-moderation-header";
  const title = document.createElement("span");
  title.className = "spc-moderation-title";
  title.textContent = "플레이어 채팅 검열";
  const count = document.createElement("span");
  count.className = "spc-moderation-count";
  count.textContent = `${state.moderationQueue.length}건 대기`;
  header.append(title, count);
  host.appendChild(header);

  const request = state.moderationQueue[0];
  if (!request) {
    const empty = document.createElement("div");
    empty.className = "spc-feature-empty";
    empty.textContent = "검열 대기 중인 플레이어 채팅이 없습니다.";
    host.appendChild(empty);
    return;
  }

  const card = document.createElement("div");
  card.className = "spc-moderation-card";

  const meta = document.createElement("div");
  meta.className = "spc-moderation-meta";
  meta.textContent = `${request.sourceUserName || "플레이어"}의 원문`;

  const senderRow = document.createElement("label");
  senderRow.className = "spc-moderation-sender";
  const senderLabel = document.createElement("span");
  senderLabel.textContent = "표시 이름";
  const senderInput = document.createElement("input");
  senderInput.type = "text";
  senderInput.maxLength = 100;
  senderInput.value = request.displayName ?? request.sourceUserName ?? "";
  senderInput.placeholder = request.sourceUserName || "플레이어 이름";
  senderInput.addEventListener("input", () => { request.displayName = senderInput.value; });
  senderInput.addEventListener("keydown", event => event.stopPropagation());
  senderRow.append(senderLabel, senderInput);

  const original = document.createElement("div");
  original.className = "spc-moderation-original";
  original.textContent = htmlToPlainText(request.content);

  const replacement = document.createElement("textarea");
  replacement.className = "spc-moderation-replacement";
  replacement.placeholder = "환상 상태 플레이어에게 보낼 가짜 채팅";
  replacement.value = request.replacementText ?? "";
  replacement.spellcheck = false;
  replacement.addEventListener("input", () => { request.replacementText = replacement.value; });
  replacement.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      void approveModerationRequest(request, replacement.value);
    }
  });

  const actions = document.createElement("div");
  actions.className = "spc-moderation-actions";
  const sendButton = makeModerationButton("전송", "spc-moderation-send", () => approveModerationRequest(request, replacement.value));
  sendButton.disabled = state.moderationBusy;
  actions.append(sendButton);

  card.append(meta, senderRow, original, replacement, actions);
  host.appendChild(card);
}

function makeModerationButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => void handler());
  return button;
}

async function approveModerationRequest(request, replacementText) {
  if (state.moderationBusy || state.moderationQueue[0]?.requestId !== request.requestId) return;
  state.moderationBusy = true;
  state.core?.refresh?.();
  try {
    const defaultHtml = request.content || "&nbsp;";
    const privateHtml = replacementText.trim().length ? toChatHtml(replacementText) : defaultHtml;
    await sendModeratedPlayerMessage({ request, defaultHtml, privateHtml });
    state.moderationQueue.shift();
  } catch (error) {
    console.error(`${MODULE_ID} | 검열 채팅 전송 실패`, error);
    ui.notifications?.error(`검열 채팅 전송 실패: ${error.message}`);
  } finally {
    state.moderationBusy = false;
    state.core?.refresh?.();
  }
}

async function sendModeratedPlayerMessage({ request, defaultHtml, privateHtml }) {
  const batchId = foundry?.utils?.randomID?.() ?? crypto.randomUUID();
  const originalSource = {
    userId: request.sourceUserId,
    speaker: request.speaker,
    style: request.style
  };
  const moderatedSource = {
    ...originalSource,
    speaker: buildModeratedSpeaker(
      request.speaker,
      request.displayName,
      request.sourceUserName
    )
  };
  await createGmSummaryMessage({ batchId, defaultHtml, source: moderatedSource });

  const illusion = getIllusionSet();
  for (const player of getPlayers()) {
    // 원 발신자는 전송 순간 이미 자기 전용 원문 메시지를 받았으므로 중복 생성하지 않는다.
    if (player.id === request.sourceUserId) continue;
    const visibleHtml = chooseVisibleHtml({
      defaultHtml,
      privateHtml,
      usePrivate: shouldShowPrivateToRecipient({
        recipientUserId: player.id,
        sourceUserId: request.sourceUserId,
        illusionUserIds: illusion
      })
    });
    await createPlayerSlotMessage({
      batchId,
      player,
      defaultHtml,
      privateHtml,
      visibleHtml,
      source: moderatedSource
    });
  }
}

export function shouldShowPrivateToRecipient({ recipientUserId, sourceUserId, illusionUserIds }) {
  if (recipientUserId === sourceUserId) return false;
  return illusionUserIds instanceof Set
    ? illusionUserIds.has(recipientUserId)
    : Array.from(illusionUserIds ?? []).includes(recipientUserId);
}

export function buildModeratedSpeaker(speaker, displayName, fallbackName = "") {
  const alias = String(displayName ?? "").trim() || String(fallbackName ?? "").trim();
  return { ...cloneSocketData(speaker ?? {}), alias };
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
  } else input.value = state.baseDraft;

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
  const root = state.core?.getRoot?.();
  for (const textarea of root?.querySelectorAll(`[data-fic-feature-id="${MODULE_ID}"] textarea[data-user-id]`) ?? []) {
    state.drafts.set(textarea.dataset.userId, textarea.value);
  }
}

async function onBaseChatKeyDown(event) {
  if (!game.user?.isGM) return;
  if (event.isComposing || event.keyCode === 229) return;
  const isEnter = (event.code === "Enter" || event.code === "NumpadEnter") && !event.shiftKey;
  const selected = getSelectedSet();
  if (!isEnter || !selected.size) return;

  const players = getPlayers();
  if (!players.some(player => selected.has(player.id))) return;

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
    const defaultHtml = toChatHtml(baseText);
    await createGmSummaryMessage({ batchId, defaultHtml });

    const illusion = getIllusionSet();
    for (const player of players) {
      const privateText = selected.has(player.id)
        ? (state.drafts.get(player.id) ?? baseText)
        : baseText;
      const privateHtml = toChatHtml(privateText);
      const visibleHtml = chooseVisibleHtml({
        defaultHtml,
        privateHtml,
        usePrivate: illusion.has(player.id)
      });
      await createPlayerSlotMessage({ batchId, player, defaultHtml, privateHtml, visibleHtml });
    }
  } catch (error) {
    console.error(`${MODULE_ID} | 메시지 전송 실패`, error);
    ui.notifications?.error(`개인 채팅 분기 전송 실패: ${error.message}`);
  } finally {
    state.sending = false;
  }
}

async function createGmSummaryMessage({ batchId, defaultHtml, source = null }) {
  const cls = ChatMessage.implementation ?? ChatMessage;
  await cls.create(baseChatData({
    content: defaultHtml || "&nbsp;",
    whisper: getGmIds(),
    flags: { [FLAG_SCOPE]: {
      batchId,
      kind: "gm-summary",
      managed: true,
      schemaVersion: SCHEMA_VERSION,
      sourceUserId: source?.userId ?? null
    } },
    source
  }));
}

async function createPlayerSlotMessage({ batchId, player, defaultHtml, privateHtml, visibleHtml, source = null }) {
  const cls = ChatMessage.implementation ?? ChatMessage;
  await cls.create(baseChatData({
    content: visibleHtml,
    whisper: [player.id],
    flags: {
      [FLAG_SCOPE]: {
        batchId,
        kind: "player-slot",
        targetUserId: player.id,
        managed: true,
        schemaVersion: SCHEMA_VERSION,
        sourceUserId: source?.userId ?? null,
        defaultHtml,
        privateHtml
      }
    },
    source
  }));

  Hooks.callAll(`${MODULE_ID}.sent`, {
    recipients: [player.id], targetName: player.name, batchId,
    targetUserId: player.id, defaultHtml, privateHtml
  });
}

function baseChatData({ content, whisper, flags, source = null }) {
  const cls = ChatMessage.implementation ?? ChatMessage;
  const chatData = {
    // GM을 문서 작성자로 유지해야 원 발신 플레이어가 다른 수신자의 whisper slot까지
    // "자신이 작성한 메시지"로 판정받아 보게 되는 정보 누출을 막을 수 있다.
    user: game.user.id,
    speaker: source?.speaker ?? cls.getSpeaker(),
    content,
    whisper,
    sound: CONFIG.sounds.notification,
    flags
  };
  if (source?.style !== undefined) {
    chatData.style = source.style;
  } else if (CONST.CHAT_MESSAGE_STYLES?.OOC !== undefined) {
    chatData.style = CONST.CHAT_MESSAGE_STYLES.OOC;
    delete chatData.speaker;
  }
  return chatData;
}

function registerModerationSocket() {
  game.socket.on(`module.${MODULE_ID}`, payload => {
    if (!game.user?.isGM || payload?.type !== "moderation-request") return;
    if (payload.targetGmId !== game.user.id) return;
    if (!isValidModerationRequest(payload)) return;
    if (state.moderationQueue.some(item => item.requestId === payload.requestId)) return;

    const sourceUser = game.users.get(payload.sourceUserId);
    state.moderationQueue.push({
      ...payload,
      sourceUserName: sourceUser.name,
      displayName: String(payload.speaker?.alias ?? "").trim() || sourceUser.name,
      replacementText: ""
    });
    state.core?.refresh?.();
    ui.notifications?.info(`${sourceUser.name || "플레이어"}의 채팅이 검열 대기 중입니다.`);
  });
}

function shouldModeratePlayerMessage(data) {
  if (!String(data?.content ?? "").trim()) return false;
  if (data.whisper?.length || data.whisper?.size) return false;
  if (data.rolls?.length || data.roll) return false;
  if (!getConfiguredIllusionUserIds().length) return false;
  return Boolean(getModerationGm());
}

function getConfiguredIllusionUserIds() {
  const saved = game.settings.get(CORE_ID, "illusionPlayers") ?? { ids: [] };
  return Array.isArray(saved.ids) ? saved.ids : [];
}

function getModerationGm() {
  return Array.from(game.users ?? []).find(user => user.isGM && user.active) ?? null;
}

function isValidModerationRequest(payload) {
  if (!payload.requestId || !payload.sourceUserId || typeof payload.content !== "string") return false;
  if (payload.content.length > 100000) return false;
  const sourceUser = game.users?.get?.(payload.sourceUserId);
  return Boolean(sourceUser && !sourceUser.isGM);
}

function cloneSocketData(value) {
  if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return JSON.parse(JSON.stringify(value));
}

function htmlToPlainText(html = "") {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(html);
  wrapper.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
  return wrapper.textContent ?? "";
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
