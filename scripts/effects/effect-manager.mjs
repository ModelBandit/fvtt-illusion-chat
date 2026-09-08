import { MODULE_ID } from "../constants.mjs";
import { waitForPaint } from "./effect-dom.mjs";
import { noiseEffect } from "./noise-effect.mjs";
import { binaryGlitchEffect } from "./binary-glitch-effect.mjs";
import { rgbSplitEffect } from "./rgb-split-effect.mjs";
import { shakingEffect } from "./shaking-effect.mjs";

const EFFECTS = {
  none: {
    start() {},
    stop() {},
    applyToElement() {}
  },
  noise: noiseEffect,
  binaryGlitch: binaryGlitchEffect,
  rgbSplit: rgbSplitEffect,
  shaking: shakingEffect
};

class EffectManagerClass {
  constructor() {
    this.activeTransitions = new Map();
    this.activeMessageIds = new Map();
    this.pendingAcks = new Map();
    this.socketRegistered = false;
  }

  registerSocket() {
    if (this.socketRegistered) return;
    this.socketRegistered = true;

    game.socket.on(`module.${MODULE_ID}`, async payload => {
      if (!payload || payload.channel !== "chat-transition") return;

      if (payload.type === "transition-ack") {
        if (!game.user?.isGM) return;
        const key = `${payload.transitionId}:${payload.phase}`;
        const resolver = this.pendingAcks.get(key);
        if (resolver) {
          this.pendingAcks.delete(key);
          resolver(Boolean(payload.ok));
        }
        return;
      }

      if (payload.targetUserId !== game.user?.id) return;

      if (payload.type === "transition-start") {
        await this.#handlePlayerStart(payload);
      } else if (payload.type === "transition-commit") {
        await this.#handlePlayerCommit(payload);
      } else if (payload.type === "transition-stop") {
        this.#handlePlayerStop(payload);
      }
    });
  }

