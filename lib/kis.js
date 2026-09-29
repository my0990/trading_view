// 한국투자증권(KIS) Open API 헬퍼. 서버에서만 사용합니다(앱키가 브라우저로 나가지 않도록).
const BASE = 'https://openapi.koreainvestment.com:9443';

// 토큰은 24시간 유효하고 발급이 1분에 1회로 제한됩니다.
// - globalThis: 여러 API 라우트(각각 별도 번들)와 개발 서버 핫리로드 사이에서 공유
// - 임시 폴더 파일: 서버를 껐다 켜도 기존 토큰을 재사용 (발급 알림이 반복되지 않게)
// - Next.js 데이터 캐시(unstable_cache): Vercel에서 여러 서버(인스턴스)와 재시작 사이에 공유
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unstable_cache, revalidateTag } from 'next/cache';

const TOKEN_FILE = path.join(os.tmpdir(), 'kis-token.json');
const store = (globalThis.__kisToken ??= { cached: null, pending: null, failedUntil: 0 });

function readFileToken() {
  try {
    const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (t.appkey === process.env.KIS_APP_KEY && t.expiresAt > Date.now() + 60_000) return t;
  } catch {}
  return null;
}

// 잠시 기다리면 풀리는 제한 (토큰 1분당 1회, 초당 호출 수). 화면에는 오류 대신 '잠시 후' 안내.
export class KisBusyError extends Error {
  constructor(message, retryAfter = 65) {
    super(message);
    this.name = 'KisBusyError';
    this.transient = true;
    this.retryAfter = retryAfter;
  }
}

export function hasKisKeys() {
  return Boolean(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
}

async function getToken() {
  if (store.cached && store.cached.expiresAt > Date.now() + 60_000) return store.cached.token;
  const fromFile = readFileToken();
  if (fromFile) {
    store.cached = fromFile;
    return fromFile.token;
  }
  if (Date.now() < store.failedUntil) {
    throw new KisBusyError('토큰 준비 중', Math.ceil((store.failedUntil - Date.now()) / 1000));
  }
  if (!store.pending) store.pending = sharedToken().finally(() => (store.pending = null));
  return store.pending;
}

// 여러 서버가 같은 토큰을 쓰도록 Next.js 데이터 캐시에 20시간 보관합니다 (토큰 유효기간 24시간).
// 발급에 실패하면(예외) 캐시에 남지 않습니다.
async function sharedToken() {
  const cachedIssue = unstable_cache(issueToken, ['kis-token', process.env.KIS_APP_KEY || ''], {
    revalidate: 20 * 3600,
    tags: ['kis-token'],
  });
  let t;
  try {
    t = await cachedIssue();
  } catch (e) {
    if (e.transient || e.keyProblem) throw e;
    // 캐시를 쓸 수 없는 환경이면 직접 발급
    t = await issueToken();
  }
  if (!t || t.expiresAt <= Date.now() + 60_000) {
    revalidateTagSafe();
    t = await issueToken();
  }
  store.cached = t;
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(t), { mode: 0o600 });
  } catch {}
  return t.token;
}

function revalidateTagSafe() {
  try {
    revalidateTag('kis-token');
  } catch {}
}

