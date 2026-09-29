// 야간선물 시세 (한국투자증권 Open API).  /api/night-futures/kospi200, /api/night-futures/kosdaq150
// 필요한 환경변수 (.env.local):
//   KIS_APP_KEY, KIS_APP_SECRET        한국투자증권 Open API 앱키/시크릿 (실전)
//   KIS_KEY_EXPIRES     (선택)         앱키 이용기간 만료일 YYYY-MM-DD. 30일 전부터 카드에 경고 표시
//   KIS_NIGHT_MRKT_CODE (선택)         야간선물 시장 분류 코드, 기본값 CM
//   KIS_KOSPI200_CODE / KIS_KOSDAQ150_CODE (선택)
//                                      종목코드를 직접 지정할 때 (예: A01612, A06612). 없으면 최근월물 자동 계산
import { hasKisKeys, kisGet, kstNow, frontMonthCode, keyExpiryNotice } from '@/lib/kis';

export const dynamic = 'force-dynamic';

const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));

const PRODUCTS = {
  kospi200: { prefix: '01', env: 'KIS_KOSPI200_CODE', fallbackName: '코스피200 선물' },
  kosdaq150: { prefix: '06', env: 'KIS_KOSDAQ150_CODE', fallbackName: '코스닥150 선물' },
};

// 같은 시점에 여러 요청이 와도 KIS는 한 번만 호출하고, 결과를 30초 동안 재사용합니다.
const CACHE_MS = 30_000;
const caches = (globalThis.__nightFutures ??= {});

export async function GET(_request, { params }) {
  const product = PRODUCTS[params.product];
  if (!product) return Response.json({ error: 'unknown product' }, { status: 404 });
  const cache = (caches[params.product] ??= { at: 0, body: null, pending: null });
  let result;
  if (cache.body && Date.now() - cache.at < CACHE_MS) result = { body: cache.body, status: 200 };
  else {
    if (!cache.pending) cache.pending = load(product, cache).finally(() => (cache.pending = null));
    result = await cache.pending;
  }
  // 만료 임박 경고는 매 응답에 붙입니다 (오류 안내가 이미 있으면 그걸 우선).
  const expiry = keyExpiryNotice();
  const body = expiry && !result.body.notice ? { ...result.body, notice: expiry } : result.body;
  return Response.json(body, { status: result.status });
}

async function load(product, cache) {
  if (!hasKisKeys()) {
    return { body: { error: '.env.local에 KIS_APP_KEY / KIS_APP_SECRET을 설정해 주세요' }, status: 503 };
  }

  const mrkt = process.env.KIS_NIGHT_MRKT_CODE || 'CM';
  const code = process.env[product.env] || frontMonthCode(product.prefix);

  try {
    const { ymd, hms } = kstNow();
    const quote = await kisGet('/uapi/domestic-futureoption/v1/quotations/inquire-price', 'FHMIF10000000', {
      FID_COND_MRKT_DIV_CODE: mrkt,
      FID_INPUT_ISCD: code,
    });
    const chart = await kisGet(
      '/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice',
      'FHKIF03020200',
      {
        FID_COND_MRKT_DIV_CODE: mrkt,
        FID_INPUT_ISCD: code,
        FID_HOUR_CLS_CODE: '60', // 1분봉
        FID_PW_DATA_INCU_YN: 'Y',
        FID_FAKE_TICK_INCU_YN: 'N',
        FID_INPUT_DATE_1: ymd,
        FID_INPUT_HOUR_1: hms,
      }
    ).catch(() => null); // 차트가 실패해도 현재가는 보여줍니다

    const o = quote.output1 || {};
    const price = num(o.futs_prpr);
    if (!Number.isFinite(price) || !o.hts_kor_isnm) throw new Error(`${code} 시세가 비어 있습니다`);
    // 야간선물 등락은 기준가(직전 주간 종가) 대비입니다. 부호 4·5는 하락.
    const sign = ['4', '5'].includes(o.prdy_vrss_sign) ? -1 : 1;
    const change = sign * Math.abs(num(o.futs_prdy_vrss) || 0);
    const prevClose = price - change;
    const changePercent = prevClose ? (change / prevClose) * 100 : 0;

    // 야간 시간은 24시를 넘겨 표기됩니다 (예: 263900 = 다음날 02:39:00).
    const toTime = (d, h) =>
      Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00+09:00`) +
      (Number(h.slice(0, 2)) * 3600 + Number(h.slice(2, 4)) * 60 + Number(h.slice(4, 6))) * 1000;

    const points = (chart?.output2 || [])
      .filter((r) => r.stck_bsop_date && r.stck_cntg_hour && Number.isFinite(num(r.futs_prpr)))
      .map((r) => ({ t: toTime(r.stck_bsop_date, r.stck_cntg_hour), c: num(r.futs_prpr) }))
      .sort((a, b) => a.t - b.t);

    const last = points.at(-1);

    const body = {
      symbol: code,
      name: `${o.hts_kor_isnm || product.fallbackName} (${code})`,
      currency: 'KRW',
      price,
      prevClose,
      prevLabel: '기준가',
      change,
      changePercent,
      marketTime: last ? last.t : Date.now(),
      points: points.length > 1 ? points : [{ t: Date.now() - 1, c: price }, { t: Date.now(), c: price }],
    };
    cache.body = body;
    cache.at = Date.now();
    return { body, status: 200 };
  } catch (err) {
    const message = String(err.message || err);
    // 오류가 나도 직전에 받은 값이 있으면 보여주되, 앱키 문제는 눈에 띄게 알립니다.
    if (cache.body) {
      const body = err.keyProblem ? { ...cache.body, notice: { level: 'error', text: message } } : cache.body;
      return { body, status: 200 };
    }
    if (err.transient) {
      return { body: { error: message, transient: true, retryAfter: err.retryAfter || 65 }, status: 503 };
    }
    return { body: { error: message, keyProblem: Boolean(err.keyProblem), code, mrkt }, status: 502 };
  }
}
