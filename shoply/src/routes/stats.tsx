import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

type StatsResponse = {
  total: number;
  success: number;
  failed: number;
  successRate: number;
  recent: {
    id: string;
    time: string;
    productName: string;
    status: "성공" | "실패" | "대기";
    failReason: string | null;
  }[];
};

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: "현황 — Shoply" },
      { name: "description", content: "실시간 주문 현황 페이지" },
    ],
  }),
  component: StatsPage,
});

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour12: false });
}

function StatsPage() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/stats");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as StatsResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "error");
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const total = data?.total ?? 0;
  const success = data?.success ?? 0;
  const fail = data?.failed ?? 0;
  const rate = data?.successRate ?? 0;
  const recent = data?.recent ?? [];

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-semibold tracking-tight">
            Shoply
          </Link>
          <nav className="flex items-center gap-5 text-sm text-neutral-600">
            <Link to="/" className="hover:text-neutral-900">홈</Link>
            <Link to="/timesale" className="hover:text-neutral-900">타임세일</Link>
            <Link to="/stats" className="font-medium text-neutral-900">현황</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold">실시간 주문 현황</h1>
          <p className="mt-1 text-sm text-neutral-500">
            3초마다 자동 새로고침됩니다. ( /api/stats )
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-600">불러오기 오류: {error}</p>
          )}
        </div>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryCard label="전체 주문 수" value={`${total}건`} />
          <SummaryCard label="성공 주문 수" value={`${success}건`} accent="success" />
          <SummaryCard label="실패 주문 수" value={`${fail}건`} accent="fail" />
          <SummaryCard label="성공률" value={`${rate}%`} />
        </section>

        <section className="mt-8 rounded-lg border border-neutral-200 p-6">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">성공률</span>
            <span className="text-neutral-500">
              {success} / {success + fail} ({rate}%)
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full bg-neutral-900 transition-all duration-500"
              style={{ width: `${rate}%` }}
            />
          </div>
          <div className="mt-4 flex gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-neutral-600">성공 {success}건</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="text-neutral-600">실패 {fail}건</span>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-4 text-lg font-semibold">최근 주문</h2>
          <div className="overflow-hidden rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">주문 시각</th>
                  <th className="px-4 py-3 font-medium">상품명</th>
                  <th className="px-4 py-3 font-medium">상태</th>
                  <th className="px-4 py-3 font-medium">실패 사유</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-neutral-400">
                      아직 주문이 없습니다. 결제 페이지에서 주문을 생성해보세요.
                    </td>
                  </tr>
                ) : (
                  recent.map((o) => (
                    <tr key={o.id} className="border-t border-neutral-100">
                      <td className="px-4 py-3 text-neutral-600">{formatTime(o.time)}</td>
                      <td className="px-4 py-3">{o.productName}</td>
                      <td className="px-4 py-3">
                        {o.status === "성공" ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            성공
                          </span>
                        ) : o.status === "실패" ? (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                            실패
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                            대기
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{o.failReason ?? "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "success" | "fail";
}) {
  const color =
    accent === "success"
      ? "text-emerald-600"
      : accent === "fail"
        ? "text-red-600"
        : "text-neutral-900";
  return (
    <div className="rounded-lg border border-neutral-200 p-5">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
