/**
 * 지도 모듈 - OpenLayers + Vworld + 올가미 + 원 패킹
 */

// ─── 좌표 변환 유틸 ───
const EARTH_RADIUS = 6378137;

function lonLatToMercator(lon, lat) {
  const x = lon * Math.PI / 180 * EARTH_RADIUS;
  const y = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * EARTH_RADIUS;
  return [x, y];
}

function mercatorToLonLat(x, y) {
  const lon = x / EARTH_RADIUS * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * 180 / Math.PI;
  return [lon, lat];
}

// 미터 → EPSG:3857 단위 (적도 기준 1:1이지만 위도 보정 필요)
function metersToMercatorAtLat(meters, lat) {
  return meters / Math.cos(lat * Math.PI / 180);
}

// ─── 올가미(폴리곤) 내부 판정 (ray casting) ───
function pointInPolygon(point, polygon) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ─── 원-폴리곤 교차 판정 ───
function circleIntersectsPolygon(cx, cy, r, polygon) {
  // 중심이 폴리곤 내부면 OK
  if (pointInPolygon([cx, cy], polygon)) return true;
  // 폴리곤 변과의 최소 거리 < r이면 OK
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const dist = pointToSegmentDist(cx, cy, polygon[j][0], polygon[j][1], polygon[i][0], polygon[i][1]);
    if (dist < r) return true;
  }
  return false;
}

