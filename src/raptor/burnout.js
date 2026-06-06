/* ============================================================
   Raptor burnout — procedural Three.js loading scene.
   A stylized Ford Raptor sits and roasts the rear tires:
   spinning wheels, body shake, and billowing tire smoke.
   No external 3D assets — everything is built in code so it
   loads instantly and runs on a phone.
   ============================================================ */
import * as THREE from 'three';

export function initBurnout(canvas) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(0x2a1320, 14, 34);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

  // ---- Lights (sunset key + cool fill + amber grille glow) ----
  scene.add(new THREE.HemisphereLight(0xffd9a0, 0x2a1830, 0.7));
  const key = new THREE.DirectionalLight(0xffb066, 1.5);
  key.position.set(-6, 7, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6688ff, 0.5);
  rim.position.set(5, 4, -6);
  scene.add(rim);
  const grille = new THREE.PointLight(0xff6a1a, 1.2, 9, 2);
  grille.position.set(-2.4, 0.9, 0); // truck is rotated 180°, grille faces -x in world
  scene.add(grille);

  // ---- Ground ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // ---- Truck ----
  const { truck, rearWheels } = buildRaptor();
  scene.add(truck);

  // ---- Smoke ----
  const smoke = new SmokeSystem(scene, reduced ? 60 : 120);
  // Truck is rotated 180°, so the spinning rear wheels sit at world +x.
  // Emit smoke just behind each rear tire.
  const emitters = [new THREE.Vector3(1.7, 0.35, 1.0), new THREE.Vector3(1.7, 0.35, -1.0)];

  // ---- Resize ----
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- Animate ----
  const clock = new THREE.Clock();
  let raf = 0;
  let running = true;
  let camAngle = -0.55;

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // spin rear wheels hard
    const spin = reduced ? 6 : 34;
    rearWheels.forEach((w) => (w.rotation.z -= spin * dt));

    // burnout vibration
    if (!reduced) {
      truck.position.y = 0.02 * Math.sin(t * 40) + 0.02 * Math.sin(t * 13);
      truck.rotation.z = 0.012 * Math.sin(t * 22);
      truck.position.x = 0.015 * Math.sin(t * 31);
    }

    // smoke
    const burst = reduced ? 1 : 3;
    for (let i = 0; i < burst; i++) {
      emitters.forEach((e) => smoke.spawn(e));
    }
    smoke.update(dt);

    // slow orbit
    camAngle += dt * (reduced ? 0.0 : 0.16);
    const r = 8.6 + Math.sin(t * 0.4) * 0.3;
    camera.position.set(Math.cos(camAngle) * r, 2.7 + Math.sin(t * 0.5) * 0.15, Math.sin(camAngle) * r);
    camera.lookAt(0, 1.0, 0);

    grille.intensity = 1.0 + Math.sin(t * 30) * 0.25;
    renderer.render(scene, camera);
  }
  if (reduced) {
    // single static-ish render plus a gentle render loop for light smoke
    camAngle = -0.55;
  }
  frame();

  return {
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        }
      });
      renderer.dispose();
    },
  };
}

/* ---------------- Raptor truck (boxes) ---------------- */
function buildRaptor() {
  const truck = new THREE.Group();

  const paint = new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.5, metalness: 0.4 });
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 0.8, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 0.15, metalness: 0.6 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff5400, emissiveIntensity: 1.4, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffd9a0, emissiveIntensity: 1.2 });

  const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    truck.add(m);
    return m;
  };

  // chassis / lower body
  box(4.5, 0.55, 2.1, paint, 0, 0.78, 0);
  // bed (rear, lower) + bed walls
  box(1.7, 0.5, 2.0, paint, -1.4, 1.15, 0);
  box(1.7, 0.18, 0.12, paint, -1.4, 1.42, 0.98);
  box(1.7, 0.18, 0.12, paint, -1.4, 1.42, -0.98);
  box(0.12, 0.18, 2.0, paint, -2.22, 1.42, 0);
  // hood (front)
  box(1.5, 0.42, 2.0, paint, 1.55, 1.12, 0);
  // cab
  box(1.7, 0.78, 1.9, paint, 0.15, 1.5, 0);
  // greenhouse / glass
  box(1.5, 0.6, 1.74, glass, 0.18, 1.62, 0);
  // roof
  box(1.74, 0.14, 1.92, darkTrim, 0.15, 1.96, 0);
  // light bar on roof
  box(1.5, 0.12, 0.16, amber, 0.15, 2.06, 0.9);

  // wide fender flares
  const flare = (x, z) => box(1.25, 0.34, 0.34, darkTrim, x, 0.62, z);
  flare(1.5, 1.0); flare(1.5, -1.0); flare(-1.5, 1.0); flare(-1.5, -1.0);

  // grille + amber marker lights (Raptor signature)
  box(0.16, 0.5, 1.7, darkTrim, 2.3, 1.0, 0);
  box(0.06, 0.12, 0.12, amber, 2.36, 1.18, 0.45);
  box(0.06, 0.12, 0.12, amber, 2.36, 1.18, 0);
  box(0.06, 0.12, 0.12, amber, 2.36, 1.18, -0.45);
  // headlights
  box(0.08, 0.2, 0.3, white, 2.34, 1.1, 0.78);
  box(0.08, 0.2, 0.3, white, 2.34, 1.1, -0.78);
  // front bumper / skid
  box(0.3, 0.26, 2.0, darkTrim, 2.32, 0.72, 0);

  // ---- wheels ----
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.4, metalness: 0.8 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff5400, emissiveIntensity: 0.5, roughness: 0.4 });

  const rearWheels = [];
  const makeWheel = (x, z, isRear) => {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.46, 22), tireMat);
    tire.rotation.x = Math.PI / 2;
    g.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.48, 12), rimMat);
    rim.rotation.x = Math.PI / 2;
    g.add(rim);
    // spokes so spin is visible
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.1), rimMat);
      spoke.rotation.z = (i / 5) * Math.PI * 2;
      g.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 10), hubMat);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
    g.position.set(x, 0.58, z);
    truck.add(g);
    if (isRear) rearWheels.push(g);
    return g;
  };
  makeWheel(1.5, 1.02, false); makeWheel(1.5, -1.02, false);
  makeWheel(-1.5, 1.02, true); makeWheel(-1.5, -1.02, true);

  truck.rotation.y = Math.PI; // rear toward camera start
  return { truck, rearWheels };
}

