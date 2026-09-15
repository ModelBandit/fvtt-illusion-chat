import { findChatMessageElements } from "./effect-dom.mjs";

const ACTIVE_CLASS = "spc-rgb-text-active";

function getVisualSource(element) {
  return element.querySelector(".message-content")
    ?? element.querySelector(".message-content-wrapper")
    ?? element;
}

function shouldAffectSender(element, context) {
  const messageId = element?.dataset?.messageId;
  return Boolean(messageId && context?.messageTransitions?.[messageId]?.senderNameModified);
}

function apply(element, context = {}) {
  if (!(element instanceof HTMLElement)) return;
  getVisualSource(element)?.classList.add(ACTIVE_CLASS);
  if (shouldAffectSender(element, context)) element.querySelector(".message-sender")?.classList.add(ACTIVE_CLASS);
}

function remove(element) {
  if (!(element instanceof HTMLElement)) return;
  getVisualSource(element)?.classList.remove(ACTIVE_CLASS);
  element.querySelector(".message-sender")?.classList.remove(ACTIVE_CLASS);
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