function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ─── 폴리곤 바운딩 박스 ───
function polygonBbox(polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// ─── 육각형 패킹으로 500m 원 채우기 ───
function hexagonalCirclePack(polygonCoords3857, radiusMeters = 500) {
  // polygonCoords3857: [[x,y], ...] in EPSG:3857
  const bbox = polygonBbox(polygonCoords3857);

  // 중심 위도 계산 (메르카토르 보정용)
  const centerMerc = [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2];
  const centerLL = mercatorToLonLat(centerMerc[0], centerMerc[1]);
  const lat = centerLL[1];

  // EPSG:3857에서의 반지름
  const r = metersToMercatorAtLat(radiusMeters, lat);
  const d = r * 2;
  const rowHeight = r * Math.sqrt(3); // 육각형 행 간격

  const circles = [];

  let row = 0;
  for (let y = bbox.minY - r; y <= bbox.maxY + r; y += rowHeight, row++) {
    const offsetX = (row % 2 === 1) ? r : 0;
    for (let x = bbox.minX - r + offsetX; x <= bbox.maxX + r; x += d) {
      if (circleIntersectsPolygon(x, y, r * 0.8, polygonCoords3857)) {
        circles.push({ x, y, r, radiusMeters });
      }
    }
  }

  return circles;
}

// ─── 원 그룹 분할 (최대 10개씩) ───
function splitCircleGroups(circles, maxPerGroup = 10) {
  const groups = [];
  for (let i = 0; i < circles.length; i += maxPerGroup) {
    groups.push(circles.slice(i, i + maxPerGroup));
  }
  return groups;
}

// ─── 빈공간(갭) 채우기: 인접 3원 사이 삼각 틈에 적당한 원 배치 ───
function computeGapCircles(mainCircles, polygonCoords3857, radiusMeters, lat) {
  if (mainCircles.length < 3) return [];

  const r = mainCircles[0].r; // mercator 반지름 (주원)
  // 갭 원 크기: 주원과 동일 (500m) → 빈공간을 확실히 덮음 (겹침 OK)
  const gapRadiusMeters = radiusMeters;
  const gapR = metersToMercatorAtLat(gapRadiusMeters, lat);

  // 공간 해시로 빠른 이웃 탐색
  const cellSize = r * 2.5;
  const hash = new Map();
  for (const c of mainCircles) {
    const key = `${Math.floor(c.x / cellSize)},${Math.floor(c.y / cellSize)}`;
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push(c);
  }

  function getNearby(c) {
    const cx = Math.floor(c.x / cellSize), cy = Math.floor(c.y / cellSize);
    const result = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const arr = hash.get(`${cx + dx},${cy + dy}`);
        if (arr) result.push(...arr);
      }
    return result;
  }

  const threshold = r * 2 * 1.15; // 인접 판정 여유
  const gaps = [];
  const seen = new Set();

  for (const a of mainCircles) {
    const nearby = getNearby(a);
    const adj = nearby.filter(b => b !== a && Math.hypot(a.x - b.x, a.y - b.y) < threshold);

    for (let i = 0; i < adj.length; i++) {
      for (let j = i + 1; j < adj.length; j++) {
        if (Math.hypot(adj[i].x - adj[j].x, adj[i].y - adj[j].y) >= threshold) continue;

        const gx = (a.x + adj[i].x + adj[j].x) / 3;
        const gy = (a.y + adj[i].y + adj[j].y) / 3;
        const key = `${Math.round(gx / 100)},${Math.round(gy / 100)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // 갭 원 중심이 폴리곤 안에 있어야 함
        if (pointInPolygon([gx, gy], polygonCoords3857)) {
          gaps.push({ x: gx, y: gy, r: gapR, radiusMeters: gapRadiusMeters, isGap: true });
        }
      }
    }
  }

  return gaps;
}

// ─── 맵 클래스 ───
// ─── 공역 레이어 정의 ───
const AIRSPACE_LAYERS = {
  lt_c_aisulac:    { name: 'UA 초경량비행장치공역', color: [0, 150, 136], order: 1 },
  lt_c_aisctrc:    { name: '관제권',              color: [33, 150, 243], order: 2 },
  lt_c_aisadvc:    { name: '경계구역',            color: [255, 152, 0],  order: 3 },
  lt_c_aisprhc:    { name: '비행금지구역',          color: [244, 67, 54],  order: 4 },
  lt_c_aisresc:    { name: '비행제한구역',          color: [233, 30, 99],  order: 5 },
  lt_c_aisatfc:    { name: '비행장교통구역',        color: [156, 39, 176], order: 6 },
  lt_c_aislapc:    { name: '경량항공기 이착륙장',    color: [63, 81, 181],  order: 7 },
  lt_c_aisdngc:    { name: '위험지역',            color: [255, 87, 34],  order: 8 },
  lt_c_drnpilotzn: { name: '드론시범사업구역',      color: [76, 175, 80],  order: 9 },
  lt_c_aisobsc:    { name: '장애물제한표면',        color: [121, 85, 72],  order: 10 },
  lt_c_drnprecon:  { name: '사전협의구역',          color: [255, 193, 7],  order: 11 },
  lt_c_aistemp:    { name: '임시비행금지구역',      color: [198, 40, 40],  order: 12 },
  lt_c_aisaltc:    { name: '고도제한구역',          color: [96, 125, 139], order: 13 },
};

class DroneMap {
  constructor(targetId) {
    this.map = null;
    this.drawLayer = null;
    this.circleLayer = null;
    this.drawInteraction = null;
    this.polygonCoords = null;  // EPSG:3857
    this.circles = [];
    this.circleGroups = [];
    this.fillGaps = false;
    this.onCirclesChanged = null;

    this._mode = 'none'; // 'none' | 'draw' | 'delete' | 'add'
    this._addRadius = 500; // 수동 추가 시 반지름(미터)

    // 공역 레이어
    this._airspaceLayers = {};   // layerKey → ol.layer.Vector
    this._airspaceVisible = {};  // layerKey → boolean
    this._airspaceCache = {};    // bbox_key → features
    this._airspaceLoading = false;
    this._sessionId = null;

    this._initMap(targetId);
  }

  _initMap(targetId) {
    // Vworld 타일 레이어
    const vworldTile = new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: 'https://api.vworld.kr/req/wmts/1.0.0/11735941-D649-334C-BA39-FB5D72A18BA3/Base/{z}/{y}/{x}.png',
        crossOrigin: 'anonymous',
      }),
    });

    // 그리기 레이어 (올가미 폴리곤)
    const drawSource = new ol.source.Vector();
    this.drawLayer = new ol.layer.Vector({
      source: drawSource,
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({ color: '#58a6ff', width: 2 }),
        fill: new ol.style.Fill({ color: 'rgba(88,166,255,0.1)' }),
      }),
    });

    // 원 레이어
    const circleSource = new ol.source.Vector();
    this.circleLayer = new ol.layer.Vector({
      source: circleSource,
      style: (feature) => {
        const groupIdx = feature.get('groupIndex');
        const colors = [
          'rgba(35,134,54,0.3)', 'rgba(88,166,255,0.3)', 'rgba(218,54,51,0.3)',
          'rgba(158,106,3,0.3)', 'rgba(163,113,247,0.3)', 'rgba(219,171,23,0.3)',
          'rgba(56,189,248,0.3)', 'rgba(251,146,60,0.3)', 'rgba(236,72,153,0.3)',
          'rgba(132,204,22,0.3)',
        ];
        const strokeColors = [
          '#238636', '#58a6ff', '#da3633', '#9e6a03', '#a371f7',
          '#dbab17', '#38bdf8', '#fb923c', '#ec4899', '#84cc16',
        ];
        const ci = (groupIdx || 0) % colors.length;
        const isGap = feature.get('isGap');
        return new ol.style.Style({
          stroke: new ol.style.Stroke({ color: strokeColors[ci], width: isGap ? 1 : 1.5, lineDash: isGap ? [3, 3] : undefined }),
          fill: new ol.style.Fill({ color: isGap ? colors[ci].replace('0.3', '0.5') : colors[ci] }),
        });
      },
    });

    // 맵 생성
    this.map = new ol.Map({
      target: targetId,
      layers: [vworldTile, this.drawLayer, this.circleLayer],
      view: new ol.View({
        center: ol.proj.fromLonLat([127.0, 37.5]), // 서울 근처
        zoom: 11,
        maxZoom: 19,
      }),
    });

    // 지도 클릭: 원 삭제 / 원 추가 모드
    this.map.on('click', (evt) => {
      if (this._mode === 'delete') {
        const feature = this.map.forEachFeatureAtPixel(evt.pixel, f => f, {
          layerFilter: l => l === this.circleLayer,
        });
        if (feature) {
          this._removeCircleByFeature(feature);
        }
      } else if (this._mode === 'add') {
        this._addCircleAt(evt.coordinate);
      }
    });

    // 커서 스타일 변경
    this.map.on('pointermove', (evt) => {
      if (this._mode === 'delete') {
        const hit = this.map.forEachFeatureAtPixel(evt.pixel, () => true, {
          layerFilter: l => l === this.circleLayer,
        });
        this.map.getTargetElement().style.cursor = hit ? 'crosshair' : '';
      } else if (this._mode === 'add') {
        this.map.getTargetElement().style.cursor = 'cell';
      } else {
        this.map.getTargetElement().style.cursor = '';
      }
    });

    // 공역 벡터 레이어 생성
    for (const [key, cfg] of Object.entries(AIRSPACE_LAYERS)) {
      const [r, g, b] = cfg.color;
      const layer = new ol.layer.Vector({
        source: new ol.source.Vector(),
        style: new ol.style.Style({
          stroke: new ol.style.Stroke({ color: `rgba(${r},${g},${b},0.8)`, width: 2 }),
          fill: new ol.style.Fill({ color: `rgba(${r},${g},${b},0.15)` }),
        }),
        visible: false,
        zIndex: 10 + cfg.order,
      });
      this._airspaceLayers[key] = layer;
      this._airspaceVisible[key] = false;
      this.map.addLayer(layer);
    }

  }

  // 올가미 그리기 시작
  startDraw() {
    this.clearAll();
    const source = this.drawLayer.getSource();

    this.drawInteraction = new ol.interaction.Draw({
      source: source,
      type: 'Polygon',
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({ color: '#58a6ff', width: 2, lineDash: [6, 4] }),
        fill: new ol.style.Fill({ color: 'rgba(88,166,255,0.15)' }),
        image: new ol.style.Circle({
          radius: 5,
          fill: new ol.style.Fill({ color: '#58a6ff' }),
        }),
      }),
    });

    this.drawInteraction.on('drawend', (e) => {
      const geom = e.feature.getGeometry();
      const coords = geom.getCoordinates()[0]; // 외곽 링 [[x,y], ...]
      this.polygonCoords = coords;
      this.map.removeInteraction(this.drawInteraction);
      this.drawInteraction = null;
      this._generateCircles();
    });

    this.map.addInteraction(this.drawInteraction);
  }

  // 그리기 취소
  cancelDraw() {
    if (this.drawInteraction) {
      this.map.removeInteraction(this.drawInteraction);
      this.drawInteraction = null;
    }
  }

  // 원 생성
  _generateCircles() {
    if (!this.polygonCoords) return;

    let allCircles = hexagonalCirclePack(this.polygonCoords, 500);

    if (this.fillGaps && allCircles.length >= 3) {
      const bbox = polygonBbox(this.polygonCoords);
      const centerMerc = [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2];
      const lat = mercatorToLonLat(centerMerc[0], centerMerc[1])[1];
      const gapCircles = computeGapCircles(allCircles, this.polygonCoords, 500, lat);
      allCircles = allCircles.concat(gapCircles);
    }

    this.circles = allCircles;
    this.circleGroups = splitCircleGroups(this.circles, 10);

    this._renderCircles();

    if (this.onCirclesChanged) {
      this.onCirclesChanged(this.circles, this.circleGroups);
    }
  }

  // 원 렌더링
  _renderCircles() {
    const source = this.circleLayer.getSource();
    source.clear();

    this.circleGroups.forEach((group, gi) => {
      group.forEach((c) => {
        const circle = new ol.geom.Circle([c.x, c.y], c.r);
        const poly = ol.geom.Polygon.fromCircle(circle, 64);
        const feature = new ol.Feature({ geometry: poly });
        feature.set('groupIndex', gi);
        feature.set('circleData', c);
        feature.set('isGap', c.isGap || false);
        source.addFeature(feature);
      });
    });
  }

  // 전체 초기화
  clearAll() {
    this.cancelDraw();
    this.drawLayer.getSource().clear();
    this.circleLayer.getSource().clear();
    this.polygonCoords = null;
    this.circles = [];
    this.circleGroups = [];
    if (this.onCirclesChanged) {
      this.onCirclesChanged([], []);
    }
  }

  // 특정 좌표로 이동
  flyTo(lon, lat, zoom = 15) {
    this.map.getView().animate({
      center: ol.proj.fromLonLat([lon, lat]),
      zoom,
      duration: 500,
    });
  }

  // 원 중심들의 WGS84 좌표 + EPSG:3857 좌표 반환
  getCircleData() {
    return this.circles.map((c) => {
      const [lon, lat] = mercatorToLonLat(c.x, c.y);
      return {
        x3857: c.x,
        y3857: c.y,
        lon,
        lat,
        radiusMeters: c.radiusMeters,
      };
    });
  }

  getCircleGroups() {
    return this.circleGroups.map((group, gi) => ({
      groupIndex: gi,
      circles: group.map((c) => {
        const [lon, lat] = mercatorToLonLat(c.x, c.y);
        return { x3857: c.x, y3857: c.y, lon, lat, radiusMeters: c.radiusMeters, isGap: c.isGap || false };
      }),
    }));
  }

  // ─── 원 삭제/추가 모드 ───
  setMode(mode) {
    // mode: 'none' | 'delete' | 'add'
    this._mode = mode;
    // draw 모드 중이면 취소
    if (mode !== 'none') this.cancelDraw();
  }

  getMode() { return this._mode; }

  setAddRadius(meters) {
    this._addRadius = Math.max(50, Math.min(5000, meters));
  }

  // 피처로 원 삭제
  _removeCircleByFeature(feature) {
    const cData = feature.get('circleData');
    if (!cData) return;
    // circles 배열에서 제거
    const idx = this.circles.indexOf(cData);
    if (idx !== -1) this.circles.splice(idx, 1);
    // 그룹 재계산 + 렌더
    this.circleGroups = splitCircleGroups(this.circles, 10);
    this._renderCircles();
    if (this.onCirclesChanged) this.onCirclesChanged(this.circles, this.circleGroups);
  }

  // 지정 좌표에 원 추가 (EPSG:3857)
  _addCircleAt(coord) {
    const [mx, my] = coord;
    const [lon, lat] = mercatorToLonLat(mx, my);
    const r = metersToMercatorAtLat(this._addRadius, lat);
    const c = { x: mx, y: my, r, radiusMeters: this._addRadius, isGap: false };
    this.circles.push(c);
    this.circleGroups = splitCircleGroups(this.circles, 10);
    this._renderCircles();
    if (this.onCirclesChanged) this.onCirclesChanged(this.circles, this.circleGroups);
  }

  // ─── 공역 레이어 토글 ───
  toggleAirspace(layerKey, visible) {
    if (!this._airspaceLayers[layerKey]) return;
    this._airspaceVisible[layerKey] = visible;
    this._airspaceLayers[layerKey].setVisible(visible);
    if (visible && !this._airspaceCache[layerKey]) {
      this._loadAirspaceLayer(layerKey);
    }
  }

  // 현재 보이는 공역 레이어 키 목록
  getVisibleAirspaceLayers() {
    return Object.keys(this._airspaceVisible).filter(k => this._airspaceVisible[k]);
  }

  // 세션 ID 설정 (API 호출용)
  setSessionId(sid) {
    this._sessionId = sid;
  }

  // 개별 공역 레이어 데이터 로드 (한국 전체 범위, 1회)
  async _loadAirspaceLayer(layerKey) {
    try {
      // 한국 전체 범위
      const url = `/api/vworld/airspace?minx=124&miny=33&maxx=132&maxy=39&layers=${layerKey}`;
      console.log(`[공역] ${layerKey} 로드 시작`);
      const resp = await fetch(url);
      const json = await resp.json();
      if (!json.success || !json.data) {
        console.warn(`[공역] ${layerKey} 응답 실패`, json);
        return;
      }

      const format = new ol.format.GeoJSON({
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      });
      const features = json.data.features ? format.readFeatures(json.data) : [];
      console.log(`[공역] ${layerKey} 피처 ${features.length}개 로드됨`);
      this._airspaceCache[layerKey] = true;
      const source = this._airspaceLayers[layerKey].getSource();
      source.clear();
      source.addFeatures(features);
    } catch (err) {
      console.warn(`[공역] ${layerKey} 로드 에러:`, err.message);
    }
  }
}

// Export
window.DroneMap = DroneMap;
window.AIRSPACE_LAYERS = AIRSPACE_LAYERS;
