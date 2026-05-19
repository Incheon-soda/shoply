import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { apiFetch } from "@/lib/auth";

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "주문/결제 — Shoply" },
      { name: "description", content: "주문 확인 및 결제 페이지" },
    ],
  }),
  component: CheckoutPage,
});

type OrderItem = {
  id: number;
  name: string;
  size: number;
  quantity: number;
  price: number;
};

const mockOrder: OrderItem[] = [
  { id: 1, name: "클래식 화이트 티셔츠", size: 250, quantity: 1, price: 24000 },
  { id: 2, name: "데님 캡", size: 270, quantity: 2, price: 22000 },
];

type PaymentMethod = "card" | "bank";
type Status = "idle" | "processing" | "success" | "failed";

function CheckoutPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [status, setStatus] = useState<Status>("idle");
  const [failReason, setFailReason] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  const total = mockOrder.reduce((s, i) => s + i.price * i.quantity, 0);

  const handlePay = async () => {
    if (!name || !phone || !address) {
      alert("배송지 정보를 모두 입력해주세요.");
      return;
    }
    setStatus("processing");
    setFailReason(null);
    try {
      // 1) Create order (reserves stock)
      const orderRes = await apiFetch("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          items: mockOrder.map((i) => ({
            productId: i.id,
            size: i.size,
            quantity: i.quantity,
          })),
        }),
      });
      const orderData = (await orderRes.json()) as
        | { orderId: string; status: string }
        | { error: string };
      if (!orderRes.ok || !("orderId" in orderData)) {
        setStatus("failed");
        setFailReason(
          "error" in orderData ? orderData.error : "주문 생성 실패",
        );
        return;
      }
      setOrderId(orderData.orderId);

      // 2) Process payment
      const payRes = await apiFetch("/api/payments", {
        method: "POST",
        body: JSON.stringify({ orderId: orderData.orderId, method }),
      });
      const payData = (await payRes.json()) as
        | { status: "PAID" }
        | { status: "FAILED"; failedReason: string }
        | { error: string };
      if (!payRes.ok || "error" in payData) {
        setStatus("failed");
        setFailReason(
          "error" in payData ? payData.error : "결제 처리 오류",
        );
        return;
      }
      if (payData.status === "PAID") {
        setStatus("success");
      } else {
        setStatus("failed");
        setFailReason(payData.failedReason);
      }
    } catch (err) {
      setStatus("failed");
      setFailReason(err instanceof Error ? err.message : "네트워크 오류");
    }
  };

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-semibold tracking-tight">
            Shoply
          </Link>
          <nav className="flex gap-5 text-sm text-neutral-600">
            <Link to="/">홈</Link>
            <Link to="/timesale">타임세일</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-8 text-2xl font-semibold">주문/결제</h1>

        {status === "success" ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
            <p className="text-lg font-semibold text-green-700">
              주문이 완료되었습니다
            </p>
            <p className="mt-2 text-sm text-neutral-600">
              감사합니다. 곧 배송이 시작됩니다.
            </p>
            {orderId && (
              <p className="mt-2 font-mono text-xs text-neutral-500">
                주문번호: {orderId}
              </p>
            )}
            <Link
              to="/"
              className="mt-6 inline-block rounded-md bg-neutral-900 px-5 py-2 text-sm text-white"
            >
              홈으로 돌아가기
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 주문 확인 */}
            <section className="rounded-lg border border-neutral-200 p-5">
              <h2 className="mb-4 text-base font-semibold">주문 확인</h2>
              <ul className="divide-y divide-neutral-100">
                {mockOrder.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        사이즈 {item.size} · 수량 {item.quantity}개
                      </p>
                    </div>
                    <p className="font-medium">
                      ₩{(item.price * item.quantity).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center justify-between border-t border-neutral-200 pt-4">
                <span className="text-sm text-neutral-600">총 결제 금액</span>
                <span className="text-lg font-semibold">
                  ₩{total.toLocaleString()}
                </span>
              </div>
            </section>

            {/* 배송지 입력 */}
            <section className="rounded-lg border border-neutral-200 p-5">
              <h2 className="mb-4 text-base font-semibold">배송지 입력</h2>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-neutral-600">
                    이름
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="홍길동"
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-600">
                    연락처
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-600">
                    주소
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="서울시 강남구 ..."
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </div>
              </div>
            </section>

            {/* 결제 */}
            <section className="rounded-lg border border-neutral-200 p-5">
              <h2 className="mb-4 text-base font-semibold">결제 수단</h2>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    { v: "card", label: "신용카드" },
                    { v: "bank", label: "무통장입금" },
                  ] as { v: PaymentMethod; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setMethod(opt.v)}
                    className={`rounded-md border px-4 py-3 text-sm transition-colors ${
                      method === opt.v
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {status === "failed" && (
                <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  결제에 실패하였습니다{failReason ? ` — ${failReason}` : ""}. 다시 시도해주세요.
                </p>
              )}

              <button
                type="button"
                onClick={handlePay}
                disabled={status === "processing"}
                className="mt-5 w-full rounded-md bg-neutral-900 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {status === "processing"
                  ? "결제 처리 중..."
                  : `₩${total.toLocaleString()} 결제하기`}
              </button>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
