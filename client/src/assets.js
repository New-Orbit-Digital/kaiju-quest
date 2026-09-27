// One place that loads .glb files. Normally fetches from ./assets/...;
// in the offline sandbox build every file is embedded (base64) in the
// page, because artifact pages can't fetch anything.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const embedded = () => globalThis.__KQ_ASSETS || null; // { 'city/roads/x.glb': base64, ... }
const key = (url) => url.replace(/^\.?\/?assets\//, '');

const manager = new THREE.LoadingManager();
manager.setURLModifier((url) => {
  const e = embedded();
  if (!e) return url;
  const k = key(url);
  if (k.endsWith('.png') && e[k]) return `data:image/png;base64,${e[k]}`;
  return url;
});
const loader = new GLTFLoader(manager);

function b64ToBuffer(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function loadGLB(url) {
  const e = embedded();
  const k = key(url);
  if (e && e[k]) {
    const dir = 'assets/' + k.slice(0, k.lastIndexOf('/') + 1);
    return new Promise((res, rej) => loader.parse(b64ToBuffer(e[k]), dir, res, rej));
  }
  return loader.loadAsync(url);
}
