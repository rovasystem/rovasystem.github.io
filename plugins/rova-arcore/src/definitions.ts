export interface ArPose {
  tx: number;
  ty: number;
  tz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface ArPlane {
  id: string;
  type: string;
  center: ArPose;
  extentX: number;
  extentZ: number;
}

export interface ArHit {
  planeId: string;
  pose: ArPose;
  distance: number;
}

export interface ArFrameData {
  viewMatrix: number[];
  projectionMatrix: number[];
  pose: ArPose;
  displayWidth: number;
  displayHeight: number;
}

export interface RovaArCorePlugin {
  isSupported(): Promise<{ supported: boolean }>;
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  setDisplayGeometry(options: { width: number; height: number; rotation?: number }): Promise<void>;
  getFrameData(): Promise<ArFrameData>;
  getPlanes(): Promise<{ planes: ArPlane[] }>;
  hitTest(options: { x: number; y: number }): Promise<{ hits: ArHit[] }>;
  createAnchor(options: { pose: ArPose }): Promise<{ anchorId: string }>;
  removeAnchor(options: { anchorId: string }): Promise<void>;
  getAnchorPose(options: { anchorId: string }): Promise<{ pose: ArPose }>;
}
