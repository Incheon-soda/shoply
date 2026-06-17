import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShoppingCart } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Shoply — Simple Online Shopping" },
      { name: "description", content: "Shop quality everyday products. Clean, simple online store with the latest sales and arrivals." },
    ],
  }),
});

type Product = {
  id: number;
  name: string;
  price: number;
  stock: "In Stock" | "Low Stock" | "Out of Stock";
};

const products: Product[] = [
  { id: 1, name: "Classic White T-Shirt", price: 24.0, stock: "In Stock" },
  { id: 2, name: "Canvas Tote Bag", price: 18.5, stock: "In Stock" },
  { id: 3, name: "Ceramic Coffee Mug", price: 14.0, stock: "Low Stock" },
  { id: 4, name: "Leather Notebook", price: 32.0, stock: "In Stock" },
  { id: 5, name: "Wireless Earbuds", price: 89.0, stock: "Out of Stock" },
  { id: 6, name: "Denim Cap", price: 22.0, stock: "In Stock" },
  { id: 7, name: "Wool Socks (3-Pack)", price: 16.0, stock: "Low Stock" },
  { id: 8, name: "Stainless Water Bottle", price: 28.0, stock: "In Stock" },
];

function useCountdown(target: Date) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, target.getTime() - now);
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff / 3600000) % 24),
    m: Math.floor((diff / 60000) % 60),
    s: Math.floor((diff / 1000) % 60),
  };
}

const pad = (n: number) => n.toString().padStart(2, "0");

function Index() {
  const saleDate = new Date(Date.now() + 2 * 86400000 + 5 * 3600000);
  const { d, h, m, s } = useCountdown(saleDate);

  const stockColor: Record<Product["stock"], string> = {
    "In Stock": "text-green-600",
    "Low Stock": "text-amber-600",
    "Out of Stock": "text-red-500",
  };

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      {/* Top nav */}
      <header className="border-b border-neutral-200">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <a href="/" className="text-xl font-semibold tracking-tight">
            Shop<span className="text-neutral-400">ly</span>
          </a>
          <ul className="hidden items-center gap-8 text-sm text-neutral-600 md:flex">
            <li><a href="#" className="hover:text-neutral-900">Shop</a></li>
            <li><a href="#" className="hover:text-neutral-900">New</a></li>
            <li><Link to="/timesale" className="hover:text-neutral-900">Sale</Link></li>
            <li><a href="#" className="hover:text-neutral-900">About</a></li>
            <li><Link to="/login" className="hover:text-neutral-900">로그인</Link></li>
          </ul>
          <button
            aria-label="Cart"
            className="relative inline-flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-50"
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">Cart</span>
            <span className="rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">0</span>
          </button>
        </nav>
      </header>

      {/* Sale banner */}
      <section className="border-b border-neutral-200 bg-neutral-50">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:px-6 md:flex-row md:py-12">
          <div className="text-center md:text-left">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
              Upcoming Sale
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
              Summer Sale — Up to 40% Off
            </h1>
            <p className="mt-2 text-sm text-neutral-600">
              Sitewide discounts on selected items. Don't miss out.
            </p>
          </div>
          <div className="flex gap-2 sm:gap-3">
            {[
              { label: "Days", value: d },
              { label: "Hours", value: h },
              { label: "Min", value: m },
              { label: "Sec", value: s },
            ].map((t) => (
              <div
                key={t.label}
                className="min-w-[60px] rounded-md border border-neutral-200 bg-white px-3 py-2 text-center sm:min-w-[68px]"
              >
                <div className="text-xl font-semibold tabular-nums sm:text-2xl">{pad(t.value)}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
                  {t.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product grid */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-lg font-semibold tracking-tight md:text-xl">Featured Products</h2>
          <a href="#" className="text-sm text-neutral-500 hover:text-neutral-900">View all</a>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <Link
              key={p.id}
              to="/products/$productId"
              params={{ productId: String(p.id) }}
              className="group"
            >
              <article>
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md bg-neutral-100 transition group-hover:bg-neutral-200">
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
                <div className="mt-3 space-y-1">
                  <h3 className="text-sm font-medium text-neutral-900">{p.name}</h3>
                  <p className="text-sm text-neutral-700">${p.price.toFixed(2)}</p>
                  <p className={`text-xs ${stockColor[p.stock]}`}>{p.stock}</p>
                </div>
              </article>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-neutral-500 sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} Shoply. All rights reserved.</span>
          <span>Privacy · Terms · Contact</span>
        </div>
      </footer>
    </div>
  );
}
