// BOB (mayordomo robot), drones ayudantes, partículas de celebración y la pelota de básquet.
import * as THREE from 'three';

export class Bob {
  group = new THREE.Group();
  private eyes: THREE.MeshStandardMaterial;
  private ring: THREE.MeshStandardMaterial;
  private t = 0;
  talk = 0;
  glitch = 0;
  pos = new THREE.Vector3(-16, 1.6, 3);
  constructor(scene: THREE.Scene) {
    const shell = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f2, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });
    const visorM = new THREE.MeshPhysicalMaterial({ color: 0x050608, roughness: 0.05, clearcoat: 1 });
    this.eyes = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6ff3ff, emissiveIntensity: 3 });
    this.ring = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6ff3ff, emissiveIntensity: 2 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 40, 28), shell);
    head.scale.set(1.15, 0.95, 1);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 40, 24), visorM);
    face.scale.set(1.05, 0.68, 0.5);
    face.position.set(0, 0.0, -0.115);
    for (const x of [-0.065, 0.065]) {
      const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.028, 4, 10), this.eyes);
      e.rotation.z = Math.PI / 2;
      e.position.set(x, 0.01, -0.198);
      this.group.add(e);
    }
    const prof = [new THREE.Vector2(0.001, -0.2), new THREE.Vector2(0.05, -0.17), new THREE.Vector2(0.11, -0.08), new THREE.Vector2(0.14, 0.02), new THREE.Vector2(0.13, 0.1), new THREE.Vector2(0.08, 0.14), new THREE.Vector2(0.001, 0.15)];
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), shell);
    body.position.y = -0.36;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.008, 8, 48), this.ring);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.33;
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.014, 6, 12), visorM);
    bow.position.set(0, -0.24, -0.11);
    bow.scale.set(1.7, 0.8, 0.6);
    const ant = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), this.ring);
    ant.position.set(0, 0.215, 0);
    this.group.add(head, face, body, ring, bow, ant);
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(0.8);
    scene.add(this.group);
  }
  update(dt: number, player: THREE.Vector3, yaw: number, eyeY: number) {
    this.t += dt;
    // se queda al costado del jugador, un poco adelante
    const side = new THREE.Vector3(-Math.sin(yaw) * 2.6 - Math.cos(yaw) * 1.6, 0, -Math.cos(yaw) * 2.6 + Math.sin(yaw) * 1.6);
    const target = player.clone().add(side);
    target.y = eyeY + 0.05 + Math.sin(this.t * 1.7) * 0.06;
    if (this.pos.distanceTo(target) > 0.3) this.pos.lerp(target, Math.min(1, dt * 1.6));
    this.group.position.copy(this.pos);
    const look = new THREE.Vector3(player.x, eyeY, player.z);
    this.group.lookAt(look);
    this.group.rotateY(Math.PI);
    this.group.rotation.z = Math.sin(this.t * 1.3) * 0.05;
    this.talk = Math.max(0, this.talk - dt);
    this.glitch = Math.max(0, this.glitch - dt);
    const g = this.glitch > 0 && Math.random() < 0.5;
    this.eyes.emissive.set(g ? 0xff2a2a : 0x6ff3ff);
    this.ring.emissive.set(g ? 0xff2a2a : 0x6ff3ff);
    this.eyes.emissiveIntensity = (this.talk > 0 ? 2.5 + Math.sin(this.t * 30) * 1.5 : 3) * (g ? Math.random() * 2 : 1);
  }
}

/** Drones de limpieza que ayudan a ordenar. */
export class Drones {
  list: { mesh: THREE.Group; pos: THREE.Vector3; target: THREE.Vector3; home: THREE.Vector3; busy: number; cool: number }[] = [];
  private mat = new THREE.MeshPhysicalMaterial({ color: 0x15161a, roughness: 0.25, metalness: 0.6, clearcoat: 1 });
  private glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2ee6ff, emissiveIntensity: 3 });
  constructor(private scene: THREE.Scene) {}
  setCount(n: number, near: THREE.Vector3) {
    while (this.list.length < n) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.07, 24), this.mat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.01, 6, 32), this.glow);
      ring.rotation.x = Math.PI / 2;
      g.add(body, ring);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.03), this.mat);
        arm.position.set(Math.cos(a) * 0.16, 0.02, Math.sin(a) * 0.16);
        arm.rotation.y = -a;
        const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.004, 16), new THREE.MeshBasicMaterial({ color: 0x9ff3ff, transparent: true, opacity: 0.25 }));
        rotor.position.set(Math.cos(a) * 0.26, 0.04, Math.sin(a) * 0.26);
        g.add(arm, rotor);
      }
      const p = near.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 2.2, (Math.random() - 0.5) * 2));
      g.position.copy(p);
      this.scene.add(g);
      this.list.push({ mesh: g, pos: p, target: p.clone(), home: p.clone(), busy: 0, cool: Math.random() });
    }
  }
  update(dt: number, t: number, player: THREE.Vector3) {
    this.list.forEach((d, i) => {
      if (d.busy <= 0) {
        const a = t * 0.5 + i * 1.3;
        d.target.set(player.x + Math.cos(a) * 2.4, player.y + 2.6 + Math.sin(t + i) * 0.2, player.z + Math.sin(a) * 2.4);
      }
      d.busy -= dt;
      d.pos.lerp(d.target, Math.min(1, dt * (d.busy > 0 ? 4 : 1.2)));
      d.mesh.position.copy(d.pos);
      d.mesh.rotation.y += dt * 2;
      d.mesh.rotation.z = Math.sin(t * 2 + i) * 0.08;
    });
  }
}

/** Chispas doradas al completar un estante o una zona. */
export class Sparkles {
  private pts: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private col: Float32Array;
  private n = 1500;
  private head = 0;
  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n);
    this.col = new Float32Array(this.n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.09, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }
  burst(box: THREE.Box3, color: string, count = 120) {
    const c = new THREE.Color(color);
    const s = box.getSize(new THREE.Vector3());
    for (let k = 0; k < count; k++) {
      const i = this.head++ % this.n;
      this.pos[i * 3] = box.min.x + Math.random() * s.x;
      this.pos[i * 3 + 1] = box.min.y + Math.random() * s.y;
      this.pos[i * 3 + 2] = box.min.z + Math.random() * s.z;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.8;
      this.vel[i * 3 + 1] = 0.5 + Math.random() * 1.5;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
      this.life[i] = 1 + Math.random() * 0.8;
      const w = Math.random() < 0.4;
      this.col[i * 3] = w ? 1 : c.r * 2;
      this.col[i * 3 + 1] = w ? 0.9 : c.g * 2;
      this.col[i * 3 + 2] = w ? 0.7 : c.b * 2;
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= dt * 0.9;
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -999;
      else if (this.life[i] < 0.3) for (let a = 0; a < 3; a++) this.col[i * 3 + a] *= 0.9;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.pts.geometry.attributes.color.needsUpdate = true;
  }
}

export function makeBall() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#d4602a'; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; x.fillRect(Math.random() * 256, Math.random() * 128, 1.5, 1.5); }
  x.strokeStyle = '#1a0d06'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, 64); x.lineTo(256, 64); x.stroke();
  for (const px of [64, 192]) { x.beginPath(); x.moveTo(px, 0); x.lineTo(px, 128); x.stroke(); }
  x.beginPath(); x.ellipse(128, 64, 40, 64, 0, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.ellipse(0, 64, 40, 64, 0, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.ellipse(256, 64, 40, 64, 0, 0, Math.PI * 2); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 20), new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 }));
}
