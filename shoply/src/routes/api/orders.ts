import { createFileRoute } from "@tanstack/react-router";
import { createOrder, type NewOrderItem } from "@/lib/api-store.server";

export const Route = createFileRoute("/api/orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "잘못된 JSON 형식" }, { status: 400 });
        }

        const items = (body as { items?: unknown })?.items;
        if (!Array.isArray(items) || items.length === 0) {
          return Response.json(
            { error: "items 배열이 필요합니다." },
            { status: 400 },
          );
        }

        const parsed: NewOrderItem[] = [];
        for (const it of items) {
          const o = it as Record<string, unknown>;
          const productId = Number(o.productId);
          const size = Number(o.size);
          const quantity = Number(o.quantity);
          if (
            !Number.isInteger(productId) ||
            !Number.isInteger(size) ||
            !Number.isInteger(quantity) ||
            quantity <= 0
          ) {
            return Response.json(
              { error: "items 형식이 잘못되었습니다." },
              { status: 400 },
            );
          }
          parsed.push({ productId, size, quantity });
        }

        const result = await createOrder(parsed);
        if (!result.ok) {
          return Response.json(
            {
              error: result.error,
              productId: result.productId,
              size: result.size,
            },
            { status: 409 },
          );
        }
        return Response.json({
          orderId: result.order.id,
          status: result.order.status,
          total: result.order.total,
          items: result.order.items,
        });
      },
    },
  },
});
