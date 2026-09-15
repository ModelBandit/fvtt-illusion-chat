import { FLAG_SCOPE, MODULE_ID, SCHEMA_VERSION } from "../constants.mjs";

let registered = false;

/**
 * 플레이어가 보내는 일반 공개 채팅을 GM 검열 요청으로 하이잭한다.
 *
 * 활성 조건은 Core의 "전송 체크박스(selected)"가 하나 이상 선택된 경우다.
 * 환상 상태 토글(illusion)은 이 단계에서 사용하지 않는다.
 */
export function registerHijackMessage({ getSelectedUserIds, localize } = {}) {
  if (registered) return;
  registered = true;

  Hooks.on("preCreateChatMessage", (document, data) => {
    if (game.user?.isGM) return;
    if (data?.flags?.[FLAG_SCOPE]?.managed) return;
    if (!shouldHijackPlayerMessage(data, getSelectedUserIds)) return;

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

    // 원래 메시지는 발신자 자신에게만 보이게 유지하고,
    // GM에게는 별도의 moderation-request를 보낸다.
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
    // 플레이어 쪽에 뜨는 디버그용 코드
    // ui.notifications?.info(localize?.("moderationQueued") ?? "moderationQueued");
  });
}

export function shouldHijackPlayerMessage(data, getSelectedUserIds) {
  if (!String(data?.content ?? "").trim()) return false;
  if (data.whisper?.length || data.whisper?.size) return false;
  if (data.rolls?.length || data.roll) return false;

  const selected = getSelectedUserIds?.() ?? [];
  if (!Array.from(selected).length) return false;

  return Boolean(getModerationGm());
}

export function isValidModerationRequest(payload) {
  if (!payload?.requestId || !payload.sourceUserId || typeof payload.content !== "string") return false;
  if (payload.content.length > 100000) return false;
  const sourceUser = game.users?.get?.(payload.sourceUserId);
  return Boolean(sourceUser && !sourceUser.isGM);
}

function getModerationGm() {
  return Array.from(game.users ?? []).find(user => user.isGM && user.active) ?? null;
}

function cloneSocketData(value) {
  if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return JSON.parse(JSON.stringify(value));
}
