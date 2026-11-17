interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export const CHESS_TILT = 0.06;
export const CHESS_TRAVEL = 0.18;

/** Fit every rotation and the full entrance travel, including the front rim. */
export function fitChessCamera(bounds: Bounds, aspect: number, travel = 0) {
  const radius = Math.hypot(
    Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
    Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)),
  );
  const sin = Math.sin(CHESS_TILT);
  const cos = Math.cos(CHESS_TILT);
  const bottom = bounds.min.y * cos - radius * sin - travel;
  const top = bounds.max.y * cos + radius * sin;
  const depth = radius * cos + Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y)) * sin;
  const halfFov = 32 * Math.PI / 360;
  const padding = 1.06;
  // Add the object's depth: its front edge is closer than its center.
  const distance = depth + Math.max(
    (top - bottom) / 2 * padding / Math.tan(halfFov),
    radius * padding / (Math.tan(halfFov) * aspect),
  );
  return { targetY: (top + bottom) / 2, distance };
}
