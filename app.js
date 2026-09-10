/* Skuggerelieff-figurar — kartutsnitt med skuggerelieff/hybrid og blå vassflater */
"use strict";

/* ---------------------------------------------------------------- presets */

const PRESETS = {
  no: {
    name: "Noreg",
    // fargane er lesne direkte frå Kartverket sine topo-fliser (norgeskart.no)
    water: "#e0fefe",
    outline: "#9acbe7",
    // nasjonalt vatn-lag: vassflater + elvar frå same kartbase som norgeskart.no.
    // Fleire lag stabla (kd_ for oversikt, vann_omrade/FKB for nær zoom) så vatnet
    // held seg synleg gjennom heile zoom-området, ikkje berre på oversiktsnivå.
    waterRaster:
      "https://wms.geonorge.no/skwms1/wms.topo?service=WMS&request=GetMap&version=1.3.0&layers=kd_vannflate,vann_omrade,kd_elver&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=512&height=512&format=image/png&transparent=true",
    attribution: "© Kartverket",
  },
  se: {
    name: "Sverige",
    // fargane er lesne direkte frå Lantmäteriet sine topowebb-fliser
    water: "#cbeaff",
    outline: "#6ecbd9",
    waterRaster: null, // Lantmäteriet har ikkje eit ope vatn-berre-lag → OpenStreetMap
    attribution: "© Lantmäteriet · vatn: © OpenStreetMap",
  },
  fi: {
    name: "Finland",
    water: "#b9e2f6",
    outline: "#6aabdb",
    waterRaster: null,
    attribution: "© Maanmittauslaitos · vatn: © OpenStreetMap",
  },
};

const URLS = {
  kvTopo: "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png",
  kvShadeFjell:
    "https://wms.geonorge.no/skwms1/wms.fjellskygge?service=WMS&request=GetMap&version=1.3.0&layers=fjellskygge&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=1024&height=1024&format=image/png&transparent=true",
  kvShadeDtm:
    "https://wms.geonorge.no/skwms1/wms.hoyde-dtm?service=WMS&request=GetMap&version=1.3.0&layers=DTM:skyggerelieff&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=1024&height=1024&format=image/png&transparent=true",
  terrarium: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  // Lantmäteriet sine opne visningstenester (same som minkarta.lantmateriet.se brukar)
  seTopo:
    "https://minkarta.lantmateriet.se/map/topowebbcache?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=topowebb&STYLE=default&TILEMATRIXSET=3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png",
  seShade:
    "https://minkarta.lantmateriet.se/map/hojdmodell?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=terrangskuggning&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=1024&HEIGHT=1024&FORMAT=image/png&TRANSPARENT=true",
  omt: "https://tiles.openfreemap.org/planet",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  // topografisk bakgrunn utan nøkkel (høgdekurver, terreng) – likare eit nasjonalt kart enn vanleg OSM
  openTopo: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  mml: (key) =>
    "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/maastokartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key=" + key,
};

const STORE_FIGS = "skuggerelieff.figurar";
const STORE_KEYS = "skuggerelieff.oppsett";

/* ---------------------------------------------------------------- ui refs */

const $ = (id) => document.getElementById(id);
const ui = {
  coords: $("coords"), goto: $("goto"),
  search: $("search"), searchbtn: $("searchbtn"), searchresults: $("searchresults"),
  clickplace: $("clickplace"),
  country: $("country"), bgmap: $("bgmap"), shadesrc: $("shadesrc"), fidetail: $("fidetail"), blend: $("blend"), blendval: $("blendval"),
  fistrength: $("fistrength"), fistrengthval: $("fistrengthval"),
  contrast: $("contrast"), contrastval: $("contrastval"),
  bearing: $("bearing"), bearingnum: $("bearingnum"), bearingreset: $("bearingreset"),
  shownorth: $("shownorth"),
  watersrc: $("watersrc"), watercolorrow: $("watercolorrow"),
  watercolor: $("watercolor"), wateroutline: $("wateroutline"), waterreset: $("waterreset"),
  waterlabels: $("waterlabels"), waterways: $("waterways"),
  markertype: $("markertype"), showmarkers: $("showmarkers"),
  markersize: $("markersize"), markersizeval: $("markersizeval"),
  markercolor: $("markercolor"), markerwidth: $("markerwidth"),
  aspect: $("aspect"), exportwidth: $("exportwidth"), exportratio: $("exportratio"),
  showscale: $("showscale"), showattrib: $("showattrib"),
  export: $("export"), exportstatus: $("exportstatus"),
  figname: $("figname"), savefig: $("savefig"), figlist: $("figlist"),
  exportfigs: $("exportfigs"), importfigs: $("importfigs"), importfile: $("importfile"),
  mmlkey: $("mmlkey"), mmlstatus: $("mmlstatus"),
  mapbox: $("mapbox"),
};

let markerItems = []; // liste av { pos: [lng, lat], type: "cross" | "dot" | "ring" }
let markerObjs = [];  // tilhøyrande maplibregl.Marker-objekt

/* ------------------------------------------------------------ stilbyggjar */

function advanced() {
  try { return JSON.parse(localStorage.getItem(STORE_KEYS)) || {}; } catch { return {}; }
}
function saveAdvanced() {
  localStorage.setItem(STORE_KEYS, JSON.stringify({ mmlkey: ui.mmlkey.value.trim() }));
}

// kva topografisk kart (hybrid-bakgrunn) som gjeld no – tiles + maxzoom
function topoSpec() {
  const country = ui.country.value;
  const mmlkey = ui.mmlkey.value.trim();
  const openTopoTiles = ["a", "b", "c"].map((s) => URLS.openTopo.replace("{s}", s));
  if (ui.bgmap.value === "opentopo") return { tiles: openTopoTiles, maxzoom: 17 };
  if (country === "fi") return mmlkey ? { tiles: [URLS.mml(mmlkey)], maxzoom: 18 } : { tiles: openTopoTiles, maxzoom: 17 };
  if (country === "se") return { tiles: [URLS.seTopo], maxzoom: 16 };
  return { tiles: [URLS.kvTopo], maxzoom: 18 };
}

// SE/FI i national-modus: vatnet finst berre i bakgrunnskartet (ikkje eit eige lag).
// Då kan vi ved eksport plukka vatnet ut av kartet og teikna det skarpt.
function mapWaterMode() {
  return ui.watersrc.value === "national" && !PRESETS[ui.country.value].waterRaster;
}

// éin sanning for kjelde-kreditering (brukt både av skjerm-info og eksport-line)
function shadeCredit() {
  const c = ui.country.value;
  if (c === "no") return "© Kartverket";
  if (c === "se") return "© Lantmäteriet";
  return ui.mmlkey.value.trim() ? "© Maanmittauslaitos" : "høgdedata: EU-DEM © Copernicus";
}
// kva topografisk kart som er aktivt, og om det byggjer på OpenStreetMap
function topoCredit() {
  const c = ui.country.value;
  if (ui.bgmap.value === "opentopo") return { name: "© OpenTopoMap", osm: true };
  if (c === "no") return { name: "© Kartverket", osm: false };
  if (c === "se") return { name: "© Lantmäteriet", osm: false };
  return ui.mmlkey.value.trim() ? { name: "© Maanmittauslaitos", osm: false } : { name: "© OpenTopoMap", osm: true };
}

