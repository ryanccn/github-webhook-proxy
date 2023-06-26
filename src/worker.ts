import { Hono } from "hono";

type Bindings = {
	UPSTREAM_URL: string;
	SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.post(`/:path`, async (c) => {
	const path = c.req.param("path");
	if (path !== c.env.SECRET) return c.notFound();

	const data = await c.req.json();
	const event = c.req.header("x-github-event");
	if (!event)
		return c.json({ ok: false, error: "No X-GitHub-Event provided!" }, 400);

	let suppress = false;

	try {
		if (event === "push") {
			if ((data.ref as string).startsWith("refs/heads/renovate/")) {
				suppress = true;
			}
		} else if (event === "pull_request") {
			if (data.pull_request.user.id === 29139614) {
				suppress = true;
			}
		}
	} catch (e) {
		console.error(e);
	}

	if (suppress) {
		return c.json({ ok: true, suppressed: true }, 202);
	}

	const proxyHeaders = new Headers();
	proxyHeaders.set("content-type", "application/json");
	for (const header of c.req.headers.keys()) {
		const normalizedHeader = header.toLowerCase();
		if (
			normalizedHeader.startsWith("x-github-") ||
			normalizedHeader === "user-agent"
		)
			proxyHeaders.append(header, c.req.header(header)!);
	}

	const upstreamRes = await fetch(c.env.UPSTREAM_URL, {
		method: "POST",
		body: JSON.stringify(data),
		headers: proxyHeaders,
	});

	if (!upstreamRes.ok) {
		return c.json(
			{ ok: false, data: await upstreamRes.json() },
			upstreamRes.status
		);
	}

	return c.json({ ok: true, suppressed: false }, 202);
});

export default app;
