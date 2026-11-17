import { describe, expect, it } from "vitest";
import { Euler, PerspectiveCamera, Vector3 } from "three";
import { CHESS_TILT, CHESS_TRAVEL, fitChessCamera } from "./chess-framing";

const bounds = { min: { x: -.61, y: -1.05, z: -.61 }, max: { x: .61, y: 1.208, z: .61 } };

describe("Chess camera framing", () => {
  it.each([.5, 2 / 3, 36 / 44, 1, 1.8, 2.5])("keeps the full rim and cross inside an aspect ratio of %s throughout the entrance", aspect => {
    for (const travel of [0, CHESS_TRAVEL]) {
      const { targetY, distance } = fitChessCamera(bounds, aspect, travel);
      const camera = new PerspectiveCamera(32, aspect, .1, 30);
      camera.position.set(0, targetY, distance);
      camera.lookAt(0, targetY, 0);
      camera.updateMatrixWorld();
      for (let turn = 0; turn <= 16; turn++) {
        for (const offset of [0, -travel]) {
          for (const x of [bounds.min.x, bounds.max.x]) {
            for (const y of [bounds.min.y, bounds.max.y]) {
              for (const z of [bounds.min.z, bounds.max.z]) {
                const point = new Vector3(x, y, z).applyEuler(new Euler(CHESS_TILT, turn * Math.PI / 8, 0));
                point.y += offset;
                point.project(camera);
                expect(Math.abs(point.x)).toBeLessThan(.95);
                expect(Math.abs(point.y)).toBeLessThan(.95);
                expect(point.z).toBeGreaterThan(-1);
                expect(point.z).toBeLessThan(1);
              }
            }
          }
        }
      }
    }
  });
});