function buildStyle() {
  const country = ui.country.value;
  const blend = +ui.blend.value / 100;
  const contrast = +ui.contrast.value / 100;
  const waterColor = ui.watercolor.value;
  const mmlkey = ui.mmlkey.value.trim();
  // finsk 2 m-høgdemodell (MML WCS) via mmldem-protokollen – krev nøkkel
  const fiDem = country === "fi" && !!mmlkey;

  // kva for eit "vanleg kart" som skal brukast i hybridmodus (kan vera fleire tenarar)
  const { tiles: topoTiles, maxzoom: topoMaxzoom } = topoSpec();

  // vatn: "national" = nøyaktig kjelde. Noreg har eit eige vatn-raster (natWaterUrl);
  // Sverige/Finland manglar det, så der kjem vatnet frå bakgrunnskartet (hybrid) og
  // det gebrekkelege OSM-laget blir skjult. "osm" teiknar OSM-vatnet uansett.
  const natWaterUrl = PRESETS[country].waterRaster;
  const wantNational = ui.watersrc.value === "national";
  const useNational = wantNational && !!natWaterUrl; // berre Noreg får eige vatn-raster
  // Skjul OSM-vatnet berre der eit nasjonalt vatn-raster tek over (Noreg). For
  // Sverige/Finland held vi OSM-vatnet synleg på skjermen (blått vatn i reint
  // skuggerelieff), og eksporten legg det nøyaktige nasjonale vatnet oppå.
  const hideOsmWater = useNational;

  // dynamiske kjeldeoppgjevingar så info-ikonet på skjermen viser rett kjelde
  // (MapLibre viser unionen av dei SYNLEGE laga sine kjelder, deduplisert)
  const sources = {
    omt: { type: "vector", url: URLS.omt, attribution: "© OpenStreetMap" },
    dem: {
      type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 15,
      tiles: [URLS.terrarium], attribution: "høgdedata: EU-DEM © Copernicus",
    },
    // tileSize 256 medan WMS-en teiknar 512 px = 2× superprøvetaking (retina),
    // slik at skuggerelieffet blir like skarpt som på hoydedata.no / minkarta
    kvshade: {
      type: "raster", tileSize: 256, maxzoom: 18,
      tiles: [ui.shadesrc.value === "dtm" ? URLS.kvShadeDtm : URLS.kvShadeFjell],
      attribution: "© Kartverket",
    },
    seshade: { type: "raster", tileSize: 256, maxzoom: 18, tiles: [URLS.seShade], attribution: "© Lantmäteriet" },
    topo: { type: "raster", tileSize: 256, maxzoom: topoMaxzoom, tiles: topoTiles, attribution: topoCredit().name },
  };
  if (fiDem) {
    // 1024-px fliser på 256-px rutenett = 4× superprøvetaking, som NO/SE
    sources.fishade = {
      type: "raster", tileSize: 256, minzoom: FI_DEM.minzoom, maxzoom: FI_DEM.maxzoom,
      // detaljnivå og skuggestyrke ligg i URL-en, så endring gjev nye fliser
      tiles: ["mmldem://{z}/{x}/{y}?q=" + ui.fidetail.value + "&zf=" + (+ui.fistrength.value || FI_DEM.zFactor)],
      attribution: "© Maanmittauslaitos",
    };
  }
  if (useNational) {
    sources.natwater = { type: "raster", tileSize: 256, maxzoom: 18, tiles: [natWaterUrl], attribution: "© Kartverket" };
  }

  const style = {
    version: 8,
    glyphs: URLS.glyphs,
    sources,
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#ffffff" } },
      {
        id: "shade-dem", type: "hillshade", source: "dem",
        // global DEM: Finland utan nøkkel, elles berre som oversikt under z6.5 (MML-flisene tek over)
        layout: { visibility: country === "fi" ? "visible" : "none" },
        ...(fiDem ? { maxzoom: 6.5 } : {}),
        paint: {
          // første versjon (brukaren ville ha denne attende for Finland)
          "hillshade-exaggeration": 0.55 + Math.max(0, contrast) * 0.5,
          "hillshade-shadow-color": "#473b24",
          "hillshade-highlight-color": "#ffffff",
          "hillshade-accent-color": "#666666",
        },
      },
      {
        id: "shade-kv", type: "raster", source: "kvshade",
        layout: { visibility: country === "no" ? "visible" : "none" },
        paint: { "raster-contrast": contrast, "raster-fade-duration": 0 },
      },
      {
        id: "shade-se", type: "raster", source: "seshade",
        layout: { visibility: country === "se" ? "visible" : "none" },
        paint: { "raster-contrast": contrast, "raster-fade-duration": 0 },
      },
      ...(fiDem
        ? [{
            id: "shade-fi", type: "raster", source: "fishade",
            paint: { "raster-contrast": contrast, "raster-fade-duration": 0 },
          }]
        : []),
      {
        id: "topo", type: "raster", source: "topo",
        layout: { visibility: blend > 0 ? "visible" : "none" },
        paint: { "raster-opacity": blend, "raster-fade-duration": 0 },
      },
      // OpenStreetMap-vatn (vektor, justerbar farge) – når nasjonalt ikkje er i bruk
      {
        id: "water", type: "fill", source: "omt", "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        layout: { visibility: hideOsmWater ? "none" : "visible" },
        paint: { "fill-color": waterColor, "fill-antialias": true },
      },
      {
        id: "water-outline", type: "line", source: "omt", "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        layout: { visibility: hideOsmWater ? "none" : "visible" },
        paint: {
          "line-color": ui.wateroutline.value,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 12, 1, 16, 1.8],
        },
      },
      {
        id: "waterway", type: "line", source: "omt", "source-layer": "waterway",
        layout: { visibility: !hideOsmWater && ui.waterways.checked ? "visible" : "none" },
        paint: {
          "line-color": waterColor,
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 8, 0.6, 12, 1.6, 16, 5],
        },
      },
      {
        id: "water-name", type: "symbol", source: "omt", "source-layer": "water_name",
        layout: {
          visibility: ui.waterlabels.checked ? "visible" : "none",
          "text-field": ["coalesce", ["get", "name:nn"], ["get", "name:no"], ["get", "name:latin"], ["get", "name"]],
          "text-font": ["Noto Sans Italic"],
          "text-size": 13,
          "symbol-placement": "point",
        },
        paint: {
          "text-color": "#1d6b9e",
          "text-halo-color": "rgba(255,255,255,0.75)",
          "text-halo-width": 1.2,
        },
      },
    ],
  };
  // nasjonalt vatn-raster (nøyaktige linjer) rett over kart/relieff, under vassnamna
  if (useNational) {
    const i = style.layers.findIndex((l) => l.id === "water");
    style.layers.splice(i, 0, {
      id: "natwater", type: "raster", source: "natwater",
      paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
    });
  }
  return style;
}

/* -------------------------------------------- finsk høgdemodell (MML 2 m) */
// Med MML-nøkkel hentar vi Maanmittauslaitos sin 2 m-høgdemodell (korkeusmalli_2m)
// frå WCS-tenesta og reknar skuggerelieffet sjølve, flis for flis, i Web Workers.
// Høgdene blir henta i det finske rutenettet (ETRS-TM35FIN, EPSG:3067) og
// reprojiserte bikubisk til Web Mercator-flisa på klientsida – tenaren sin eigen
// reprojeksjon (nærast nabo på eit rotert rutenett) gav eit synleg gittermønster
// i relieffet. Utanfor Finland (over grensa) fyller vi inn frå den globale DEM-en.
const FI_DEM = {
  wcs: "https://avoin-karttakuva.maanmittauslaitos.fi/ortokuvat-ja-korkeusmallit/wcs/v2",
  coverage: "korkeusmalli_2m",
  // dekningsomriss for korkeusmalli_2m (EPSG:3067); kantane ligg på 2 m-rutenettet
  env: { e0: 44000, n0: 6594000, e1: 740000, n1: 7782000 },
  outSize: 1024, // 4× superprøvetaking per 256-px flis (same som NO/SE-WMS-ane)
  // to detaljnivå (veljaren «Høgdemodell Finland» i panelet):
  //   max:  kjelde ned til 2 m (tak 1800 px per side, ≈2–9 MB per flis); skuggen blir rekna
  //         på eit 2048-px rutenett og nedskalert til 1024 – måla skarpare enn Kartverket
  //   fast: kjeldeoppløysing ≈ 2 × utpiksel (0,2–1,5 MB per flis), skugge rett på 1024
  quality: {
    max: { srcFactor: 0, maxSrcPx: 1800, shadeScale: 2 },
    fast: { srcFactor: 2, maxSrcPx: 640, shadeScale: 1 },
  },
  minzoom: 7,
  maxzoom: 14, // 2 m-data er fullt utnytta ved z14; over det blir flisene forstørra
  // lys og tone: flat grunntone 255·sin(42°) ≈ 170, som Kartverket/Lantmäteriet
  azimuth: 315,
  altitude: 42,
  zFactor: 1, // standard skuggestyrke; glidaren «Skuggestyrke Finland» overstyrer per figur (0,5 ≈ Kartverket-mjukt, 1,5–2 = markant)
  nodataLimit: -50, // under dette = manglar (reine -9999 og «average»-blanda kantblokker)
  geotiff: "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js",
  cacheSize: 48, // rå WCS-svar (≈0,2–1,5 MB kvar) – eksporten får då flisene gratis
};

// ETRS-TM35FIN (EPSG:3067): lengd/breidd i grader -> [E, N] i meter (Krüger-rekkje)
function tm35(lon, lat) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, lon0 = 27, FE = 500000;
  const n = f / (2 - f), A = (a / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64);
  const al = [0, n / 2 - (2 * n * n) / 3 + (5 * n ** 3) / 16, (13 * n * n) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240];
  const e = Math.sqrt(f * (2 - f));
  const phi = (lat * Math.PI) / 180, lam = ((lon - lon0) * Math.PI) / 180;
  const sp = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sp) - e * Math.atanh(e * sp));
  const xi0 = Math.atan2(t, Math.cos(lam)), eta0 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xi0, eta = eta0;
  for (let j = 1; j <= 3; j++) {
    xi += al[j] * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0);
    eta += al[j] * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0);
  }
  return [FE + k0 * A * eta, k0 * A * xi];
}

