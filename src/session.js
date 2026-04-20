const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// 유저별 세션 저장소 (메모리)
const sessions = new Map();

const ONESTOP_BASE = 'https://drone.onestop.go.kr';

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
};

/**
 * 세션(CookieJar + axios 인스턴스) 생성
 */
function createSession() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    baseURL: ONESTOP_BASE,
    headers: COMMON_HEADERS,
    jar,
    withCredentials: true,
    maxRedirects: 5,
    validateStatus: (status) => status < 400,
  }));
  return { jar, client };
}

/**
 * 세션 ID로 세션 가져오기
 */
function getSession(sessionId) {
  return sessions.get(sessionId);
}

/**
 * 새 세션 저장
 */
function setSession(sessionId, session) {
  sessions.set(sessionId, session);
}

/**
 * 세션 삭제
 */
function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

module.exports = {
  createSession,
  getSession,
  setSession,
  deleteSession,
  ONESTOP_BASE,
  COMMON_HEADERS,
};