async function issueToken() {
  const res = await fetch(`${BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    store.failedUntil = Date.now() + 65_000;
    const detail = `${json.error_code || ''} ${json.error_description || json.msg1 || res.status}`.trim();
    if (/EGW00133|1분당/.test(detail)) throw new KisBusyError('토큰 준비 중', 65);
    if (KEY_ERROR.test(detail)) throw new KisKeyError(detail);
    throw new Error(`KIS 토큰 발급 실패: ${detail}`);
  }
  return {
    token: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 86400) * 1000,
    appkey: process.env.KIS_APP_KEY,
  };
}

// 앱키/시크릿 자체가 만료·무효일 때 KIS가 주는 오류인지 판별합니다.
// (EGW00103 유효하지 않은 AppKey, EGW00105 유효하지 않은 AppSecret 등)
const KEY_ERROR = /EGW0010[0-9]|유효하지 않은 ?App|appkey|appsecret|서비스.*(만료|해지)|이용기간/i;
export class KisKeyError extends Error {
  constructor(detail) {
    super('한국투자증권 앱키가 만료되었거나 유효하지 않습니다. KIS Developers에서 갱신해 주세요');
    this.name = 'KisKeyError';
    this.detail = detail;
    this.keyProblem = true;
  }
}
// 접근토큰이 만료·폐기된 경우 (EGW00121~00123 등) → 새로 발급받아 다시 시도
const TOKEN_ERROR = /EGW0012[0-9]|token/i;

function clearToken() {
  store.cached = null;
  revalidateTagSafe();
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {}
}

// 모든 KIS 호출을 한 줄로 세워 간격을 둡니다 (신규 계정은 초당 호출 한도가 낮음).
const GAP_MS = 600;
const queue = (globalThis.__kisQueue ??= { tail: Promise.resolve(), last: 0 });

function enqueue(fn) {
  const run = queue.tail.then(async () => {
    const wait = queue.last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      queue.last = Date.now();
    }
  });
  queue.tail = run.catch(() => {});
  return run;
}

// 초당 호출 제한에 걸리면 1초 쉬고 한 번 더 시도합니다.
export async function kisGet(path, trId, params, retry = 1) {
  try {
    return await enqueue(() => kisGetOnce(path, trId, params));
  } catch (e) {
    if (String(e.message).includes('초당')) {
      if (retry > 0) {
        await new Promise((r) => setTimeout(r, 1100));
        return kisGet(path, trId, params, retry - 1);
      }
      throw new KisBusyError('호출이 몰려 잠시 대기 중', 5);
    }
    if (retry > 0 && e.tokenProblem) {
      clearToken();
      return kisGet(path, trId, params, retry - 1);
    }
    throw e;
  }
}

async function kisGetOnce(path, trId, params) {
  const token = await getToken();
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: trId,
      custtype: 'P',
    },
    cache: 'no-store',
  });
  const json = await res.json();
  if (!res.ok || json.rt_cd !== '0') {
    const detail = `${json.msg_cd || ''} ${json.msg1 || res.status}`.trim();
    if (KEY_ERROR.test(detail)) throw new KisKeyError(detail);
    const err = new Error(`KIS ${trId} 오류: ${json.msg1 || res.status}`);
    if (TOKEN_ERROR.test(detail)) err.tokenProblem = true;
    throw err;
  }
  return json;
}

// 한국 시간 기준 날짜/시각
export function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    ymd: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`,
    hms: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`,
  };
}

// KRX 파생상품 단축코드: A + 상품(01=코스피200, 06=코스닥150) + 연도 끝자리 + 월
// 예) A06612 = 코스닥150 선물 2026년 12월물
function secondThursday(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=일
  const firstThu = 1 + ((4 - first + 7) % 7);
  return firstThu + 7;
}

// 최근월물(3·6·9·12월, 둘째 목요일 만기) 단축코드. productPrefix: '01' 코스피200, '06' 코스닥150. 만기일 야간부터는 다음 월물로 넘어갑니다.
export function frontMonthCode(productPrefix) {
  const { year, month, day } = kstNow();
  let y = year;
  let m = Math.ceil(month / 3) * 3;
  if (m === month && day >= secondThursday(y, m)) m += 3;
  if (m > 12) {
    m -= 12;
    y += 1;
  }
  return `A${productPrefix}${y % 10}${String(m).padStart(2, '0')}`;
}

// 앱키 이용기간 만료 안내. KIS_KEY_EXPIRES=YYYY-MM-DD (한국 시간 기준)
export const EXPIRY_WARN_DAYS = 30;
export function keyExpiryNotice() {
  const v = process.env.KIS_KEY_EXPIRES;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  // 한국 날짜 기준 D-day (만료일 당일 = D-0)
  const todayKst = Date.parse(`${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);
  const daysLeft = Math.round((Date.parse(`${v}T00:00:00Z`) - todayKst) / 86_400_000);
  if (daysLeft > EXPIRY_WARN_DAYS) return null;
  if (daysLeft === 0) {
    return { level: 'error', text: `한국투자증권 API가 오늘(${v}) 만료됩니다. 지금 갱신해 주세요` };
  }
  if (daysLeft < 0) {
    return { level: 'error', text: `한국투자증권 API 이용기간이 만료되었습니다 (${v}). 갱신해 주세요` };
  }
  return { level: 'warn', text: `한국투자증권 API가 D-${daysLeft} 후 만료됩니다 (${v}). 미리 갱신해 주세요` };
}
