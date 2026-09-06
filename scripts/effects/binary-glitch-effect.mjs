import { findChatMessageElements } from "./effect-dom.mjs";

const UNICODE_BITS = 21;
const MAX_CODE_POINT = 0x10FFFF;
const REPLACEMENT_GLYPH = "□";
const ACTIVE_CLASS = "spc-binary-active";

function codePoints(text = "") {
  return Array.from(String(text), char => char.codePointAt(0));
}

function isRenderableCodePoint(value) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_CODE_POINT) return false;
  if (value >= 0xD800 && value <= 0xDFFF) return false;
  if (value < 0x20 || (value >= 0x7F && value <= 0x9F)) return false;
  return true;
}

function displayCodePoint(value, { final = false, missingTarget = false } = {}) {
  if (final && missingTarget) return " ";
  if (value === 0) return " ";
  if (!isRenderableCodePoint(value)) return REPLACEMENT_GLYPH;

  try {
    return String.fromCodePoint(value);
  } catch {
    return REPLACEMENT_GLYPH;
  }
}

/**
 * source의 21비트 값을 왼쪽으로 밀어내면서 target의 상위 비트부터 주입한다.
 * step=0이면 source, step=21이면 target이다.
 */
function shiftCodePoint(source, target, step) {
  const safeStep = Math.max(0, Math.min(UNICODE_BITS, Math.trunc(step)));
  const mask = (1 << UNICODE_BITS) - 1;

  if (safeStep === 0) return source & mask;
  if (safeStep === UNICODE_BITS) return target & mask;

  const keptSourceBits = (source << safeStep) & mask;
  const injectedTargetBits = target >>> (UNICODE_BITS - safeStep);
  return (keptSourceBits | injectedTargetBits) & mask;
}

function renderTransitionText(sourceText, targetText, step) {
  const source = codePoints(sourceText);
  const target = codePoints(targetText);
  const length = Math.max(source.length, target.length);
  const final = step >= UNICODE_BITS;
  let output = "";

  for (let index = 0; index < length; index += 1) {
    const sourceValue = source[index] ?? 0;
    const targetMissing = index >= target.length;
    const targetValue = target[index] ?? 0;
    const value = shiftCodePoint(sourceValue, targetValue, step);
    output += displayCodePoint(value, { final, missingTarget: targetMissing });
  }

  return output;
}

function getMessageTransition(context, messageId) {
  return context.messageTransitions?.[messageId] ?? {
    sourceText: "",
    targetText: ""
  };
}

function getContentElement(messageElement) {
  return messageElement.querySelector(".message-content")
    ?? messageElement.querySelector(".message-content-wrapper")
    ?? null;
}

function ensureSnapshot(context, messageId, contentElement) {
  context.binarySnapshots ??= new Map();

  let snapshotsForMessage = context.binarySnapshots.get(messageId);
  if (!snapshotsForMessage) {
    snapshotsForMessage = new Map();
    context.binarySnapshots.set(messageId, snapshotsForMessage);
  }

  if (!snapshotsForMessage.has(contentElement)) {
    snapshotsForMessage.set(contentElement, contentElement.innerHTML);
  }
}

function apply(element, context = {}) {
  if (!(element instanceof HTMLElement)) return;

  const messageId = element.dataset.messageId;
  if (!messageId) return;

  const contentElement = getContentElement(element);
  if (!(contentElement instanceof HTMLElement)) return;

  ensureSnapshot(context, messageId, contentElement);
  contentElement.classList.add(ACTIVE_CLASS);
  renderElement(element, context, messageId);
}

function renderElement(element, context, messageId) {
  const contentElement = getContentElement(element);
  if (!(contentElement instanceof HTMLElement)) return;

  ensureSnapshot(context, messageId, contentElement);

  const transition = getMessageTransition(context, messageId);
  const step = context.binaryStep ?? 0;
  contentElement.textContent = renderTransitionText(
    transition.sourceText ?? "",
    transition.targetText ?? "",
    step
  );
}

function renderAll(context) {
  for (const messageId of context.messageIds) {
    for (const element of findChatMessageElements(messageId)) {
      apply(element, context);
    }
  }
}

function restoreCurrentElements(context) {
  for (const messageId of context.messageIds) {
    const snapshotsForMessage = context.binarySnapshots?.get(messageId);

    for (const element of findChatMessageElements(messageId)) {
      const contentElement = getContentElement(element);
      if (!(contentElement instanceof HTMLElement)) continue;

      const snapshot = snapshotsForMessage?.get(contentElement);
      if (typeof snapshot === "string") contentElement.innerHTML = snapshot;
      contentElement.classList.remove(ACTIVE_CLASS);
    }
  }

  context.binarySnapshots?.clear?.();
}

function stopAnimation(context) {
  if (context.binaryAnimationFrame) {
    cancelAnimationFrame(context.binaryAnimationFrame);
    context.binaryAnimationFrame = null;
  }
}

function startAnimation(context) {
  stopAnimation(context);

  const rawDuration = Number(context.duration);
  const duration = Number.isFinite(rawDuration) ? Math.max(0, rawDuration) : 500;
  context.binaryStep = 0;
  renderAll(context);

  if (duration === 0) {
    context.binaryStep = UNICODE_BITS;
    renderAll(context);
    return;
  }

  const startedAt = performance.now();

  const tick = now => {
    const ratio = Math.min(1, (now - startedAt) / duration);
    const nextStep = Math.min(UNICODE_BITS, Math.floor(ratio * UNICODE_BITS));

    if (nextStep !== context.binaryStep) {
      context.binaryStep = nextStep;
      renderAll(context);
    }

    if (ratio < 1) {
      context.binaryAnimationFrame = requestAnimationFrame(tick);
    } else {
      context.binaryStep = UNICODE_BITS;
      context.binaryAnimationFrame = null;
      renderAll(context);
    }
  };

  context.binaryAnimationFrame = requestAnimationFrame(tick);
}

export const binaryGlitchEffect = {
  start(context) {
    context.binaryStep = 0;
    context.binarySnapshots = new Map();
    renderAll(context);
    startAnimation(context);
  },

  stop(context) {
    stopAnimation(context);
    restoreCurrentElements(context);
  },

  applyToElement(element, context) {
    apply(element, context);
  }
};