// Web Mercator-flis z/x/y -> utsnitt i 3857, midtbreidd, kjeldeoppløysing og
// WCS-utsnitt i 3067 (snappa til rutenettet, så «average»-nedskaleringa blir heile blokker)
function fiTileSpec(z, x, y, q) {
  const Q = FI_DEM.quality[q] || FI_DEM.quality.max;
  const R = 6378137, W = Math.PI * R, n = 2 ** z;
  const X0 = -W + (2 * W * x) / n, X1 = -W + (2 * W * (x + 1)) / n;
  const Y1 = W - (2 * W * y) / n, Y0 = W - (2 * W * (y + 1)) / n;
  const lat = 2 * Math.atan(Math.exp((Y0 + Y1) / 2 / R)) - Math.PI / 2; // radianar
  const outPx = ((X1 - X0) / FI_DEM.outSize) * Math.cos(lat); // meter på bakken per utpiksel
  let res = 2;
  while (res < outPx * Q.srcFactor && res < 4096) res *= 2;
  // omriss av flisa i 3067 (langs kantane, ikkje berre hjørna)
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  const toLL = (px, py) => [(px / R) * (180 / Math.PI), ((2 * Math.atan(Math.exp(py / R)) - Math.PI / 2) * 180) / Math.PI];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    for (const [px, py] of [[X0 + (X1 - X0) * t, Y0], [X0 + (X1 - X0) * t, Y1], [X0, Y0 + (Y1 - Y0) * t], [X1, Y0 + (Y1 - Y0) * t]]) {
      const [E, N] = tm35(...toLL(px, py));
      if (E < e0) e0 = E;
      if (E > e1) e1 = E;
      if (N < n0) n0 = N;
      if (N > n1) n1 = N;
    }
  }
  // tak på storleiken på førespurnaden (oversiktsfliser dekkjer store område)
  while (Math.max(e1 - e0, n1 - n0) / res > Q.maxSrcPx) res *= 2;
  const m = 4 * res, env = FI_DEM.env;
  const snapDn = (v, o) => o + Math.floor((v - o) / res) * res;
  const snapUp = (v, o) => o + Math.ceil((v - o) / res) * res;
  e0 = Math.max(env.e0, snapDn(e0 - m, env.e0));
  e1 = Math.min(env.e1, snapUp(e1 + m, env.e0));
  n0 = Math.max(env.n0, snapDn(n0 - m, env.n1));
  n1 = Math.min(env.n1, snapUp(n1 + m, env.n1));
  return { z, x, y, X0, Y0, X1, Y1, lat, res, e0, n0, e1, n1, shadeScale: Q.shadeScale, inside: e1 > e0 && n1 > n0 };
}

function fiWcsUrl(s, key) {
  const scale = s.res > 2 ? `&SCALEFACTOR=${2 / s.res}&interpolation=average` : "";
  return (
    `${FI_DEM.wcs}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${FI_DEM.coverage}` +
    `&subset=E(${s.e0},${s.e1})&subset=N(${s.n0},${s.n1})${scale}` +
    `&format=image/tiff&geotiff:compression=DEFLATE&api-key=${encodeURIComponent(key)}`
  );
}

// Køyrer i Web Worker (blir serialisert med toString – ingen referansar til ytre kode
// utanom tm35 og self.FI, som blir lagde inn i worker-kjelda)
function fiWorkerMain() {
  const C = self.FI;
  importScripts(C.geotiff);
  const R = 6378137;

  self.onmessage = async (ev) => {
    const j = ev.data;
    try {
      const out = await render(j);
      self.postMessage({ id: j.id, rgba: out.rgba, fallback: out.fallback }, [out.rgba.buffer]);
    } catch (err) {
      self.postMessage({ id: j.id, error: String((err && err.message) || err) });
    }
  };

  // bikubisk vekt (Catmull-Rom)
  function cw(t) {
    t = Math.abs(t);
    return t < 1 ? 1.5 * t * t * t - 2.5 * t * t + 1 : t < 2 ? -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2 : 0;
  }

  // separabel boksglatting (radius rad) med kantklemming
  function boxBlur(a, N, rad) {
    const tmp = new Float32Array(N * N), k = 2 * rad + 1;
    for (let r = 0; r < N; r++) {
      let s = 0;
      for (let c = -rad; c <= rad; c++) s += a[r * N + Math.min(N - 1, Math.max(0, c))];
      for (let c = 0; c < N; c++) {
        tmp[r * N + c] = s / k;
        s += a[r * N + Math.min(N - 1, c + rad + 1)] - a[r * N + Math.max(0, c - rad)];
      }
    }
    for (let c = 0; c < N; c++) {
      let s = 0;
      for (let r = -rad; r <= rad; r++) s += tmp[Math.min(N - 1, Math.max(0, r)) * N + c];
      for (let r = 0; r < N; r++) {
        a[r * N + c] = s / k;
        s += tmp[Math.min(N - 1, r + rad + 1) * N + c] - tmp[Math.max(0, r - rad) * N + c];
      }
    }
  }

  // global høgdemodell (terrarium-PNG) bikubisk oppsampla til utrutenettet
  async function terrarium(j, N, M) {
    const zt = Math.min(j.z, 15), d = j.z - zt;
    const xt = j.x >> d, yt = j.y >> d;
    const url = C.terrarium.replace("{z}", zt).replace("{x}", xt).replace("{y}", yt);
    let bmp;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      bmp = await createImageBitmap(await resp.blob());
    } catch {
      return null;
    }
    const cv = new OffscreenCanvas(256, 256), ctx = cv.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const d8 = ctx.getImageData(0, 0, 256, 256).data;
    const h = new Float32Array(256 * 256);
    for (let i = 0; i < 256 * 256; i++) h[i] = d8[i * 4] * 256 + d8[i * 4 + 1] + d8[i * 4 + 2] / 256 - 32768;
    // kvar flisa vår ligg inne i (den eventuelt grovare) terrarium-flisa
    const sub = 256 / (1 << d), ox = (j.x - (xt << d)) * sub, oy = (j.y - (yt << d)) * sub;
    const S = N - 2 * M, scale = sub / S; // terrarium-px per utpiksel
    const out = new Float32Array(N * N);
    for (let r = 0; r < N; r++) {
      const row = oy + (r - M + 0.5) * scale - 0.5, r0 = Math.floor(row), fy = row - r0;
      for (let c = 0; c < N; c++) {
        const col = ox + (c - M + 0.5) * scale - 0.5, c0 = Math.floor(col), fx = col - c0;
        let v = 0;
        for (let dr = -1; dr <= 2; dr++) {
          const wy = cw(fy - dr), rr = Math.min(255, Math.max(0, r0 + dr)) * 256;
          for (let dc = -1; dc <= 2; dc++) {
            v += wy * cw(fx - dc) * h[rr + Math.min(255, Math.max(0, c0 + dc))];
          }
        }
        out[r * N + c] = v;
      }
    }
    return out;
  }

  async function render(j) {
    // skuggen blir rekna på eit k× finare rutenett (F) og nedskalert til S – skarpare kantar
    const S = C.outSize, k = j.shadeScale || 1, F = S * k, M = 1, N = F + 2 * M; // 1 px kant for gradientane
    const px = (j.X1 - j.X0) / F;
    const z = new Float32Array(N * N);
    z.fill(NaN);

    if (j.tiff) {
      const tiff = await GeoTIFF.fromArrayBuffer(j.tiff);
      const img = await tiff.getImage();
      const W = img.getWidth(), H = img.getHeight();
      const [E0, N0] = img.getOrigin();
      const [dE, dNr] = img.getResolution(), dN = Math.abs(dNr);
      const dem = (await img.readRasters())[0];
      // manglande data (+1 px utviding: «average» smittar kantblokkene) -> NaN
      const bad = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) if (!(dem[i] > C.nodataLimit)) bad[i] = 1;
      const bad2 = new Uint8Array(W * H);
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          let b = 0;
          for (let dr = -1; dr <= 1 && !b; dr++) {
            const rr = r + dr;
            if (rr < 0 || rr >= H) continue;
            for (let dc = -1; dc <= 1; dc++) {
              const cc = c + dc;
              if (cc >= 0 && cc < W && bad[rr * W + cc]) { b = 1; break; }
            }
          }
          bad2[r * W + c] = b;
        }
      }
      for (let i = 0; i < W * H; i++) if (bad2[i]) dem[i] = NaN;

      // reprojeksjon: eksakt TM35-transform på eit grovt rutenett (kvar 32. px),
      // bilineært imellom (feil < 1 mm), så bikubisk oppslag i høgdemodellen
      const G = 32, ng = Math.floor(N / G) + 2;
      const Eg = new Float64Array(ng * ng), Ng = new Float64Array(ng * ng);
      for (let gj = 0; gj < ng; gj++) {
        for (let gi = 0; gi < ng; gi++) {
          const xm = j.X0 + (gi * G - M + 0.5) * px, ym = j.Y1 - (gj * G - M + 0.5) * px;
          const lon = ((xm / R) * 180) / Math.PI, lat = ((2 * Math.atan(Math.exp(ym / R)) - Math.PI / 2) * 180) / Math.PI;
          const EN = tm35(lon, lat);
          Eg[gj * ng + gi] = EN[0];
          Ng[gj * ng + gi] = EN[1];
        }
      }
      const env = C.env;
      for (let r = 0; r < N; r++) {
        const gj = Math.floor(r / G), fr = r / G - gj;
        for (let c = 0; c < N; c++) {
          const gi = Math.floor(c / G), fc = c / G - gi, k = gj * ng + gi;
          const E = Eg[k] * (1 - fr) * (1 - fc) + Eg[k + 1] * (1 - fr) * fc + Eg[k + ng] * fr * (1 - fc) + Eg[k + ng + 1] * fr * fc;
          const Nn = Ng[k] * (1 - fr) * (1 - fc) + Ng[k + 1] * (1 - fr) * fc + Ng[k + ng] * fr * (1 - fc) + Ng[k + ng + 1] * fr * fc;
          if (E < env.e0 || E > env.e1 || Nn < env.n0 || Nn > env.n1) continue; // utanfor dekninga
          const col = (E - E0) / dE - 0.5, row = (N0 - Nn) / dN - 0.5;
          const c0 = Math.floor(col), r0 = Math.floor(row);
          if (c0 < 1 || r0 < 1 || c0 + 2 >= W || r0 + 2 >= H) continue;
          const fx = col - c0, fy = row - r0;
          const wx0 = cw(fx + 1), wx1 = cw(fx), wx2 = cw(1 - fx), wx3 = cw(2 - fx);
          let v = 0;
          for (let dr = -1; dr <= 2; dr++) {
            const base = (r0 + dr) * W + c0;
            v += cw(fy - dr) * (wx0 * dem[base - 1] + wx1 * dem[base] + wx2 * dem[base + 1] + wx3 * dem[base + 2]);
          }
          z[r * N + c] = v; // NaN om nokon av dei 16 nabocellene manglar
        }
      }
    }

    // hol (utanfor Finland / manglande data): fyll frå global høgdemodell med mjuk overgang
    let fallback = false, missing = 0;
    for (let i = 0; i < N * N; i++) if (z[i] !== z[i]) missing++;
    if (missing > 0) {
      fallback = true;
      const terr = await terrarium(j, N, M);
      if (!terr) {
        for (let i = 0; i < N * N; i++) if (z[i] !== z[i]) z[i] = 0; // siste utveg: flatt
      } else if (missing === N * N) {
        z.set(terr);
      } else {
        // glatta gyldigmaske -> mjuk overgang over grensa (33 px ≈ 50–100 m på bakken),
        // elles teiknar høgdeskilnaden mellom dei to modellane seg som ei linje langs grensa
        const w = new Float32Array(N * N);
        for (let i = 0; i < N * N; i++) w[i] = z[i] === z[i] ? 1 : 0;
        boxBlur(w, N, 16 * k);
        for (let i = 0; i < N * N; i++) {
          const t = terr[i], v = z[i] === z[i] ? z[i] : t;
          z[i] = t + w[i] * (v - t);
        }
      }
    }

    // Horn-skuggerelieff: p = dz/daust, q = dz/dnord (radene går sørover -> forteikn)
    const cell = px * Math.cos(j.lat), zf = j.zFactor > 0 ? j.zFactor : C.zFactor;
    const zen = ((90 - C.altitude) * Math.PI) / 180, az = (C.azimuth * Math.PI) / 180;
    const Lx = Math.sin(zen) * Math.sin(az), Ly = Math.sin(zen) * Math.cos(az), Lz = Math.cos(zen);
    const sh = new Float32Array(F * F);
    for (let r = 0; r < F; r++) {
      for (let c = 0; c < F; c++) {
        const i = (r + M) * N + (c + M);
        const p = (((z[i - N + 1] + 2 * z[i + 1] + z[i + N + 1]) - (z[i - N - 1] + 2 * z[i - 1] + z[i + N - 1])) / (8 * cell)) * zf;
        const q = (-((z[i + N - 1] + 2 * z[i + N] + z[i + N + 1]) - (z[i - N - 1] + 2 * z[i - N] + z[i - N + 1])) / (8 * cell)) * zf;
        const s = (-p * Lx - q * Ly + Lz) / Math.sqrt(1 + p * p + q * q);
        sh[r * F + c] = s > 0 ? s : 0;
      }
    }
    // nedskalering k×k (arealmiddel av den ferdige skuggen) til utflisa
    const rgba = new Uint8ClampedArray(S * S * 4), kk = k * k;
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        let s = 0;
        for (let dr = 0; dr < k; dr++) for (let dc = 0; dc < k; dc++) s += sh[(r * k + dr) * F + c * k + dc];
        const g = Math.round((255 * s) / kk), o = (r * S + c) * 4;
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = 255;
      }
    }
    return { rgba, fallback };
  }
}

