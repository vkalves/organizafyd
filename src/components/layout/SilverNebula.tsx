import { useEffect, useRef } from "react";
import { silverFragmentShader } from "./silver-shader";

/** Hotfy's liquid-metal shader, scoped to the login with React-owned cleanup. */
export function SilverNebula() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) return; // CSS texture stays visible on devices without WebGL.
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    const release = () => {
      shaders.forEach(shader => gl.deleteShader(shader));
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
    if (!program || !buffer) { release(); return; }
    for (const [type, source] of [[gl.VERTEX_SHADER, 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'], [gl.FRAGMENT_SHADER, silverFragmentShader]] as const) {
      const shader = gl.createShader(type);
      if (!shader) { release(); return; }
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { release(); return; }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { release(); return; }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const name of ['r', 'c', 'm', 'E', 'cam', 'M', 'S0', 'S1', 'S2', 'S3', 'S4', 'q', 't', 'f', 'k4']) u[name] = gl.getUniformLocation(program, name);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = window.matchMedia('(max-width: 767px)');
    let frame = 0, last = 0, lost = false;
    let pointerX = 0, pointerY = 0;
    const started = performance.now();
    const draw = (now: number) => {
      if (lost) return;
      const width = canvas.width, height = canvas.height;
      const time = motion.matches ? 20 : (now - started) / 1000 + 20;
      gl.uniform2f(u.r, width, height);
      gl.uniform2f(u.c, width * .38, height * .53);
      gl.uniform1f(u.q, Math.min(width * .26, height * .36));
      gl.uniform1f(u.t, time); gl.uniform1f(u.f, 1);
      gl.uniform2f(u.m, -9999, -9999);
      gl.uniform2f(u.cam, pointerX * .25, pointerY * .2);
      gl.uniform2f(u.E, Math.cos(time * .05), Math.sin(time * .05));
      gl.uniform3f(u.M, 0, 0, 0); gl.uniform1f(u.k4, .001);
      gl.uniform4f(u.S0, 0, 0, 0, 1 + .025 * Math.sin(time * .8));
      gl.uniform4f(u.S1, 1.2 * Math.cos(time * .23), .8 * Math.sin(time * .299), .55 * Math.sin(time * .161), .5);
      gl.uniform4f(u.S2, .95 * Math.cos(time * .17 + 2.1), -.95 * Math.sin((time * .17 + 2.1) * 1.1), .6 * Math.cos((time * .17 + 2.1) * .8), .44);
      gl.uniform4f(u.S3, 1.75 * Math.sin(time * .29 + 4.2), .85 * Math.cos((time * .29 + 4.2) * .9), -.45, .36);
      gl.uniform4f(u.S4, 0, 0, -30, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.style.opacity = '1';
    };
    const tick = (now: number) => {
      if (document.hidden || motion.matches || mobile.matches || lost) return;
      if (now - last >= 33) { draw(now); last = now; }
      frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      canvas.width = Math.max(2, Math.round(canvas.clientWidth * .6));
      canvas.height = Math.max(2, Math.round(canvas.clientHeight * .6));
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw(performance.now());
    };
    const resume = () => { cancelAnimationFrame(frame); if (!document.hidden) { resize(); frame = requestAnimationFrame(tick); } };
    const pointer = (event: PointerEvent) => { pointerX = event.clientX / window.innerWidth - .5; pointerY = .5 - event.clientY / window.innerHeight; };
    const contextLost = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); canvas.style.opacity = '0'; };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('pointermove', pointer, { passive: true });
    document.addEventListener('visibilitychange', resume);
    motion.addEventListener('change', resume);
    mobile.addEventListener('change', resume);
    canvas.addEventListener('webglcontextlost', contextLost);
    resume();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('pointermove', pointer);
      document.removeEventListener('visibilitychange', resume);
      motion.removeEventListener('change', resume); mobile.removeEventListener('change', resume);
      canvas.removeEventListener('webglcontextlost', contextLost);
      release();
    };
  }, []);
  return <div className="silver-nebula" aria-hidden="true"><canvas ref={ref} /></div>;
}