  async start(effectType, context) {
    if (!game.user?.isGM || !context?.targetUserId || !context?.messageIds?.length) return true;
    if (effectType === "none") return true;

    const transitionId = context.transitionId;
    const ack = this.#waitForAck(transitionId, "start");
    this.#emit({
      type: "transition-start",
      phase: "start",
      targetUserId: context.targetUserId,
      messageIds: context.messageIds,
      transitionId,
      effectType,
      duration: context.duration,
      messageTransitions: context.messageTransitions
    });
    return ack;
  }

  async commit(effectType, context) {
    if (!game.user?.isGM || effectType === "none") return true;
    const ack = this.#waitForAck(context.transitionId, "commit", 1800);
    this.#emit({
      type: "transition-commit",
      phase: "commit",
      targetUserId: context.targetUserId,
      messageIds: context.messageIds,
      expectedUpdateIds: context.successfulMessageIds ?? context.messageIds,
      transitionId: context.transitionId,
      effectType
    });
    return ack;
  }

  async stop(effectType, context) {
    if (!game.user?.isGM || effectType === "none") return true;
    const ack = this.#waitForAck(context.transitionId, "stop", 1800);
    this.#emit({
      type: "transition-stop",
      phase: "stop",
      targetUserId: context.targetUserId,
      messageIds: context.messageIds,
      transitionId: context.transitionId,
      effectType
    });
    return ack;
  }

  handleRenderChatMessage(message, element) {
    if (!message?.id || !(element instanceof HTMLElement)) return;
    const activeEntries = this.activeMessageIds.get(message.id);
    if (!activeEntries?.size) return;

    for (const [transitionId, effectType] of activeEntries) {
      const transition = this.activeTransitions.get(transitionId);
      if (!transition) continue;
      const effect = EFFECTS[effectType];
      effect?.applyToElement?.(element, transition);
    }
  }

  handleUpdateChatMessage(message) {
    if (!message?.id) return;
    const activeEntries = this.activeMessageIds.get(message.id);
    if (!activeEntries?.size) return;

    for (const [transitionId] of activeEntries) {
      const transition = this.activeTransitions.get(transitionId);
      if (!transition) continue;
      transition.updatedIds.add(message.id);
      this.#finishDeferredStopIfReady(transition);
    }
  }

  async #handlePlayerStart(payload) {
    const effectType = EFFECTS[payload.effectType] ? payload.effectType : "noise";
    const messageIds = Array.isArray(payload.messageIds) ? [...new Set(payload.messageIds)] : [];
    const transition = {
      transitionId: payload.transitionId,
      targetUserId: payload.targetUserId,
      messageIds,
      effectType,
      duration: Math.max(1, Number(payload.duration) || 500),
      messageTransitions: payload.messageTransitions ?? {},
      updatedIds: new Set(),
      commitRequested: false,
      stopRequested: false,
      safetyTimer: null
    };

    this.activeTransitions.set(payload.transitionId, transition);
    for (const messageId of messageIds) {
      this.#registerActiveMessage(messageId, payload.transitionId, effectType);
    }

    try {
      EFFECTS[effectType].start(transition);
      await waitForPaint();
      this.#ack(payload.transitionId, "start", true);
    } catch (error) {
      // Binary는 실제 채팅 HTML 자체를 변형하는 효과다. 실패 시 Noise 이미지로
      // 대체하지 않고 효과 없이 content 교체만 계속 진행한다.
      if (effectType === "binaryGlitch") {
        console.error(`${MODULE_ID} | binary effect start failed; continuing without visual effect`, error);
        transition.effectType = "none";
        for (const messageId of messageIds) {
          this.#registerActiveMessage(messageId, payload.transitionId, "none");
        }
        this.#ack(payload.transitionId, "start", false);
      } else {
        console.error(`${MODULE_ID} | effect start failed; falling back to noise`, error);
        try {
          transition.effectType = "noise";
          for (const messageId of messageIds) {
            this.#registerActiveMessage(messageId, payload.transitionId, "noise");
          }
          EFFECTS.noise.start(transition);
          await waitForPaint();
          this.#ack(payload.transitionId, "start", true);
        } catch (fallbackError) {
          console.error(`${MODULE_ID} | fallback effect start failed`, fallbackError);
          this.#ack(payload.transitionId, "start", false);
        }
      }
    }

    transition.safetyTimer = setTimeout(() => this.#forceStop(transition), 7000);
  }

  async #handlePlayerCommit(payload) {
    const transition = this.activeTransitions.get(payload.transitionId);
    if (!transition) {
      this.#ack(payload.transitionId, "commit", false);
      return;
    }

    transition.commitRequested = true;
    transition.expectedUpdateIds = Array.isArray(payload.expectedUpdateIds)
      ? [...new Set(payload.expectedUpdateIds)]
      : transition.messageIds;
    const ready = await this.#waitUntilUpdated(transition, 1600);
    if (ready) await waitForPaint();
    this.#ack(payload.transitionId, "commit", ready);
    this.#finishDeferredStopIfReady(transition);
  }

  #handlePlayerStop(payload) {
    const transition = this.activeTransitions.get(payload.transitionId);
    if (!transition) return;
    transition.stopRequested = true;
    this.#finishDeferredStopIfReady(transition);
  }

  #finishDeferredStopIfReady(transition) {
    if (!transition.stopRequested) return;
    if (!this.#allUpdated(transition)) return;
    requestAnimationFrame(() => requestAnimationFrame(() => this.#forceStop(transition)));
  }

  #forceStop(transition) {
    if (!this.activeTransitions.has(transition.transitionId)) return;
    try {
      EFFECTS[transition.effectType]?.stop?.(transition);
    } catch (error) {
      console.error(`${MODULE_ID} | effect stop failed`, error);
    }

    if (transition.safetyTimer) clearTimeout(transition.safetyTimer);
    if (transition.stopRequested) this.#ack(transition.transitionId, "stop", true);
    this.activeTransitions.delete(transition.transitionId);
    for (const messageId of transition.messageIds) {
      const activeEntries = this.activeMessageIds.get(messageId);
      if (!activeEntries) continue;
      activeEntries.delete(transition.transitionId);
      if (!activeEntries.size) this.activeMessageIds.delete(messageId);
    }
  }

  #registerActiveMessage(messageId, transitionId, effectType) {
    let activeEntries = this.activeMessageIds.get(messageId);
    if (!activeEntries) {
      activeEntries = new Map();
      this.activeMessageIds.set(messageId, activeEntries);
    }
    activeEntries.set(transitionId, effectType);
  }

  #allUpdated(transition) {
    const expected = transition.expectedUpdateIds ?? transition.messageIds;
    return expected.every(messageId => transition.updatedIds.has(messageId));
  }

  #waitUntilUpdated(transition, timeoutMs) {
    if (this.#allUpdated(transition)) return Promise.resolve(true);

    return new Promise(resolve => {
      const started = Date.now();
      const poll = () => {
        if (this.#allUpdated(transition)) return resolve(true);
        if (Date.now() - started >= timeoutMs) return resolve(false);
        setTimeout(poll, 25);
      };
      poll();
    });
  }

  #emit(payload) {
    game.socket.emit(`module.${MODULE_ID}`, {
      channel: "chat-transition",
      ...payload
    });
  }

  #ack(transitionId, phase, ok) {
    this.#emit({
      type: "transition-ack",
      transitionId,
      phase,
      ok,
      sourceUserId: game.user?.id
    });
  }

  #waitForAck(transitionId, phase, timeoutMs = 1500) {
    return new Promise(resolve => {
      const key = `${transitionId}:${phase}`;
      const timer = setTimeout(() => {
        this.pendingAcks.delete(key);
        resolve(false);
      }, timeoutMs);

      this.pendingAcks.set(key, ok => {
        clearTimeout(timer);
        resolve(ok);
      });
    });
  }
}

export const EffectManager = new EffectManagerClass();
