/* ── HeroScene — the cinematic 3D backdrop for the landing story ──
 *
 * A fleet of A3 portfolio pages choreographed through four movements,
 * driven by scroll progress:
 *
 *   0  scatter   — pages drift weightlessly through carbon-black space
 *   1  grid      — pages assemble into a judging matrix of categories
 *   2  scan      — pages stack into a portfolio; a red analysis sheet sweeps it
 *   3  scores    — pages rise into a score column formation
 *
 * Time-based idle motion is layered on top of the keyframed choreography so
 * the scene never feels frozen, and pointer parallax adds depth.
 */

import * as THREE from "three";

const PAGE_COUNT = 27;
const A3 = { w: 2.1, h: 2.97, d: 0.012 };

interface Keys {
  pos: THREE.Vector3[];
  rot: THREE.Euler[];
  scale: number[];
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Fake "document" textures — text lines, a graph, a drawing — so the pages
 *  read as engineering portfolio pages, not blank slabs. */
function makePageTexture(kind: number, seedBase: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 210;
  c.height = 297;
  const g = c.getContext("2d")!;
  let seed = seedBase;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  g.fillStyle = "#17171c";
  g.fillRect(0, 0, 210, 297);
  g.strokeStyle = "rgba(255,255,255,0.10)";
  g.strokeRect(1, 1, 208, 295);

  // Header band + red accent
  g.fillStyle = "rgba(255,255,255,0.16)";
  g.fillRect(16, 18, 110, 8);
  g.fillStyle = "#e10600";
  g.fillRect(16, 32, 34, 3);

  if (kind === 0) {
    // Text page
    g.fillStyle = "rgba(255,255,255,0.09)";
    for (let y = 52; y < 270; y += 12) {
      g.fillRect(16, y, 40 + rand() * 138, 4);
    }
  } else if (kind === 1) {
    // Graph page
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.strokeRect(16, 60, 178, 100);
    g.strokeStyle = "#e10600";
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const x = 16 + (i / 16) * 178;
      const y = 150 - Math.abs(Math.sin(i * 0.6 + seedBase)) * 80 - rand() * 8;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.09)";
    for (let y = 180; y < 270; y += 12) g.fillRect(16, y, 30 + rand() * 148, 4);
  } else {
    // Engineering drawing page
    g.strokeStyle = "rgba(255,255,255,0.2)";
    g.strokeRect(40, 70, 130, 60);
    g.beginPath();
    g.ellipse(70, 100, 16, 16, 0, 0, Math.PI * 2);
    g.ellipse(140, 100, 16, 16, 0, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "rgba(225,6,0,0.7)";
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(105, 60);
    g.lineTo(105, 140);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "rgba(255,255,255,0.09)";
    for (let y = 160; y < 270; y += 12) g.fillRect(16, y, 30 + rand() * 148, 4);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class HeroScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private pages: THREE.Mesh[] = [];
  private keys: Keys[] = [];
  private scanPlane: THREE.Mesh;
  private particles: THREE.Points;
  private redLight: THREE.PointLight;
  private progress = 0;
  private pointer = new THREE.Vector2(0, 0);
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private textures: THREE.CanvasTexture[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x08080a, 1);

    this.scene.fog = new THREE.FogExp2(0x08080a, 0.055);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    this.camera.position.set(0, 0.4, 12);

    // Lighting: cool key, faint fill, hot red accent
    this.scene.add(new THREE.AmbientLight(0x33343c, 1.4));
    const key = new THREE.DirectionalLight(0xf2f2f8, 2.1);
    key.position.set(5, 8, 6);
    this.scene.add(key);
    this.redLight = new THREE.PointLight(0xe10600, 60, 26, 1.9);
    this.redLight.position.set(-5, -2, 4);
    this.scene.add(this.redLight);

    this.textures = [0, 1, 2, 0, 1].map((k, i) => makePageTexture(k, 7 + i * 131));
    this.buildPages();
    this.keys = [this.kScatter(), this.kGrid(), this.kStack(), this.kScores()];

    // Analysis scan sheet
    const scanGeo = new THREE.PlaneGeometry(5.4, 0.04);
    const scanMat = new THREE.MeshBasicMaterial({
      color: 0xff2e3f,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.scanPlane = new THREE.Mesh(scanGeo, scanMat);
    this.scene.add(this.scanPlane);

    this.particles = this.buildParticles();
    this.scene.add(this.particles);

    this.resize();
    window.addEventListener("resize", this.resize);
    this.loop();
  }

  private buildPages() {
    const geo = new THREE.BoxGeometry(A3.w, A3.h, A3.d);
    for (let i = 0; i < PAGE_COUNT; i++) {
      const tex = this.textures[i % this.textures.length];
      const face = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.62,
        metalness: 0.28,
        color: 0xffffff,
      });
      const edge = new THREE.MeshStandardMaterial({
        color: 0x1c1c22,
        roughness: 0.5,
        metalness: 0.4,
      });
      const mesh = new THREE.Mesh(geo, [edge, edge, edge, edge, face, face]);
      this.pages.push(mesh);
      this.scene.add(mesh);
    }
  }

  /* ── Keyframe formations ── */

  private kScatter(): Keys {
    const pos: THREE.Vector3[] = [];
    const rot: THREE.Euler[] = [];
    const scale: number[] = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < PAGE_COUNT; i++) {
      pos.push(
        new THREE.Vector3(
          (rand() - 0.5) * 16,
          (rand() - 0.5) * 9,
          (rand() - 0.72) * 11,
        ),
      );
      rot.push(
        new THREE.Euler(
          (rand() - 0.5) * 1.4,
          (rand() - 0.5) * 1.8,
          (rand() - 0.5) * 0.9,
        ),
      );
      scale.push(0.8 + rand() * 0.5);
    }
    return { pos, rot, scale };
  }

