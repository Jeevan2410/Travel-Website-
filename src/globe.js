// The 3D globe: continents as dots, a soft atmosphere, pins for destinations and arcs for the trip.
// Drag to turn, scroll or pinch to zoom; picking a place flies the camera round to it.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LAND_DOTS } from "./land-dots.js";
import { decodeDots, toVector } from "./trip.js";

const vector = (lat, lon, radius = 1) => new THREE.Vector3(...toVector(lat, lon, radius));

function dotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.9)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** An arc lifted off the surface between two places, higher for longer trips. */
function arcCurve(a, b) {
  const start = vector(a.lat, a.lon, 1.003);
  const end = vector(b.lat, b.lon, 1.003);
  const angle = start.angleTo(end);
  const lift = 1 + Math.min(0.55, 0.12 + angle * 0.28);
  const middle = start.clone().add(end).normalize().multiplyScalar(lift);
  const c1 = start.clone().lerp(middle, 0.55).normalize().multiplyScalar(lift * 0.98);
  const c2 = end.clone().lerp(middle, 0.55).normalize().multiplyScalar(lift * 0.98);
  return new THREE.CubicBezierCurve3(start, c1, c2, end);
}

export function createGlobe(canvas, { destinations, reduceMotion, onPick, onHover }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.copy(vector(18, 78, 3.4)); // start over India

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.55;
  controls.minDistance = 1.7;
  controls.maxDistance = 5;
  controls.autoRotate = !reduceMotion.matches;
  controls.autoRotateSpeed = 0.35;

  const globe = new THREE.Group();
  scene.add(globe);

  // A dark core hides the dots on the far side.
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.995, 64, 64), new THREE.MeshBasicMaterial({ color: "#0b1530" })));

  // Continents: one point per land dot, brighter towards the viewer via additive blending.
  const dots = decodeDots(LAND_DOTS);
  const positions = new Float32Array((dots.length / 2) * 3);
  for (let i = 0, j = 0; i < dots.length; i += 2, j += 3) {
    const [x, y, z] = toVector(dots[i], dots[i + 1], 1.001);
    positions[j] = x;
    positions[j + 1] = y;
    positions[j + 2] = z;
  }
  const landGeometry = new THREE.BufferGeometry();
  landGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const land = new THREE.Points(
    landGeometry,
    new THREE.PointsMaterial({
      color: "#7dd3fc",
      size: 0.022,
      map: dotTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  globe.add(land);

  // Atmosphere: a back-facing shell that glows at the rim.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.18, 64, 64),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color("#38bdf8") } },
      vertexShader: `varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 color; varying vec3 vNormal; void main() { float rim = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0); gl_FragColor = vec4(color, 1.0) * rim; }`,
    }),
  );
  scene.add(atmosphere);

  // Pins: a dot on the surface and a ring that pulses outwards.
  const pinGeometry = new THREE.SphereGeometry(0.014, 16, 16);
  const ringGeometry = new THREE.RingGeometry(0.02, 0.026, 40);
  const pins = new Map();
  for (const destination of destinations) {
    const group = new THREE.Group();
    const position = vector(destination.lat, destination.lon, 1.004);
    group.position.copy(position);
    group.lookAt(position.clone().multiplyScalar(2));
    const dot = new THREE.Mesh(pinGeometry, new THREE.MeshBasicMaterial({ color: "#fbbf24" }));
    const ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: "#fbbf24", transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    // A larger invisible target makes small pins easy to click.
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.id = destination.id;
    group.add(dot, ring, hit);
    globe.add(group);
    pins.set(destination.id, { group, dot, ring, hit, phase: Math.random() * Math.PI * 2 });
  }

  // Trip arcs, rebuilt whenever the trip changes.
  const arcs = new THREE.Group();
  globe.add(arcs);
  let arcList = [];

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let selected = null;
  let hovered = null;
  let flight = null;
  let visible = true;
  let frame = 0;
  let lastInteraction = 0;

  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render(performance.now());
  }

  function pinAt(event) {
    const box = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...pins.values()].map((pin) => pin.hit), false);
    // Ignore pins on the far side of the globe.
    const front = hits.find((hit) => hit.point.clone().normalize().dot(camera.position.clone().normalize()) > 0.15);
    return front?.object.userData.id ?? null;
  }

  function render(now) {
    const t = now / 1000;
    if (flight) {
      const k = Math.min(1, (now - flight.start) / flight.duration);
      const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      const direction = flight.from.clone().lerp(flight.to, e).normalize();
      const distance = flight.fromDistance + (flight.toDistance - flight.fromDistance) * e;
      // Pull out a little in the middle of long flights, like a real camera move.
      const hop = Math.sin(Math.PI * e) * flight.hop;
      camera.position.copy(direction.multiplyScalar(distance + hop));
      if (k === 1) flight = null;
    }
    controls.autoRotate = !reduceMotion.matches && !flight && now - lastInteraction > 6000 && !selected;
    controls.update();

    for (const [id, pin] of pins) {
      const active = id === selected || id === hovered;
      const pulse = reduceMotion.matches ? 0.5 : (t * 0.8 + pin.phase / (Math.PI * 2)) % 1;
      pin.ring.scale.setScalar(1 + pulse * (active ? 3.2 : 2));
      pin.ring.material.opacity = (1 - pulse) * (active ? 0.9 : 0.55);
      pin.dot.scale.setScalar(active ? 1.6 : 1);
      const color = id === selected ? "#f472b6" : "#fbbf24";
      pin.dot.material.color.set(color);
      pin.ring.material.color.set(color);
    }

    // Arcs draw themselves in, then a light runs along them.
    for (const arc of arcList) {
      const k = reduceMotion.matches ? 1 : Math.min(1, (now - arc.born) / 900);
      arc.mesh.geometry.setDrawRange(0, Math.floor(arc.count * k));
      const s = ((t * 0.35 + arc.offset) % 1) * k;
      arc.spark.position.copy(arc.curve.getPoint(s));
      arc.spark.visible = !reduceMotion.matches && k === 1;
    }
    renderer.render(scene, camera);
  }

  function loop(now) {
    render(now);
    frame = requestAnimationFrame(loop);
  }

  function start() {
    cancelAnimationFrame(frame);
    if (visible && !document.hidden) frame = requestAnimationFrame(loop);
  }

  controls.addEventListener("start", () => {
    lastInteraction = performance.now();
    flight = null;
  });
  controls.addEventListener("end", () => {
    lastInteraction = performance.now();
  });

  let downAt = null;
  canvas.addEventListener("pointerdown", (event) => {
    downAt = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", (event) => {
    // A click, not the end of a drag.
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) return;
    const id = pinAt(event);
    if (id) onPick(id);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const id = pinAt(event);
    if (id !== hovered) {
      hovered = id;
      canvas.style.cursor = id ? "pointer" : "";
      onHover?.(id);
    }
  });

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    start();
  }).observe(canvas);
  document.addEventListener("visibilitychange", start);

  return {
    /** Fly round to a destination and highlight its pin. */
    focus(id) {
      selected = id;
      const destination = destinations.find((d) => d.id === id);
      if (!destination) return;
      const to = vector(destination.lat, destination.lon).normalize();
      const fromDistance = camera.position.length();
      const toDistance = Math.min(Math.max(fromDistance, 2.9), 3.4);
      const angle = camera.position.clone().normalize().angleTo(to);
      if (reduceMotion.matches) {
        camera.position.copy(to.multiplyScalar(toDistance));
        return;
      }
      flight = {
        from: camera.position.clone().normalize(),
        to,
        fromDistance,
        toDistance,
        hop: Math.min(1.2, angle * 0.5),
        start: performance.now(),
        duration: 900 + angle * 600,
      };
    },
    clear() {
      selected = null;
    },
    /** Draw arcs between the trip's stops, in order. */
    setTrip(stops) {
      arcs.clear();
      arcList = [];
      for (let i = 1; i < stops.length; i++) {
        const curve = arcCurve(stops[i - 1], stops[i]);
        const geometry = new THREE.TubeGeometry(curve, 96, 0.0045, 8, false);
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({ color: "#f472b6", transparent: true, opacity: 0.9, depthWrite: false }),
        );
        const spark = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
        arcs.add(mesh, spark);
        arcList.push({ curve, mesh, spark, count: geometry.index.count, born: performance.now() + i * 140, offset: i * 0.27 });
      }
    },
    /** Screen position of a destination and whether it faces the viewer, for the HTML label. */
    project(id) {
      const pin = pins.get(id);
      if (!pin) return null;
      const world = pin.group.getWorldPosition(new THREE.Vector3());
      const facing = world.clone().normalize().dot(camera.position.clone().normalize()) > 0.2;
      const screen = world.project(camera);
      const box = canvas.getBoundingClientRect();
      return { x: ((screen.x + 1) / 2) * box.width, y: ((1 - screen.y) / 2) * box.height, facing };
    },
    start,
  };
}