const fiState = { workers: [], next: 0, pending: new Map(), seq: 0, cache: new Map(), fallbackTiles: new Set(), active: 0 };

function fiWorkers() {
  if (fiState.workers.length) return fiState.workers;
  const consts = Object.assign({ terrarium: URLS.terrarium }, FI_DEM);
  const src = `self.FI=${JSON.stringify(consts)};\n${tm35.toString()}\n(${fiWorkerMain.toString()})();`;
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  for (let i = 0; i < n; i++) {
    const w = new Worker(url);
    w.onmessage = (ev) => {
      const p = fiState.pending.get(ev.data.id);
      if (!p) return;
      fiState.pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data);
    };
    w.onerror = (e) => console.warn("MML-DEM-worker:", e.message);
    fiState.workers.push(w);
  }
  return fiState.workers;
}

function fiRender(job) {
  const ws = fiWorkers();
  const w = ws[fiState.next++ % ws.length];
  return new Promise((resolve, reject) => {
    job.id = ++fiState.seq;
    fiState.pending.set(job.id, { resolve, reject });
    w.postMessage(job, job.tiff ? [job.tiff] : []);
  });
}

// rått WCS-svar (GeoTIFF) med LRU-mellomlager, uavhengig av nøkkelen
async function fiFetchDem(spec, key, signal) {
  const ck = `${spec.e0},${spec.n0},${spec.e1},${spec.n1},${spec.res}`;
  const hit = fiState.cache.get(ck);
  if (hit) {
    fiState.cache.delete(ck);
    fiState.cache.set(ck, hit); // flytt fremst
    return hit;
  }
  const resp = await fetch(fiWcsUrl(spec, key), { signal });
  const buf = await resp.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  const isTiff = b.length === 2 && ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d));
  if (!resp.ok || !isTiff) throw new Error(`MML WCS svarte ${resp.status}${isTiff ? "" : " (ikkje TIFF)"}`);
  fiState.cache.set(ck, buf);
  while (fiState.cache.size > FI_DEM.cacheSize) fiState.cache.delete(fiState.cache.keys().next().value);
  return buf;
}

maplibregl.addProtocol("mmldem", async (params, abort) => {
  const m = /^mmldem:\/\/(\d+)\/(\d+)\/(\d+)(?:\?(.*))?$/.exec(params.url);
  if (!m) throw new Error("ugyldig mmldem-URL: " + params.url);
  const qs = new URLSearchParams(m[4] || "");
  const spec = fiTileSpec(+m[1], +m[2], +m[3], qs.get("q") || ui.fidetail.value);
  const zFactor = +qs.get("zf") || +ui.fistrength.value || FI_DEM.zFactor;
  const key = ui.mmlkey.value.trim();
  const signal = abort && abort.signal;
  fiState.active++; // for framdriftsmeldinga i eksporten
  try {
    let tiff = null;
    if (spec.inside && key) {
      try {
        tiff = (await fiFetchDem(spec, key, signal)).slice(0); // kopi – workeren får eigarskapen
      } catch (err) {
        if (signal && signal.aborted) throw new Error("AbortError");
        console.warn("MML-høgdemodell feila, brukar global DEM:", err.message);
      }
    }
    if (signal && signal.aborted) throw new Error("AbortError");
    const res = await fiRender(Object.assign({ tiff, zFactor }, spec));
    const tileKey = `${spec.z}/${spec.x}/${spec.y}`;
    if (res.fallback) fiState.fallbackTiles.add(tileKey);
    else fiState.fallbackTiles.delete(tileKey);
    const bmp = await createImageBitmap(new ImageData(res.rgba, FI_DEM.outSize, FI_DEM.outSize));
    return { data: bmp };
  } finally {
    fiState.active--;
  }
});

// har nokon av dei synlege finske relieff-flisene i eit kart brukt den globale DEM-en?
function fiFallbackVisible(m) {
  try {
    const sc = m.style && m.style.sourceCaches && m.style.sourceCaches.fishade;
    if (!sc) return false;
    for (const id of sc.getVisibleCoordinates()) {
      const c = id.canonical;
      if (fiState.fallbackTiles.has(`${c.z}/${c.x}/${c.y}`)) return true;
    }
  } catch (err) {
    console.warn("fiFallbackVisible:", err && err.message);
  }
  return false;
}

/* ------------------------------------------------------------------- kart */

const map = new maplibregl.Map({
  container: "map",
  style: buildStyle(),
  center: [23.04, 69.005],
  zoom: 11.5,
  hash: false,
  fadeDuration: 0,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: "metric" }), "bottom-left");
map.on("error", (e) => console.warn("Kartfeil:", e && e.error && e.error.message));

function refreshStyle() {
  map.setStyle(buildStyle(), { diff: true });
}

/* -------------------------------------------------------------- rotasjon */

function setBearing(deg, fromMap = false) {
  let b = ((deg % 360) + 360) % 360;
  ui.bearing.value = Math.round(b);
  ui.bearingnum.value = Math.round(b);
  if (!fromMap) map.setBearing(b);
}
ui.bearing.addEventListener("input", () => setBearing(+ui.bearing.value));
ui.bearingnum.addEventListener("change", () => setBearing(+ui.bearingnum.value || 0));
ui.bearingreset.addEventListener("click", () => map.easeTo({ bearing: 0, duration: 300 }));
map.on("rotate", () => setBearing(map.getBearing(), true));

