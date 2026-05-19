import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { email?: string; password?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ message: "잘못된 요청입니다." }, { status: 400 });
        }
        const email = (body.email ?? "").trim();
        const password = body.password ?? "";

        if (!email || !password) {
          return Response.json(
            { message: "이메일 또는 비밀번호가 올바르지 않습니다." },
            { status: 401 },
          );
        }

        // Mock auth: any email + password length >= 4 succeeds.
        if (password.length < 4) {
          return Response.json(
            { message: "이메일 또는 비밀번호가 올바르지 않습니다." },
            { status: 401 },
          );
        }

        const user = {
          id: `u_${Math.random().toString(36).slice(2, 10)}`,
          email,
          name: email.split("@")[0],
        };
        const payload = btoa(JSON.stringify({ sub: user.id, email, iat: Date.now() }));
        const token = `mock.${payload}.sig`;

        return Response.json({ token, user });
      },
    },
  },
});
