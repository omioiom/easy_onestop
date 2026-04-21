const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const multer = require('multer');
const { createSession, getSession, setSession, deleteSession } = require('../session');
const { buildRegisterForm, parseUserProfile } = require('../formbuilder');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadFields = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'spec', maxCount: 1 },
  { name: 'reg', maxCount: 1 },
  { name: 'appr', maxCount: 1 },
  { name: 'pilot', maxCount: 1 },
  { name: 'insurance', maxCount: 1 },
  { name: 'business', maxCount: 1 },
  { name: 'testflight', maxCount: 1 },
  { name: 'operationManual', maxCount: 1 },
  { name: 'businessP', maxCount: 1 },
]);

/**
 * POST /api/login
 * body: { memberId, password }
 *
 * 원스탑에 로그인하고 세션 쿠키를 서버에 저장.
 * 클라이언트에는 자체 세션ID만 반환.
 */
router.post('/login', async (req, res) => {
  const { memberId, password } = req.body;

  if (!memberId || !password) {
    return res.status(400).json({ success: false, message: '아이디와 비밀번호를 입력하세요.' });
  }

  try {
    const session = createSession();
    const { client, jar } = session;

    // 1) 로그인 페이지 먼저 방문 → 초기 쿠키(JSESSIONID 등) 획득
    await client.get('/member/login/login');

    // 2) 로그인 POST
    const loginData = new URLSearchParams({
      MEMBER_ID: memberId,
      PASSWORD: password,
      LOGIN_TYPE: 'NORMAL',
      ANYID_CI: '',
    }).toString();

    const loginRes = await client.post('/member/login/loginPost', loginData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://drone.onestop.go.kr',
        'Referer': 'https://drone.onestop.go.kr/member/login/login',
      },
      maxRedirects: 5,
    });

    // 3) 로그인 성공 판별
    //    - 원스탑은 로그인 실패 시 로그인 페이지로 리다이렉트
    //    - 성공 시 메인 페이지(/) 또는 대시보드로 리다이렉트
    const finalUrl = loginRes.request?.res?.responseUrl || loginRes.request?.path || '';
    const html = typeof loginRes.data === 'string' ? loginRes.data : '';
    const isLoginPage = html.includes('loginPost') || html.includes('로그인') && html.includes('MEMBER_ID');
    const hasError = html.includes('alert(') && (html.includes('비밀번호') || html.includes('아이디'));

    if (hasError || (isLoginPage && finalUrl.includes('/login'))) {
      return res.status(401).json({
        success: false,
        message: '로그인 실패. 아이디 또는 비밀번호를 확인하세요.',
      });
    }

    // 4) 세션 쿠키에서 필요 정보 추출
    const cookies = await jar.getCookies('https://drone.onestop.go.kr');
    const jsessionId = cookies.find(c => c.key === 'JSESSIONID')?.value;

    if (!jsessionId) {
      return res.status(500).json({
        success: false,
        message: '세션 쿠키를 받지 못했습니다.',
      });
    }

    // 5) 자체 세션ID 발급 후 저장
    const sessionId = crypto.randomUUID();
    setSession(sessionId, {
      ...session,
      memberId,
      cookies,
      jsessionId,
      loginTime: new Date().toISOString(),
    });

    // 6) 사용자 이름 추출 시도
    let userName = '';
    const nameMatch = html.match(/APPLY_USER_NM[^>]*value="([^"]+)"/);
    if (nameMatch) {
      userName = nameMatch[1];
    }

    return res.json({
      success: true,
      sessionId,
      message: '로그인 성공',
      user: {
        memberId,
        userName,
      },
    });

  } catch (err) {
    console.error('로그인 에러:', err.message);
    return res.status(500).json({
      success: false,
      message: '서버 오류: ' + err.message,
    });
  }
});

/**
 * GET /api/session
 * 헤더: x-session-id
 * 현재 세션 상태 확인
 */
router.get('/session', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    return res.status(401).json({ success: false, message: '세션 ID가 없습니다.' });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ success: false, message: '세션이 만료되었습니다.' });
  }

  return res.json({
    success: true,
    user: {
      memberId: session.memberId,
      loginTime: session.loginTime,
    },
  });
});

/**
 * POST /api/logout
 * 세션 삭제
 */
router.post('/logout', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (sessionId) {
    deleteSession(sessionId);
  }
  return res.json({ success: true, message: '로그아웃 완료' });
});

/**
 * GET /api/myac
 * 내 기체 목록 조회
 */
