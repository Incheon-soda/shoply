import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/products/$productId')({ component: ProductDetailPage });

function ProductDetailPage() {
  const { productId } = Route.useParams();
  const [selectedSize, setSelectedSize] = useState<number | null>(null);

  const sizes = [240, 250, 260, 270, 280, 290];

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="text-xl font-semibold tracking-tight">Shop<span className="text-neutral-400">ly</span></Link>
          <Link to="/" className="text-sm text-neutral-500 hover:text-neutral-900">← 목록으로</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <div className="flex aspect-square items-center justify-center rounded-lg bg-neutral-100">
            <svg className="h-20 w-20 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="M21 15l-5-5L5 21" />
            </svg>
          </div>

          <div>
            <p className="text-xs text-neutral-500">상품번호 #{productId}</p>
            <h1 className="mt-2 text-2xl font-semibold">상품명</h1>
            <p className="mt-4 text-2xl font-bold">₩00,000</p>
            <p className="mt-4 text-sm text-neutral-600">상품 설명이 여기에 표시됩니다.</p>

            <div className="mt-6">
              <p className="mb-2 text-sm font-medium">사이즈 선택</p>
              <div className="flex flex-wrap gap-2">
                {sizes.map((s) => (
                  <button key={s} type="button" onClick={() => setSelectedSize(s)}
                    className={`rounded-md border px-4 py-2 text-sm transition ${selectedSize === s ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 hover:border-neutral-400'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <Link to="/checkout"
              className="mt-8 block w-full rounded-md bg-neutral-900 py-3 text-center text-sm font-medium text-white transition hover:bg-neutral-800">
              구매하기
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
