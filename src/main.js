import { DESTINATIONS, TAGS } from "./data.js";
import { formatRupees, isGoodNow, monthRanges, moveStop, parseTrip, tripHash, tripStats, weatherLabel } from "./trip.js";

const TRIP_KEY = "travels:trip";
const $ = (selector, scope = document) => scope.querySelector(selector);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const byId = new Map(DESTINATIONS.map((d) => [d.id, d]));
const ids = DESTINATIONS.map((d) => d.id);
const month = new Date().getMonth() + 1;
const monthName = new Date().toLocaleDateString("en", { month: "long" });

function savedTrip() {
  const fromLink = parseTrip(location.hash, ids);
  if (fromLink.length) return fromLink;
  try {
    return parseTrip(`#trip=${localStorage.getItem(TRIP_KEY) ?? ""}`, ids);
  } catch {
    return [];
  }
}

const state = { tag: "all", nowOnly: false, selected: null, hovered: null, trip: savedTrip() };
let globe = null;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") node.style.cssText = value;
    else if (key in node && !key.includes("-")) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

const announce = (message) => {
  $("#announce").textContent = message;
};

/* ---------- filters and the list ---------- */

function renderFilters() {
  $("#tags").replaceChildren(
    ...TAGS.map(([id, label]) =>
      el("button", { type: "button", class: "chip", "aria-pressed": String(id === state.tag), "data-tag": id }, label),
    ),
  );
  $("#now-label").textContent = `Best in ${monthName}`;
}

function visiblePlaces() {
  return DESTINATIONS.filter((d) => (state.tag === "all" || d.tags.includes(state.tag)) && (!state.nowOnly || isGoodNow(d, month)));
}

function renderPlaces() {
  const places = visiblePlaces();
  $("#places").replaceChildren(
    ...places.map((d, i) =>
      el(
        "li",
        { style: `--i:${Math.min(i, 10)}` },
        el(
          "button",
          {
            type: "button",
            class: "place",
            "data-id": d.id,
            "aria-pressed": String(d.id === state.selected),
            "aria-label": `${d.name}, ${d.country}`,
          },
          el("span", { class: "place-name" }, d.name, el("small", {}, d.country)),
          el("span", { class: "place-meta" }, `${monthRanges(d.best)} · ${d.days} days`),
          isGoodNow(d, month) ? el("span", { class: "now-badge" }, "Good now") : null,
          state.trip.includes(d.id) ? el("span", { class: "in-trip", "aria-label": "In your trip" }, "✓") : null,
        ),
      ),
    ),
  );
  $("#places-empty").hidden = places.length > 0;
  const list = $("#places");
  list.classList.remove("in");
  void list.offsetWidth;
  list.classList.add("in");
}

$("#tags").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-tag]");
  if (!chip) return;
  state.tag = chip.dataset.tag;
  for (const other of $("#tags").children) other.setAttribute("aria-pressed", String(other === chip));
  renderPlaces();
});
$("#now-only").addEventListener("change", (event) => {
  state.nowOnly = event.target.checked;
  renderPlaces();
});
$("#places").addEventListener("click", (event) => {
  const place = event.target.closest(".place");
  if (place) select(place.dataset.id);
});

/* ---------- a selected place ---------- */

const weatherCache = new Map();

async function loadWeather(destination) {
  if (weatherCache.has(destination.id)) return weatherCache.get(destination.id);
  const params = new URLSearchParams({
    latitude: String(destination.lat),
    longitude: String(destination.lon),
    current: "temperature_2m,weather_code,is_day",
    timezone: "auto",
  });
  const request = fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((data) => ({
      temp: Math.round(data.current.temperature_2m),
      label: weatherLabel(data.current.weather_code),
      time: data.current.time.slice(11, 16),
    }));
  weatherCache.set(destination.id, request);
  request.catch(() => weatherCache.delete(destination.id));
  return request;
}

function select(id) {
  const destination = byId.get(id);
  if (!destination) return;
  state.selected = id;
  globe?.focus(id);
  for (const place of document.querySelectorAll(".place")) place.setAttribute("aria-pressed", String(place.dataset.id === id));
  renderDetail();
  announce(`${destination.name}, ${destination.country}`);
}

function renderDetail() {
  const d = byId.get(state.selected);
  const panel = $("#detail");
  if (!d) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("#d-name").textContent = d.name;
  $("#d-country").textContent = d.country;
  $("#d-blurb").textContent = d.blurb;
  $("#d-best").textContent = monthRanges(d.best);
  $("#d-days").textContent = `${d.days} days`;
  $("#d-budget").textContent = `${formatRupees(d.perDay)} / day`;
  const inTrip = state.trip.includes(d.id);
  const add = $("#d-add");
  add.textContent = inTrip ? "In your trip ✓" : "Add to trip";
  add.setAttribute("aria-pressed", String(inTrip));
  const weather = $("#d-weather");
  weather.textContent = "Checking the weather…";
  loadWeather(d)
    .then((now) => {
      if (state.selected === d.id) weather.textContent = `${now.temp}°C, ${now.label.toLowerCase()} · ${now.time} local time`;
    })
    .catch(() => {
      if (state.selected === d.id) weather.textContent = "Weather unavailable right now";
    });
  panel.classList.remove("swap");
  void panel.offsetWidth;
  panel.classList.add("swap");
}

