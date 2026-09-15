import { findChatMessageElements } from "./effect-dom.mjs";

const UNICODE_BITS = 21;
const MAX_CODE_POINT = 0x10FFFF;
const REPLACEMENT_GLYPH = "▒";

const ACTIVE_CLASS = "spc-binary-active";
const FINAL_CLASS = "spc-binary-final";
const ANIMATED_CLASS = "spc-binary-animated";


function codePoints(text = "") {
  return Array.from(
    String(text),
    char => char.codePointAt(0)
  );
}


function isRenderableCodePoint(value) {
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_CODE_POINT
  ) {
    return false;
  }

  if (
    value >= 0xD800 &&
    value <= 0xDFFF
  ) {
    return false;
  }

  if (
    value < 0x20 ||
    (
      value >= 0x7F &&
      value <= 0x9F
    )
  ) {
    return false;
  }

  return true;
}


function displayCodePoint(
  value,
  {
    final = false,
    missingTarget = false
  } = {}
) {
  if (
    final &&
    missingTarget
  ) {
    return " ";
  }

  if (value === 0) {
    return " ";
  }

  if (!isRenderableCodePoint(value)) {
    return REPLACEMENT_GLYPH;
  }

  try {
    return String.fromCodePoint(value);
  }
  catch {
    return REPLACEMENT_GLYPH;
  }
}


/**
 * source의 21비트 값을 왼쪽으로 밀어내면서
 * target의 상위 비트부터 주입한다.
 *
 * step = 0  → source
 * step = 21 → target
 */
function shiftCodePoint(
  source,
  target,
  step
) {
  const safeStep = Math.max(
    0,
    Math.min(
      UNICODE_BITS,
      Math.trunc(step)
    )
  );

  const mask =
    (1 << UNICODE_BITS) - 1;

  if (safeStep === 0) {
    return source & mask;
  }

  if (safeStep === UNICODE_BITS) {
    return target & mask;
  }

  const keptSourceBits =
    (source << safeStep) & mask;

  const injectedTargetBits =
    target >>> (
      UNICODE_BITS -
      safeStep
    );

  return (
    keptSourceBits |
    injectedTargetBits
  ) & mask;
}


function renderTransitionText(
  sourceText,
  targetText,
  step
) {
  const source =
    codePoints(sourceText);

  const target =
    codePoints(targetText);

  const length =
    Math.max(
      source.length,
      target.length
    );

  const final =
    step >= UNICODE_BITS;

  let output = "";

  for (
    let index = 0;
    index < length;
    index += 1
  ) {
    const sourceValue =
      source[index] ?? 0;

    const targetMissing =
      index >= target.length;

    const targetValue =
      target[index] ?? 0;

    const value =
      shiftCodePoint(
        sourceValue,
        targetValue,
        step
      );

    output += displayCodePoint(
      value,
      {
        final,
        missingTarget:
          targetMissing
      }
    );
  }

  return output;
}


function getMessageTransition(
  context,
  messageId
) {
  return (
    context
      .messageTransitions
      ?.[messageId]
    ?? {
      sourceText: "",
      targetText: "",
      sourceHtml: "",
      targetHtml: "",
      baseText: "",
      baseHtml: ""
    }
  );
}


/**
 * 원래 DOM과 inline style 저장
 */
function ensureSnapshot(
  context,
  messageId,
  contentElement
) {
  context.binarySnapshots ??=
    new Map();

  let snapshotsForMessage =
    context.binarySnapshots.get(
      messageId
    );

  if (!snapshotsForMessage) {
    snapshotsForMessage =
      new Map();

    context.binarySnapshots.set(
      messageId,
      snapshotsForMessage
    );
  }

  if (
    snapshotsForMessage.has(
      contentElement
    )
  ) {
    return;
  }

  snapshotsForMessage.set(
    contentElement,
    {
      innerHTML: contentElement.innerHTML,
      position: contentElement.style.position,
      height: contentElement.style.height,
      minHeight: contentElement.style.minHeight,
      overflow: contentElement.style.overflow
    }
  );
}


/**
 * computed color:
 *
 * rgb(10, 20, 30)
 * rgba(10, 20, 30, 0.8)
 *
 * 같은 형태에서 RGB는 유지하고
 * alpha만 0으로 만든다.
 */
