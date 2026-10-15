
const MODULE_ROOT = "modules/fvtt-illusion-1-chat";

const ADVANCED_SETTINGS = {
  "duration":{ 
    default: 500, min: 0, max: 5000, step: 50 
  },
  "shakeRange":{
    default: 6, min: 0, max: 30, step: 0.5 
  },
  "shakeShadowRange":{ 
    default: 3, min: 0, max: 30, step: 0.5 
  },
  "rgbSplitOffset":{ 
    default: 4, min: 0, max: 30, step: 0.5 
  },
  "rgbSplitOpacity":{ 
    default: 0.8, min: 0, max: 1, step: 0.05 
  }
};

Hooks.once("fvtt-illusion-core.lateinit", async () => {
  let sharedData = globalThis.fvttIllusion.sharedData;
  const moduleInfo = await globalThis.fvttIllusion.loadFile(MODULE_ROOT, "module", "json");
  globalThis.fvttIllusion.buildObject(sharedData.moduleInfo.chat, moduleInfo);

  const effect = sharedData.langBase.chat.effect;
  const effectKey = Object.keys(effect);
  // console.log(sharedData.moduleInfo.chat);
  for(const key of effectKey)
  {
    game.settings.register(sharedData.moduleInfo.chat.id, key, {
      name: effect[key].name,
      hint: effect[key].hint,
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
  }

  const advance = sharedData.langBase.chat.advance;
  const advanceKey = Object.keys(advance);
  for(const key of advanceKey)
  {
    game.settings.register(
      sharedData.moduleInfo.chat.id, key, {
      name: advance[key].name,
      hint: advance[key].hint,
      scope: "world",
      config: true,
      type: Number,
      range: {
        min: ADVANCED_SETTINGS[key].min,
        max: ADVANCED_SETTINGS[key].max,
        step: ADVANCED_SETTINGS[key].step
      },
      default: ADVANCED_SETTINGS[key].default
    });
  }
  
});