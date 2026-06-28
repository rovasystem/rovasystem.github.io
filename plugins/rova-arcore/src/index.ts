import { registerPlugin } from "@capacitor/core";
import type { RovaArCorePlugin } from "./definitions";

const RovaArCore = registerPlugin<RovaArCorePlugin>("RovaArCore", {
  web: () => import("./web").then((m) => new m.RovaArCoreWeb())
});

export * from "./definitions";
export { RovaArCore };