function makeTransparentColor(
  color
) {
  const match =
    String(color).match(
      /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)/i
    );

  if (!match) {
    return "rgba(0, 0, 0, 0)";
  }

  return (
    `rgba(` +
    `${match[1]}, ` +
    `${match[2]}, ` +
    `${match[3]}, ` +
    `0)`
  );
}


/**
 * 환상(source/target)의 현재 전환 방향과 무관하게
 * 비환상 원본(baseHtml)의 실제 렌더 높이를 잰다.
 * 측정용 요소는 absolute + hidden이라 현재 채팅 레이아웃에는 참여하지 않는다.
 */
function measureBaseLayout(
  contentElement,
  baseHtml,
  baseText
) {
  const parent = contentElement.parentElement;
  if (!(parent instanceof HTMLElement)) return null;

  const rect = contentElement.getBoundingClientRect();
  const probe = contentElement.cloneNode(false);

  probe.removeAttribute("id");
  probe.classList.remove(ACTIVE_CLASS);
  probe.setAttribute("aria-hidden", "true");

  probe.style.position = "absolute";
  probe.style.left = "0";
  probe.style.top = "0";
  probe.style.width = `${rect.width}px`;
  probe.style.height = "auto";
  probe.style.minHeight = "0";
  probe.style.maxHeight = "none";
  probe.style.overflow = "visible";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.transform = "none";

  if (baseHtml) {
    probe.innerHTML = baseHtml;
  } else {
    probe.textContent = baseText ?? "";
  }

  parent.appendChild(probe);

  const probeStyle = getComputedStyle(probe);
  const measured = {
    height: probeStyle.height
  };

  probe.remove();
  return measured;
}

function lockToTargetHeight(
  contentElement,
  targetLayout
) {
  if (!targetLayout) return;

  const cssHeight = targetLayout.height;
  if (!cssHeight || cssHeight === "auto") return;

  contentElement.style.height = cssHeight;
  contentElement.style.minHeight = cssHeight;
  contentElement.style.overflow = "hidden";
}

/**
 * 최종 텍스트와
 * 글리치 애니메이션 레이어 생성
 */
function ensureBinaryLayers(
  context,
  messageId,
  contentElement,
  targetText,
  baseHtml,
  baseText
) {
  context.binaryLayers ??= new Map();

  let layersForMessage =
    context.binaryLayers.get(messageId);

  if (!layersForMessage) {
    layersForMessage = new Map();

    context.binaryLayers.set(
      messageId,
      layersForMessage
    );
  }

  let layers =
    layersForMessage.get(
      contentElement
    );

  if (layers) {
    layers.finalElement.textContent =
      targetText;

    return layers;
  }

  const targetLayout =
    measureBaseLayout(
      contentElement,
      baseHtml,
      baseText
    );

  const computed =
    getComputedStyle(
      contentElement
    );

  /*
   * 최종 문자열
   *
   * 처음부터 DOM에는 존재하지만
   * alpha = 0이라 보이지 않는다.
   */
  const finalElement =
    document.createElement("span");

  finalElement.classList.add(
    FINAL_CLASS
  );

  finalElement.textContent =
    targetText;

  finalElement.style.setProperty(
    "color",
    makeTransparentColor(computed.color),
    "important"
  );

  // RGB Split의 text-shadow가 부모에서 상속되면
  // color alpha가 0이어도 최종 문자열의 그림자가 보일 수 있다.
  // Binary 진행 중에는 최종 문자열의 shadow도 강제로 숨긴다.
  finalElement.style.setProperty(
    "text-shadow",
    "none",
    "important"
  );


  /*
   * 실제로 보이는
   * binary animation layer
   */
  const animatedElement =
    document.createElement("span");

  animatedElement.classList.add(
    ANIMATED_CLASS
  );

  animatedElement.style.position =
    "absolute";

  animatedElement.style.inset =
    "0";

  animatedElement.style.pointerEvents =
    "none";

  animatedElement.style.color =
    computed.color;


  /*
   * 중요:
   *
   * 여기서 기존 초기 문자열을 완전히 제거한다.
   *
   * contentElement 안에는
   *
   * 1. 투명한 최종 문자열
   * 2. 애니메이션 문자열
   *
   * 두 개만 존재한다.
   */
  contentElement.replaceChildren(
    finalElement,
    animatedElement
  );

  contentElement.style.position =
    "relative";

  // 효과 중 채팅 높이는 전환 방향과 무관하게 비환상 원본(baseHtml)의 실제 렌더 높이를 기준으로 고정한다.
  lockToTargetHeight(
    contentElement,
    targetLayout
  );


  layers = {
    finalElement,
    animatedElement,

    originalComputedColor:
      computed.color
  };

  layersForMessage.set(
    contentElement,
    layers
  );

  return layers;
}


