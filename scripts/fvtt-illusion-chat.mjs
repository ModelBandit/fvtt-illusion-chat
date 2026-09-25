import { CORE_ID, FLAG_SCOPE, MODULE_ID, SCHEMA_VERSION } from "./constants.mjs";
import { ChatTransitionController, chooseVisibleHtml } from "./chat/chat-transition-controller.mjs";
import { isValidModerationRequest, registerHijackMessage } from "./chat/hijack-message.mjs";
import { EffectManager } from "./effects/effect-manager.mjs";
import { refreshSettingsLocalization, registerSettings } from "./settings/settings.mjs";

const state = {
  core: null,
  controlHost: null,
  unregisterModule: null,
  drafts: new Map(),
  baseDraft: "",
  baseDraftReady: false,
  chatInput: null,
  captureHandler: null,
  baseInputHandler: null,
  sending: false,
  moderationQueue: [],
  moderationBusy: false,
  textMap: {},
  sceneImagePath: "",
  sceneImageContainer: null,
  sceneImageSprite: null,
  sceneImageFilter: null,
  sceneImageTicker: null
};

const transitionController = new ChatTransitionController({
  getIllusionUserIds: () => state.core?.getIllusionUserIds?.() ?? []
});

// 모듈 평가 시점에는 game이 아직 준비되지 않을 수 있으므로 Core가 선공개한 전역 API만 사용한다.
const coreApi = globalThis.FVTTIllusionCore;

// Core가 자기 init에서 공통 데이터/API 준비를 끝낸 뒤 호출한다.
// Foundry의 settings 등록은 Chat 자신의 init 훅에 남겨 생명주기를 침범하지 않는다.
coreApi?.registerInitializer?.(MODULE_ID, core => {
  state.core = core;
  state.textMap = core.getLanguageMap?.("chat") ?? {};
});

Hooks.once("init", () => {
  state.core = state.core ?? game.modules.get(CORE_ID)?.api ?? globalThis.FVTTIllusionCore;
  state.textMap = state.textMap && Object.keys(state.textMap).length
    ? state.textMap
    : state.core?.getLanguageMap?.("chat") ?? {};
  registerSettings(state.textMap);
});

Hooks.once("ready", async () => {
  EffectManager.registerSocket();
  registerModerationSocket();
  registerSceneImageSocket();

  state.core = game.modules.get(CORE_ID)?.api ?? globalThis.FVTTIllusionCore;
  if (!state.core) {
    ui.notifications?.error(t("requiresCore"));
    return;
  }

  state.textMap = state.core.getLanguageMap?.("chat") ?? {};

  Hooks.on(`${CORE_ID}.languageChanged`, () => {
    state.textMap = state.core?.getLanguageMap?.("chat") ?? {};
    refreshSettingsLocalization(state.textMap);
    if (!game.user?.isGM) return;
    registerWithCore();
    state.core?.refresh?.();
  });

  // 플레이어 일반 채팅 하이잭은 별도 모듈에서 담당한다.
  // 하이잭 활성 조건은 환상 토글이 아니라 Core의 전송 체크박스(selected)다.
  registerHijackMessage({
    getSelectedUserIds: () => state.core?.getSelectedUserIds?.() ?? [],
    localize: (key, replacements) => t(key, replacements)
  });

  if (!game.user?.isGM) return;

  registerWithCore();

  bindChatInput();
  await transitionController.queueSync();
});

