/**
 * Velaris: the living, grainy gradient behind AI surfaces (composer, thesis chat,
 * Opret case, Brain, login). Port same shader, same
 * defaults, same colours.
 *
 * Added for the product ("Velaris-baggrund" and §1.7):
 * - reduced motion: one still frame, no animation loop;
 * - the loop pauses while the tab is hidden or the surface is scrolled out of view,
 *   and time only advances while it runs, so it resumes without a jump;
 * - the ground follows the theme (--bg-canvas); in dark the colours are mixed toward that
 *   ground and greyed less (`VELARIS_DARK_TONES`), because the prototype only has a
 *   light variant and the light recipe turned dark Brain almost grey;
 * - without WebGL (or if the shader fails) the ground colour is shown instead.
 * Keep it slow and quiet: speed ≈ 1.2–1.6, grain ≈.3 (a little less than the prototype's.45, so the
 * flowing shows), one per screen.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const VERT = `attribute vec2 position;varying vec2 vUv;void main(){vUv=position*0.5+0.5;gl_Position=vec4(position,0.0,1.0);}`;
const FRAG = `precision highp float;varying vec2 vUv;uniform vec2 u_resolution;uniform float u_time;uniform float u_grain;uniform vec3 u_colors[4];uniform vec3 u_bg;uniform float u_desat;
vec3 permute(vec3 x){return mod(((x*34.0)+1.0)*x,289.0);}
float snoise(vec2 v){const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod(i,289.0);vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);m=m*m;m=m*m;vec3 x=2.0*fract(p*C.www)-1.0;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;return 130.0*dot(m,g);}
void main(){vec2 uv=vUv;float ratio=u_resolution.x/u_resolution.y;vec2 p=uv-0.5;p.x*=ratio;float t=u_time*0.1;
float n1=snoise(p*0.38+vec2(t*0.3,-t*0.34));float n2=snoise(p*0.52+vec2(-t*0.26,t*0.3)+n1*0.35);float n3=snoise(p*0.7+vec2(t*0.22,-t*0.26)+n2*0.3);
vec3 col=u_bg;float dist=length(p)*1.5;float vignette=1.0-smoothstep(0.3,1.3,dist);
col=mix(col,u_colors[0],smoothstep(-0.2,0.6,n1)*0.42);col=mix(col,u_colors[1],smoothstep(-0.1,0.7,n2)*0.38);col=mix(col,u_colors[2],smoothstep(-0.3,0.5,n3)*0.3);col=mix(col,u_colors[3],smoothstep(0.0,0.8,n1*n2)*0.25);
col=mix(col,u_colors[1],smoothstep(0.2,0.9,snoise(p*0.3+vec2(t*0.35,t*0.12)))*0.3);float grain=fract(sin(dot(uv,vec2(12.9898,78.233)))*43758.5453+u_time);col=mix(col,vec3(dot(col,vec3(0.299,0.587,0.114))),u_desat);col+=(grain-0.5)*u_grain*0.16;gl_FragColor=vec4(col,1.0);}`;

/** The prototype's light ground and palette (coral, lilac, light blue, peach). */
export const VELARIS_LIGHT_BG = "#f4f3f0";
export const VELARIS_COLORS = ["#ffb59f", "#c9bdf7", "#a9cbf2", "#ffe3d6"] as const;

/** The prototype's still frame under reduced motion is taken at 8 s; the loop starts there. */
const STILL_FRAME_MS = 8000;
/** The prototype's greying of the light mix (the shader's last mix toward grey). */
const LIGHT_DESATURATION = 0.18;

/**
 * How Velaris is coloured on a dark ground. `share` is how much of each colour survives
 * (the rest is the ground), `desat` how far the result is pulled toward grey, and `colors`
 * replaces the light palette where the light tints are too pale to read on dark. The product owner picks
 * one on /intern/velaris (the names and notes are there); `VELARIS_DARK_DEFAULT` is what the product uses.
 */
/** The four colours made deeper for a dark ground: the light tints are pale and would only
 *  turn the ground grey or, with more of them, too light for the text on top. */
const VELARIS_DARK_COLORS = ["#f0704f", "#8f74f0", "#4d8fe6", "#f2a07c"] as const;

export interface VelarisDarkTone {
  id: string;
  share: number;
  desat: number;
  colors?: readonly string[];
}

export const VELARIS_DARK_TONES = [
  {
    id: "foer",
    share: 0.4,
    desat: 0.18,
  },
  {
    id: "rolig",
    share: 0.5,
    desat: 0.08,
    colors: VELARIS_DARK_COLORS,
  },
  {
    id: "klar",
    share: 0.62,
    desat: 0.03,
    colors: VELARIS_DARK_COLORS,
  },
  {
    id: "staerk",
    share: 0.75,
    desat: 0,
    colors: VELARIS_DARK_COLORS,
  },
] as const satisfies readonly VelarisDarkTone[];

export type VelarisDarkToneId = (typeof VELARIS_DARK_TONES)[number]["id"];
/** The tone the product uses in dark. */
export const VELARIS_DARK_DEFAULT: VelarisDarkToneId = "klar";