/**
 * 애니메이션 종료 시
 *
 * 최종 텍스트 alpha 복구
 * +
 * 글리치 레이어 제거
 */
function revealFinalLayer(
  context,
  messageId,
  contentElement
) {
  const layers =
    context.binaryLayers
      ?.get(messageId)
      ?.get(contentElement);

  if (!layers)
    return;

  /*
   * 먼저 애니메이션 글자 제거
   */
  layers.animatedElement.remove();

  /*
   * 그 직후 최종글자의 alpha 복구
   */
  layers.finalElement.style.setProperty(
    "color",
    layers.originalComputedColor,
    "important"
  );

  // Binary가 숨기기 위해 넣었던 shadow 차단만 제거한다.
  // RGB Split이 아직 활성 상태라면 부모의 text-shadow가 다시 상속된다.
  layers.finalElement.style.removeProperty(
    "text-shadow"
  );
}


function apply(
  element,
  context = {}
) {
  if (
    !(element instanceof HTMLElement)
  ) {
    return;
  }

  const messageId =
    element.dataset.messageId;

  if (!messageId) {
    return;
  }

  const contentTarget = context.getEffectTargets(element)
    .find(target => target.kind === "content");
  const contentElement = contentTarget?.element;

  if (!(contentElement instanceof HTMLElement)) return;

  ensureSnapshot(
    context,
    messageId,
    contentElement
  );

  contentElement.classList.add(
    ACTIVE_CLASS
  );

  renderElement(
    element,
    context,
    messageId
  );
}

function renderElement(
  element,
  context,
  messageId
) {
  const effectTargets = context.getEffectTargets(element);
  const contentElement = effectTargets.find(target => target.kind === "content")?.element;
  if (!(contentElement instanceof HTMLElement)) return;

  const transition = getMessageTransition(context, messageId);
  const step = context.binaryStep ?? 0;

  // Sender exists in the shared target list only when the moderated name changed.
  const senderElement = effectTargets.find(target => target.kind === "sender")?.element;
  if (senderElement instanceof HTMLElement) {
    context.binarySenderSnapshots ??= new Map();
    if (!context.binarySenderSnapshots.has(senderElement)) {
      context.binarySenderSnapshots.set(senderElement, senderElement.textContent ?? "");
    }
    const senderSource = transition.senderSourceText ?? senderElement.textContent ?? "";
    const senderTarget = transition.senderTargetText ?? senderElement.textContent ?? "";
    senderElement.textContent = step >= UNICODE_BITS
      ? senderTarget
      : renderTransitionText(senderSource, senderTarget, step);
  }

  const sourceText =
    transition.sourceText ?? "";

  const targetText =
    transition.targetText ?? "";

  const baseHtml =
    transition.baseHtml ?? transition.targetHtml ?? "";

  const baseText =
    transition.baseText ?? transition.targetText ?? "";


  const layers =
    ensureBinaryLayers(
      context,
      messageId,
      contentElement,
      targetText,
      baseHtml,
      baseText
    );


  /*
   * 마지막 step에서는
   * animatedElement에 targetText를
   * 다시 출력하지 않는다.
   *
   * 애니메이션 제거 →
   * final alpha 복구.
   */
  if (
    step >= UNICODE_BITS
  ) {
    layers.finalElement.textContent =
      targetText;

    revealFinalLayer(
      context,
      messageId,
      contentElement
    );

    return;
  }


  /*
   * 애니메이션 도중에는
   * animatedElement만 변경.
   */
  layers.animatedElement.textContent =
    renderTransitionText(
      sourceText,
      targetText,
      step
    );
}


