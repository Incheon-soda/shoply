import { createFileRoute } from "@tanstack/react-router";
import { getStats } from "@/lib/api-store.server";

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(getStats());
      },
    },
  },
});
