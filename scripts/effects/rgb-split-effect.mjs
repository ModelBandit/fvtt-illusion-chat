import { findChatMessageElements } from "./effect-dom.mjs";

const ACTIVE_CLASS = "spc-rgb-text-active";

function apply(element, context = {}) {
  for (const target of context.getEffectTargets(element)) {
    target.element.style.setProperty("--spc-rgb-offset", `${context.tuning.rgbSplitOffset}px`);
    target.element.style.setProperty("--spc-rgb-opacity", String(context.tuning.rgbSplitOpacity));
    target.element.classList.add(ACTIVE_CLASS);
  }
}

function remove(element) {
  if (!(element instanceof HTMLElement)) return;

  // Cleanup cannot depend on the current transition flags: remove our class
  // from every DOM type this effect can own.
  for (const target of element.querySelectorAll(".message-content, .message-content-wrapper, .message-sender")) {
    if (!(target instanceof HTMLElement)) continue;
    target.classList.remove(ACTIVE_CLASS);
    target.style.removeProperty("--spc-rgb-offset");
    target.style.removeProperty("--spc-rgb-opacity");
  }
}

export const rgbSplitEffect = {
  start(context) {
    for (const messageId of context.messageIds) {
      for (const element of findChatMessageElements(messageId)) apply(element, context);
    }
  },
  stop(context) {
    for (const messageId of context.messageIds) {
      for (const element of findChatMessageElements(messageId)) remove(element);
    }
  },
  applyToElement: apply
};
