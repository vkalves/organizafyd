import * as THREE from "three";
import { CHESS_TILT, CHESS_TRAVEL, fitChessCamera } from "./chess-framing";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** A solid, lathed king with a beveled cross. No model download or render loop at rest. */
export function mountChess(canvas: HTMLCanvasElement, animated: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  const mobile = matchMedia("(max-width: 767px)").matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04, 0.1, 100, { size: 64 });
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xf5f7ff, 0x24242c, 2));
  const light = new THREE.DirectionalLight(0xffffff, 4);
  light.position.set(-3, 4, 5); scene.add(light);
  const rim = new THREE.DirectionalLight(0xcad6ee, 3);
  rim.position.set(3, 2, -2); scene.add(rim);

  const king = new THREE.Group();
  scene.add(king);
  const material = new THREE.MeshStandardMaterial({ color: 0xe2e5eb, metalness: 0.92, roughness: 0.22 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x687080, metalness: 0.85, roughness: 0.3 });
  const profile = [
    [0, -1.05], [.50, -1.05], [.58, -1.03], [.61, -.99], [.61, -.92], [.57, -.88],
    [.56, -.84], [.57, -.81], [.55, -.77], [.48, -.73], [.43, -.66], [.35, -.56],
    [.27, -.42], [.21, -.25], [.18, -.09], [.18, .08], [.21, .22], [.26, .33],
    [.32, .39], [.36, .42], [.37, .46], [.35, .50], [.28, .53], [.27, .57],
    [.32, .59], [.34, .63], [.33, .67], [.27, .71], [.19, .74], [.15, .78], [0, .78],
  ].map(([radius, height]) => new THREE.Vector2(radius, height));
  const body = new THREE.LatheGeometry(profile, mobile ? 40 : 64);
  king.add(new THREE.Mesh(body, material));
  const bandGeometry = new THREE.TorusGeometry(.56, .012, 6, mobile ? 40 : 64);
  const band = new THREE.Mesh(bandGeometry, dark);
  band.rotation.x = Math.PI / 2; band.position.y = -.845;
  king.add(band);

  const crossShape = new THREE.Shape();
  const points = [[-.07, 0], [.07, 0], [.07, .17], [.21, .17], [.21, .29], [.07, .29], [.07, .46], [-.07, .46], [-.07, .29], [-.21, .29], [-.21, .17], [-.07, .17]];
  points.forEach(([x, y], index) => index ? crossShape.lineTo(x, y) : crossShape.moveTo(x, y));
  crossShape.closePath();
  const crossGeometry = new THREE.ExtrudeGeometry(crossShape, { depth: .11, bevelEnabled: true, bevelSize: .018, bevelThickness: .018, bevelSegments: 3, steps: 1 });
  crossGeometry.translate(0, .73, -.055);
  king.add(new THREE.Mesh(crossGeometry, material));

  const modelBounds = new THREE.Box3().setFromObject(king);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, disposed = false;
  const started = performance.now();
  const duration = 2600;
  const pose = (progress: number) => {
    const ease = 1 - (1 - progress) ** 3;
    king.rotation.y = -.35 + (animated && !reduced.matches ? (1 - ease) * Math.PI * 2 : 0);
    king.rotation.x = CHESS_TILT;
    king.position.y = animated && !reduced.matches ? -CHESS_TRAVEL * (1 - ease) : 0;
    renderer.render(scene, camera);
    canvas.style.opacity = "1";
  };
  const tick = (now: number) => {
    if (disposed || document.hidden) return;
    const progress = Math.min(1, (now - started) / duration);
    pose(progress);
    if (animated && !reduced.matches && progress < 1) frame = requestAnimationFrame(tick);
  };
  const resize = () => {
    if (disposed) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const framing = fitChessCamera(modelBounds, camera.aspect, animated ? CHESS_TRAVEL : 0);
    camera.position.set(0, framing.targetY, framing.distance);
    camera.lookAt(0, framing.targetY, 0);
    camera.updateProjectionMatrix();
    pose(Math.min(1, (performance.now() - started) / duration));
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const visibility = () => { cancelAnimationFrame(frame); if (!document.hidden) tick(performance.now()); };
  const lost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); canvas.style.opacity = "0"; };
  document.addEventListener("visibilitychange", visibility);
  canvas.addEventListener("webglcontextlost", lost);
  resize(); tick(performance.now());
  return () => {
    disposed = true;
    cancelAnimationFrame(frame); observer.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    canvas.removeEventListener("webglcontextlost", lost);
    body.dispose(); bandGeometry.dispose(); crossGeometry.dispose(); material.dispose(); dark.dispose(); environment.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  };
}
