'use client';

import { useEffect, useRef } from 'react';

export default function TradingViewWidget({ symbol, label }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || container.dataset.loaded) return;
    container.dataset.loaded = 'true';

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    container.appendChild(widgetDiv);

    const script = document.createElement('script');
    script.src =
      'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol,
      width: '100%',
      height: '100%',
      locale: 'kr',
      dateRange: '3M',
      colorTheme: 'dark',
      isTransparent: true,
      autosize: true,
      largeChartUrl: '',
    });

    container.appendChild(script);
  }, [symbol]);

  return (
    <div className="chart-card">
      <div className="chart-card__title">{label}</div>
      <div className="tradingview-widget-container" ref={containerRef} style={{ height: 220 }} />
    </div>
  );
}
