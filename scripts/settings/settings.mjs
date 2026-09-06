import { MODULE_ID } from "../constants.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, "selectedPlayers", {
    scope: "world",
    config: false,
    type: Object,
    default: { ids: [] }
  });

  game.settings.register(MODULE_ID, "transitionEffect", {
    name: "Chat Transition Effect",
    hint: "개인 채팅 로그의 공용/개인 문자열 전환 시 사용할 화면 효과입니다.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      none: "None",
      noise: "Noise",
      binaryGlitch: "Binary Glitch",
      rgbSplit: "RGB Split"
    },
    default: "noise"
  });

  game.settings.register(MODULE_ID, "transitionDuration", {
    name: "Chat Transition Duration (ms)",
    hint: "효과가 실제 화면에 나타난 뒤 content를 교체하기 전까지 유지할 최소 시간입니다.",
    scope: "world",
    config: true,
    type: Number,
    range: {
      min: 0,
      max: 5000,
      step: 50
    },
    default: 500
  });
}

export function getTransitionSettings() {
  const requestedEffect = game.settings.get(MODULE_ID, "transitionEffect") ?? "noise";
  const durationValue = Number(game.settings.get(MODULE_ID, "transitionDuration"));

  return {
    effectType: ["none", "noise", "binaryGlitch", "rgbSplit"].includes(requestedEffect)
      ? requestedEffect
      : "noise",
    duration: Number.isFinite(durationValue) ? Math.max(0, durationValue) : 500
  };
}
