// The three.js half of the lens turn — only the classes it needs, so the lazy
// chunk stays small (loaded on a child's first perspective switch, never on
// first paint). See lensTransition.js.
import {
  WebGLRenderer, Scene, PerspectiveCamera, BoxGeometry, Mesh, MeshBasicMaterial,
  TextureLoader, LinearFilter, SRGBColorSpace,
} from "three";

export function createTurn3d({ width, height }) {
  const renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x140b20, 1);
  renderer.outputColorSpace = SRGBColorSpace;
  const loader = new TextureLoader();
  loader.setCrossOrigin("anonymous");
  const textures = [];
  const disposables = [];

  return {
    canvas: renderer.domElement,
    loadTexture(src) {
      return new Promise((resolve) => {
        loader.load(src, (t) => { textures.push(t); resolve(t); }, undefined, () => resolve(null));
      });
    },
    // Build the prism. fit(img) → { rx, ry, ox, oy } cover-fits a picture.
    build({ from, to, direction, fit }) {
      const fa = width / height;
      for (const t of [from, to]) {
        const { rx, ry, ox, oy } = fit((t.image?.width || 16) / (t.image?.height || 9), fa);
        t.repeat.set(rx, ry);
        t.offset.set(ox, oy);
        t.generateMipmaps = false;
        t.minFilter = LinearFilter;
        t.colorSpace = SRGBColorSpace;
        t.needsUpdate = true;
      }
      const h = 2;
      const w = h * fa;
      const scene = new Scene();
      const fov = 35;
      const camera = new PerspectiveCamera(fov, fa, 0.05, 100);
      const baseZ = w / 2 + h / 2 / Math.tan((fov * Math.PI) / 360);
      camera.position.set(0, 0, baseZ);
      const side = new MeshBasicMaterial({ color: 0x241533 });
      const front = new MeshBasicMaterial({ map: from });
      const next = new MeshBasicMaterial({ map: to });
      // faces: [+x, -x, +y, -y, +z (front), -z]; turning "next" brings +x round to the front
      const mats = direction > 0 ? [next, side, side, side, front, side] : [side, next, side, side, front, side];
      const geo = new BoxGeometry(w, h, w);
      const box = new Mesh(geo, mats);
      scene.add(box);
      disposables.push(geo, side, front, next);
      const target = (-Math.PI / 2) * direction;
      // e = eased progress 0..1: rotate, and pull the camera back mid-turn for depth
      return (e) => {
        box.rotation.y = target * e;
        camera.position.z = baseZ + Math.sin(Math.PI * e) * w * 0.32;
        renderer.render(scene, camera);
      };
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      textures.forEach((t) => t.dispose());
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
