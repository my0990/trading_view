import './globals.css';

export const metadata = {
  title: '마켓 대시보드',
  description: '코스피, 환율, 유가, 나스닥 100, S&P 500을 한눈에',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
