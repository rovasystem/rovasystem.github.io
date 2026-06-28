# @rova/arcore

Capacitor plugin for ARCore — plane detection, hit-test, anchors, and per-frame camera matrices for 3D AR rendering.

## API

| Method | Input | Output | Notes |
|--------|-------|--------|-------|
| `isSupported()` | — | `{ supported: boolean }` | Checks ARCore availability on device |
| `startSession()` | — | `void` | Starts ARCore session (requests camera permission if needed) |
| `stopSession()` | — | `void` | Stops session and clears anchors |
| `setDisplayGeometry` | `{ width, height, rotation? }` | `void` | Viewport size in pixels; `rotation` is `Surface.ROTATION_*` (0–3) |
| `getFrameData()` | — | `{ viewMatrix[16], projectionMatrix[16], pose, displayWidth, displayHeight }` | Call each render frame after session start |
| `getPlanes()` | — | `{ planes: ArPlane[] }` | Tracked horizontal/vertical planes |
| `hitTest` | `{ x, y }` | `{ hits: ArHit[] }` | `x`, `y` normalized 0–1 (converted to pixels internally) |
| `createAnchor` | `{ pose: ArPose }` | `{ anchorId: string }` | Stable UUID anchor ID |
| `removeAnchor` | `{ anchorId }` | `void` | Detaches and removes anchor |
| `getAnchorPose` | `{ anchorId }` | `{ pose: ArPose }` | Current anchor pose |

### Types

```typescript
interface ArPose {
  tx: number; ty: number; tz: number;
  qx: number; qy: number; qz: number; qw: number;
}

interface ArPlane {
  id: string;
  type: string;       // "HORIZONTAL" | "VERTICAL" | ...
  center: ArPose;
  extentX: number;
  extentZ: number;
}

interface ArHit {
  planeId: string;
  pose: ArPose;
  distance: number;
}
```

## Example (JS)

```javascript
import { RovaArCore } from '@rova/arcore';

const { supported } = await RovaArCore.isSupported();
if (!supported) return;

await RovaArCore.setDisplayGeometry({
  width: window.innerWidth,
  height: window.innerHeight,
  rotation: 0,
});

await RovaArCore.startSession();

function renderLoop() {
  RovaArCore.getFrameData().then(({ viewMatrix, projectionMatrix, pose }) => {
    // feed matrices to WebGL / Three.js
  });
  requestAnimationFrame(renderLoop);
}
renderLoop();

// Tap at screen center
const { hits } = await RovaArCore.hitTest({ x: 0.5, y: 0.5 });
if (hits.length > 0) {
  const { anchorId } = await RovaArCore.createAnchor({ pose: hits[0].pose });
  const { pose } = await RovaArCore.getAnchorPose({ anchorId });
}

await RovaArCore.stopSession();
```