/* ---------------- Smoke particle pool ---------------- */
class SmokeSystem {
  constructor(scene, max) {
    this.max = max;
    this.tex = makeSmokeTexture();
    this.pool = [];
    this.live = [];
    const mat = () => new THREE.SpriteMaterial({
      map: this.tex, color: 0xcbb89a, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.NormalBlending,
    });
    for (let i = 0; i < max; i++) {
      const s = new THREE.Sprite(mat());
      s.visible = false;
      s.userData = { life: 0, max: 0, vel: new THREE.Vector3(), rot: 0 };
      scene.add(s);
      this.pool.push(s);
    }
  }
  spawn(origin) {
    const s = this.pool.pop();
    if (!s) return;
    const d = s.userData;
    d.max = 1.4 + Math.random() * 1.3;
    d.life = d.max;
    d.vel.set((Math.random() - 0.3) * 1.6, 0.6 + Math.random() * 1.1, (Math.random() - 0.5) * 1.4);
    d.rot = (Math.random() - 0.5) * 1.2;
    s.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4));
    const sc = 0.5 + Math.random() * 0.4;
    s.scale.set(sc, sc, sc);
    s.material.opacity = 0;
    s.material.rotation = Math.random() * Math.PI;
    s.visible = true;
    this.live.push(s);
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      const d = s.userData;
      d.life -= dt;
      if (d.life <= 0) {
        s.visible = false;
        s.material.opacity = 0;
        this.live.splice(i, 1);
        this.pool.push(s);
        continue;
      }
      d.vel.y += dt * 0.4;       // buoyancy
      d.vel.multiplyScalar(0.985); // drag
      s.position.addScaledVector(d.vel, dt);
      const k = d.life / d.max;          // 1 -> 0
      const grow = 1 + (1 - k) * 2.6;
      const base = s.scale.x;
      s.scale.setScalar(Math.max(base, (0.5 + (1 - k) * 1.8)));
      s.material.opacity = Math.sin(k * Math.PI) * 0.5; // fade in then out
      s.material.rotation += d.rot * dt;
    }
  }
}

/* ---------------- Procedural textures ---------------- */
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#1a1024');
  g.addColorStop(0.42, '#3a1830');
  g.addColorStop(0.66, '#8a3417');
  g.addColorStop(0.82, '#c4561a');
  g.addColorStop(1, '#2a1410');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a120c';
  ctx.fillRect(0, 0, 512, 512);
  // warm pool of light under the truck
  const g = ctx.createRadialGradient(256, 256, 30, 256, 256, 260);
  g.addColorStop(0, 'rgba(196,86,26,0.5)');
  g.addColorStop(0.5, 'rgba(120,48,30,0.25)');
  g.addColorStop(1, 'rgba(26,18,12,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // grit
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(${30 + Math.random() * 60},${20 + Math.random() * 40},${12 + Math.random() * 24},${Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // tire streaks
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 16;
  [206, 306].forEach((y) => {
    ctx.beginPath();
    ctx.moveTo(150, y);
    ctx.lineTo(420, y + (Math.random() * 8 - 4));
    ctx.stroke();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSmokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(220,210,195,0.5)');
  g.addColorStop(1, 'rgba(200,190,175,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  return t;
}