  private kGrid(): Keys {
    const pos: THREE.Vector3[] = [];
    const rot: THREE.Euler[] = [];
    const scale: number[] = [];
    const cols = 9;
    for (let i = 0; i < PAGE_COUNT; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      pos.push(
        new THREE.Vector3((col - (cols - 1) / 2) * 2.5, ((1 - row) * 3.45) - 0.2, -1.5),
      );
      rot.push(new THREE.Euler(0, 0, 0));
      scale.push(1);
    }
    return { pos, rot, scale };
  }

  private kStack(): Keys {
    const pos: THREE.Vector3[] = [];
    const rot: THREE.Euler[] = [];
    const scale: number[] = [];
    for (let i = 0; i < PAGE_COUNT; i++) {
      const t = i / (PAGE_COUNT - 1);
      pos.push(new THREE.Vector3(0, -0.35, -2.4 + t * 2.4));
      rot.push(new THREE.Euler(0, (t - 0.5) * 0.06, (t - 0.5) * 0.05));
      scale.push(1.16);
    }
    return { pos, rot, scale };
  }

  private kScores(): Keys {
    const pos: THREE.Vector3[] = [];
    const rot: THREE.Euler[] = [];
    const scale: number[] = [];
    const bars = 9;
    const heights = [0.55, 0.8, 0.62, 0.92, 0.7, 0.85, 0.6, 0.78, 0.95];
    for (let i = 0; i < PAGE_COUNT; i++) {
      const bar = i % bars;
      const level = Math.floor(i / bars); // 0..2
      const h = heights[bar];
      pos.push(
        new THREE.Vector3(
          (bar - (bars - 1) / 2) * 1.55,
          -2.6 + level * 1.06 * h + 1.4 * h,
          -1,
        ),
      );
      rot.push(new THREE.Euler(Math.PI / 2, 0, 0));
      scale.push(0.42 + h * 0.22);
    }
    return { pos, rot, scale };
  }

  /* ── Camera keyframes per movement ── */