/* ------------------------------------------------------------------ markør */

function markerSVG(type) {
  const size = +ui.markersize.value;
  const w = +ui.markerwidth.value;
  const c = ui.markercolor.value;
  const h = size / 2, halo = w + 4;
  let inner = "";
  if (type === "cross") {
    const a = h * 0.72;
    inner =
      line(-a, -a, a, a, "#ffffff", halo, 0.85) + line(-a, a, a, -a, "#ffffff", halo, 0.85) +
      line(-a, -a, a, a, c, w, 1) + line(-a, a, a, -a, c, w, 1);
  } else if (type === "dot") {
    inner =
      `<circle cx="0" cy="0" r="${h * 0.62 + 2}" fill="#ffffff" fill-opacity="0.85"/>` +
      `<circle cx="0" cy="0" r="${h * 0.62}" fill="${c}"/>`;
  } else if (type === "ring") {
    inner =
      `<circle cx="0" cy="0" r="${h * 0.7}" fill="none" stroke="#ffffff" stroke-width="${halo}" stroke-opacity="0.85"/>` +
      `<circle cx="0" cy="0" r="${h * 0.7}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
  }
  function line(x1, y1, x2, y2, col, sw, op) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${sw}" stroke-opacity="${op}" stroke-linecap="round"/>`;
  }
  return `<svg class="place-marker" width="${size + 8}" height="${size + 8}" viewBox="${-(h + 4)} ${-(h + 4)} ${size + 8} ${size + 8}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function refreshMarkers() {
  for (const m of markerObjs) m.remove();
  markerObjs = [];
  if (ui.showmarkers.checked) {
    markerItems.forEach((item, i) => {
      const el = document.createElement("div");
      el.innerHTML = markerSVG(item.type);
      const m = new maplibregl.Marker({ element: el.firstChild, anchor: "center", draggable: true })
        .setLngLat(item.pos)
        .addTo(map);
      m.on("dragend", () => {
        const p = m.getLngLat();
        markerItems[i].pos = [p.lng, p.lat];
        renderMarkerList();
      });
      markerObjs.push(m);
    });
  }
  renderMarkerList();
}

const MARKER_SYMBOL = { cross: "×", dot: "●", ring: "○" };

function renderMarkerList() {
  const list = $("markerlist");
  list.innerHTML = "";
  if (!markerItems.length) {
    list.innerHTML = '<div class="empty">Ingen markørar.</div>';
    return;
  }
  markerItems.forEach((item, i) => {
    const div = document.createElement("div");
    div.className = "fig";
    const nm = document.createElement("span");
    nm.className = "name";
    nm.textContent = `${i + 1}: ${item.pos[1].toFixed(5)}, ${item.pos[0].toFixed(5)}`;
    nm.title = "Sentrer kartet på markøren";
    nm.addEventListener("click", () => map.jumpTo({ center: item.pos }));
    const typeSel = document.createElement("select");
    typeSel.title = "Type for denne markøren";
    for (const [val, sym] of Object.entries(MARKER_SYMBOL)) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = sym;
      typeSel.appendChild(opt);
    }
    typeSel.value = item.type;
    typeSel.addEventListener("change", () => {
      item.type = typeSel.value;
      refreshMarkers();
    });
    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Fjern markøren";
    del.addEventListener("click", () => {
      markerItems.splice(i, 1);
      refreshMarkers();
    });
    div.append(nm, typeSel, del);
    list.appendChild(div);
  });
}

function addMarker(lngLat, updateInput = true) {
  markerItems.push({ pos: [lngLat[0], lngLat[1]], type: ui.markertype.value });
  refreshMarkers();
  if (updateInput) ui.coords.value = `${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}`;
}

$("clearmarkers").addEventListener("click", () => {
  markerItems = [];
  refreshMarkers();
});

map.on("click", (e) => {
  if (ui.clickplace.checked) addMarker([e.lngLat.lng, e.lngLat.lat]);
});

/* -------------------------------------------------------- koordinat-parsar */

function utmToLonLat(zone, easting, northing, northern = true) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = easting - 500000;
  const y = northern ? northing : northing - 10000000;
  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const fp =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sinfp = Math.sin(fp), cosfp = Math.cos(fp), tanfp = Math.tan(fp);
  const c1 = ep2 * cosfp * cosfp, t1 = tanfp * tanfp;
  const r1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinfp * sinfp, 1.5);
  const n1 = a / Math.sqrt(1 - e2 * sinfp * sinfp);
  const d = x / (n1 * k0);
  const lat =
    fp -
    ((n1 * tanfp) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon =
    ((zone * 6 - 183) * Math.PI) / 180 +
    (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / cosfp;
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

function parseCoords(text) {
  text = text.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!text) return null;

  // UTM: "33 512345 7654321", òg med sonebokstav ("33W")
  let m = text.match(/^(\d{1,2})\s*([C-HJ-NP-Xc-hj-np-x])?\s+(\d{5,7}(?:[.,]\d+)?)\s+(\d{6,8}(?:[.,]\d+)?)$/);
  if (m) {
    const zone = +m[1];
    const band = (m[2] || "N").toUpperCase();
    const northern = band >= "N";
    const e = parseFloat(m[3].replace(",", "."));
    const n = parseFloat(m[4].replace(",", "."));
    if (zone >= 1 && zone <= 60) return utmToLonLat(zone, e, n, northern);
  }

  // Desimalgrader: "69.0114, 23.0416" / "69,0114 23,0416" / "N69.01 E23.04"
  m = text.match(/^[NnSs]?\s*(-?\d{1,2}(?:[.,]\d+)?)\s*°?\s*[,;\s]\s*[EeWwØøVv]?\s*(-?\d{1,3}(?:[.,]\d+)?)\s*°?$/);
  if (m) {
    let lat = parseFloat(m[1].replace(",", "."));
    let lon = parseFloat(m[2].replace(",", "."));
    if (/^[Ss]/.test(text)) lat = -Math.abs(lat);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [lon, lat];
  }

  // Grader-minutt(-sekund): "69°00'41.2\"N 23°02'30\"E" o.l.
  const re = /([NnSsEeWwØøVv])?\s*(\d{1,3})\s*°\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:'\s*(\d{1,2}(?:[.,]\d+)?)\s*"?)?\s*([NnSsEeWwØøVv])?/g;
  const parts = [];
  let g;
  while ((g = re.exec(text)) !== null && parts.length < 2) {
    const deg = +g[2];
    const min = parseFloat((g[3] || "0").replace(",", "."));
    const sec = parseFloat((g[4] || "0").replace(",", "."));
    let v = deg + min / 60 + sec / 3600;
    const letter = (g[1] || g[5] || "").toUpperCase();
    if (letter === "S" || letter === "W" || letter === "V") v = -v;
    parts.push({ v, letter });
  }
  if (parts.length === 2) {
    let lat = parts[0], lon = parts[1];
    if (["E", "Ø", "W", "V"].includes(parts[0].letter) || parts[1].letter === "N" || parts[1].letter === "S") {
      lat = parts[1]; lon = parts[0];
    }
    if (Math.abs(lat.v) <= 90 && Math.abs(lon.v) <= 180) return [lon.v, lat.v];
  }
  return null;
}

ui.goto.addEventListener("click", gotoCoords);
ui.coords.addEventListener("keydown", (e) => { if (e.key === "Enter") gotoCoords(); });
function gotoCoords() {
  const p = parseCoords(ui.coords.value);
  if (!p) { alert("Klarte ikkje å tolka koordinatane. Prøv t.d. «69.0114, 23.0416»."); return; }
  addMarker(p, false);
  map.jumpTo({ center: p, zoom: Math.max(map.getZoom(), 12) });
}

/* ---------------------------------------------------------------- stadsøk */

ui.searchbtn.addEventListener("click", doSearch);
ui.search.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
async function doSearch() {
  const q = ui.search.value.trim();
  if (!q) return;
  ui.searchresults.textContent = "Søkjer …";
  try {
    const r = await fetch(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=no,se,fi&q=" + encodeURIComponent(q),
      { headers: { "Accept-Language": "nn,no,sv,fi" } }
    );
    const res = await r.json();
    ui.searchresults.innerHTML = "";
    if (!res.length) { ui.searchresults.textContent = "Ingen treff."; return; }
    for (const hit of res) {
      const div = document.createElement("div");
      div.className = "res";
      div.innerHTML = `${hit.name || hit.display_name.split(",")[0]} <small>${hit.display_name.split(",").slice(1, 3).join(",")}</small>`;
      div.addEventListener("click", () => {
        const p = [+hit.lon, +hit.lat];
        addMarker(p);
        map.jumpTo({ center: p, zoom: 12.5 });
        ui.searchresults.innerHTML = "";
      });
      ui.searchresults.appendChild(div);
    }
  } catch {
    ui.searchresults.textContent = "Søket feila (nettverk?).";
  }
}

/* --------------------------------------------------------- UI-hendingar */

ui.blend.addEventListener("input", () => {
  ui.blendval.innerHTML = ui.blend.value + "&nbsp;%";
  const b = +ui.blend.value / 100;
  if (map.getLayer("topo")) {
    map.setLayoutProperty("topo", "visibility", b > 0 ? "visible" : "none");
    map.setPaintProperty("topo", "raster-opacity", b);
  }
  updateMmlStatus();
});
ui.contrast.addEventListener("input", () => {
  ui.contrastval.textContent = ui.contrast.value;
  const c = +ui.contrast.value / 100;
  if (map.getLayer("shade-kv")) map.setPaintProperty("shade-kv", "raster-contrast", c);
  if (map.getLayer("shade-se")) map.setPaintProperty("shade-se", "raster-contrast", c);
  if (map.getLayer("shade-fi")) map.setPaintProperty("shade-fi", "raster-contrast", c);
  if (map.getLayer("shade-dem")) map.setPaintProperty("shade-dem", "hillshade-exaggeration", 0.55 + Math.max(0, c) * 0.5);
});
ui.watercolor.addEventListener("input", () => {
  if (map.getLayer("water")) map.setPaintProperty("water", "fill-color", ui.watercolor.value);
  if (map.getLayer("waterway")) map.setPaintProperty("waterway", "line-color", ui.watercolor.value);
});
ui.wateroutline.addEventListener("input", () => {
  if (map.getLayer("water-outline")) map.setPaintProperty("water-outline", "line-color", ui.wateroutline.value);
});
ui.waterreset.addEventListener("click", () => {
  ui.watercolor.value = PRESETS[ui.country.value].water;
  ui.wateroutline.value = PRESETS[ui.country.value].outline;
  ui.watercolor.dispatchEvent(new Event("input"));
  ui.wateroutline.dispatchEvent(new Event("input"));
});
ui.waterlabels.addEventListener("change", () => {
  if (map.getLayer("water-name"))
    map.setLayoutProperty("water-name", "visibility", ui.waterlabels.checked ? "visible" : "none");
});
ui.waterways.addEventListener("change", () => {
  if (map.getLayer("waterway"))
    map.setLayoutProperty("waterway", "visibility", ui.waterways.checked ? "visible" : "none");
});
ui.country.addEventListener("change", () => {
  ui.watercolor.value = PRESETS[ui.country.value].water;
  ui.wateroutline.value = PRESETS[ui.country.value].outline;
  updateWaterUI();
  updateMmlStatus();
  refreshStyle();
});
ui.watersrc.addEventListener("change", () => { updateWaterUI(); refreshStyle(); });

// kjeldeline som speglar NØYAKTIG dei kjeldene som faktisk er i den eksporterte
// figuren, ut frå vala (land, skuggekjelde, bakgrunnskart, hybrid/blend, vasskjelde,
// MML-nøkkel, kart-vatn). Kvar kjelde blir kreditert éin gong (utan duplikat).
function currentAttribution(fiFallback = false) {
  const c = ui.country.value;
  const blend = +ui.blend.value > 0;
  const topo = topoCredit();
  const credits = [];
  const add = (x) => { if (x && !credits.includes(x)) credits.push(x); };

  // 1) skuggerelieff (alltid synleg); over grensa frå Finland kjem høgdene frå global DEM
  add(shadeCredit());
  if (fiFallback) add("høgdedata utanfor Finland: EU-DEM © Copernicus");

  // 2) bakgrunnskart – berre kreditert når det faktisk er synleg (hybrid)
  if (blend) { add(topo.name); if (topo.osm) add("© OpenStreetMap"); }

  // 3) vatn – krediter den faktiske kjelda
  if (ui.watersrc.value !== "national") {
    add("© OpenStreetMap"); // OSM-vektorvatn
  } else if (PRESETS[c].waterRaster) {
    add("© Kartverket"); // Noreg: nasjonalt vatn-raster (allereie kreditert)
  } else {
    // SE/FI national: vatnet blir plukka ut av topo-kartet ved eksport – same kjelde
    add(topo.name); if (topo.osm) add("© OpenStreetMap");
  }

  // 4) vassnamn (etikettar) frå OpenStreetMap
  if (ui.waterlabels.checked) add("© OpenStreetMap");

  return credits.join(" · ");
}

// vis/skjul fargeveljarane og oppdater forklaringa etter vasskjelde
function updateWaterUI() {
  const hasNat = !!PRESETS[ui.country.value].waterRaster; // berre Noreg
  const wantNational = ui.watersrc.value === "national";
  ui.watercolorrow.style.display = wantNational ? "none" : "flex";
  const hint = document.getElementById("watersrchint");
  if (wantNational && hasNat) {
    hint.textContent = "Noreg: vassflater og elvar blir henta frå same nasjonale kart som norgeskart.no – nøyaktige linjer og norgeskart-blått, òg i reint skuggerelieff.";
  } else if (wantNational && !hasNat) {
    hint.textContent = "Sverige/Finland: på skjermen ser du OpenStreetMap-vatn (blått). Ved eksport blir det nøyaktige vatnet frå det nasjonale/hybrid-kartet lagt oppå i full oppløysing – òg på reint skuggerelieff.";
  } else {
    hint.textContent = "Vatnet kjem frå OpenStreetMap – farge og kantlinje kan justerast fritt, men ein del sjøar manglar i Sverige.";
  }
}
for (const el of [ui.markersize, ui.markercolor, ui.markerwidth]) {
  el.addEventListener("input", () => {
    ui.markersizeval.textContent = ui.markersize.value;
    refreshMarkers();
  });
}
ui.showmarkers.addEventListener("change", refreshMarkers);
ui.shadesrc.addEventListener("change", refreshStyle);
ui.fidetail.addEventListener("change", refreshStyle);
// skuggestyrke: vis verdien medan ein dreg, rekn flisene på nytt fyrst når ein slepper
ui.fistrength.addEventListener("input", () => { ui.fistrengthval.textContent = (+ui.fistrength.value).toFixed(2); });
ui.fistrength.addEventListener("change", refreshStyle);
ui.bgmap.addEventListener("change", () => { refreshStyle(); updateMmlStatus(); });
ui.mmlkey.addEventListener("input", () => { saveAdvanced(); refreshStyle(); updateMmlStatus(); });

// fortel brukaren om den finske nøkkelen faktisk er i bruk, og kva som eventuelt manglar
function updateMmlStatus() {
  const key = ui.mmlkey.value.trim();
  const el = ui.mmlstatus;
  if (!key) { el.textContent = ""; el.style.color = ""; return; }
  if (ui.country.value !== "fi") {
    el.textContent = "Nøkkel lagra. Han gjeld berre når «Land» er Finland.";
    el.style.color = "#8a6d1a";
    return;
  }
  let txt = "Finsk høgdemodell 2 m (Maanmittauslaitos) i bruk for skuggerelieffet ✓";
  if (+ui.blend.value > 0) {
    txt += ui.bgmap.value === "opentopo"
      ? " Bakgrunnskartet i hybrid er OpenTopoMap – vel «Nasjonalt» for MML-kartet."
      : " Bakgrunnskart: MML maastokartta ✓";
  }
  el.textContent = txt;
  el.style.color = "#1a7a3a";
}

/* ------------------------------------------------------- format/utsnitt */

function applyAspect() {
  const v = ui.aspect.value;
  const wrap = document.getElementById("mapwrap");
  if (v === "free") {
    ui.mapbox.classList.remove("fixed");
    ui.mapbox.style.width = "100%";
    ui.mapbox.style.height = "100%";
  } else {
    const ar = parseFloat(v); // breidd/høgd
    const W = wrap.clientWidth - 24, H = wrap.clientHeight - 24;
    let w = W, h = w / ar;
    if (h > H) { h = H; w = h * ar; }
    ui.mapbox.classList.add("fixed");
    ui.mapbox.style.width = Math.round(w) + "px";
    ui.mapbox.style.height = Math.round(h) + "px";
  }
  map.resize();
}
ui.aspect.addEventListener("change", applyAspect);
window.addEventListener("resize", applyAspect);

/* ------------------------------------------------ skjul/vis menylinja */

function togglePanel(force) {
  const app = document.getElementById("app");
  const collapsed = force === undefined ? !app.classList.contains("collapsed") : force;
  app.classList.toggle("collapsed", collapsed);
  document.getElementById("togglepanel").textContent = collapsed ? "›" : "‹";
  requestAnimationFrame(() => { applyAspect(); map.resize(); });
}
document.getElementById("togglepanel").addEventListener("click", () => togglePanel());
window.addEventListener("keydown", (e) => {
  const t = e.target.tagName;
  if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
  if (e.key === "m" || e.key === "M") togglePanel();
});

/* ---------------------------------------------------------------- eksport */

function haversine(lon1, lat1, lon2, lat2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function niceScale(mppCSS, maxCSSpx) {
  // same avrunding som MapLibre sin ScaleControl (1/2/3/5 × 10^n),
  // slik at eksportert målestokk viser same tal som den i kartvisinga
  const maxM = mppCSS * maxCSSpx;
  const pow10 = Math.pow(10, Math.floor(Math.log10(maxM)));
  const d = maxM / pow10;
  return pow10 * (d >= 10 ? 10 : d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1);
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [200, 235, 255];
}

function drawNorthArrow(ctx, ratio, canvasW, bearing) {
  // pila peikar mot geografisk nord; kartet er rotert «bearing» grader, så pila roterer -bearing
  const size = 46 * ratio;
  const cx = canvasW - size / 2 - 16 * ratio;
  const cy = size / 2 + 16 * ratio;
  ctx.save();
  // rund bakplate for lesbarheit
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.62, 0, 7);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.fill();
  ctx.translate(cx, cy);
  ctx.rotate((-bearing * Math.PI) / 180);
  const h = size / 2;
  // pilspiss (nord) fylt, hale open
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(h * 0.42, h * 0.55);
  ctx.lineTo(0, h * 0.28);
  ctx.lineTo(-h * 0.42, h * 0.55);
  ctx.closePath();
  ctx.fillStyle = "#333333";
  ctx.fill();
  // høgre halvdel mørk for kompass-preg
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(h * 0.42, h * 0.55);
  ctx.lineTo(0, h * 0.28);
  ctx.closePath();
  ctx.fillStyle = "#111111";
  ctx.fill();
  // «N» over pila
  ctx.rotate((bearing * Math.PI) / 180); // hald bokstaven ståande… nei, N skal følgje nord
  ctx.restore();
  // teikn «N» ved nord-enden, roterande med pila
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-bearing * Math.PI) / 180);
  ctx.translate(0, -h - 7 * ratio);
  ctx.rotate((bearing * Math.PI) / 180); // hald N lesbar
  ctx.font = `bold ${13 * ratio}px "Segoe UI", sans-serif`;
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 3 * ratio;
  ctx.strokeText("N", 0, 0);
  ctx.fillText("N", 0, 0);
  ctx.restore();
}

function drawScalebar(ctx, ratio, cssW, cssH, mppCSS) {
  const d = niceScale(mppCSS, Math.min(140, cssW * 0.3)); // 140 = maxWidth til ScaleControl i kartvisinga
  const barLen = (d / mppCSS) * ratio;
  const x0 = 16 * ratio, barH = 7 * ratio;
  const y0 = cssH * ratio - 20 * ratio;
  const label = d >= 1000 ? (d / 1000).toLocaleString("nn") + " km" : d + " m";
  const font = `${12 * ratio}px "Segoe UI", sans-serif`;

  ctx.save();
  // bakplate
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  const padX = 8 * ratio, padTop = 22 * ratio, padBot = 8 * ratio;
  roundRect(ctx, x0 - padX, y0 - padTop, barLen + padX * 2, barH + padTop + padBot, 4 * ratio);
  ctx.fill();
  // fire vekslande segment
  const seg = barLen / 4;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#111111" : "#ffffff";
    ctx.fillRect(x0 + i * seg, y0, seg, barH);
  }
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 1 * ratio;
  ctx.strokeRect(x0, y0, barLen, barH);
  // tekst
  ctx.font = font;
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText("0", x0, y0 - 4 * ratio);
  ctx.textAlign = "right";
  ctx.fillText(label, x0 + barLen, y0 - 4 * ratio);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawMarkerOnCanvas(ctx, x, y, ratio, type) {
  const size = +ui.markersize.value * ratio;
  const w = +ui.markerwidth.value * ratio;
  const c = ui.markercolor.value;
  const h = size / 2;
  ctx.save();
  ctx.lineCap = "round";
  if (type === "cross") {
    const a = h * 0.72;
    for (const [col, sw, op] of [["#ffffff", w + 4 * ratio, 0.85], [c, w, 1]]) {
      ctx.strokeStyle = col; ctx.lineWidth = sw; ctx.globalAlpha = op;
      ctx.beginPath();
      ctx.moveTo(x - a, y - a); ctx.lineTo(x + a, y + a);
      ctx.moveTo(x - a, y + a); ctx.lineTo(x + a, y - a);
      ctx.stroke();
    }
  } else if (type === "dot") {
    ctx.globalAlpha = 0.85; ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(x, y, h * 0.62 + 2 * ratio, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, h * 0.62, 0, 7); ctx.fill();
  } else if (type === "ring") {
    for (const [col, sw, op] of [["#ffffff", w + 4 * ratio, 0.85], [c, w, 1]]) {
      ctx.strokeStyle = col; ctx.lineWidth = sw; ctx.globalAlpha = op;
      ctx.beginPath(); ctx.arc(x, y, h * 0.7, 0, 7); ctx.stroke();
    }
  }
  ctx.restore();
}

ui.export.addEventListener("click", exportPNG);
async function exportPNG() {
  ui.export.disabled = true;
  ui.exportstatus.textContent = "Lagar figuren … (hentar kartfliser i full oppløysing)";
  const container = document.getElementById("exportcontainer");
  let em = null;
  // i gøymde faner frys nettlesaren requestAnimationFrame, og då stoppar
  // MapLibre-renderinga; fall tilbake til timer-baserte rammer under eksporten
  const rafOrig = window.requestAnimationFrame.bind(window);
  const cafOrig = window.cancelAnimationFrame.bind(window);
  const TIMER_ID_OFFSET = 2 ** 30;
  window.requestAnimationFrame = (cb) =>
    document.hidden ? setTimeout(() => cb(performance.now()), 33) + TIMER_ID_OFFSET : rafOrig(cb);
  window.cancelAnimationFrame = (id) =>
    id >= TIMER_ID_OFFSET ? clearTimeout(id - TIMER_ID_OFFSET) : cafOrig(id);
  try {
    const outW = +ui.exportwidth.value;
    const box = ui.mapbox.getBoundingClientRect();
    const mode = ui.exportratio.value;
    let cssW, ratio;
    if (mode === "screen") {
      // WYSIWYG: same CSS-storleik som førehandsvisinga -> same fliszoom,
      // same tekststorleik i høve til kartet; oppløysinga kjem frå pixelRatio
      cssW = Math.round(box.width);
      ratio = outW / cssW;
    } else {
      ratio = +mode;
      cssW = Math.max(200, Math.round(outW / ratio));
    }
    const cssH = Math.max(200, Math.round((cssW * box.height) / box.width));
    // Eksport-lerretet kan vera breiare enn skjermen (finare kartdetaljar). For at
    // det geografiske utsnittet skal vera NØYAKTIG det same som på skjermen, må
    // zoomen aukast tilsvarande: dobbel breidd = +1 zoom-nivå.
    const zoomAdj = Math.log2(cssW / box.width);
    const exportZoom = map.getZoom() + zoomAdj;

    const div = document.createElement("div");
    div.style.width = cssW + "px";
    div.style.height = cssH + "px";
    container.appendChild(div);

    em = new maplibregl.Map({
      container: div,
      style: buildStyle(),
      center: map.getCenter(),
      zoom: exportZoom,
      bearing: map.getBearing(), // ta med rotasjonen
      pixelRatio: ratio,
      preserveDrawingBuffer: true,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    });

    // finsk høgdemodell i maks detalj kan vera 2–9 MB per flis: romsleg tidsavbrot og framdrift
    const prog = setInterval(() => {
      if (fiState.active > 0) ui.exportstatus.textContent = `Lagar figuren … (hentar finsk høgdemodell, ${fiState.active} fliser att)`;
    }, 500);
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Tidsavbrot ved lasting av kartfliser")), 300000);
        em.once("idle", () => { clearTimeout(t); resolve(); });
        em.once("error", (e) => {
          // ikkje-fatale flisfeil skal ikkje stoppa eksporten
          console.warn("eksport:", e && e.error);
        });
      });
    } finally {
      clearInterval(prog);
    }

    const src = em.getCanvas();
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext("2d");
    ctx.drawImage(src, 0, 0);

    // SE/FI: plukk vatnet ut av det nasjonale/hybrid-kartet i full oppløysing og
    // teikn det som skarpt, heiltdekkjande blått oppå skuggerelieffet
    if (mapWaterMode()) {
      ui.exportstatus.textContent = "Lagar figuren … (hentar vatn frå kartet)";
      const spec = topoSpec();
      const wdiv = document.createElement("div");
      wdiv.style.width = cssW + "px";
      wdiv.style.height = cssH + "px";
      container.appendChild(wdiv);
      const wm = new maplibregl.Map({
        container: wdiv,
        style: {
          version: 8,
          sources: { topo: { type: "raster", tileSize: 256, maxzoom: spec.maxzoom, tiles: spec.tiles } },
          layers: [{ id: "topo", type: "raster", source: "topo", paint: { "raster-fade-duration": 0 } }],
        },
        center: map.getCenter(), zoom: exportZoom, bearing: map.getBearing(),
        pixelRatio: ratio, preserveDrawingBuffer: true, interactive: false,
        attributionControl: false, fadeDuration: 0,
      });
      try {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("Tidsavbrot ved vatn-lag")), 60000);
          wm.once("idle", () => { clearTimeout(t); resolve(); });
        });
        const wc = document.createElement("canvas");
        wc.width = src.width; wc.height = src.height;
        wc.getContext("2d").drawImage(wm.getCanvas(), 0, 0);
        const wd = wc.getContext("2d").getImageData(0, 0, wc.width, wc.height).data;
        const od = ctx.getImageData(0, 0, out.width, out.height);
        const px = od.data;
        const blue = hexToRgb(PRESETS[ui.country.value].water);
        for (let i = 0; i < wd.length; i += 4) {
          const R = wd[i], G = wd[i + 1], B = wd[i + 2], A = wd[i + 3];
          // fargenøkkel: kart-vatn er tydeleg blått (B klart over R, og ikkje mørkt)
          if (A > 80 && B - R > 14 && B > 140 && G >= R - 6) {
            px[i] = blue[0]; px[i + 1] = blue[1]; px[i + 2] = blue[2]; px[i + 3] = 255;
          }
        }
        ctx.putImageData(od, 0, 0);
      } finally {
        wm.remove();
        wdiv.remove();
      }
    }

    if (ui.showmarkers.checked) {
      for (const item of markerItems) {
        const pt = em.project(item.pos);
        drawMarkerOnCanvas(ctx, pt.x * ratio, pt.y * ratio, ratio, item.type);
      }
    }

    if (ui.showscale.checked) {
      // meter per CSS-piksel (rotasjons-uavhengig). MapLibre-zoom er 512-pikslars-basert,
      // så konstanten er jordomkrinsen / 512 = 78271.5 (ikkje 256-varianten 156543).
      const lat = em.getCenter().lat;
      const mppCSS = (78271.5169640 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, em.getZoom());
      drawScalebar(ctx, ratio, cssW, cssH, mppCSS);
    }

    if (ui.shownorth.checked) {
      drawNorthArrow(ctx, ratio, out.width, map.getBearing());
    }

    if (ui.showattrib.checked) {
      const txt = currentAttribution(fiFallbackVisible(em));
      ctx.save();
      ctx.font = `${9 * ratio}px "Segoe UI", sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 2.5 * ratio;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.fillStyle = "#333333";
      ctx.strokeText(txt, out.width - 6 * ratio, out.height - 5 * ratio);
      ctx.fillText(txt, out.width - 6 * ratio, out.height - 5 * ratio);
      ctx.restore();
    }

    const name = (ui.figname.value.trim() || "kartutsnitt").replace(/[^\wæøåÆØÅáčđŋšŧžÁČĐŊŠŦŽ -]+/g, "_");
    await new Promise((resolve) =>
      out.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${name}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        resolve();
      }, "image/png")
    );
    ui.exportstatus.textContent = `Ferdig: ${out.width} × ${out.height} px.`;
  } catch (err) {
    console.error(err);
    ui.exportstatus.textContent = "Eksporten feila: " + err.message;
  } finally {
    window.requestAnimationFrame = rafOrig;
    window.cancelAnimationFrame = cafOrig;
    if (em) em.remove();
    container.innerHTML = "";
    ui.export.disabled = false;
  }
}

