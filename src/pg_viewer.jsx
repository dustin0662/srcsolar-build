/* pg_viewer.jsx — interactive viewer for a reconstruction: coloured point
   cloud, surface mesh, and the camera stations the photos were taken from.
   three.js is imported lazily so it only loads when a model is opened. */

import React, { useEffect, useRef, useState } from 'react';

const ORANGE = '#F97316';
const NBF = "'Barlow Condensed', sans-serif";

const THREE_IMPORTS = () => Promise.all([
  import('three'),
  import('three/examples/jsm/controls/OrbitControls.js'),
]);

export default function PointCloudViewer({
  positions, colors, mesh, cameras, height = 460,
  mode = 'auto', pointSize = 1, showCameras = true, background = '#06080f',
  onReady,
}) {
  const mountRef = useRef(null);
  const stateRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [err, setErr] = useState('');

  /* build the scene once per data set */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !positions || !positions.length) { setStatus('empty'); return; }
    let cancelled = false, raf = 0, onResize = null;
    setStatus('loading');

    THREE_IMPORTS().then(([THREE, oc]) => {
      if (cancelled || !mountRef.current) return;
      const w = mount.clientWidth || 640, h = height;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(background);
      const camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 1e7);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      mount.appendChild(renderer.domElement);

      const controls = new oc.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.09;
      controls.screenSpacePanning = true;

      /* centre everything on the cloud so orbiting feels natural */
      const n = positions.length / 3;
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < n; i++) { cx += positions[i * 3] / n; cy += positions[i * 3 + 1] / n; cz += positions[i * 3 + 2] / n; }
      // 97th percentile rather than the max: a handful of stray points should
      // not push the whole model into the distance
      const dists = [];
      const step = Math.max(1, Math.floor(n / 20000));
      for (let i = 0; i < n; i += step) {
        dists.push(Math.hypot(positions[i * 3] - cx, positions[i * 3 + 1] - cy, positions[i * 3 + 2] - cz));
      }
      dists.sort((a, b) => a - b);
      const radius = dists[Math.floor(dists.length * 0.97)] || dists[dists.length - 1] || 1;

      const root = new THREE.Group();
      root.position.set(-cx, -cy, -cz);
      scene.add(root);

      // point cloud
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      if (colors && colors.length === positions.length) {
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
      }
      const pMat = new THREE.PointsMaterial({
        size: radius * 0.004 * pointSize, sizeAttenuation: true,
        vertexColors: !!(colors && colors.length === positions.length), color: 0xdddddd,
      });
      const points = new THREE.Points(geo, pMat);
      root.add(points);

      // surface mesh
      let meshObj = null;
      if (mesh && mesh.positions && mesh.positions.length && mesh.indices && mesh.indices.length) {
        const mg = new THREE.BufferGeometry();
        mg.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
        if (mesh.colors) mg.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3, true));
        mg.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        mg.computeVertexNormals();
        const mMat = new THREE.MeshStandardMaterial({
          vertexColors: !!mesh.colors, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, flatShading: false,
        });
        meshObj = new THREE.Mesh(mg, mMat);
        root.add(meshObj);
      }

      // camera stations
      let camGroup = null;
      if (cameras && cameras.length) {
        camGroup = new THREE.Group();
        const s = radius * 0.03;
        const lineMat = new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.85 });
        for (const c of cameras) {
          if (!c || !c.C) continue;
          const g = new THREE.BufferGeometry();
          // a little pyramid pointing along the optical axis
          const R = c.R;
          const dir = R ? [R[6], R[7], R[8]] : [0, 0, 1];
          const right = R ? [R[0], R[1], R[2]] : [1, 0, 0];
          const upv = R ? [R[3], R[4], R[5]] : [0, 1, 0];
          const apex = c.C;
          const corner = (a, b) => [
            apex[0] + dir[0] * s * 2 + right[0] * s * a + upv[0] * s * b,
            apex[1] + dir[1] * s * 2 + right[1] * s * a + upv[1] * s * b,
            apex[2] + dir[2] * s * 2 + right[2] * s * a + upv[2] * s * b,
          ];
          const c1 = corner(1, 0.75), c2 = corner(-1, 0.75), c3 = corner(-1, -0.75), c4 = corner(1, -0.75);
          const verts = [];
          const seg = (p, q) => verts.push(p[0], p[1], p[2], q[0], q[1], q[2]);
          seg(apex, c1); seg(apex, c2); seg(apex, c3); seg(apex, c4);
          seg(c1, c2); seg(c2, c3); seg(c3, c4); seg(c4, c1);
          g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
          camGroup.add(new THREE.LineSegments(g, lineMat));
        }
        root.add(camGroup);
      }

      scene.add(new THREE.HemisphereLight(0xffffff, 0x223044, 1.25));
      const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(1, 1, 2); scene.add(key);
      const fill = new THREE.DirectionalLight(0xffe0bb, 0.45); fill.position.set(-2, -1, 1); scene.add(fill);

      const fit = (topDown) => {
        const dist = radius * 1.7;
        if (topDown) camera.position.set(0, 0.001 * dist, dist);
        else camera.position.set(dist * 0.75, -dist * 0.55, dist * 0.55);
        camera.up.set(0, 0, 1);
        camera.near = Math.max(radius / 2000, 1e-3);
        camera.far = radius * 60;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
      };
      fit(false);

      const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
      animate();

      onResize = () => {
        if (!mountRef.current) return;
        const nw = mountRef.current.clientWidth || w;
        camera.aspect = nw / height; camera.updateProjectionMatrix(); renderer.setSize(nw, height);
      };
      window.addEventListener('resize', onResize);

      stateRef.current = {
        THREE, scene, camera, renderer, controls, points, meshObj, camGroup, pMat, radius, fit,
        dispose() {
          if (raf) cancelAnimationFrame(raf);
          if (onResize) window.removeEventListener('resize', onResize);
          controls.dispose();
          geo.dispose(); pMat.dispose();
          if (meshObj) { meshObj.geometry.dispose(); meshObj.material.dispose(); }
          if (camGroup) camGroup.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
          renderer.dispose();
          if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
        },
      };
      setStatus('ok');
      if (onReady) onReady(stateRef.current);
    }).catch((e) => { setErr(String(e && e.message ? e.message : e)); setStatus('error'); });

    return () => {
      cancelled = true;
      if (stateRef.current) { stateRef.current.dispose(); stateRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, colors, mesh, cameras, height, background]);

  /* live toggles that do not need a rebuild */
  useEffect(() => {
    const s = stateRef.current; if (!s) return;
    s.pMat.size = s.radius * 0.004 * pointSize;
    // auto = the surface when one exists, otherwise the cloud
    const showPoints = mode === 'points' || mode === 'both' || (mode === 'auto' && !s.meshObj);
    const showMesh = !!s.meshObj && (mode === 'mesh' || mode === 'both' || mode === 'auto');
    s.points.visible = showPoints;
    if (s.meshObj) s.meshObj.visible = showMesh;
    if (s.camGroup) s.camGroup.visible = !!showCameras;
  }, [mode, pointSize, showCameras, status]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div ref={mountRef} style={{ width: '100%', height: height, cursor: 'grab', background: background }} />
      {status !== 'ok' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(249,115,22,.75)', fontFamily: NBF, fontSize: 12, letterSpacing: 3, textTransform: 'uppercase',
          pointerEvents: 'none', textAlign: 'center', padding: 20,
        }}>
          {status === 'loading' ? 'Loading viewer…' : status === 'empty' ? 'No model loaded' : 'Viewer error: ' + err}
        </div>
      )}
    </div>
  );
}

/* helpers the tool uses for the viewer toolbar */
export function viewerSnapshot(state, filename) {
  if (!state || !state.renderer) return;
  state.renderer.render(state.scene, state.camera);
  state.renderer.domElement.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'model-view.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

export const VIEWER_ORANGE = ORANGE;
