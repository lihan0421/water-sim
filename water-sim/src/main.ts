import * as THREE from 'three/webgpu';

async function boot() {
  if (!navigator.gpu) {
    document.getElementById('unsupported')!.style.display = 'block';
    return;
  }
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  // 冒烟测试：旋转方块（Task 2 会替换为 App）
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(0, 1, 3);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
  scene.add(cube);
  renderer.setAnimationLoop(() => { cube.rotation.y += 0.01; renderer.render(scene, camera); });
}
boot();
