import React, { useRef, useEffect, useState } from 'react';

const THREE_IMPORTS = () => Promise.all([
  import('three'),
  import('three/examples/jsm/loaders/GLTFLoader.js'),
  import('three/examples/jsm/controls/OrbitControls.js'),
]);

/* interactive viewer — loads from an ArrayBuffer (uploaded/assembled) or a URL */
export function ModelViewer({ arrayBuffer, src, height = 360 }) {
  const mountRef = useRef(null);
  const [state, setState] = useState('loading'); // loading | ok | error
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    let cancelled = false, renderer, controls, rafId, onResize;
    setState('loading');
    THREE_IMPORTS().then(([THREE, gltfMod, ocMod]) => {
      if (cancelled || !mountRef.current) return;
      const w = mount.clientWidth || 600, h = height;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
      mount.appendChild(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x202030, 1.15));
      const dir = new THREE.DirectionalLight(0xffffff, 1.2); dir.position.set(40, 90, 60); scene.add(dir);
      const fill = new THREE.DirectionalLight(0xffe2b5, 0.5); fill.position.set(-40, 20, -30); scene.add(fill);
      controls = new ocMod.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotate = true; controls.autoRotateSpeed = 0.5;
      const onLoad = (gltf) => {
        if (cancelled) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const fitDist = maxDim / (2 * Math.tan(Math.PI * camera.fov / 360));
        camera.position.set(fitDist * 0.5, fitDist * 0.4, fitDist * 0.5);
        camera.near = Math.max(maxDim / 100, 0.01); camera.far = maxDim * 30; camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0); controls.minDistance = fitDist * 0.25; controls.maxDistance = fitDist * 4; controls.update();
        scene.add(model); setState('ok');
      };
      const onErr = () => setState('error');
      try {
        if (arrayBuffer) new gltfMod.GLTFLoader().parse(arrayBuffer, '', onLoad, onErr);
        else if (src) new gltfMod.GLTFLoader().load(src, onLoad, undefined, onErr);
        else setState('error');
      } catch (e) { setState('error'); }
      const animate = () => { rafId = requestAnimationFrame(animate); if (controls) controls.update(); renderer.render(scene, camera); };
      animate();
      onResize = () => { if (!mountRef.current) return; const nw = mountRef.current.clientWidth; camera.aspect = nw / h; camera.updateProjectionMatrix(); renderer.setSize(nw, h); };
      window.addEventListener('resize', onResize);
    }).catch(() => setState('error'));
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (onResize) window.removeEventListener('resize', onResize);
      if (controls) controls.dispose();
      if (renderer) { renderer.dispose(); if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement); }
    };
  }, [arrayBuffer, src, height]);
  return (
    <div ref={mountRef} style={{ width: '100%', height, position: 'relative', cursor: 'grab', background: 'radial-gradient(circle at 50% 30%, #11203a, #06080f)' }}>
      {state === 'loading' && <div style={ovl}>Loading model…</div>}
      {state === 'error' && <div style={ovl}>Model unavailable</div>}
    </div>
  );
}
const ovl = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(249,115,22,.6)', fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, letterSpacing: '3px', textTransform: 'uppercase' };

/* top-down orthographic render → PNG data URL (for the PDF overhead page) */
export async function renderOverheadPNG(arrayBuffer, px = 1100) {
  const [THREE, gltfMod] = await Promise.all([import('three'), import('three/examples/jsm/loaders/GLTFLoader.js')]);
  return await new Promise((resolve, reject) => {
    let renderer;
    try {
      new gltfMod.GLTFLoader().parse(arrayBuffer, '', (gltf) => {
        try {
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          model.position.sub(center);
          const scene = new THREE.Scene();
          scene.background = new THREE.Color(0xffffff);
          scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.25));
          const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(20, 120, 40); scene.add(dl);
          scene.add(model);
          const w = size.x || 1, d = size.z || 1, hgt = size.y || 1;
          const aspect = w / d;
          const pw = px, ph = Math.max(1, Math.round(px / aspect));
          const camW = (w / 2) * 1.05, camD = (d / 2) * 1.05;
          const cam = new THREE.OrthographicCamera(-camW, camW, camD, -camD, 0.1, hgt * 20 + 2000);
          cam.position.set(0, hgt * 6 + 100, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
          const canvas = document.createElement('canvas'); canvas.width = pw; canvas.height = ph;
          renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
          renderer.setSize(pw, ph, false);
          if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
          renderer.render(scene, cam);
          const url = canvas.toDataURL('image/png');
          renderer.dispose();
          resolve(url);
        } catch (e) { if (renderer) renderer.dispose(); reject(e); }
      }, (e) => reject(e));
    } catch (e) { reject(e); }
  });
}
