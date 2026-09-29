'use client';

import { useEffect, useRef, useState } from 'react';

// 한국식 색상: 상승 빨강, 하락 파랑, 보합 회색
const UP = '#f04452';
const DOWN = '#3d8bfd';
const FLAT = '#8b929c';

// 소수 둘째 자리에서 0이 되면 보합으로 봅니다 (-0.00% 같은 표시 방지)
const isFlat = (pct) => !Number.isFinite(pct) || Math.abs(pct) < 0.005;
const toneColor = (pct) => (isFlat(pct) ? FLAT : pct > 0 ? UP : DOWN);
const signOf = (pct) => (!isFlat(pct) && pct > 0 ? '+' : '');

function fmt(n, digits = 2) {
  if (Math.abs(n) < 0.5 * 10 ** -digits) n = 0; // -0.00 방지
  return n.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const RANGES = [
  { key: '1d', label: '1일' },
  { key: '5d', label: '5일' },
  { key: '1mo', label: '1개월' },
  { key: '3mo', label: '3개월' },
  { key: '6mo', label: '6개월' },
  { key: '1y', label: '1년' },
  { key: '5y', label: '5년' },
];
const INTRADAY = new Set(['1d', '5d']);

function fmtDate(t, withTime) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

// 차트 아래에 보여줄 기간: "2026.06.26 ~ 2026.09.25 · 기간 +3.21%"
function periodText(points, intraday) {
  if (!points?.length) return '';
  const first = points[0];
  const last = points.at(-1);
  const startStr = fmtDate(first.t, intraday);
  let endStr = fmtDate(last.t, intraday);
  // 같은 날짜 안이면 끝은 시각만
  if (intraday && startStr.slice(0, 10) === endStr.slice(0, 10)) endStr = endStr.slice(11);
  const pct = ((last.c - first.c) / first.c) * 100;
  return { range: `${startStr} ~ ${endStr}`, pct };
}

function Sparkline({ points, color, intraday }) {
  const W = 300;
  const H = 120;
  const PAD = 4;
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null); // 마우스가 가리키는 점의 index

  const values = points.map((p) => p.c);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xOf = (i) => (i / Math.max(values.length - 1, 1)) * W;
  const yOf = (v) => H - ((v - min) / span) * (H - PAD * 2) - PAD;
  const line = values
    .map((v, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const gid = `g-${color.slice(1)}`;

  // 마우스(터치) 위치에서 가장 가까운 점 찾기
  const onMove = (e) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !values.length) return;
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    setHover(Math.round(ratio * (values.length - 1)));
  };

  const h = hover !== null && points[hover] ? points[hover] : null;
  const hx = h ? (xOf(hover) / W) * 100 : 0; // %
  const hy = h ? (yOf(h.c) / H) * 100 : 0; // %
  const first = values[0];
  const diffPct = h ? ((h.c - first) / first) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      className="index-card__chart"
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="index-card__svg">
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {h && (
        <>
          <div className="chart-hover__line" style={{ left: `${hx}%` }} />
          <div
            className="chart-hover__dot"
            style={{ left: `${hx}%`, top: `${hy}%`, background: color }}
          />
          <div
            className={`chart-hover__tip${hx > 60 ? ' is-left' : ''}`}
            style={{ left: `${hx}%` }}
          >
            <div className="chart-hover__value">{fmt(h.c)}</div>
            <div className="chart-hover__date">{fmtDate(h.t, intraday)}</div>
            <div style={{ color: toneColor(diffPct) }}>
              시작 대비 {signOf(diffPct)}
              {fmt(diffPct)}%
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function IndexChartCard({ symbol, label, endpoint, rangeLabel, handle }) {
  // endpoint가 따로 있는 카드(야간선물)는 기간 선택 없이 고정 기간을 씁니다.
  const selectable = !endpoint;
  const storageKey = `range:${symbol}`;
  const [range, setRange] = useState('3mo');
  const url = endpoint || `/api/quote?symbol=${encodeURIComponent(symbol)}&range=${range}`;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [keyProblem, setKeyProblem] = useState(false);
  const [waiting, setWaiting] = useState(false); // 일시적 제한으로 잠시 대기 중

  // 카드별로 마지막에 고른 기간을 기억합니다.
  useEffect(() => {
    if (!selectable) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && RANGES.some((r) => r.key === saved)) setRange(saved);
    } catch {}
  }, [selectable, storageKey]);

  const chooseRange = (key) => {
    setRange(key);
    setData(null);
    try {
      localStorage.setItem(storageKey, key);
    } catch {}
  };

  useEffect(() => {
    let alive = true;
    let retryTimer;
    const load = () =>
      fetch(url)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          clearTimeout(retryTimer);
          if (d.transient) {
            // 토큰 1분당 1회 등 잠깐의 제한: 오류 대신 안내하고 제한이 풀리면 바로 다시 시도
            setWaiting(true);
            setError(null);
            retryTimer = setTimeout(load, (Math.min(d.retryAfter || 65, 70) + 2) * 1000);
            return;
          }
          setWaiting(false);
          if (d.error) {
            setError(d.error);
            setKeyProblem(Boolean(d.keyProblem));
          } else {
            setData(d);
            setError(null);
          }
        })
        .catch((e) => alive && setError(String(e)));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
      clearTimeout(retryTimer);
    };
  }, [url]);

  const color = data ? toneColor(data.changePercent) : FLAT;
  const sign = data ? signOf(data.changePercent) : '';
  const intraday = selectable ? INTRADAY.has(range) : true;
  const period = data ? periodText(data.points, intraday) : null;
  const shownRange = selectable ? RANGES.find((r) => r.key === range)?.label : rangeLabel;

  return (
    <div className="chart-card">
      <div className="chart-card__head">
        <div className="chart-card__title">
          {handle}
          {label}
        </div>
        {selectable && (
          <div className="range-tabs" role="tablist" aria-label="기간 선택">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                role="tab"
                aria-selected={r.key === range}
                className={`range-tabs__btn${r.key === range ? ' is-active' : ''}`}
                onClick={() => chooseRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="index-card" style={{ height: 240 }}>
        {error && keyProblem && <div className="card-notice card-notice--error">{error}</div>}
        {error && !keyProblem && (
          <div className="index-card__status">데이터를 불러오지 못했습니다 ({error})</div>
        )}
        {!error && !data && (
          <div className="index-card__status">
            {waiting ? '연결 준비 중이에요. 잠시 후 자동으로 불러옵니다…' : '불러오는 중…'}
          </div>
        )}
        {data && (
          <>
            {data.notice && (
              <div className={`card-notice card-notice--${data.notice.level}`}>{data.notice.text}</div>
            )}
            <div className="index-card__quote">
              <span className="index-card__price">{fmt(data.price)}</span>
              <span className="index-card__change" style={{ color }}>
                {sign}
                {fmt(isFlat(data.changePercent) ? 0 : data.change)} ({sign}
                {fmt(data.changePercent)}%)
              </span>
              {typeof data.prevClose === 'number' && (
                <span className="index-card__prev">
                  {data.prevLabel || '전일 종가'} {fmt(data.prevClose)}
                </span>
              )}
            </div>
            <Sparkline points={data.points} color={color} intraday={intraday} />
            {period && (
              <div className="index-card__period">
                <span>
                  {shownRange} · {period.range}
                </span>
                <span style={{ color: toneColor(period.pct) }}>
                  기간 {signOf(period.pct)}
                  {fmt(period.pct)}%
                </span>
              </div>
            )}
            <div className="index-card__meta">
              {data.name} · {new Date(data.marketTime).toLocaleString('ko-KR')} 기준
            </div>
          </>
        )}
      </div>
    </div>
  );
}
