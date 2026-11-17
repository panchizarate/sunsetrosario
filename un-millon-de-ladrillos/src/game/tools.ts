import * as THREE from 'three';
import type { ToolId } from './config';
import { SUN_DIR } from './world';

const sm = (color: string, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

/** Madera con veta procedural. */
function woodMat() {
  const m = sm('#b07a48', 0.75);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vO;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vO = position;');
    sh.fragmentShader = 'varying vec3 vO;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float g = sin(vO.y * 90.0 + sin(vO.x * 40.0) * 2.0 + sin(vO.z * 37.0)) * 0.5 + 0.5;
      diffuseColor.rgb *= 0.78 + 0.3 * g;`);
  };
  return m;
}

function buildTool(id: ToolId): THREE.Group {
  const g = new THREE.Group();
  const wood = woodMat();
  const steel = sm('#9aa2a8', 0.32, 0.9);
  const dark = sm('#3a3d40', 0.45, 0.8);
  if (id === 'martillo') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.36, 10), wood);
    handle.position.y = 0.0;
    g.add(handle);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10), sm('#c0392b', 0.6));
    grip.position.y = -0.11;
    g.add(grip);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.035, 0.035), steel);
    head.position.set(0.02, 0.18, 0);
    g.add(head);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 12), steel);
    face.rotation.z = Math.PI / 2;
    face.position.set(0.09, 0.18, 0);
    g.add(face);
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.03), steel);
    claw.position.set(-0.07, 0.17, 0);
    claw.rotation.z = -0.4;
    g.add(claw);
  } else if (id === 'maza') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.75, 10), wood);
    g.add(handle);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), dark);
    head.position.set(0, 0.38, 0);
    g.add(head);
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.085, 0.085), steel);
      f.position.set(s * 0.1, 0.38, 0);
      g.add(f);
    }
  } else if (id === 'neumatico') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.34, 16), sm('#e2a514', 0.45, 0.3));
    g.add(body);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.06, 16), dark);
    top.position.y = 0.2;
    g.add(top);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8), dark);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 0.24;
    g.add(bar);
    for (const s of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), sm('#222', 0.8));
      grip.rotation.z = Math.PI / 2;
      grip.position.set(s * 0.18, 0.24, 0);
      g.add(grip);
    }
    const bit = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.005, 0.22, 8), steel);
    bit.position.y = -0.27;
    g.add(bit);
    const hose = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 16, Math.PI), sm('#111', 0.7));
    hose.position.set(0.06, 0.1, -0.03);
    hose.rotation.y = Math.PI / 2;
    g.add(hose);
  } else if (id === 'bola') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.15, 0.035), sm('#f2b705', 0.5, 0.1));
    g.add(box);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.04), new THREE.MeshBasicMaterial({ color: '#57ff9a' }));
    screen.position.set(0, 0.04, 0.019);
    g.add(screen);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 12), sm('#e02020', 0.4));
    btn.rotation.x = Math.PI / 2;
    btn.position.set(0, -0.02, 0.02);
    btn.name = 'btn';
    g.add(btn);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 6), dark);
    ant.position.set(0.03, 0.14, 0);
    g.add(ant);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), sm('#7a2a1c', 0.6));
    g.add(box);
    const plunger = new THREE.Group();
    plunger.name = 'plunger';
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), steel);
    rod.position.y = 0.06;
    plunger.add(rod);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 8), dark);
    t.rotation.z = Math.PI / 2;
    t.position.y = 0.12;
    plunger.add(t);
    plunger.position.y = 0.04;
    g.add(plunger);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.025), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
    label.position.set(0, 0, 0.041);
    g.add(label);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).frustumCulled = false; });
  g.scale.setScalar(0.8);
  return g;
}

const REST: Record<ToolId, { pos: THREE.Vector3; rot: THREE.Euler }> = {
  martillo: { pos: new THREE.Vector3(0.36, -0.38, -0.85), rot: new THREE.Euler(0.35, -0.5, -0.25) },
  maza: { pos: new THREE.Vector3(0.42, -0.6, -1.0), rot: new THREE.Euler(0.6, -0.45, -0.3) },
  neumatico: { pos: new THREE.Vector3(0.12, -0.55, -0.9), rot: new THREE.Euler(-0.75, 0, 0.12) },
  bola: { pos: new THREE.Vector3(0.3, -0.3, -0.7), rot: new THREE.Euler(0.25, -0.35, 0) },
  explosivos: { pos: new THREE.Vector3(0.32, -0.32, -0.72), rot: new THREE.Euler(0.3, -0.45, 0) },
};

export class ViewModel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
  private tools = new Map<ToolId, THREE.Group>();
  private holder = new THREE.Group();
  current: ToolId = 'martillo';
  private swingT = 1;
  private swingDur = 0.3;
  private switchT = 1;
  private vib = 0;
  private sway = new THREE.Vector2();
  private bobT = 0;

  constructor(env: THREE.Texture | null) {
    this.scene.environment = env;
    this.scene.add(new THREE.HemisphereLight(0xcfdcff, 0x5a4636, 0.5));
    const sun = new THREE.DirectionalLight(0xffd0a0, 2.4);
    sun.position.copy(SUN_DIR).multiplyScalar(5);
    this.scene.add(sun);
    this.scene.add(this.holder);
    for (const id of ['martillo', 'maza', 'neumatico', 'bola', 'explosivos'] as ToolId[]) {
      const t = buildTool(id);
      t.visible = false;
      this.holder.add(t);
      this.tools.set(id, t);
    }
    this.select('martillo', true);
  }

  select(id: ToolId, instant = false) {
    for (const [k, t] of this.tools) t.visible = k === id;
    this.current = id;
    this.switchT = instant ? 1 : 0;
  }

  swing(rate: number) {
    this.swingDur = Math.min(0.42, Math.max(0.12, 0.85 / rate));
    this.swingT = 0;
  }

  setVibrate(on: boolean) {
    this.vib = on ? 1 : 0;
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  visible = true;

  update(dt: number, moveSpeed: number, look: [number, number], time: number) {
    this.holder.visible = this.visible;
    const t = this.tools.get(this.current)!;
    const rest = REST[this.current];
    this.swingT = Math.min(1, this.swingT + dt / this.swingDur);
    this.switchT = Math.min(1, this.switchT + dt * 4);
    this.bobT += dt * (2 + moveSpeed * 1.6);
    this.sway.x += (-look[0] * 0.0006 - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (-look[1] * 0.0006 - this.sway.y) * Math.min(1, dt * 8);
    const bob = Math.min(1, moveSpeed / 4);
    const pos = rest.pos.clone();
    pos.x += Math.sin(this.bobT) * 0.012 * bob + this.sway.x;
    pos.y += -Math.abs(Math.cos(this.bobT)) * 0.012 * bob + this.sway.y - (1 - this.switchT) * 0.35;
    const rot = rest.rot.clone();
    // curva de golpe: levantar, bajar rápido, rebote
    const s = this.swingT;
    let swing = 0;
    if (this.current === 'martillo' || this.current === 'maza') {
      swing = s < 0.35 ? -(s / 0.35) * 0.9 : s < 0.55 ? -0.9 + ((s - 0.35) / 0.2) * 2.1 : 1.2 * (1 - (s - 0.55) / 0.45);
      rot.x += swing * (this.current === 'maza' ? 1.1 : 0.9);
      pos.z += Math.max(0, swing) * -0.08;
    } else if (this.current === 'explosivos') {
      const pl = t.getObjectByName('plunger');
      if (pl) pl.position.y = 0.04 - Math.sin(Math.min(1, s * 2) * Math.PI) * 0.05;
      rot.x += Math.sin(s * Math.PI) * 0.2;
    } else if (this.current === 'bola') {
      const b = t.getObjectByName('btn');
      if (b) b.position.z = 0.02 - Math.sin(s * Math.PI) * 0.006;
      rot.x += Math.sin(s * Math.PI) * 0.1;
    }
    if (this.vib > 0 && this.current === 'neumatico') {
      pos.x += (Math.random() - 0.5) * 0.012;
      pos.y += (Math.random() - 0.5) * 0.016;
      pos.z += (Math.random() - 0.5) * 0.01;
    }
    void time;
    t.position.copy(pos);
    t.rotation.copy(rot);
  }
}