/* ---------------------------------------------------------- lagra figurar */

function currentSettings() {
  const c = map.getCenter();
  return {
    name: ui.figname.value.trim(),
    center: [c.lng, c.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    markers: markerItems.map((m) => ({ pos: [m.pos[0], m.pos[1]], type: m.type })),
    showMarkers: ui.showmarkers.checked,
    country: ui.country.value,
    bgMap: ui.bgmap.value,
    shadeSrc: ui.shadesrc.value,
    fiDetail: ui.fidetail.value,
    fiStrength: +ui.fistrength.value,
    blend: +ui.blend.value,
    contrast: +ui.contrast.value,
    waterSrc: ui.watersrc.value,
    waterColor: ui.watercolor.value,
    waterOutline: ui.wateroutline.value,
    waterLabels: ui.waterlabels.checked,
    waterways: ui.waterways.checked,
    showNorth: ui.shownorth.checked,
    markerType: ui.markertype.value,
    markerSize: +ui.markersize.value,
    markerColor: ui.markercolor.value,
    markerWidth: +ui.markerwidth.value,
    aspect: ui.aspect.value,
    exportWidth: +ui.exportwidth.value,
    exportRatio: ui.exportratio.value,
    showScale: ui.showscale.checked,
    showAttrib: ui.showattrib.checked,
  };
}

function applySettings(s) {
  ui.figname.value = s.name || "";
  ui.country.value = s.country || "no";
  ui.bgmap.value = s.bgMap || "national";
  ui.shadesrc.value = s.shadeSrc || "dtm";
  ui.fidetail.value = s.fiDetail || "max";
  ui.fistrength.value = s.fiStrength > 0 ? s.fiStrength : FI_DEM.zFactor;
  ui.fistrengthval.textContent = (+ui.fistrength.value).toFixed(2);
  ui.blend.value = s.blend ?? 0;
  ui.blendval.innerHTML = ui.blend.value + "&nbsp;%";
  ui.contrast.value = s.contrast ?? 0;
  ui.contrastval.textContent = ui.contrast.value;
  ui.watersrc.value = s.waterSrc || "national";
  ui.shownorth.checked = !!s.showNorth;
  ui.watercolor.value = s.waterColor || PRESETS[ui.country.value].water;
  ui.wateroutline.value = s.waterOutline || PRESETS[ui.country.value].outline;
  ui.waterlabels.checked = s.waterLabels !== false;
  ui.waterways.checked = s.waterways !== false;
  ui.markertype.value = s.markerType && s.markerType !== "none" ? s.markerType : "cross";
  ui.markersize.value = s.markerSize ?? 30;
  ui.markersizeval.textContent = ui.markersize.value;
  ui.markercolor.value = s.markerColor || "#d40000";
  ui.markerwidth.value = s.markerWidth ?? 5;
  ui.aspect.value = s.aspect || "free";
  ui.exportwidth.value = s.exportWidth ?? 2400;
  const er = String(s.exportRatio ?? "screen");
  ui.exportratio.value = ["screen", "1", "2"].includes(er) ? er : "screen";
  ui.showscale.checked = s.showScale !== false;
  ui.showattrib.checked = s.showAttrib !== false;
  updateWaterUI();
  applyAspect();
  refreshStyle();
  // normaliser eldre lagra figurar: «marker» (éin) eller «markers» som reine posisjonar
  const raw = s.markers || (s.marker ? [s.marker] : []);
  const fallbackType = s.markerType && s.markerType !== "none" ? s.markerType : "cross";
  markerItems = raw.map((m) =>
    Array.isArray(m) ? { pos: m, type: fallbackType } : { pos: m.pos, type: m.type || fallbackType }
  );
  ui.showmarkers.checked = s.showMarkers !== false && s.markerType !== "none";
  if (markerItems.length) {
    const p = markerItems[0].pos;
    ui.coords.value = `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
  }
  refreshMarkers();
  if (s.center) map.jumpTo({ center: s.center, zoom: s.zoom ?? 12, bearing: s.bearing ?? 0 });
  setBearing(s.bearing ?? 0, true);
}

function loadFigs() {
  try { return JSON.parse(localStorage.getItem(STORE_FIGS)) || []; } catch { return []; }
}
function saveFigs(figs) {
  localStorage.setItem(STORE_FIGS, JSON.stringify(figs));
  renderFigList();
}

function renderFigList() {
  const figs = loadFigs();
  ui.figlist.innerHTML = "";
  if (!figs.length) {
    ui.figlist.innerHTML = '<div class="empty">Ingen lagra figurar enno.</div>';
    return;
  }
  figs.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "fig";
    const nm = document.createElement("span");
    nm.className = "name";
    nm.textContent = f.name || `(utan namn ${i + 1})`;
    nm.title = "Opna figuren";
    nm.addEventListener("click", () => applySettings(f));
    const upd = document.createElement("button");
    upd.textContent = "Oppdater";
    upd.title = "Skriv over med gjeldande innstillingar";
    upd.addEventListener("click", () => {
      const figs2 = loadFigs();
      figs2[i] = { ...currentSettings(), name: f.name };
      saveFigs(figs2);
    });
    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Slett";
    del.addEventListener("click", () => {
      if (!confirm(`Sletta figuren «${f.name}»?`)) return;
      const figs2 = loadFigs();
      figs2.splice(i, 1);
      saveFigs(figs2);
    });
    div.append(nm, upd, del);
    ui.figlist.appendChild(div);
  });
}

ui.savefig.addEventListener("click", () => {
  const s = currentSettings();
  if (!s.name) { alert("Gje figuren eit namn først."); return; }
  const figs = loadFigs();
  const i = figs.findIndex((f) => f.name === s.name);
  if (i >= 0) figs[i] = s; else figs.push(s);
  saveFigs(figs);
});

ui.exportfigs.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(loadFigs(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "skuggerelieff-figurar.json";
  a.click();
});
ui.importfigs.addEventListener("click", () => ui.importfile.click());
ui.importfile.addEventListener("change", async () => {
  const file = ui.importfile.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported)) throw new Error("Fila har feil format");
    const figs = loadFigs();
    for (const f of imported) {
      const i = figs.findIndex((x) => x.name === f.name);
      if (i >= 0) figs[i] = f; else figs.push(f);
    }
    saveFigs(figs);
  } catch (e) {
    alert("Klarte ikkje å importera: " + e.message);
  }
  ui.importfile.value = "";
});

/* ------------------------------------------------------------------ start */

(function init() {
  const adv = advanced();
  if (adv.mmlkey) ui.mmlkey.value = adv.mmlkey;
  renderFigList();
  renderMarkerList();
  updateWaterUI();
  updateMmlStatus();
  applyAspect();
})();
