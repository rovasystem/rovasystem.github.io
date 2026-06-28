import { WebPlugin } from "@capacitor/core";
import type { ArFrameData, ArHit, ArPlane, ArPose, RovaArCorePlugin } from "./definitions";

export class RovaArCoreWeb extends WebPlugin implements RovaArCorePlugin {
  async isSupported(): Promise<{ supported: boolean }> {
    return { supported: false };
  }
  async startSession(): Promise<void> {}
  async stopSession(): Promise<void> {}
  async setDisplayGeometry(_options: {
    width: number;
    height: number;
    rotation?: number;
  }): Promise<void> {}
  async getFrameData(): Promise<ArFrameData> {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return {
      viewMatrix: id,
      projectionMatrix: id,
      pose: { tx: 0, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
      displayWidth: 1,
      displayHeight: 1
    };
  }
  async getPlanes(): Promise<{ planes: ArPlane[] }> {
    return { planes: [] };
  }
  async hitTest(_options: { x: number; y: number }): Promise<{ hits: ArHit[] }> {
    return { hits: [] };
  }
  async createAnchor(_options: { pose: ArPose }): Promise<{ anchorId: string }> {
    return { anchorId: "web-none" };
  }
  async removeAnchor(_options: { anchorId: string }): Promise<void> {}
  async getAnchorPose(_options: { anchorId: string }): Promise<{ pose: ArPose }> {
    return { pose: { tx: 0, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 } };
  }
}