function darkTone(id: VelarisDarkToneId): VelarisDarkTone {
  return VELARIS_DARK_TONES.find((tone) => tone.id === id) ?? VELARIS_DARK_TONES[0];
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb | null {
  const h = hex.trim().replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

function mix(a: Rgb, b: Rgb, share: number): Rgb {
  return [
    a[0] * share + b[0] * (1 - share),
    a[1] * share + b[1] * (1 - share),
    a[2] * share + b[2] * (1 - share),
  ];
}

/** Theme ground (--bg-canvas) and whether the theme is dark, updated on theme changes. */
function useThemeGround() {
  const [ground, setGround] = useState<{ bg: string; dark: boolean }>({
    bg: VELARIS_LIGHT_BG,
    dark: false,
  });
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const dark = root.classList.contains("dark") || root.dataset["theme"] === "dark";
      const token = getComputedStyle(root).getPropertyValue("--bg-canvas").trim();
      setGround({ bg: hexToRgb(token) ? token : VELARIS_LIGHT_BG, dark });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, []);
  return ground;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface VelarisParams {
  ground: Rgb;
  palette: Float32Array;
  speed: number;
  grain: number;
  /** How far the mix is pulled toward grey (light .18, dark per tone). */
  desat: number;
  reduced: boolean;
}

interface VelarisControls {
  /** Redraw one frame with the current parameters (needed while paused). */
  redraw: () => void;
  /** Start or stop the loop after a change (reduced motion, visibility). */
  sync: () => void;
}

export function Velaris({
  bg,
  colors = VELARIS_COLORS,
  speed = 1.6,
  grain = 0.3,
  paused = false,
  darkTone: darkToneId = VELARIS_DARK_DEFAULT,
  className,
  style,
  children,
}: {
  /** Ground colour (#hex). Defaults to the theme's --bg-canvas. */
  bg?: string;
  /** Four #hex colours, in the shader's order. */
  colors?: readonly string[];
  speed?: number;
  grain?: number;
  /** One still frame, like reduced motion (e.g. the corner pill until it is hovered). */
  paused?: boolean;
  /** How it is coloured on the dark theme (only /intern/velaris sets it). */
  darkTone?: VelarisDarkToneId;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const paramsRef = useRef<VelarisParams | null>(null);
  const controlsRef = useRef<VelarisControls | null>(null);
  const [failed, setFailed] = useState(false);
  const ground = useThemeGround();
  const reduced = usePrefersReducedMotion();

  const bgHex = bg ?? ground.bg;
  const tintForDark = ground.dark && !bg;
  const tone = darkTone(darkToneId);
  // Only the default palette is swapped for the dark tone's own; a caller's colours stay.
  const palette = tintForDark && tone.colors && colors === VELARIS_COLORS ? tone.colors : colors;
  const colorKey = palette.slice(0, 4).join(",");
  const share = tintForDark ? tone.share : 1;
  const desat = tintForDark ? tone.desat : LIGHT_DESATURATION;

  // Parameters live in a ref, so a theme or prop change never rebuilds the WebGL context.
  // Declared before the setup effect, so the first frame already has them.
  useEffect(() => {
    const groundRgb = hexToRgb(bgHex) ?? (hexToRgb(VELARIS_LIGHT_BG) as Rgb);
    const palette = colorKey
      .split(",")
      .map((hex) => hexToRgb(hex) ?? groundRgb)
      .map((rgb) => (share < 1 ? mix(rgb, groundRgb, share) : rgb));
    while (palette.length < 4) palette.push(groundRgb);
    paramsRef.current = {
      ground: groundRgb,
      palette: new Float32Array(palette.flat()),
      speed,
      grain,
      desat,
      reduced: reduced || paused,
    };
    controlsRef.current?.sync();
    controlsRef.current?.redraw();
  }, [bgHex, colorKey, share, desat, speed, grain, reduced, paused]);

  // WebGL setup once per mount: the prototype's shader and full-screen quad.
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;
    const gl = canvas.getContext("webgl", { antialias: false });
    if (!gl) {
      setFailed(true);
      return;
    }
    const vertex = compile(gl, gl.VERTEX_SHADER, VERT);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) {
      setFailed(true);
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = {
      resolution: gl.getUniformLocation(program, "u_resolution"),
      time: gl.getUniformLocation(program, "u_time"),
      grain: gl.getUniformLocation(program, "u_grain"),
      colors: gl.getUniformLocation(program, "u_colors"),
      bg: gl.getUniformLocation(program, "u_bg"),
      desat: gl.getUniformLocation(program, "u_desat"),
    };

    let elapsed = STILL_FRAME_MS;
    let last: number | null = null;
    let frame = 0;
    let visible = true;

    const draw = () => {
      const params = paramsRef.current;
      if (!params) return;
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, elapsed * 0.001 * params.speed);
      gl.uniform1f(uniforms.grain, params.grain);
      gl.uniform1f(uniforms.desat, params.desat);
      gl.uniform3f(uniforms.bg, params.ground[0], params.ground[1], params.ground[2]);
      gl.uniform3fv(uniforms.colors, params.palette);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const loop = (now: number) => {
      // Time only advances while running, capped per frame, so a resume never jumps.
      if (last !== null) elapsed += Math.min(now - last, 100);
      last = now;
      draw();
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const sync = () => {
      const shouldRun = !paramsRef.current?.reduced && !document.hidden && visible;
      if (!shouldRun) {
        stop();
        return;
      }
      if (frame) return;
      last = null;
      frame = requestAnimationFrame(loop);
    };
    controlsRef.current = { redraw: draw, sync };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(box.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(box.clientHeight * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(box);
    resize();

    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      sync();
    });
    intersection.observe(box);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      controlsRef.current = null;
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", sync);
      // Free the context on unmount; browsers only keep a handful of WebGL contexts alive.
      // Deferred and only when the canvas has left the page: React's StrictMode (dev) runs
      // this cleanup and mounts again on the same canvas, which a lost context would break.
      window.setTimeout(() => {
        if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext();
      }, 0);
    };
  }, []);

  return (
    <div
      ref={boxRef}
      className={cn("relative h-full w-full overflow-hidden", className)}
      style={{ backgroundColor: bgHex, ...style }}
    >
      {!failed && (
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      )}
      {children ? <div className="relative z-[1] h-full w-full">{children}</div> : null}
    </div>
  );
}
