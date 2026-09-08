import { findChatMessageElements } from "./effect-dom.mjs";

const ACTIVE_CLASS = "spc-rgb-text-active";

function getVisualSource(element) {
  return element.querySelector(".message-content")
    ?? element.querySelector(".message-content-wrapper")
    ?? element;
}

function apply(element) {
  if (!(element instanceof HTMLElement)) return;
  getVisualSource(element)?.classList.add(ACTIVE_CLASS);
}

function remove(element) {
  if (!(element instanceof HTMLElement)) return;
  getVisualSource(element)?.classList.remove(ACTIVE_CLASS);
}

export const rgbSplitEffect = {
  start(context) {
    for (const messageId of context.messageIds) {
      for (const element of findChatMessageElements(messageId)) apply(element);
    }
  },
  stop(context) {
    for (const messageId of context.messageIds) {
      for (const element of findChatMessageElements(messageId)) remove(element);
    }
  },
  applyToElement: apply
};