router.get('/myac', async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }

  try {
    const { client } = session;
    const result = await client.post('/mypage/myac/listAjax', {
      draw: 1,
      columns: [
        { data: 'NUM', name: '', searchable: false, orderable: true, search: { value: '', regex: false } },
        { data: 'MY_AC_NM', name: '', searchable: false, orderable: true, search: { value: '', regex: false } },
        { data: 'AC_USE_TYPE_NM', name: '', searchable: false, orderable: true, search: { value: '', regex: false } },
        { data: 'AC_NM', name: '', searchable: false, orderable: true, search: { value: '', regex: false } },
        { data: 'AC_STANDARD', name: '', searchable: false, orderable: true, search: { value: '', regex: false } },
        { data: 'AC_PROFIT_NM', name: '', searchable: false, orderable: true, search: { value: '', regex: false } },
      ],
      order: [{ column: 0, dir: 'desc' }],
      start: 0,
      length: 100,
      search: { value: '', regex: false },
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
      },
    });

    return res.json({ success: true, data: result.data });

  } catch (err) {
    console.error('기체목록 에러:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── 인증 미들웨어 ───
function requireSession(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }
  req.session = session;
  next();
}

// ─── Vworld API 프록시 ───
const VWORLD_KEY = '11735941-D649-334C-BA39-FB5D72A18BA3';
const VWORLD_BASE = 'https://api.vworld.kr';
const VWORLD_DEFAULT_DOMAIN = 'https://drone.onestop.go.kr';

function getVworldDomainCandidates(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const requestDomain = host ? `${proto}://${host}` : '';
  return [requestDomain, VWORLD_DEFAULT_DOMAIN].filter((v, i, a) => v && a.indexOf(v) === i);
}

function parseVworldServiceException(xmlText) {
  if (typeof xmlText !== 'string' || !xmlText.includes('ServiceException')) return '';
  const m = xmlText.match(/<ServiceException[^>]*>([\s\S]*?)<\/ServiceException>/i);
  return (m?.[1] || '').trim();
}

function mercatorToLonLat(x, y) {
  const lon = (Number(x) / 20037508.34) * 180;
  let lat = (Number(y) / 20037508.34) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return [lon, lat];
}

function normalizeBboxTo4326(minx, miny, maxx, maxy) {
  const a = [Number(minx), Number(miny), Number(maxx), Number(maxy)];
  if (a.some(v => Number.isNaN(v))) return null;
  const looks4326 = Math.abs(a[0]) <= 180 && Math.abs(a[2]) <= 180 && Math.abs(a[1]) <= 90 && Math.abs(a[3]) <= 90;
  if (looks4326) return a;
  const [lon1, lat1] = mercatorToLonLat(a[0], a[1]);
  const [lon2, lat2] = mercatorToLonLat(a[2], a[3]);
  const minLon = Math.min(lon1, lon2);
  const minLat = Math.min(lat1, lat2);
  const maxLon = Math.max(lon1, lon2);
  const maxLat = Math.max(lat1, lat2);
  return [minLon, minLat, maxLon, maxLat];
}

async function vworldGetWithDomainRetry(req, path, params, domainParamKey, shouldAccept, domainCandidates) {
  const domains = (Array.isArray(domainCandidates) && domainCandidates.length)
    ? domainCandidates
    : getVworldDomainCandidates(req);
  let lastErr = null;

  for (const domain of domains) {
    try {
      const requestParams = { ...params };
      if (domainParamKey) requestParams[domainParamKey] = domain;

      const response = await axios.get(`${VWORLD_BASE}${path}`, {
        headers: { Referer: `${domain.replace(/\/+$/, '')}/` },
        params: requestParams,
      });

      if (typeof response.data === 'string' && response.data.includes('ServiceException')) {
        const msg = parseVworldServiceException(response.data) || 'Vworld ServiceException';
        lastErr = new Error(msg);
        continue;
      }

      if (typeof shouldAccept === 'function' && !shouldAccept(response.data)) {
        lastErr = new Error('Vworld response rejected by validator');
        continue;
      }

      return { data: response.data, domain };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Vworld 요청 실패');
}

/**
 * GET /api/vworld/district?x=...&y=...
 * EPSG:3857 좌표로 행정구역 조회
 */
router.get('/vworld/district', async (req, res) => {
  const { x, y } = req.query;
  if (!x || !y) return res.status(400).json({ success: false, message: 'x, y 좌표 필요' });

  try {
    const result = await vworldGetWithDomainRetry(req, '/req/data', {
        KEY: VWORLD_KEY,
        SERVICE: 'DATA',
        VERSION: '2.0',
        REQUEST: 'getfeature',
        FORMAT: 'json',
        SIZE: 1000,
        PAGE: 1,
        DATA: 'LT_C_ADEMD_INFO',
        GEOMETRY: true,
        ATTRIBUTE: true,
        CRS: 'EPSG:3857',
        BUFFER: 100,
        GEOMFILTER: `POINT(${x} ${y})`,
    }, 'DOMAIN', (data) => {
      const features = data?.response?.result?.featureCollection?.features || [];
      return features.length > 0;
    });
    return res.json({ success: true, data: result.data });
  } catch (err) {
    // EPSG:3857 조회 실패 시 EPSG:4326 포인트로 한 번 더 시도
    try {
      const [lon, lat] = mercatorToLonLat(x, y);
      const fallback = await vworldGetWithDomainRetry(req, '/req/data', {
        KEY: VWORLD_KEY,
        SERVICE: 'DATA',
        VERSION: '2.0',
        REQUEST: 'getfeature',
        FORMAT: 'json',
        SIZE: 1000,
        PAGE: 1,
        DATA: 'LT_C_ADEMD_INFO',
        GEOMETRY: true,
        ATTRIBUTE: true,
        CRS: 'EPSG:4326',
        BUFFER: 0,
        GEOMFILTER: `POINT(${lon} ${lat})`,
      }, 'DOMAIN', (data) => {
        const features = data?.response?.result?.featureCollection?.features || [];
        return features.length > 0;
      });
      return res.json({ success: true, data: fallback.data });
    } catch (e2) {
      console.error('행정구역 조회 에러:', e2.message);
      return res.status(500).json({ success: false, message: e2.message });
    }
  }
});

/**
 * GET /api/vworld/address?lng=...&lat=...
 * WGS84 좌표로 역지오코딩
 */
router.get('/vworld/address', async (req, res) => {
  const { lng, lat } = req.query;
  if (!lng || !lat) return res.status(400).json({ success: false, message: 'lng, lat 필요' });

  try {
    const result = await vworldGetWithDomainRetry(req, '/req/address', {
        service: 'address',
        version: '2.0',
        key: VWORLD_KEY,
        type: 'BOTH',
        request: 'GetAddress',
        point: `${lng},${lat}`,
    });
    return res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('역지오코딩 에러:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/vworld/search?q=검색어
 * Vworld 장소/주소 통합 검색 → 좌표 반환
 */
router.get('/vworld/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ success: false, message: '검색어 필요' });

  try {
    // place 검색
    const placeRes = await vworldGetWithDomainRetry(req, '/req/search', {
        service: 'search', request: 'search', version: '2.0',
        key: VWORLD_KEY, type: 'place', query: q,
        crs: 'EPSG:4326', size: 5, page: 1, format: 'json',
    });
    // address 검색
    const addrRes = await vworldGetWithDomainRetry(req, '/req/search', {
        service: 'search', request: 'search', version: '2.0',
        key: VWORLD_KEY, type: 'address', query: q,
        crs: 'EPSG:4326', size: 5, page: 1, format: 'json',
    });

    const items = [];
    const addItems = (data, type) => {
      const r = data?.response;
      if (r?.status === 'OK' && r.result?.items) {
        for (const it of r.result.items) {
          items.push({
            title: it.title,
            address: it.address?.road || it.address?.parcel || '',
            lng: parseFloat(it.point.x),
            lat: parseFloat(it.point.y),
            type,
          });
        }
      }
    };
    addItems(placeRes.data, 'place');
    addItems(addrRes.data, 'address');

    return res.json({ success: true, items });
  } catch (err) {
    console.error('장소검색 에러:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/vworld/airspace?minx=...&miny=...&maxx=...&maxy=...&layers=...
 * EPSG:3857 bbox로 공역 조회
 * layers: 쉼표 구분 레이어명 (선택, 기본값: 6개 기본 공역)
 */
router.get('/vworld/airspace', async (req, res) => {
  const { minx, miny, maxx, maxy, layers } = req.query;
  if (!minx || !miny || !maxx || !maxy) {
    return res.status(400).json({ success: false, message: 'bbox 좌표 필요 (minx,miny,maxx,maxy)' });
  }
  const bbox4326 = normalizeBboxTo4326(minx, miny, maxx, maxy);
  if (!bbox4326) {
    return res.status(400).json({ success: false, message: 'bbox 형식 오류' });
  }

  // 허용 레이어 화이트리스트
  const ALLOWED_LAYERS = [
    'lt_c_aisaltc', 'lt_c_aisprhc', 'lt_c_aisresc', 'lt_c_aisdngc', 'lt_c_aistemp', 'lt_c_aisctrc',
    'lt_c_aisulac', 'lt_c_aisatfc', 'lt_c_aisadvc', 'lt_c_aislapc', 'lt_c_aisobsc',
    'lt_c_drnpilotzn', 'lt_c_drnprecon',
    'lt_c_cp014', 'lt_c_uq163',
  ];
  const defaultLayers = 'lt_c_aisaltc,lt_c_aisprhc,lt_c_aisresc,lt_c_aisdngc,lt_c_aistemp,lt_c_aisctrc';
  let typename = defaultLayers;
  if (layers) {
    const requested = layers.split(',').map(l => l.trim()).filter(l => ALLOWED_LAYERS.includes(l));
    if (requested.length) typename = requested.join(',');
  }

  try {
    const result = await vworldGetWithDomainRetry(req, '/req/wfs', {
        service: 'WFS',
        key: VWORLD_KEY,
        version: '1.1.0',
        request: 'GetFeature',
        typename,
        output: 'application/json',
        srsname: 'EPSG:4326',
        bbox: `${bbox4326[0]},${bbox4326[1]},${bbox4326[2]},${bbox4326[3]}`,
        maxFeatures: 1000,
      }, 'domain', null, [VWORLD_DEFAULT_DOMAIN]);
      // Vworld가 에러 시 XML 문자열(ExceptionReport/ServiceException) 반환 가능
      if (typeof result.data === 'string') {
        const isXmlException = result.data.includes('ServiceException') || result.data.includes('ExceptionReport');
        if (isXmlException) {
          console.warn('Vworld WFS 레이어 오류(빈 결과 처리):', result.data.substring(0, 220));
          return res.json({
            success: true,
            data: {
              type: 'FeatureCollection',
              features: [],
              totalFeatures: 0,
              numberMatched: 0,
              numberReturned: 0,
            },
          });
        }
    }
    return res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('공역 조회 에러:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/affairs?addrId=...&applyType=3
 * 처리기관 조회
 */
router.get('/affairs', requireSession, async (req, res) => {
  const { addrId, applyType } = req.query;
  if (!addrId || !applyType) {
    return res.status(400).json({ success: false, message: 'addrId, applyType 필요' });
  }

  try {
    const { client } = req.session;
    const result = await client.get('/civilaffairs/affairs/getAffairsUser', {
      params: {
        PAGE_TYPE: 'user',
        APPLY_TYPE: applyType,
        ADDR_ID: addrId,
      },
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json; charset=UTF-8',
        'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
      },
    });
    return res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('기관 조회 에러:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/tipinfo
 * body: { addrId, applyType }
 * 지역 팁 정보 조회
 */
router.post('/tipinfo', requireSession, async (req, res) => {
  const { addrId, applyType } = req.body;
  if (!addrId || !applyType) {
    return res.status(400).json({ success: false, message: 'addrId, applyType 필요' });
  }

  try {
    const { client } = req.session;
    const result = await client.post('/civilappeal/flight/getTipinfoAjax',
      `ADDR_ID=${addrId}&APPLY_TYPE=${applyType}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
        },
      });
    return res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('팁 정보 에러:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════
// 사용자 프로필 조회 (registerF 스크랩)
// ═══════════════════════════════════════

/**
 * GET /api/userinfo
 * 원스탑 registerF에서 APPLY_USER 추출 후 AJAX API로 실제 사용자 정보 조회
 */
router.get('/userinfo', requireSession, async (req, res) => {
  try {
    const { client } = req.session;

    // 1) registerF에서 APPLY_USER (hidden field에 value 있음) 추출
    const result = await client.get('/civilappeal/flightphotos/registerF', {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://drone.onestop.go.kr/',
      },
    });
    const html = typeof result.data === 'string' ? result.data : '';
    const applyUserMatch = html.match(/name="APPLY_USER"[^>]*value="([^"]+)"/i);
    const applyUser = applyUserMatch ? applyUserMatch[1] : '';

    if (!html || !applyUser) {
      return res.status(401).json({ success: false, message: '세션이 만료되었습니다. 다시 로그인하세요.' });
    }

    // 2) loadApplyUserChoiceAjax로 실제 사용자 정보 가져오기
    const userRes = await client.get('/civilappeal/flightphotos/loadApplyUserChoiceAjax', {
      params: { APPLY_USER: applyUser },
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json; charset=UTF-8',
        'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
      },
    });
    const userData = userRes.data || {};

    // 3) registerF에 임베딩된 flight 객체에서 조종자 + 기체 정보 추출
    let flightData = null;
    const flightMatch = html.match(/(?:^|\s)flight\s*=\s*(\{[\s\S]*?\});\s*(?:\/\/|$|\n)/m);
    if (flightMatch) {
      try { flightData = JSON.parse(flightMatch[1]); } catch (e) {}
    }

    const pilot = flightData?.PILOT_LIST?.[0] || {};

    const userInfo = {
      APPLY_USER: applyUser,
      APPLY_USER_NM: userData.APPLY_USER_NM || '',
      APPLY_BIRTHDAY_YMD: userData.APPLY_BIRTHDAY_YMD || '',
      APPLY_PHONE_NO: userData.APPLY_PHONE_NO || '',
      APPLY_TEL_NO: userData.APPLY_TEL_NO || '',
      APPLY_FAX_NO: userData.APPLY_FAX_NO || '',
      APPLY_ZIP_CD: userData.APPLY_ZIP_CD || '',
      APPLY_ADDR: userData.APPLY_ADDR || '',
      APPLY_ADDR_DETAIL: userData.APPLY_ADDR_DETAIL || '',
      APPLY_COMP_NM: userData.APPLY_COMP_NM || '',
      AERO_PROFIT: '1',
      PILOT_NM: pilot.PILOT_NM || userData.APPLY_USER_NM || '',
      PILOT_BIRTHDAY_YMD: pilot.PILOT_BIRTHDAY_YMD || userData.APPLY_BIRTHDAY_YMD || '',
      PILOT_ZIP_CD: pilot.PILOT_ZIP_CD || userData.APPLY_ZIP_CD || '',
      PILOT_ADDR: pilot.PILOT_ADDR || userData.APPLY_ADDR || '',
      PILOT_ADDR_DETAIL: pilot.PILOT_ADDR_DETAIL || userData.APPLY_ADDR_DETAIL || '',
      PILOT_QUAL: pilot.PILOT_QUAL || '',
      PILOT_TEL_NO: pilot.PILOT_TEL_NO || userData.APPLY_PHONE_NO || '',
      PILOT_HP: pilot.PILOT_HP || pilot.PILOT_TEL_NO || userData.APPLY_PHONE_NO || '',
      PILOT_ADD_SEQ: pilot.PILOT_ADD_SEQ || '1',
      AC_FLIGHT_ID: pilot.AC_FLIGHT_ID || flightData?.AC_FLIGHT_ID || '',
      PILOT_COMP_NM: pilot.PILOT_COMP_NM || '',
      PILOT_COMP_POSITON: pilot.PILOT_COMP_POSITON || '',
    };

    return res.json({ success: true, data: userInfo });
  } catch (err) {
    console.error('사용자 정보 에러:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 디버그: popupLoad_P 페이지 소스 확인
router.get('/debug/popup', requireSession, async (req, res) => {
  try {
    const { client } = req.session;
    const popupRes = await client.get('/civilappeal/aircraft/popupLoad_P?APPLY_TYPE=3', {
      headers: {
        'Accept': 'text/html, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
      },
    });
    res.type('text/plain').send(typeof popupRes.data === 'string' ? popupRes.data : JSON.stringify(popupRes.data));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ═══════════════════════════════════════
// 과거 비행 불러오기
// ═══════════════════════════════════════

/**
 * POST /api/flights
 * 과거 비행 목록 조회 (DataTables 형식)
 * body: { dateStart, dateEnd } (optional)
 */
router.post('/flights', requireSession, async (req, res) => {
  try {
    const { client } = req.session;
    const applyUser = req.session.memberId || '';

    // APPLY_USER 추출 (세션에 없으면 registerF에서)
    let applyUserId = '';
    if (req.session._applyUser) {
      applyUserId = req.session._applyUser;
    } else {
      const regRes = await client.get('/civilappeal/flightphotos/registerF', {
        headers: { 'Accept': 'text/html', 'Referer': 'https://drone.onestop.go.kr/' },
      });
      const html = typeof regRes.data === 'string' ? regRes.data : '';
      const m = html.match(/name="APPLY_USER"[^>]*value="([^"]+)"/i);
      applyUserId = m ? m[1] : '';
      if (applyUserId) req.session._applyUser = applyUserId;
    }

    if (!applyUserId) {
      return res.status(401).json({ success: false, message: '세션 만료' });
    }

    // 날짜 범위 (기본: 최근 6개월)
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '');
    const dateStart = req.body.dateStart || fmt(sixMonthsAgo);
    const dateEnd = req.body.dateEnd || fmt(now);

    const result = await client.post('/mypage/civilappealhis/listAjaxP', {
      draw: 1,
      columns: [
        { data: 'NUM', name: '', searchable: false, orderable: true, search: { value: '', regex: false } },
        { data: 'APPLY_NO', name: '', searchable: true, orderable: true, search: { value: '', regex: false } },
        { data: 'APPLY_TYPE_NM', name: '', searchable: true, orderable: true, search: { value: '', regex: false } },
        { data: 'PRO_STEP_NM', name: '', searchable: false, orderable: true, search: { value: '', regex: false } },
        { data: 'FP_CHK', name: '', searchable: true, orderable: true, search: { value: '', regex: false } },
      ],
      order: [{ column: 0, dir: 'desc' }],
      start: 0,
      length: 20,
      search: { value: '', regex: false },
      parms: { PRO_STEP: 'ALL', APPLY_TYPE: '3', searchType: 'ALL', searchText: '' },
      etc: { APPLY_USER: applyUserId, DATE_S: dateStart, DATE_E: dateEnd },
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
      },
    });

    // 디버그: 응답 필드 확인
    if (result.data?.data?.[0]) {
      console.log('listAjaxP 첫번째 항목 키:', Object.keys(result.data.data[0]).join(', '));
    }

    return res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('과거 비행 목록 에러:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 균형 중괄호 카운팅으로 JS 변수에서 JSON 객체 추출
function extractJsonVar(html, varName) {
  // 1단계: varName = { 패턴으로 시작 위치 후보 모두 수집
  const candidates = [];
  const re1 = new RegExp(`${varName}\\s*=\\s*\\{`, 'g');
  let m;
  while ((m = re1.exec(html)) !== null) {
    candidates.push(m.index);
  }
  console.log(`extractJsonVar(${varName}): ${candidates.length}개 후보 위치`);

  for (const startIdx of candidates) {
    const braceStart = html.indexOf('{', startIdx);
    if (braceStart < 0) continue;

    // 빈 객체 건너뛰기
    const next10 = html.slice(braceStart, braceStart + 10).replace(/\s/g, '');
    if (next10.startsWith('{}')) continue;

    // flight = flight || {}; 같은 패턴 건너뛰기
    const beforeBrace = html.slice(startIdx, braceStart).trim();
    if (beforeBrace.includes('||')) continue;

    let depth = 0, inStr = false, esc = false;
    for (let i = braceStart; i < Math.min(html.length, braceStart + 500000); i++) {
      const ch = html[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\' && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const jsonStr = html.slice(braceStart, i + 1);
          try {
            const obj = JSON.parse(jsonStr);
            console.log(`extractJsonVar(${varName}): 성공! 키 수=${Object.keys(obj).length}, 길이=${jsonStr.length}`);
            return obj;
          } catch (e) {
            console.error(`extractJsonVar(${varName}): JSON 파싱 실패 at offset ${braceStart}:`, e.message);
            console.error(`  처음 300자: ${jsonStr.slice(0, 300)}`);
            console.error(`  마지막 100자: ${jsonStr.slice(-100)}`);
            break;
          }
        }
      }
    }
  }
  return null;
}

/**
 * GET /api/flight/latest
 * registerF에 임베딩된 최근 비행 데이터 파싱하여 반환
 * ?id=<AC_FLIGHT_ID>&prouser=<PRO_USER> 파라미터가 있으면 loadP 페이지에서 해당 비행 데이터 로드
 */
router.get('/flight/latest', requireSession, async (req, res) => {
  try {
    const { client } = req.session;
    const flightId = req.query.id;
    const proUser = req.query.prouser || '';

    let html = '';

    if (flightId) {
      // 특정 비행 ID로 로드: loadP 페이지 사용 (승인 완료된 비행도 데이터 포함)
      // loadP는 id + prouser 파라미터 필요
      try {
        let loadPUrl = `/civilappeal/flightphotos/loadP?id=${encodeURIComponent(flightId)}`;
        if (proUser) loadPUrl += `&prouser=${encodeURIComponent(proUser)}`;
        const loadPRes = await client.get(loadPUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
          },
        });
        html = typeof loadPRes.data === 'string' ? loadPRes.data : '';
        console.log('flight/latest: loadP HTML 길이 =', html.length, `(id=${flightId}, prouser=${proUser})`);
        if (html.length < 5000) {
          console.log('flight/latest: loadP 응답 내용:', html.slice(0, 500));
        }
      } catch (loadPErr) {
        console.log('flight/latest: loadP 실패:', loadPErr.message);
      }

      // loadP에서 flight 추출 시도
      let flight = null;
      if (html.length > 5000) {
        flight = extractJsonVar(html, 'flight');
      }

      // loadP 실패 시 registerF?P_AC_FLIGHT_ID 시도
      if (!flight) {
        try {
          const regRes = await client.get(`/civilappeal/flightphotos/registerF?P_AC_FLIGHT_ID=${encodeURIComponent(flightId)}`, {
            headers: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Referer': 'https://drone.onestop.go.kr/',
            },
          });
          html = typeof regRes.data === 'string' ? regRes.data : '';
          console.log('flight/latest: registerF HTML 길이 =', html.length, `(P_AC_FLIGHT_ID=${flightId})`);
        } catch (regErr) {
          console.log('flight/latest: registerF 실패:', regErr.message);
        }
      }
    } else {
      // 기본: registerF (임시저장/편집중인 비행)
      const regRes = await client.get('/civilappeal/flightphotos/registerF', {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': 'https://drone.onestop.go.kr/',
        },
      });
      html = typeof regRes.data === 'string' ? regRes.data : '';
      console.log('flight/latest: registerF HTML 길이 =', html.length, '(기본)');
    }

    // flight 객체 추출 (균형 중괄호 파싱)
    const flight = extractJsonVar(html, 'flight');
    const aerophotos = extractJsonVar(html, 'aerophotos');

    console.log('flight/latest: flight =', flight ? 'OK' : 'null', '| aerophotos =', aerophotos ? 'OK' : 'null');

    // 첨부파일 정보: HTML downloadURL 경로 + flight JSON의 파일ID/이름
    const attachments = {};
    const actFields = ['ACT_PICTURE', 'ACT_SPEC', 'ACT_REG', 'ACT_APPR', 'ACT_PILOT_NM', 'ACT_INSURANCE', 'ACT_BUSINESS', 'ACT_TESTFLIGHT', 'ACT_OPERATION_MANUAL', 'ACT_BUSINESS_P'];

    // 1) HTML에서 downloadURL 경로 파싱
    for (const field of actFields) {
      const tdId = field + '_PATH';
      const tdRe = new RegExp(`id="${tdId}"[\\s\\S]*?(?=<\\/td>)`, 'i');
      const tdMatch = html.match(tdRe);
      if (tdMatch) {
        const dlRe = /downloadURL\('([^']+)',\s*'([^']+)'\)/;
        const dlMatch = tdMatch[0].match(dlRe);
        if (dlMatch) {
          attachments[field] = { path: dlMatch[1], name: dlMatch[2] };
        }
      }
    }

    // 2) flight JSON에서 파일 ID/이름 보충 (기존 항목에도 ID 추가)
    if (flight) {
      for (const field of actFields) {
        const fileId = flight[field];
        const fileName = flight[field + '_NM'];
        if (fileId && fileName) {
          if (!attachments[field]) {
            attachments[field] = { id: fileId, name: fileName };
          } else if (!attachments[field].id) {
            attachments[field].id = fileId;
          }
        }
      }
    }

    console.log('flight/latest: attachments =', Object.keys(attachments).join(', ') || '없음');

    if (!flight) {
      return res.json({ success: false, message: '불러올 비행 데이터가 없습니다.' });
    }

    return res.json({ success: true, flight, aerophotos, attachments });
  } catch (err) {
    console.error('최근 비행 로드 에러:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/file/download
 * 원스톱 서버에서 첨부파일 다운로드 프록시
 * query: path=/3/2026/03/31/uuid.ext
 */
router.get('/file/download', requireSession, async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath || !filePath.startsWith('/')) {
      return res.status(400).json({ success: false, message: '잘못된 파일 경로' });
    }
    // 경로 검증: 숫자/날짜/UUID 패턴만 허용
    if (!/^\/\d+\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9-]+\.\w+$/i.test(filePath)) {
      return res.status(400).json({ success: false, message: '잘못된 파일 경로 형식' });
    }

    const { client } = req.session;
    const fileRes = await client.get(filePath, {
      responseType: 'arraybuffer',
      headers: {
        'Accept': '*/*',
        'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
      },
    });

    const contentType = fileRes.headers?.['content-type'] || 'application/octet-stream';
    res.set('Content-Type', contentType);
    res.send(Buffer.from(fileRes.data));
  } catch (err) {
    console.error('파일 다운로드 에러:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════
// 비행허가 신청 제출
// ═══════════════════════════════════════

/**
 * POST /api/submit
 * multipart: photo (file) + data (JSON string)
 *
 * data JSON: {
 *   aircraft: { ... },     // 선택된 기체 데이터
 *   groups: [               // 원 그룹 (각 그룹이 1건 신청)
 *     [{ lon, lat, x3857, y3857 }, ...]
 *   ],
 *   centroidLon, centroidLat,  // 폴리곤 중심 WGS84
 *   centroidX, centroidY,      // 폴리곤 중심 EPSG:3857
 *   startDate, endDate,
 *   altitude,
 *   purpose,          // 03=항공촬영
 *   purposeEtc,       // 세부 목적
 *   directPur,        // 01
 *   purposeEtcN,      // 드론촬영 등
 *   aeroEtc,          // 취미 등
 *   cameraDesc,       // 카메라/기체 설명
 * }
 */
router.post('/submit', requireSession, uploadFields, async (req, res) => {
  try {
    const data = JSON.parse(req.body.data || '{}');
    const { aircraft, groups, centroidLon, centroidLat, centroidX, centroidY } = data;

    if (!aircraft || !groups || groups.length === 0) {
      return res.status(400).json({ success: false, message: '기체와 비행 구역 정보가 필요합니다.' });
    }

    const { client } = req.session;

    // 1) 사용자 프로필 가져오기
    console.log('[신청] 사용자 프로필 조회...');
    const profileRes = await client.get('/civilappeal/flightphotos/registerF', {
      headers: { 'Accept': 'text/html', 'Referer': 'https://drone.onestop.go.kr/' },
    });
    const profileHtml = typeof profileRes.data === 'string' ? profileRes.data : '';
    const applyUserMatch = profileHtml.match(/name="APPLY_USER"[^>]*value="([^"]+)"/i);
    const applyUserId = applyUserMatch ? applyUserMatch[1] : '';
    if (!applyUserId) {
      return res.status(401).json({ success: false, message: '세션 만료. 다시 로그인하세요.' });
    }

    // loadApplyUserChoiceAjax로 실제 사용자 데이터 조회
    const userAjax = await client.get('/civilappeal/flightphotos/loadApplyUserChoiceAjax', {
      params: { APPLY_USER: applyUserId },
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF' },
    });
    const ud = userAjax.data || {};

    const extractInput = (html, name) => {
      if (!html || !name) return '';
      const r1 = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
      const r2 = new RegExp(`value="([^"]*)"[^>]*name="${name}"`, 'i');
      return (html.match(r1) || html.match(r2) || [])[1] || '';
    };

    // flight 임베딩 데이터에서 조종자 정보 추출
    let pilotData = {};
    const flightMatch = profileHtml.match(/(?:^|\s)flight\s*=\s*(\{"AC_FLIGHT_ID"[\s\S]*?\});/m);
    if (flightMatch) {
      try { const f = JSON.parse(flightMatch[1]); pilotData = f?.PILOT_LIST?.[0] || {}; } catch (e) {}
    }

    const userInfo = {
      APPLY_USER: applyUserId,
      APPLY_USER_NM: ud.APPLY_USER_NM || extractInput(profileHtml, 'APPLY_USER_NM') || '',
      APPLY_BIRTHDAY_YMD: ud.APPLY_BIRTHDAY_YMD || extractInput(profileHtml, 'APPLY_BIRTHDAY_YMD') || '',
      APPLY_PHONE_NO: ud.APPLY_PHONE_NO || extractInput(profileHtml, 'APPLY_PHONE_NO') || '',
      APPLY_TEL_NO: ud.APPLY_TEL_NO || extractInput(profileHtml, 'APPLY_TEL_NO') || '',
      APPLY_ZIP_CD: ud.APPLY_ZIP_CD || extractInput(profileHtml, 'APPLY_ZIP_CD') || '',
      APPLY_ADDR: ud.APPLY_ADDR || extractInput(profileHtml, 'APPLY_ADDR') || '',
      APPLY_ADDR_DETAIL: ud.APPLY_ADDR_DETAIL || extractInput(profileHtml, 'APPLY_ADDR_DETAIL') || '',
      APPLY_COMP_NM: ud.APPLY_COMP_NM || extractInput(profileHtml, 'APPLY_COMP_NM') || '',
      AERO_PROFIT: '1',
      PILOT_NM:
        pilotData.PILOT_NM ||
        extractInput(profileHtml, 'PILOT_NM') ||
        ud.APPLY_USER_NM ||
        extractInput(profileHtml, 'APPLY_USER_NM') ||
        req.session.memberId ||
        '',
      PILOT_BIRTHDAY_YMD:
        pilotData.PILOT_BIRTHDAY_YMD ||
        extractInput(profileHtml, 'PILOT_BIRTHDAY_YMD') ||
        ud.APPLY_BIRTHDAY_YMD ||
        extractInput(profileHtml, 'APPLY_BIRTHDAY_YMD') ||
        '',
      PILOT_ZIP_CD: pilotData.PILOT_ZIP_CD || extractInput(profileHtml, 'PILOT_ZIP_CD') || ud.APPLY_ZIP_CD || extractInput(profileHtml, 'APPLY_ZIP_CD') || '',
      PILOT_ADDR: pilotData.PILOT_ADDR || extractInput(profileHtml, 'PILOT_ADDR') || ud.APPLY_ADDR || extractInput(profileHtml, 'APPLY_ADDR') || '',
      PILOT_ADDR_DETAIL: pilotData.PILOT_ADDR_DETAIL || extractInput(profileHtml, 'PILOT_ADDR_DETAIL') || ud.APPLY_ADDR_DETAIL || extractInput(profileHtml, 'APPLY_ADDR_DETAIL') || '',
      PILOT_QUAL: pilotData.PILOT_QUAL || extractInput(profileHtml, 'PILOT_QUAL') || '',
      PILOT_TEL_NO:
        pilotData.PILOT_TEL_NO ||
        extractInput(profileHtml, 'PILOT_TEL_NO') ||
        ud.APPLY_PHONE_NO ||
        extractInput(profileHtml, 'APPLY_PHONE_NO') ||
        '',
      PILOT_HP:
        pilotData.PILOT_HP ||
        extractInput(profileHtml, 'PILOT_HP') ||
        pilotData.PILOT_TEL_NO ||
        extractInput(profileHtml, 'PILOT_TEL_NO') ||
        ud.APPLY_PHONE_NO ||
        extractInput(profileHtml, 'APPLY_PHONE_NO') ||
        '',
      PILOT_ADD_SEQ: pilotData.PILOT_ADD_SEQ || '1',
      AC_FLIGHT_ID: pilotData.AC_FLIGHT_ID || '',
    };

    // 클라이언트 입력값(신청자/조종자 정보) 우선 반영
    const normBirth = (v) => String(v || '').trim().replace(/\./g, '-').replace(/\//g, '-');
    userInfo.APPLY_USER_NM = String(data.applyUserNm || userInfo.APPLY_USER_NM || '').trim();
    userInfo.APPLY_PHONE_NO = String(data.applyPhoneNo || userInfo.APPLY_PHONE_NO || '').trim();
    userInfo.APPLY_TEL_NO = String(data.applyPhoneNo || userInfo.APPLY_TEL_NO || userInfo.APPLY_PHONE_NO || '').trim();
    userInfo.APPLY_BIRTHDAY_YMD = normBirth(data.applyBirthdayYmd || userInfo.APPLY_BIRTHDAY_YMD);
    userInfo.APPLY_ADDR = String(data.applyAddr || userInfo.APPLY_ADDR || '').trim();
    userInfo.APPLY_ADDR_DETAIL = String(data.applyAddrDetail || userInfo.APPLY_ADDR_DETAIL || '').trim();

    userInfo.PILOT_NM = String(data.pilotNm || userInfo.PILOT_NM || userInfo.APPLY_USER_NM || '').trim();
    userInfo.PILOT_TEL_NO = String(data.pilotTelNo || userInfo.PILOT_TEL_NO || userInfo.APPLY_PHONE_NO || '').trim();
    userInfo.PILOT_HP = String(data.pilotTelNo || userInfo.PILOT_HP || userInfo.PILOT_TEL_NO || '').trim();
    userInfo.PILOT_BIRTHDAY_YMD = normBirth(data.pilotBirthdayYmd || userInfo.PILOT_BIRTHDAY_YMD || userInfo.APPLY_BIRTHDAY_YMD);
    userInfo.PILOT_QUAL = String(data.pilotQual || userInfo.PILOT_QUAL || '').trim();
    userInfo.PILOT_ADDR = String(data.pilotAddr || userInfo.PILOT_ADDR || userInfo.APPLY_ADDR || '').trim();
    userInfo.PILOT_ADDR_DETAIL = String(data.pilotAddrDetail || userInfo.PILOT_ADDR_DETAIL || userInfo.APPLY_ADDR_DETAIL || '').trim();

    // 2) 역지오코딩: 폴리곤 중심으로 주소 + ADDR_ID 가져오기
    console.log(`[신청] 역지오코딩... centroidX=${centroidX}, centroidY=${centroidY}, lon=${centroidLon}, lat=${centroidLat}`);
    let address = '';
    let addrId = '';

    // 행정구역 조회 (ADDR_ID)
    try {
        const distRes = await vworldGetWithDomainRetry(req, '/req/data', {
          KEY: VWORLD_KEY,
          SERVICE: 'DATA', VERSION: '2.0', REQUEST: 'getfeature',
          FORMAT: 'json', SIZE: 1000, PAGE: 1,
          DATA: 'LT_C_ADEMD_INFO',
          GEOMETRY: true, ATTRIBUTE: true,
          CRS: 'EPSG:3857', BUFFER: 100,
          GEOMFILTER: `POINT(${centroidX} ${centroidY})`,
      }, 'DOMAIN', (data) => {
        const features = data?.response?.result?.featureCollection?.features || [];
        return features.length > 0;
      });
      console.log('[신청] 행정구역 응답 status:', distRes.data?.response?.status);
      const features = distRes.data?.response?.result?.featureCollection?.features || [];
      console.log('[신청] 행정구역 features:', features.length);
      if (features.length > 0) {
        const attrs = features[0].properties || {};
        addrId = attrs.emd_cd || attrs.EMD_CD || '';
        address = attrs.full_nm || attrs.FULL_NM || '';
        console.log(`[신청] addrId=${addrId}, address=${address}`);
      } else {
        console.log('[신청] 행정구역 응답 전체:', JSON.stringify(distRes.data?.response).substring(0, 500));
      }
    } catch (e) {
      console.error('[신청] 행정구역 조회 실패:', e.message);
    }

    // 1차 실패 시 4326 좌표로 행정구역 재시도
    if (!addrId && centroidLon && centroidLat) {
      try {
        const distRes4326 = await vworldGetWithDomainRetry(req, '/req/data', {
          KEY: VWORLD_KEY,
          SERVICE: 'DATA', VERSION: '2.0', REQUEST: 'getfeature',
          FORMAT: 'json', SIZE: 1000, PAGE: 1,
          DATA: 'LT_C_ADEMD_INFO',
          GEOMETRY: true, ATTRIBUTE: true,
          CRS: 'EPSG:4326', BUFFER: 0,
          GEOMFILTER: `POINT(${centroidLon} ${centroidLat})`,
        }, 'DOMAIN');
        const features2 = distRes4326.data?.response?.result?.featureCollection?.features || [];
        if (features2.length > 0) {
          const attrs2 = features2[0].properties || {};
          addrId = attrs2.emd_cd || attrs2.EMD_CD || '';
          address = address || attrs2.full_nm || attrs2.FULL_NM || '';
          console.log(`[신청] 4326 재시도 성공 addrId=${addrId}`);
        }
      } catch (e2) {
        console.error('[신청] 행정구역 4326 재시도 실패:', e2.message);
      }
    }

    // 역지오코딩으로 주소 보완
    if (!address) {
      try {
        const addrRes = await vworldGetWithDomainRetry(req, '/req/address', {
            service: 'address', version: '2.0', key: VWORLD_KEY,
            type: 'BOTH', request: 'GetAddress',
            point: `${centroidLon},${centroidLat}`,
        });
        const results = addrRes.data?.response?.result || [];
        if (Array.isArray(results) && results.length > 0) {
          address = results[0].text || '';
        } else if (results?.text) {
          address = results.text;
        }

        // 역지오코딩 구조정보에서 행정동 코드 추정 (최후 폴백)
        if (!addrId) {
          const first = Array.isArray(results) ? results[0] : results;
          const st = first?.structure || {};
          const ac = String(st.level4AC || '').trim();
          const lc = String(st.level4LC || '').trim();
          const raw = ac || lc;
          if (raw) {
            addrId = raw.length >= 8 ? raw.substring(0, 8) : raw;
            console.log(`[신청] 주소 구조정보 폴백 addrId=${addrId}`);
          }
        }
      } catch (e) {
        console.error('[신청] 역지오코딩 실패:', e.message);
      }
    }

    if (!addrId) {
      return res.status(400).json({ success: false, message: '비행 구역의 행정구역 정보를 조회할 수 없습니다.' });
    }

    // 3) 처리기관 조회
    console.log(`[신청] 처리기관 조회 (ADDR_ID: ${addrId})...`);
    let agency = { PRO_USER: '', PRO_USERS: '' };

    // XML 응답에서 MEMBER_SEQ 추출 헬퍼
    function extractMemberSeq(data) {
      if (!data) return '';
      const str = typeof data === 'string' ? data : JSON.stringify(data);
      const m = str.match(/<MEMBER_SEQ>([^<]+)<\/MEMBER_SEQ>/);
      return m ? m[1].trim() : '';
    }

    try {
      // 비행허가 (APPLY_TYPE=3)
      const affRes3 = await client.get('/civilaffairs/affairs/getAffairsUser', {
        params: { PAGE_TYPE: 'user', APPLY_TYPE: '3', ADDR_ID: addrId },
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/json; charset=UTF-8',
          'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
        },
      });
      const affData3 = affRes3.data;
      let proUser3 = extractMemberSeq(affData3);
      if (!proUser3) {
        // JSON 응답 대응
        if (affData3?.PRO_USER) proUser3 = affData3.PRO_USER;
        else if (affData3?.list?.[0]?.USER_ID) proUser3 = affData3.list[0].USER_ID;
      }

      // 촬영허가 (APPLY_TYPE=5, 항공촬영인 경우)
      let proUser5 = '';
      if (data.purpose === '03') {
        try {
          const affRes5 = await client.get('/civilaffairs/affairs/getAffairsUser', {
            params: { PAGE_TYPE: 'user', APPLY_TYPE: '5', ADDR_ID: addrId },
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'Content-Type': 'application/json; charset=UTF-8',
              'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
            },
          });
          proUser5 = extractMemberSeq(affRes5.data);
          if (!proUser5) {
            const affData5 = affRes5.data;
            if (affData5?.PRO_USER) proUser5 = affData5.PRO_USER;
            else if (affData5?.list?.[0]?.USER_ID) proUser5 = affData5.list[0].USER_ID;
          }
        } catch (e) {
          console.error('[신청] 촬영기관 조회 실패:', e.message);
        }
      }

      agency.PRO_USER = proUser3;
      agency.PRO_USERS = proUser3;
      // 촬영 기관은 PRO_USER2/PRO_USERS2로 별도 전달
      agency.PRO_USER2 = proUser5;
      agency.PRO_USERS2 = proUser5;

      console.log(`[신청] 처리기관: 비행=${agency.PRO_USER}, 촬영=${agency.PRO_USER2}`);
    } catch (e) {
      console.error('[신청] 기관 조회 실패:', e.message);
    }

    // 4) 첨부파일 준비
    function pickFile(fieldName) {
      const f = req.files?.[fieldName]?.[0];
      return f ? { buffer: f.buffer, name: f.originalname, mimetype: f.mimetype } : null;
    }
    const attachments = {
      photo: pickFile('photo'),
      spec: pickFile('spec'),
      reg: pickFile('reg'),
      appr: pickFile('appr'),
      pilot: pickFile('pilot'),
      insurance: pickFile('insurance'),
      business: pickFile('business'),
      testflight: pickFile('testflight'),
      operationManual: pickFile('operationManual'),
      businessP: pickFile('businessP'),
    };

    // 5) 그룹별 신청 제출
    const results = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const groupCircles = groups[gi].map(c => ({
        lon: c.lon,
        lat: c.lat,
        radius: c.radiusMeters || 500,
        address: address,
        addrId: addrId,
      }));

      console.log(`[신청] 그룹 ${gi + 1}/${groups.length} 제출 (${groupCircles.length}개 원)...`);

      try {
        const form = buildRegisterForm({
          userInfo,
          circles: groupCircles,
          aircraft,
          params: {
            startDate: data.startDate,
            endDate: data.endDate,
            startDate2: data.startDate2 || data.startDate,
            endDate2: data.endDate2 || data.endDate,
            altitude: data.altitude || 100,
            purpose: data.purpose || '03',
            purposeEtc: data.purposeEtc || '시계비행',
            inputPurposeEtc: data.inputPurposeEtc || '',
            directPur: data.directPur || '01',
            purposeEtcN: data.purposeEtcN || '드론촬영',
            aeroEtc: data.aeroEtc || '취미',
            cameraDesc: data.cameraDesc || '',
            planAddEtc: data.planAddEtc || '',
            aeroProfit: data.aeroProfit || '1',
            applyCompNm: data.applyCompNm || '',
            pilotCompNm: data.pilotCompNm || '',
            pilotCompPositon: data.pilotCompPositon || '',
            acCameraVideo: data.acCameraVideo || '',
            acCameraViewpoint: data.acCameraViewpoint || '',
            acCameraBlueprint: data.acCameraBlueprint || '',
          },
          attachments,
          agency,
        });

        const submitRes = await client.post('/civilappeal/flightphotos/registerP', form, {
          headers: {
            ...form.getHeaders(),
            'Origin': 'https://drone.onestop.go.kr',
            'Referer': 'https://drone.onestop.go.kr/civilappeal/flightphotos/registerF',
            'Upgrade-Insecure-Requests': '1',
          },
          maxRedirects: 5,
        });

        const resHtml = typeof submitRes.data === 'string' ? submitRes.data : '';
        const responseUrl = submitRes.request?.res?.responseUrl || '';
        console.log(`[신청] 그룹 ${gi + 1} 응답 URL: ${responseUrl}`);
        console.log(`[신청] 그룹 ${gi + 1} 응답 길이: ${resHtml.length}`);
        // alert 메시지 추출
        const alertMatch = resHtml.match(/alert\(['"]([^'"]+)['"]\)/);
        if (alertMatch) console.log(`[신청] 그룹 ${gi + 1} alert: ${alertMatch[1]}`);
        // 응답 앞부분 로깅
        if (resHtml.length < 500) {
          console.log(`[신청] 그룹 ${gi + 1} 응답 전체:`, resHtml);
        } else {
          console.log(`[신청] 그룹 ${gi + 1} 응답 앞200자:`, resHtml.substring(0, 200));
        }

        const hasError = alertMatch && (alertMatch[1].includes('오류') || alertMatch[1].includes('실패') || alertMatch[1].includes('확인'));
        const isSuccess = resHtml.includes('접수') || resHtml.includes('완료')
          || responseUrl.includes('mypage') || responseUrl.includes('list')
          || (resHtml.includes('listP') && !resHtml.includes('registerF'));

        results.push({
          group: gi + 1,
          circleCount: groupCircles.length,
          success: !hasError && (isSuccess || !resHtml.includes('registerF')),
          message: hasError ? '제출 오류 발생' : (isSuccess ? '접수 완료' : '제출됨 (결과 확인 필요)'),
        });
      } catch (err) {
        console.error(`[신청] 그룹 ${gi + 1} 실패:`, err.message);
        results.push({
          group: gi + 1,
          circleCount: groupCircles.length,
          success: false,
          message: '제출 실패: ' + err.message,
        });
      }
    }

    const allSuccess = results.every(r => r.success);
    return res.json({
      success: allSuccess,
      message: allSuccess
        ? `${results.length}건 모두 접수 완료`
        : `${results.filter(r => r.success).length}/${results.length}건 접수`,
      results,
    });

  } catch (err) {
    console.error('[신청] 전체 에러:', err.message);
    return res.status(500).json({ success: false, message: '신청 처리 중 오류: ' + err.message });
  }
});

module.exports = router;
