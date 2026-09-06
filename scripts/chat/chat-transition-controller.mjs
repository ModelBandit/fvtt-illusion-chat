import { FLAG_SCOPE, MODULE_ID, SCHEMA_VERSION } from "../constants.mjs";
import { EffectManager } from "../effects/effect-manager.mjs";
import { getTransitionSettings } from "../settings/settings.mjs";

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeTransitionId(userId) {
  const random = foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2);
  return `${Date.now()}-${userId}-${random}`;
}

function htmlToPlainText(html = "") {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(html);
  return wrapper.textContent ?? "";
}

export class ChatTransitionController {
  constructor({ getSelectedUserIds }) {
    this.getSelectedUserIds = getSelectedUserIds;
    this.syncChain = Promise.resolve();
    this.syncing = false;
  }

  queueSync(targetUserId = null) {
    this.syncChain = this.syncChain
      .catch(error => console.error(`${MODULE_ID} | 이전 로그 내용 동기화 실패`, error))
      .then(() => this.synchronize(targetUserId));
    return this.syncChain;
  }

  async synchronize(targetUserId = null) {
    if (!game.user?.isGM || this.syncing) return;

    const selected = new Set(this.getSelectedUserIds());
    const changes = this.#collectChanges(selected, targetUserId);
    if (!changes.length) return;

    this.syncing = true;
    try {
      const { effectType, duration } = getTransitionSettings();
      const transitions = this.#groupTransitions(changes, effectType, duration);

      // 1) 플레이어 DOM에 효과가 실제로 붙었다는 ACK를 받은 뒤에만 진행한다.
      if (effectType !== "none") {
        await Promise.all(transitions.map(item =>
          EffectManager.start(effectType, item.context)
            .catch(error => {
              console.error(`${MODULE_ID} | effect start handshake failed`, error);
              return false;
            })
        ));

        // 2) ACK 시점부터 설정된 최소 지속시간을 보장한다.
        if (duration > 0) await delay(duration);
      }

      // 3) 동일 ChatMessage의 content 필드만 수정한다.
      const successfulIds = new Set();
      for (const { message, desired } of changes) {
        try {
          await message.update(
            { content: desired },
            { fvttIllusionChatContentSwap: true }
          );
          successfulIds.add(message.id);
        } catch (error) {
          // 개별 content 교체 실패는 다른 메시지의 전환을 중단시키지 않는다.
          console.error(`${MODULE_ID} | content swap failed for ${message.id}`, error);
        }
      }

      if (effectType !== "none") {
        for (const item of transitions) {
          item.context.successfulMessageIds = item.context.messageIds.filter(id => successfulIds.has(id));
        }
        // 4) 플레이어가 updateChatMessage를 받고 새 DOM에도 효과를 재적용한 뒤 ACK한다.
        await Promise.all(transitions.map(item =>
          EffectManager.commit(effectType, item.context)
            .catch(error => {
              console.error(`${MODULE_ID} | effect commit handshake failed`, error);
              return false;
            })
        ));

        // 5) stop은 commit 이후에만 보내며, 플레이어도 update가 확인되기 전에는 실제 제거하지 않는다.
        // 제거 완료 ACK까지 기다려 빠른 연속 토글에서도 이전 효과와 다음 효과가 겹치지 않게 한다.
        await Promise.all(transitions.map(item =>
          EffectManager.stop(effectType, item.context)
            .catch(error => {
              console.error(`${MODULE_ID} | effect stop handshake failed`, error);
              return false;
            })
        ));
      }
    } finally {
      this.syncing = false;
    }
  }

  #collectChanges(selected, targetUserId) {
    const slots = Array.from(game.messages ?? []).filter(message => {
      const flags = message.flags?.[FLAG_SCOPE];
      if (flags?.schemaVersion !== SCHEMA_VERSION) return false;
      if (flags?.kind !== "player-slot" || !flags?.managed) return false;
      if (!flags.targetUserId) return false;
      return targetUserId ? flags.targetUserId === targetUserId : true;
    });

    const changes = [];
    for (const message of slots) {
      const flags = message.flags?.[FLAG_SCOPE];
      const desired = chooseVisibleHtml({
        defaultHtml: flags.defaultHtml ?? "",
        privateHtml: flags.privateHtml ?? "",
        usePrivate: selected.has(flags.targetUserId)
      });
      if ((message.content ?? "") === desired) continue;

      changes.push({
        message,
        desired,
        targetUserId: flags.targetUserId
      });
    }
    return changes;
  }

  #groupTransitions(changes, effectType, duration = 500) {
    const byTarget = new Map();
    for (const change of changes) {
      const entry = byTarget.get(change.targetUserId) ?? {
        messageIds: [],
        messageTransitions: {}
      };
      entry.messageIds.push(change.message.id);
      entry.messageTransitions[change.message.id] = {
        sourceText: htmlToPlainText(change.message.content ?? ""),
        targetText: htmlToPlainText(change.desired ?? "")
      };
      byTarget.set(change.targetUserId, entry);
    }

    return Array.from(byTarget, ([targetUserId, entry]) => ({
      context: {
        targetUserId,
        messageIds: [...new Set(entry.messageIds)],
        messageTransitions: entry.messageTransitions,
        transitionId: makeTransitionId(targetUserId),
        effectType,
        duration
      }
    }));
  }
}

export function chooseVisibleHtml({ defaultHtml, privateHtml, usePrivate }) {
  if (usePrivate && privateHtml) return privateHtml;
  if (defaultHtml) return defaultHtml;
  if (privateHtml) return privateHtml;
  return "&nbsp;";
}