function renderAll(
  context
) {
  for (
    const messageId
    of context.messageIds
  ) {
    for (
      const element
      of findChatMessageElements(
        messageId
      )
    ) {
      apply(
        element,
        context
      );
    }
  }
}


/**
 * 효과가 완전히 stop 되었을 때
 * 원래 DOM을 그대로 돌려놓는다.
 */
function restoreCurrentElements(
  context
) {
  for (
    const messageId
    of context.messageIds
  ) {
    const snapshotsForMessage =
      context.binarySnapshots
        ?.get(messageId);

    for (
      const element
      of findChatMessageElements(
        messageId
      )
    ) {
      const contentElement = context.getEffectTargets(element)
        .find(target => target.kind === "content")?.element;

      if (
        !(contentElement instanceof HTMLElement)
      ) {
        continue;
      }

      const snapshot =
        snapshotsForMessage
          ?.get(contentElement);


      if (snapshot) {
        const transition = getMessageTransition(context, messageId);
        const updateCompleted = context.updatedIds?.has?.(messageId) ?? false;

        contentElement.innerHTML = updateCompleted
          ? (transition.targetHtml ?? snapshot.innerHTML)
          : snapshot.innerHTML;

        contentElement.style.position = snapshot.position;
        contentElement.style.height = snapshot.height;
        contentElement.style.minHeight = snapshot.minHeight;
        contentElement.style.overflow = snapshot.overflow;
      }


      contentElement.classList.remove(
        ACTIVE_CLASS
      );
    }
  }


  for (const [senderElement, originalText] of context.binarySenderSnapshots?.entries?.() ?? []) {
    if (!(senderElement instanceof HTMLElement)) continue;
    const messageElement = senderElement.closest("[data-message-id]");
    const messageId = messageElement?.dataset?.messageId;
    const transition = messageId ? getMessageTransition(context, messageId) : null;
    senderElement.textContent = transition?.senderNameModified
      ? (transition.senderTargetText ?? originalText)
      : originalText;
  }
  context.binarySenderSnapshots?.clear?.();

  context.binarySnapshots
    ?.clear?.();

  context.binaryLayers
    ?.clear?.();
}


function stopAnimation(
  context
) {
  if (
    context.binaryAnimationFrame
  ) {
    cancelAnimationFrame(
      context.binaryAnimationFrame
    );

    context.binaryAnimationFrame =
      null;
  }
}


function startAnimation(
  context
) {
  stopAnimation(
    context
  );


  const rawDuration =
    Number(
      context.duration
    );

  const duration =
    Number.isFinite(
      rawDuration
    )
      ? Math.max(
          0,
          rawDuration
        )
      : 500;


  context.binaryStep = 0;

  renderAll(
    context
  );


  if (
    duration === 0
  ) {
    context.binaryStep =
      UNICODE_BITS;

    renderAll(
      context
    );

    return;
  }


  const startedAt =
    performance.now();


  const tick =
    now => {

      const ratio =
        Math.min(
          1,
          (
            now -
            startedAt
          ) /
          duration
        );


      const nextStep =
        Math.min(
          UNICODE_BITS,

          Math.floor(
            ratio *
            UNICODE_BITS
          )
        );


      if (
        nextStep !==
        context.binaryStep
      ) {
        context.binaryStep =
          nextStep;

        renderAll(
          context
        );
      }


      if (
        ratio < 1
      ) {
        context.binaryAnimationFrame =
          requestAnimationFrame(
            tick
          );
      }
      else {
        context.binaryStep =
          UNICODE_BITS;

        context.binaryAnimationFrame =
          null;

        renderAll(
          context
        );
      }
    };


  context.binaryAnimationFrame =
    requestAnimationFrame(
      tick
    );
}


export const binaryGlitchEffect = {

  start(context) {
    context.binaryStep =
      0;

    context.binarySnapshots =
      new Map();

    context.binaryLayers =
      new Map();

    context.binarySenderSnapshots =
      new Map();


    startAnimation(
      context
    );
  },


  stop(context) {
    stopAnimation(
      context
    );

    restoreCurrentElements(
      context
    );
  },


  applyToElement(
    element,
    context
  ) {
    apply(
      element,
      context
    );
  }
};