import { MODULE_ID } from "../constants.mjs";

const EFFECT_SETTINGS = [
  { key: "effectNoise", effectType: "noise", labelKey: "effectNoiseLabel", default: true },
  { key: "effectBinaryGlitch", effectType: "binaryGlitch", labelKey: "effectBinaryGlitchLabel", default: false },
  { key: "effectRgbSplit", effectType: "rgbSplit", labelKey: "effectRgbSplitLabel", default: false },
  { key: "shakingEffect", effectType: "shaking", labelKey: "shakingEffectLabel", default: false }
];

const ADVANCED_SETTINGS = [
  { key: "shakeRange", default: 6, min: 0, max: 30, step: 0.5 },
  { key: "shakeShadowRange", default: 3, min: 0, max: 30, step: 0.5 },
  { key: "rgbSplitOffset", default: 4, min: 0, max: 30, step: 0.5 },
  { key: "rgbSplitOpacity", default: 0.8, min: 0, max: 1, step: 0.05 }
];

function t(textMap, key, replacements = {}) {
  const value = String(key ?? "").split(".").reduce((node, part) => node?.[part], textMap);
  let text = typeof value === "string" ? value : String(key ?? "");
  for (const [name, replacement] of Object.entries(replacements ?? {})) {
    text = text.replaceAll(`{${name}}`, String(replacement));
  }
  return text;
}

export function registerSettings(core, textMap = {}) {
  for (const setting of EFFECT_SETTINGS) {
    game.settings.register(MODULE_ID, setting.key, {
      name: t(textMap, "settings.effectName", { name: t(textMap, `settings.${setting.labelKey}`) }),
      hint: t(textMap, "settings.effectHint", { name: t(textMap, `settings.${setting.labelKey}`) }),
      scope: "world",
      config: true,
      type: Boolean,
      default: setting.default
    });
  }

  game.settings.register(MODULE_ID, "transitionDuration", {
    name: t(textMap, "settings.durationName"),
    hint: t(textMap, "settings.durationHint"),
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

  for (const setting of ADVANCED_SETTINGS) {
    game.settings.register(MODULE_ID, setting.key, {
      name: t(textMap, `settings.${setting.key}Name`),
      hint: t(textMap, `settings.${setting.key}Hint`),
      scope: "world",
      config: true,
      type: Number,
      range: { min: setting.min, max: setting.max, step: setting.step },
      default: setting.default
    });
  }
}

export function refreshSettingsLocalization(textMap = {}) {
  for (const setting of EFFECT_SETTINGS) {
    const config = game.settings.settings.get(`${MODULE_ID}.${setting.key}`);
    if (!config) continue;
    config.name = t(textMap, "settings.effectName", { name: t(textMap, `settings.${setting.labelKey}`) });
    config.hint = t(textMap, "settings.effectHint", { name: t(textMap, `settings.${setting.labelKey}`) });
  }

  const duration = game.settings.settings.get(`${MODULE_ID}.transitionDuration`);
  if (duration) {
    duration.name = t(textMap, "settings.durationName");
    duration.hint = t(textMap, "settings.durationHint");
  }

  for (const setting of ADVANCED_SETTINGS) {
    const config = game.settings.settings.get(`${MODULE_ID}.${setting.key}`);
    if (!config) continue;
    config.name = t(textMap, `settings.${setting.key}Name`);
    config.hint = t(textMap, `settings.${setting.key}Hint`);
  }
}

export function getTransitionSettings() {
  const durationValue = Number(game.settings.get(MODULE_ID, "transitionDuration"));
  const effectTypes = EFFECT_SETTINGS
    .filter(setting => Boolean(game.settings.get(MODULE_ID, setting.key)))
    .map(setting => setting.effectType);

  const tuning = Object.fromEntries(
    ADVANCED_SETTINGS.map(setting => [
      setting.key,
      Number(game.settings.get(MODULE_ID, setting.key))
    ])
  );

  return {
    effectTypes,
    duration: Number.isFinite(durationValue) ? Math.max(0, durationValue) : 500,
    tuning
  };
}
