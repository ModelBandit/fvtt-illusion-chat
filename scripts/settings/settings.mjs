import { MODULE_ID } from "../constants.mjs";

const EFFECT_SETTINGS = [
  { key: "effectNoise", effectType: "noise", name: "Noise", default: true },
  { key: "effectBinaryGlitch", effectType: "binaryGlitch", name: "Binary Glitch", default: false },
  { key: "effectRgbSplit", effectType: "rgbSplit", name: "RGB Split", default: false },
  { key: "shakingEffect", effectType: "shaking", name: "Shake", default: false }
];

export function registerSettings() {
  for (const setting of EFFECT_SETTINGS) {
    game.settings.register(MODULE_ID, setting.key, {
      name: `Chat Transition Effect: ${setting.name}`,
      hint: `${setting.name} 효과를 채팅 내용 전환 시 사용합니다. 여러 효과를 동시에 활성화할 수 있습니다.`,
      scope: "world",
      config: true,
      type: Boolean,
      default: setting.default
    });
  }

  game.settings.register(MODULE_ID, "transitionDuration", {
    name: "Chat Transition Duration (ms)",
    hint: "활성화된 전환 효과가 content 교체 전까지 진행될 최소 시간입니다.",
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
  const durationValue = Number(game.settings.get(MODULE_ID, "transitionDuration"));
  const effectTypes = EFFECT_SETTINGS
    .filter(setting => Boolean(game.settings.get(MODULE_ID, setting.key)))
    .map(setting => setting.effectType);

  return {
    effectTypes,
    duration: Number.isFinite(durationValue) ? Math.max(0, durationValue) : 500
  };
}
