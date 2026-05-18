import { createFileRoute } from "@tanstack/react-router";
import { processPayment } from "@/lib/api-store.server";

export const Route = createFileRoute("/api/payments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "잘못된 JSON 형식" }, { status: 400 });
        }
        const orderId = (body as { orderId?: unknown })?.orderId;
        if (typeof orderId !== "string" || !orderId) {
          return Response.json({ error: "orderId가 필요합니다." }, { status: 400 });
        }

        const result = await processPayment(orderId);
        if (!result.ok) {
          return Response.json({ error: result.error }, { status: 400 });
        }
        const o = result.order;
        if (o.status === "PAID") {
          return Response.json({
            orderId: o.id,
            status: "PAID",
            paidAt: o.paidAt,
            total: o.total,
          });
        }
        return Response.json({
          orderId: o.id,
          status: "FAILED",
          failedAt: o.failedAt,
          failedReason: o.failedReason,
        });
      },
    },
  },
});
