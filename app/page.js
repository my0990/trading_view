import Dashboard from './components/Dashboard';

// TradingView 무료 위젯은 실제 지수 심볼을 막아 두어 대체 심볼(EWY ETF, CFD)을 쓰면 값이 틀립니다.
// 그래서 지수·환율·유가는 /api/quote(Yahoo Finance), 코스피200·코스닥150 야간선물은 /api/night-futures(한국투자증권)에서 받아옵니다.
const SYMBOLS = [
  { symbol: '^KS11', label: '코스피 (KOSPI)' },
  { symbol: 'KRW=X', label: '원/달러 환율 (USD/KRW)' },
  { symbol: 'CL=F', label: 'WTI 유가 (최근월물 선물, 달러)' },
  { symbol: '^NDX', label: '나스닥 100 (Nasdaq 100)' },
  { symbol: '^GSPC', label: 'S&P 500' },
  {
    symbol: 'KOSPI200-NIGHT',
    label: '코스피200 야간선물',
    endpoint: '/api/night-futures/kospi200',
    rangeLabel: '1분봉',
  },
  {
    symbol: 'KOSDAQ150-NIGHT',
    label: '코스닥150 야간선물',
    endpoint: '/api/night-futures/kosdaq150',
    rangeLabel: '1분봉',
  },
];

export default function Home() {
  return (
    <main className="dashboard">
      <header className="dashboard__header">
        <h1>마켓 대시보드</h1>
        <p>코스피 · 환율 · 유가 · 나스닥 100 · S&amp;P 500 · 코스피·코스닥 야간선물을 한눈에 확인하세요</p>
      </header>
      <Dashboard items={SYMBOLS} />
    </main>
  );
}
