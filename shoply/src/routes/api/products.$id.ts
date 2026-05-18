import { createFileRoute } from "@tanstack/react-router";
import { getProductDetail } from "@/lib/api-store.server";

export const Route = createFileRoute("/api/products/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = parseInt(params.id, 10);
        if (!Number.isFinite(id)) {
          return Response.json({ error: "잘못된 상품 ID" }, { status: 400 });
        }
        const product = getProductDetail(id);
        if (!product) {
          return Response.json({ error: "상품을 찾을 수 없습니다." }, { status: 404 });
        }
        return Response.json({ product });
      },
    },
  },
});