  private camKeys = [
    { pos: new THREE.Vector3(0, 0.4, 12), look: new THREE.Vector3(0, 0, 0) },
    { pos: new THREE.Vector3(0, 0.2, 13.5), look: new THREE.Vector3(0, 0, -1.5) },
    { pos: new THREE.Vector3(3.4, 1.6, 7.4), look: new THREE.Vector3(0, -0.3, -1.2) },
    { pos: new THREE.Vector3(0, 0.4, 11.4), look: new THREE.Vector3(0, -0.4, -1) },
  ];

  setProgress(p: number) {
    this.progress = Math.max(0, Math.min(1, p));
  }

  setPointer(x: number, y: number) {
    this.pointer.set(x, y);
  }

  private buildParticles(): THREE.Points {
    const N = 420;
    const positions = new Float32Array(N * 3);
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < N; i++) {
      positions[i * 3] = (rand() - 0.5) * 30;
      positions[i * 3 + 1] = (rand() - 0.5) * 18;
      positions[i * 3 + 2] = (rand() - 0.6) * 16;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8a8f98,
      size: 0.03,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    const t = this.clock.getElapsedTime();
    const p = this.progress;

    // Which movement are we between?
    const seg = Math.min(2.9999, p * 3);
    const idx = Math.floor(seg);
    const local = easeInOut(seg - idx);
    const from = this.keys[idx];
    const to = this.keys[Math.min(idx + 1, 3)];

    // Idle drift fades as the choreography tightens
    const drift = 1 - Math.min(1, p * 1.9);

    const tmpQa = new THREE.Quaternion();
    const tmpQb = new THREE.Quaternion();

    this.pages.forEach((mesh, i) => {
      const phase = i * 0.83;
      mesh.position.lerpVectors(from.pos[i], to.pos[i], local);
      mesh.position.y += Math.sin(t * 0.5 + phase) * 0.22 * drift + Math.sin(t * 0.7 + phase) * 0.02;
      mesh.position.x += Math.cos(t * 0.4 + phase) * 0.16 * drift;

      tmpQa.setFromEuler(from.rot[i]);
      tmpQb.setFromEuler(to.rot[i]);
      mesh.quaternion.slerpQuaternions(tmpQa, tmpQb, local);
      mesh.rotateY(Math.sin(t * 0.3 + phase) * 0.12 * drift);
      mesh.rotateX(Math.cos(t * 0.26 + phase) * 0.08 * drift);

      const s = THREE.MathUtils.lerp(from.scale[i], to.scale[i], local);
      mesh.scale.setScalar(s);
    });

    // Camera
    const camFrom = this.camKeys[idx];
    const camTo = this.camKeys[Math.min(idx + 1, 3)];
    const camPos = camFrom.pos.clone().lerp(camTo.pos, local);
    const camLook = camFrom.look.clone().lerp(camTo.look, local);
    camPos.x += this.pointer.x * 0.55;
    camPos.y += -this.pointer.y * 0.35;
    this.camera.position.lerp(camPos, 0.06);
    this.camera.lookAt(camLook);

    // Red light orbits, intensifying during the scan movement
    const scanActive = p > 0.42 && p < 0.75;
    this.redLight.position.set(
      Math.sin(t * 0.5) * 6,
      Math.cos(t * 0.34) * 3,
      3 + Math.sin(t * 0.22) * 2,
    );
    this.redLight.intensity = scanActive ? 110 : 60;

    // Scan sheet sweep during movement 2
    const scanMat = this.scanPlane.material as THREE.MeshBasicMaterial;
    if (scanActive) {
      const st = (p - 0.42) / 0.33;
      this.scanPlane.position.set(0, THREE.MathUtils.lerp(2.2, -2.6, (Math.sin(st * Math.PI * 2 - Math.PI / 2) + 1) / 2), 0.4);
      scanMat.opacity = Math.sin(st * Math.PI) * 0.9;
      this.scanPlane.scale.setScalar(1 + Math.sin(t * 6) * 0.02);
    } else {
      scanMat.opacity = 0;
    }

    // Particles slow orbit
    this.particles.rotation.y = t * 0.012;

    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.textures.forEach((t) => t.dispose());
    this.renderer.dispose();
  }
}
