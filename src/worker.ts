import { Hono } from "hono";
import { object, string, minLength, safeParse } from "valibot";
import { generateSecret, validate } from "./lib";

type Bindings = {
	UPSTREAM_URL: string;
	WEBHOOK_SECRETS: KVNamespace;
	API_SECRET?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const RENOVATE_ID = 29139614;
const DEPENDABOT_ID = 49699333;

app.get("/", (c) => c.redirect("https://github.com/ryanccn/github-webhook-proxy"));

app.post(`/:key`, async (c) => {
	const key = c.req.param("key");
	const webhookSecret = await c.env.WEBHOOK_SECRETS.get(key);

	if (!webhookSecret) {
		return c.notFound();
	}

	const rawData = await c.req.arrayBuffer();

	const upstreamSignature = c.req.header("x-hub-signature-256");
	if (!upstreamSignature) return c.json({ error: "Unauthorized" }, 401);

	const signatureIsValid = await validate({
		data: rawData,
		secret: webhookSecret,
		signature: upstreamSignature,
	});

	if (!signatureIsValid) return c.json({ error: "Unauthorized" }, 401);

	const event = c.req.header("x-github-event");
	if (!event) {
		return c.json({ ok: false, error: "No x-github-event header provided!" }, 400);
	}

	const data = JSON.parse(new TextDecoder().decode(rawData));

	let suppress = false;

	try {
		if (event === "push") {
			if (
				(data.ref as string)?.startsWith("refs/heads/renovate/") ||
				(data.ref as string)?.startsWith("refs/heads/dependabot/")
			) {
				suppress = true;
			}
		} else if (event === "pull_request") {
			if (
				data.pull_request.user?.id === RENOVATE_ID ||
				data.pull_request.user?.id === DEPENDABOT_ID
			) {
				suppress = true;
			}
		} else if (event === "issue") {
			if (data.issue.user?.id === RENOVATE_ID || data.issue.user?.id === DEPENDABOT_ID) {
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
		if (normalizedHeader.startsWith("x-github-") || normalizedHeader === "user-agent")
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			proxyHeaders.append(header, c.req.header(header)!);
	}

	const upstreamRes = await fetch(c.env.UPSTREAM_URL, {
		method: "POST",
		body: JSON.stringify(data),
		headers: proxyHeaders,
	});

	if (!upstreamRes.ok) {
		return c.json({ ok: false, data: await upstreamRes.json() }, upstreamRes.status);
	}

	return c.json({ ok: true, suppressed: false }, 202);
});

const apiNewSchema = object({ name: string([minLength(1)]) });

app.post("/api/new", async (c) => {
	const authHeader = c.req.header("authorization");
	if (!c.env.API_SECRET || authHeader !== `Bearer ${c.env.API_SECRET}`) {
		return c.json({ ok: false, error: "unauthorized" }, 401);
	}

	const body = await c.req.json<unknown>();
	const parsedBody = safeParse(apiNewSchema, body);

	if (!parsedBody.success) {
		return c.json({ ok: false, error: "bad request" }, 400);
	}

	const { name } = parsedBody.data;

	const existing = await c.env.WEBHOOK_SECRETS.get(name);
	if (existing) {
		return c.json({ ok: false, error: "already exists" }, 400);
	}

	const secret = generateSecret();
	await c.env.WEBHOOK_SECRETS.put(name, secret);
	return c.json({ ok: true, secret });
});

app.onError((error, c) => {
	console.error(error);
	return c.json({ error: "An internal server error occurred" }, 500);
});

export default app;
