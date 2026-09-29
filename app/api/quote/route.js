// 실제 지수 데이터를 가져오는 API 라우트.
// TradingView 무료 위젯은 KRX:KOSPI, NASDAQ:NDX, SP:SPX 같은 실제 지수 심볼을
// "트레이딩뷰에서만 쓸 수 있습니다"로 막아 두어서, 지수는 Yahoo Finance에서 직접 받아옵니다.
export const revalidate = 60;

const ALLOWED = new Set(['^KS11', '^NDX', '^GSPC', 'KRW=X', 'CL=F']);

// 기간별 차트 간격 (기간이 짧을수록 촘촘하게)
const INTERVALS = {
  '1d': '5m',
  '5d': '30m',
  '1mo': '1d',
  '3mo': '1d',
  '6mo': '1d',
  '1y': '1d',
  '5y': '1wk',
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const range = searchParams.get('range') || '3mo';

  if (!ALLOWED.has(symbol)) {
    return Response.json({ error: 'unsupported symbol' }, { status: 400 });
  }
  if (!INTERVALS[range]) {
    return Response.json({ error: 'unsupported range' }, { status: 400 });
  }
  const interval = INTERVALS[range];

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error('no data');

    const { meta, timestamp = [], indicators } = result;
    const closes = indicators?.quote?.[0]?.close ?? [];
    const points = timestamp
      .map((t, i) => ({ t: t * 1000, c: closes[i] }))
      .filter((p) => typeof p.c === 'number');

    const price = meta.regularMarketPrice ?? points.at(-1)?.c;
    // Yahoo가 전일 대비 등락률을 주면 그 기준을 따릅니다(환율처럼 24시간 거래되는 상품은
    // 일봉 마지막 두 개와 Yahoo의 '전일 종가' 시점이 달라서). 없으면 일봉 두 개로 계산합니다.
    const pct = meta.regularMarketChangePercent;
    const prevClose =
      typeof pct === 'number'
        ? price / (1 + pct / 100)
        : interval.endsWith('d') && points.length > 1
          ? points.at(-2).c
          : (meta.previousClose ?? meta.chartPreviousClose);
    const change = price - prevClose;
    const changePercent = (change / prevClose) * 100;

    return Response.json({
      symbol,
      name: meta.shortName || meta.longName || symbol,
      currency: meta.currency,
      price,
      prevClose,
      change,
      changePercent,
      marketTime: (meta.regularMarketTime ?? 0) * 1000,
      range,
      interval,
      points,
    });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 502 });
  }
}