Hooks.on("renderChatLog", () => {
  if (!game.user?.isGM) return;
  queueMicrotask(() => {
    bindChatInput();
    state.core?.refresh?.();
    renderModerationQueueInChatLogs();
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
  if (flags.kind === "player-slot") {
    syncPlayerSlotSenderName(element, flags);
    EffectManager.handleRenderChatMessage(message, element);
  }
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

function t(key, replacements = {}) {
  const value = String(key ?? "").split(".").reduce((node, part) => node?.[part], state.textMap);
  let text = typeof value === "string" ? value : String(key ?? "");
  for (const [name, replacement] of Object.entries(replacements ?? {})) {
    text = text.replaceAll(`{${name}}`, String(replacement));
  }
  return text;
}

function getGmIds() {
  return Array.from(game.users ?? []).filter(user => user.isGM).map(user => user.id);
}

function registerWithCore() {
  state.unregisterModule?.();
  state.unregisterModule = state.core.registerModule({
    id: MODULE_ID,
    title: t("moduleTitle"),
    description: t("moduleDescription"),
    order: 100,
    renderControl: renderChatControls,
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
}

function renderChatControls(host) {
  if (!game.user?.isGM) return;
  state.controlHost = host;

  if (!host.querySelector("[data-spc-chat-feature]")) {
    host.innerHTML = `
      <div class="spc-chat-feature" data-spc-chat-feature>
        <div class="spc-inputs" data-spc-inputs></div>
        <div class="spc-scene-image-controls" data-spc-scene-image-controls>
          <input type="text" data-spc-scene-image-path placeholder="Image path" />
          <button type="button" data-spc-scene-image-browse>Browse</button>
          <button type="button" data-spc-scene-image-show>Show</button>
        </div>
      </div>
    `;
  }

  const inputsHost = host.querySelector("[data-spc-inputs]");
  if (!inputsHost) return;
  bindSceneImageControls(host);

  for (const textarea of inputsHost.querySelectorAll("textarea[data-user-id]")) {
    state.drafts.set(textarea.dataset.userId, textarea.value);
  }

  inputsHost.replaceChildren();
  const selected = getSelectedSet();
  const players = getPlayers().filter(player => selected.has(player.id));

  if (!players.length) {
    const empty = document.createElement("div");
    empty.className = "spc-feature-empty";
    empty.textContent = t("selectPlayerHint");
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
      textarea.placeholder = t("privatePlaceholder", { name: player.name });
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
}

function renderModerationQueueInChatLogs({ scroll = false } = {}) {
  if (!game.user?.isGM) return;
  const activeIds = new Set(state.moderationQueue.map(request => request.requestId));

  for (const log of document.querySelectorAll("#chat-log")) {
    for (const entry of log.querySelectorAll("[data-spc-moderation-request-id]")) {
      if (!activeIds.has(entry.dataset.spcModerationRequestId)) entry.remove();
    }

    for (const [index, request] of state.moderationQueue.entries()) {
      const selector = `[data-spc-moderation-request-id="${CSS.escape(request.requestId)}"]`;
      let entry = log.querySelector(selector);
      if (!entry) {
        entry = createModerationLogEntry(request);
        log.appendChild(entry);
      }
      const position = entry.querySelector("[data-spc-moderation-position]");
      if (position) position.textContent = t("moderationPosition", { current: index + 1, total: state.moderationQueue.length });
      const button = entry.querySelector(".spc-moderation-send");
      if (button) button.disabled = state.moderationBusy;
    }

    if (scroll && state.moderationQueue.length) {
      log.querySelector("[data-spc-moderation-request-id]:last-of-type")
        ?.scrollIntoView({ block: "end" });
    }
  }
}

function createModerationLogEntry(request) {
  const entry = document.createElement("li");
  entry.className = "chat-message flexcol spc-moderation-message";
  entry.dataset.spcModerationRequestId = request.requestId;

  const header = document.createElement("header");
  header.className = "message-header flexrow";

  const sender = document.createElement("h4");
  sender.className = "message-sender";
  sender.textContent = request.displayName || request.sourceUserName || t("player");

  const metadata = document.createElement("span");
  metadata.className = "message-metadata spc-moderation-position";
  metadata.dataset.spcModerationPosition = "true";
  metadata.textContent = t("moderationPending");
  header.append(sender, metadata);

  const content = document.createElement("div");
  content.className = "message-content spc-moderation-content";

  const senderRow = document.createElement("label");
  senderRow.className = "spc-moderation-sender";
  const senderLabel = document.createElement("span");
  senderLabel.textContent = t("displayName");
  const senderInput = document.createElement("input");
  senderInput.type = "text";
  senderInput.maxLength = 100;
  senderInput.dataset.spcModerationField = "display-name";
  senderInput.value = request.displayName ?? request.sourceUserName ?? "";
  senderInput.placeholder = request.sourceUserName || t("playerName");
  senderInput.addEventListener("input", () => {
    request.displayName = senderInput.value;
    sender.textContent = senderInput.value.trim() || request.sourceUserName || t("player");
  });
  senderInput.addEventListener("keydown", event => event.stopPropagation());
  senderRow.append(senderLabel, senderInput);

  const original = document.createElement("div");
  original.className = "spc-moderation-original";
  original.textContent = htmlToPlainText(request.content);

  const replacement = document.createElement("textarea");
  replacement.className = "spc-moderation-replacement";
  replacement.dataset.spcModerationField = "replacement";
  replacement.placeholder = t("replacementPlaceholder");
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
  const sendButton = makeModerationButton(t("send"), "spc-moderation-send", () => approveModerationRequest(request, replacement.value));
  sendButton.disabled = state.moderationBusy;
  actions.append(sendButton);

  content.append(senderRow, original, replacement, actions);
  entry.append(header, content);
  return entry;
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
  if (state.moderationBusy || !state.moderationQueue.some(item => item.requestId === request.requestId)) return;
  state.moderationBusy = true;
  renderModerationQueueInChatLogs();
  try {
    const defaultHtml = request.content || "&nbsp;";
    const privateHtml = replacementText.trim().length ? toChatHtml(replacementText) : defaultHtml;
    await sendModeratedPlayerMessage({ request, defaultHtml, privateHtml });
    state.moderationQueue = state.moderationQueue.filter(item => item.requestId !== request.requestId);
  } catch (error) {
    console.error(`${MODULE_ID} | Moderated chat send failed`, error);
    ui.notifications?.error(t("moderationSendFailed", { error: error.message }));
  } finally {
    state.moderationBusy = false;
    renderModerationQueueInChatLogs();
  }
}

async function sendModeratedPlayerMessage({ request, defaultHtml, privateHtml }) {
  const batchId = foundry?.utils?.randomID?.() ?? crypto.randomUUID();
  const originalSource = {
    userId: request.sourceUserId,
    speaker: request.speaker,
    style: request.style
  };
  const originalSenderName = String(request.sourceUserName ?? request.speaker?.alias ?? "").trim();
  const moderatedSenderName = String(request.displayName ?? "").trim() || originalSenderName;
  const moderatedSource = {
    ...originalSource,
    speaker: buildModeratedSpeaker(
      request.speaker,
      request.displayName,
      request.sourceUserName
    ),
    senderNameModified: Boolean(originalSenderName && moderatedSenderName && moderatedSenderName !== originalSenderName),
    senderOriginalName: originalSenderName,
    senderDisplayName: moderatedSenderName
  };
  await createGmSummaryMessage({ batchId, defaultHtml, source: moderatedSource });

  const illusion = getIllusionSet();
  for (const player of getPlayers()) {
    // 원 발신자는 전송 순간 이미 자기 전용 원문 메시지를 받았으므로 중복 생성하지 않는다.
    if (player.id === request.sourceUserId) continue;
    const usePrivate = shouldShowPrivateToRecipient({
      recipientUserId: player.id,
      sourceUserId: request.sourceUserId,
      illusionUserIds: illusion
    });
    const visibleHtml = chooseVisibleHtml({ defaultHtml, privateHtml, usePrivate });
    await createPlayerSlotMessage({
      batchId,
      player,
      defaultHtml,
      privateHtml,
      visibleHtml,
      usePrivate,
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
  for (const textarea of state.controlHost?.querySelectorAll("textarea[data-user-id]") ?? []) {
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
      const usePrivate = illusion.has(player.id);
      const visibleHtml = chooseVisibleHtml({ defaultHtml, privateHtml, usePrivate });
      await createPlayerSlotMessage({ batchId, player, defaultHtml, privateHtml, visibleHtml, usePrivate });
    }
  } catch (error) {
    console.error(`${MODULE_ID} | Message send failed`, error);
    ui.notifications?.error(t("privateSendFailed", { error: error.message }));
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
      sourceUserId: source?.userId ?? null,
      senderNameModified: Boolean(source?.senderNameModified),
      senderOriginalName: source?.senderOriginalName ?? null,
      senderDisplayName: source?.senderDisplayName ?? null
    } },
    source
  }));
}

async function createPlayerSlotMessage({ batchId, player, defaultHtml, privateHtml, visibleHtml, usePrivate = false, source = null }) {
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
        senderNameModified: Boolean(source?.senderNameModified),
        senderOriginalName: source?.senderOriginalName ?? null,
        senderDisplayName: source?.senderDisplayName ?? null,
        senderUsePrivate: Boolean(usePrivate),
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

function syncPlayerSlotSenderName(element, flags) {
  if (!flags?.senderNameModified) return;
  const sender = element.querySelector(".message-sender");
  if (!(sender instanceof HTMLElement)) return;

  const illusionActive = state.core?.isIllusionActive?.(flags.targetUserId)
    ?? (state.core?.getIllusionUserIds?.() ?? []).includes(flags.targetUserId);
  const originalName = String(flags.senderOriginalName ?? "").trim();
  const displayName = String(flags.senderDisplayName ?? "").trim();
  sender.textContent = illusionActive
    ? (displayName || originalName || sender.textContent || "")
    : (originalName || displayName || sender.textContent || "");
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
    renderModerationQueueInChatLogs({ scroll: true });
    ui.notifications?.info(t("moderationWaiting", { name: sourceUser.name || t("player") }));
  });
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


function bindSceneImageControls(host) {
  const pathInput = host.querySelector("[data-spc-scene-image-path]");
  const browseButton = host.querySelector("[data-spc-scene-image-browse]");
  const showButton = host.querySelector("[data-spc-scene-image-show]");
  if (!(pathInput instanceof HTMLInputElement) || !browseButton || !showButton) return;

  if (!pathInput.value && state.sceneImagePath) pathInput.value = state.sceneImagePath;
  pathInput.addEventListener("input", () => { state.sceneImagePath = pathInput.value.trim(); }, { once: false });

  if (browseButton.dataset.bound !== "true") {
    browseButton.dataset.bound = "true";
    browseButton.addEventListener("click", () => {
      const picker = new FilePicker({
        type: "image",
        current: pathInput.value || "",
        callback: path => {
          state.sceneImagePath = path;
          pathInput.value = path;
        }
      });
      picker.browse();
    });
  }

  if (showButton.dataset.bound !== "true") {
    showButton.dataset.bound = "true";
    showButton.addEventListener("click", () => {
      const path = pathInput.value.trim();
      if (!path) return ui.notifications?.warn("Select an image first.");
      state.sceneImagePath = path;
      emitSceneImage({ action: "show", path });
    });
  }
}

function registerSceneImageSocket() {
  game.socket.on(`module.${MODULE_ID}`, payload => {
    if (payload?.type !== "scene-image") return;
    if (payload.action === "show") void showSceneImage(payload.path);
    else if (payload.action === "hide") hideSceneImage();
  });
}

function emitSceneImage(payload) {
  game.socket.emit(`module.${MODULE_ID}`, { type: "scene-image", ...payload });
  if (payload.action === "show") void showSceneImage(payload.path);
  else if (payload.action === "hide") hideSceneImage();
}

async function showSceneImage(path) {
  hideSceneImage();
  if (!canvas?.app?.stage || !globalThis.PIXI) return;

  try {
    const texture = PIXI.Texture.from(path);
    if (texture.baseTexture && !texture.baseTexture.valid) {
      await new Promise((resolve, reject) => {
        texture.baseTexture.once("loaded", resolve);
        texture.baseTexture.once("error", reject);
      });
    }

    const container = new PIXI.Container();
    container.eventMode = "none";
    container.zIndex = 100000;
    container.sortableChildren = true;

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(canvas.app.renderer.width / 2, canvas.app.renderer.height / 2);

    const maxW = canvas.app.renderer.width * 0.85;
    const maxH = canvas.app.renderer.height * 0.85;
    const scale = Math.min(maxW / Math.max(1, texture.width), maxH / Math.max(1, texture.height), 1);
    sprite.scale.set(scale);

    const fragment = `
      varying vec2 vTextureCoord;
      uniform sampler2D uSampler;
      uniform float time;
      float hash(float n) { return fract(sin(n) * 43758.5453123); }
      void main(void) {
        vec2 uv = vTextureCoord;
        float y = floor(uv.y * 42.0);
        float gate = step(0.72, hash(y * 17.17 + floor(time * 8.0)));
        float coarse = (hash(y * 7.31 + floor(time * 5.0)) - 0.5) * 0.20;
        float fine = sin(uv.y * 260.0 + time * 17.0) * 0.006;
        uv.x += coarse * gate + fine * gate;
        gl_FragColor = texture2D(uSampler, uv);
      }
    `;
    const filter = new PIXI.Filter(undefined, fragment, { time: 0 });
    sprite.filters = [filter];
    container.addChild(sprite);
    canvas.app.stage.addChild(container);

    const ticker = () => {
      if (!filter?.uniforms) return;
      filter.uniforms.time = performance.now() / 1000;
      sprite.position.set(canvas.app.renderer.width / 2, canvas.app.renderer.height / 2);
    };
    canvas.app.ticker.add(ticker);

    state.sceneImageContainer = container;
    state.sceneImageSprite = sprite;
    state.sceneImageFilter = filter;
    state.sceneImageTicker = ticker;

    window.setTimeout(() => {
      if (state.sceneImageContainer === container) hideSceneImage();
    }, 1800);
  } catch (error) {
    console.error(`${MODULE_ID} | Scene image failed`, error);
    ui.notifications?.error(`Image effect failed: ${error.message}`);
  }
}

function hideSceneImage() {
  if (state.sceneImageTicker && canvas?.app?.ticker) canvas.app.ticker.remove(state.sceneImageTicker);
  state.sceneImageTicker = null;
  if (state.sceneImageContainer) {
    state.sceneImageContainer.parent?.removeChild(state.sceneImageContainer);
    state.sceneImageContainer.destroy({ children: true });
  }
  state.sceneImageContainer = null;
  state.sceneImageSprite = null;
  state.sceneImageFilter = null;
}