$("#d-add").addEventListener("click", () => toggleTrip(state.selected));
$("#d-close").addEventListener("click", () => {
  state.selected = null;
  globe?.clear();
  renderDetail();
  for (const place of document.querySelectorAll(".place")) place.setAttribute("aria-pressed", "false");
});

/* ---------- the trip ---------- */

function saveTrip() {
  try {
    localStorage.setItem(TRIP_KEY, state.trip.join(","));
  } catch {
    // Storage blocked: the share link still holds the trip.
  }
  history.replaceState(null, "", `${location.pathname}${location.search}${tripHash(state.trip)}`);
}

function toggleTrip(id) {
  const destination = byId.get(id);
  if (!destination) return;
  const adding = !state.trip.includes(id);
  state.trip = adding ? [...state.trip, id] : state.trip.filter((x) => x !== id);
  saveTrip();
  renderTrip();
  renderPlaces();
  renderDetail();
  announce(adding ? `${destination.name} added to your trip` : `${destination.name} removed from your trip`);
  if (adding) bump();
}

function bump() {
  const badge = $("#trip-count");
  badge.classList.remove("bump");
  void badge.offsetWidth;
  badge.classList.add("bump");
}

function renderTrip() {
  const stops = state.trip.map((id) => byId.get(id));
  const stats = tripStats(stops);
  $("#trip-count").textContent = stats.stops ? String(stats.stops) : "";
  globe?.setTrip(stops);

  $("#trip-stops").replaceChildren(
    ...stops.map((stop, i) => {
      const up = el("button", { type: "button", class: "icon", "aria-label": `Move ${stop.name} earlier`, disabled: i === 0 }, "↑");
      const down = el(
        "button",
        { type: "button", class: "icon", "aria-label": `Move ${stop.name} later`, disabled: i === stops.length - 1 },
        "↓",
      );
      const remove = el("button", { type: "button", class: "icon", "aria-label": `Remove ${stop.name}` }, "✕");
      up.addEventListener("click", () => reorder(stop.id, -1));
      down.addEventListener("click", () => reorder(stop.id, 1));
      remove.addEventListener("click", () => toggleTrip(stop.id));
      return el(
        "li",
        { style: `--i:${i}` },
        el("span", { class: "stop-number" }, String(i + 1)),
        el("div", {}, el("strong", {}, stop.name), el("span", {}, `${stop.days} days · ${monthRanges(stop.best)}`)),
        el("div", { class: "stop-actions" }, up, down, remove),
      );
    }),
  );
  $("#trip-empty").hidden = stops.length > 0;
  $("#trip-summary").hidden = stops.length === 0;
  $("#t-days").textContent = String(stats.days);
  $("#t-km").textContent = stats.km.toLocaleString("en-IN");
  $("#t-budget").textContent = formatRupees(stats.budget);
  $("#trip-bar").hidden = stops.length === 0;
  $("#trip-bar-text").textContent = `${stats.stops} ${stats.stops === 1 ? "stop" : "stops"} · ${stats.days} days · about ${formatRupees(stats.budget)}`;
}

function reorder(id, step) {
  state.trip = moveStop(state.trip, id, step);
  saveTrip();
  renderTrip();
}

const tripDialog = $("#trip");
for (const opener of document.querySelectorAll("[data-open-trip]")) {
  opener.addEventListener("click", () => {
    renderTrip();
    tripDialog.showModal();
  });
}
$("#trip-close").addEventListener("click", () => tripDialog.close());
tripDialog.addEventListener("click", (event) => {
  if (event.target === tripDialog) tripDialog.close();
});
$("#trip-clear").addEventListener("click", () => {
  state.trip = [];
  saveTrip();
  renderTrip();
  renderPlaces();
  renderDetail();
  announce("Trip cleared");
});
$("#trip-share").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = "Link copied";
  } catch {
    button.textContent = "Copy the address bar";
  }
  setTimeout(() => (button.textContent = "Copy share link"), 2000);
});

/* ---------- the label that follows a pin ---------- */

function followLabel() {
  const id = state.hovered ?? state.selected;
  const label = $("#pin-label");
  const spot = id && globe ? globe.project(id) : null;
  if (spot && spot.facing) {
    label.hidden = false;
    label.textContent = byId.get(id).name;
    label.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
  } else {
    label.hidden = true;
  }
  requestAnimationFrame(followLabel);
}

/* ---------- reveals ---------- */

if ("IntersectionObserver" in window && !reduceMotion.matches) {
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        reveal.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  for (const node of document.querySelectorAll(".reveal")) reveal.observe(node);
} else {
  for (const node of document.querySelectorAll(".reveal")) node.classList.add("in");
}

/* ---------- start ---------- */

async function loadGlobe() {
  try {
    const { createGlobe } = await import("./globe.js");
    globe = createGlobe($("#globe"), {
      destinations: DESTINATIONS,
      reduceMotion,
      onPick: select,
      onHover: (id) => {
        state.hovered = id;
      },
    });
    globe.setTrip(state.trip.map((id) => byId.get(id)));
    if (state.selected) globe.focus(state.selected);
    globe.start();
    document.documentElement.classList.add("has-3d");
    requestAnimationFrame(followLabel);
  } catch (error) {
    console.warn("3D globe unavailable:", error);
    $(".globe-fallback").hidden = false;
  }
}

renderFilters();
renderPlaces();
renderTrip();
requestAnimationFrame(() => document.documentElement.classList.add("ready"));
loadGlobe();
