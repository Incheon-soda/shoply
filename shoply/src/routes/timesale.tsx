import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShoppingCart, Timer } from "lucide-react";

type TimesaleProduct = {
  id: number;
  name: string;
  originalPrice: number;
  salePrice: number;
  stock: number;
  totalStock: number;
};

const timesaleProducts: TimesaleProduct[] = [
  {
    id: 1,
    name: "클래식 화이트 티셔츠",
    originalPrice: 24000,
    salePrice: 16800,
    stock: 12,
    totalStock: 50,
  },
  {
    id: 2,
    name: "캔버스 토트백",
    originalPrice: 18500,
    salePrice: 12950,
    stock: 8,
    totalStock: 30,
  },
  {
    id: 3,
    name: "세라믹 커피 머그",
    originalPrice: 14000,
    salePrice: 9800,
    stock: 3,
    totalStock: 40,
  },
  {
    id: 4,
    name: "가죽 노트북",
    originalPrice: 32000,
    salePrice: 22400,
    stock: 20,
    totalStock: 40,
  },
  {
    id: 5,
    name: "무선 이어버드",
    originalPrice: 89000,
    salePrice: 62300,
    stock: 0,
    totalStock: 20,
  },
  {
    id: 6,
    name: "데님 캡",
    originalPrice: 22000,
    salePrice: 15400,
    stock: 15,
    totalStock: 35,
  },
];

function useCountdown(target: Date) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = target.getTime() - now;
  const ended = diff <= 0;
  const absDiff = Math.abs(diff);
  return {
    ended,
    h: Math.floor((absDiff / 3600000) % 24),
    m: Math.floor((absDiff / 60000) % 60),
    s: Math.floor((absDiff / 1000) % 60),
  };
}

const pad = (n: number) => n.toString().padStart(2, "0");

function formatPrice(n: number) {
  return n.toLocaleString("ko-KR");
}

function discountRate(original: number, sale: number) {
  return Math.round(((original - sale) / original) * 100);
}

function stockPercent(stock: number, total: number) {
  if (total === 0) return 0;
  return Math.round((stock / total) * 100);
}

export const Route = createFileRoute("/timesale")({
  component: TimesalePage,
  head: () => ({
    meta: [
      { title: "타임세일 — Shoply" },
      { name: "description", content: "Shoply 타임세일 — 한정 시간 동안 특별한 가격으로 만나보세요." },
    ],
  }),
});

function TimesalePage() {
  const saleEnd = new Date(Date.now() + 5 * 3600000 + 47 * 60000 + 12 * 1000);
  const { ended, h, m, s } = useCountdown(saleEnd);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      {/* Top nav */}
      <header className="border-b border-neutral-200">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="text-xl font-semibold tracking-tight">
            Shop<span className="text-neutral-400">ly</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="hidden text-sm text-neutral-600 hover:text-neutral-900 sm:inline"
            >
              상품 목록
            </Link>
            <button
              aria-label="장바구니"
              className="relative inline-flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-50"
            >
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">장바구니</span>
              <span className="rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                0
              </span>
            </button>
          </div>
        </nav>
      </header>

      {/* Countdown banner */}
      <section className="border-b border-neutral-200 bg-neutral-50">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-red-500" />
            {ended ? (
              <span className="rounded-full bg-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700">
                타임세일 준비중
              </span>
            ) : (
              <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white">
                타임세일 진행중
              </span>
            )}
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
            {ended ? "다음 타임세일을 기대해주세요" : "한정 타임세일"}
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            {ended
              ? "지금은 타임세일 기간이 아닙니다. 다음 세일을 기다려주세요."
              : "남은 시간 동안 특별한 가격으로 만나보세요."}
          </p>

          <div className="mt-6 flex items-center gap-2 sm:gap-3">
            {[
              { label: "시간", value: h },
              { label: "분", value: m },
              { label: "초", value: s },
            ].map((t, i) => (
              <div key={t.label} className="flex items-center gap-2 sm:gap-3">
                <div className="min-w-[72px] rounded-lg border border-neutral-200 bg-white px-4 py-3 text-center sm:min-w-[88px] sm:px-5 sm:py-4">
                  <div className="text-2xl font-bold tabular-nums text-neutral-900 sm:text-3xl">
                    {pad(t.value)}
                  </div>
                  <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                    {t.label}
                  </div>
                </div>
                {i < 2 && (
                  <span className="text-xl font-bold text-neutral-400 sm:text-2xl">
                    :
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product list */}
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <h2 className="text-lg font-semibold tracking-tight md:text-xl">
          타임세일 상품
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          수량 한정 — 품절 전에 서두르세요
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {timesaleProducts.map((p) => {
            const rate = discountRate(p.originalPrice, p.salePrice);
            const pct = stockPercent(p.stock, p.totalStock);
            const soldOut = p.stock === 0;

            return (
              <div
                key={p.id}
                className="flex flex-col rounded-lg border border-neutral-200 bg-white p-4 transition hover:shadow-sm sm:p-5"
              >
                {/* Image placeholder */}
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-neutral-100">
                  <svg
                    className="h-10 w-10 text-neutral-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="9" cy="9" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </div>

                <div className="mt-4 flex items-start justify-between gap-3">
                  <h3 className="text-sm font-medium text-neutral-900">
                    {p.name}
                  </h3>
                  {!soldOut && (
                    <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-500">
                      {rate}% 할인
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-lg font-bold text-red-500">
                    {formatPrice(p.salePrice)}원
                  </span>
                  <span className="text-sm text-neutral-400 line-through">
                    {formatPrice(p.originalPrice)}원
                  </span>
                </div>

                {/* Stock bar */}
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span
                      className={soldOut ? "text-red-500" : "text-neutral-600"}
                    >
                      {soldOut
                        ? "품절"
                        : `남은 수량: ${p.stock}개`}
                    </span>
                    {!soldOut && (
                      <span className="text-neutral-400">{pct}%</span>
                    )}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className={`h-full rounded-full transition-all ${
                        soldOut
                          ? "bg-neutral-300"
                          : pct <= 20
                          ? "bg-red-500"
                          : pct <= 50
                          ? "bg-amber-400"
                          : "bg-green-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={soldOut}
                  className="mt-4 w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                >
                  {soldOut ? "품절" : "구매하기"}
                </button>
              </div>
            );
          })}
        </div>
      </main>

      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-neutral-500 sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} Shoply. 모든 권리 보유.</span>
          <span>개인정보 · 이용약관 · 문의</span>
        </div>
      </footer>
    </div>
  );
}
