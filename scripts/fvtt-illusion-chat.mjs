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
  sending: false
};

const transitionController = new ChatTransitionController({
  getIllusionUserIds: () => state.core?.getIllusionUserIds?.() ?? []
});

Hooks.once("init", () => registerSettings());

Hooks.once("ready", async () => {
  EffectManager.registerSocket();
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

Hooks.on("renderChatLog", () => {
  if (!game.user?.isGM) return;
  queueMicrotask(() => {
    bindChatInput();
    state.core?.refresh?.();
  });
});

Hooks.on("renderChatMessage", (message, html) => {
  const flags = message.flags?.[FLAG_SCOPE];
  if (flags?.schemaVersion !== SCHEMA_VERSION || flags?.kind !== "player-slot" || !flags?.managed) return;

  const element = html?.[0] ?? html;
  if (!(element instanceof HTMLElement)) return;

  if (game.user?.isGM) {
    element.style.display = "none";
    return;
  }
  if (flags.targetUserId !== game.user?.id) return;

  element.classList.remove("whisper");
  element.classList.add("spc-player-visible-message");
  element.querySelectorAll(".whisper-to").forEach(node => node.remove());
  EffectManager.handleRenderChatMessage(message, element);
});

Hooks.on("updateChatMessage", message => {
  if (!game.user?.isGM) EffectManager.handleUpdateChatMessage(message);
});

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
      </div>
    `;
  }

  const inputsHost = host.querySelector("[data-spc-inputs]");
  if (!inputsHost) return;

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
    return;
  }

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

async function createGmSummaryMessage({ batchId, defaultHtml }) {
  const cls = ChatMessage.implementation ?? ChatMessage;
  await cls.create(baseChatData({
    content: defaultHtml || "&nbsp;",
    whisper: getGmIds(),
    flags: { [FLAG_SCOPE]: { batchId, kind: "gm-summary", managed: true, schemaVersion: SCHEMA_VERSION } }
  }));
}

async function createPlayerSlotMessage({ batchId, player, defaultHtml, privateHtml, visibleHtml }) {
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
        defaultHtml,
        privateHtml
      }
    }
  }));

  Hooks.callAll(`${MODULE_ID}.sent`, {
    recipients: [player.id], targetName: player.name, batchId,
    targetUserId: player.id, defaultHtml, privateHtml
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
