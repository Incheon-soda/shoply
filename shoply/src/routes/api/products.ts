import { createFileRoute } from "@tanstack/react-router";
import { listProducts } from "@/lib/api-store.server";

export const Route = createFileRoute("/api/products")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({ products: listProducts() });
      },
    },
  },
});
