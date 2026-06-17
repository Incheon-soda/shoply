import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { getProduct, getStockStatus, type SizeStock } from "@/lib/products";

export const Route = createFileRoute("/products/$productId")({
  component: ProductDetail,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">상품을 찾을 수 없습니다</h1>
      <Link to="/" className="mt-4 inline-block text-sm text-neutral-600 underline">
        홈으로 돌아가기
      </Link>
    </div>
  ),
  loader: ({ params }) => {
    const product = getProduct(parseInt(params.productId, 10));
    if (!product) throw notFound();
    return { product };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.product.name ?? "상품"} — Shoply` },
      { name: "description", content: loaderData?.product.description ?? "" },
    ],
  }),
});

function ProductDetail() {
  const { product } = Route.useLoaderData();
  const firstAvailable = product.sizes.find((s: SizeStock) => s.stock > 0)?.size ?? null;
  const [selected, setSelected] = useState<number | null>(firstAvailable);

  const status = getStockStatus(product);
  const statusColor =
    status === "재고 있음"
      ? "text-green-600"
      : status === "재고 부족"
      ? "text-amber-600"
      : "text-red-500";

  const canBuy = status !== "품절" && selected !== null;

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      {/* Top nav */}
      <header className="border-b border-neutral-200">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="text-xl font-semibold tracking-tight">
            Shop<span className="text-neutral-400">ly</span>
          </Link>
          <button
            aria-label="장바구니"
            className="relative inline-flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-50"
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">장바구니</span>
            <span className="rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">0</span>
          </button>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <nav className="mb-6 text-sm text-neutral-500">
          <Link to="/" className="hover:text-neutral-900">홈</Link>
          <span className="mx-2">/</span>
          <span className="text-neutral-700">{product.name}</span>
        </nav>

        <div className="grid gap-10 md:grid-cols-2">
          {/* Image */}
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-neutral-100">
            <svg
              className="h-16 w-16 text-neutral-300"
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

          {/* Info */}
          <div className="flex flex-col">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{product.name}</h1>
            <p className="mt-2 text-2xl font-medium text-neutral-900">${product.price.toFixed(2)}</p>
            <p className={`mt-2 text-sm font-medium ${statusColor}`}>{status}</p>

            <p className="mt-6 text-sm leading-relaxed text-neutral-600">{product.description}</p>

            {/* Size selector */}
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-neutral-900">사이즈 선택</h2>
                {selected && (
                  <span className="text-xs text-neutral-500">선택: {selected}</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
                {product.sizes.map(({ size, stock }: SizeStock) => {
                  const disabled = stock === 0;
                  const isSelected = selected === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelected(size)}
                      className={[
                        "flex flex-col items-center justify-center rounded-md border px-3 py-3 text-sm transition",
                        disabled
                          ? "cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-300 line-through"
                          : isSelected
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-300 bg-white text-neutral-900 hover:border-neutral-900",
                      ].join(" ")}
                    >
                      <span className="font-medium">{size}</span>
                      <span
                        className={[
                          "mt-0.5 text-[11px]",
                          disabled
                            ? "text-neutral-400 no-underline"
                            : isSelected
                            ? "text-white/70"
                            : "text-neutral-500",
                        ].join(" ")}
                      >
                        {disabled ? "품절" : `재고: ${stock}개`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled={!canBuy}
                className="flex-1 rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                구매하기
              </button>
              <button
                type="button"
                disabled={!canBuy}
                className="flex-1 rounded-md border border-neutral-900 bg-white px-6 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-300"
              >
                장바구니 담기
              </button>
            </div>

            {!canBuy && status === "품절" && (
              <p className="mt-3 text-xs text-red-500">현재 모든 사이즈가 품절되었습니다.</p>
            )}
          </div>
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
