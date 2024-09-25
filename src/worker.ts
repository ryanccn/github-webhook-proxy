import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";

import { object, string, minLength, pipe } from "valibot";
import { vValidator } from "@hono/valibot-validator";

import { generateSecret, normalizeDiscordWebhook, validate } from "./lib";

type Bindings = {
	UPSTREAM_URLS: string;
	/**
	 * @deprecated
	 */
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

	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const data = JSON.parse(new TextDecoder().decode(rawData));

	let suppress = false;

	try {
		switch (event) {
			case "push": {
				if (
					(data.ref as string)?.startsWith("refs/heads/renovate/") ||
					(data.ref as string)?.startsWith("refs/heads/dependabot/")
				) {
					suppress = true;
				}

				break;
			}
			case "pull_request": {
				if (
					data.pull_request.user?.id === RENOVATE_ID ||
					data.pull_request.user?.id === DEPENDABOT_ID
				) {
					suppress = true;
				}

				break;
			}
			case "issue": {
				if (data.issue.user?.id === RENOVATE_ID || data.issue.user?.id === DEPENDABOT_ID) {
					suppress = true;
				}

				break;
			}
		}
	} catch (error) {
		console.error(error);
	}

	if (suppress) {
		return c.json({ ok: true, suppressed: true }, 202);
	}

	const proxyHeaders = new Headers();
	proxyHeaders.set("content-type", "application/json");

	for (const header of c.req.raw.headers.keys()) {
		const normalizedHeader = header.toLowerCase();
		if (normalizedHeader.startsWith("x-github-") || normalizedHeader === "user-agent")
			proxyHeaders.append(header, c.req.raw.headers.get(header)!);
	}

	let upstreamUrl: string;

	if (c.env.UPSTREAM_URL) {
		upstreamUrl = c.env.UPSTREAM_URL;
	} else if (c.env.UPSTREAM_URLS) {
		const upstreamUrls = c.env.UPSTREAM_URLS.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const randIdx = Math.max(
			Math.floor(Math.random() * upstreamUrls.length),
			Math.floor(Math.random() * upstreamUrls.length),
		);

		upstreamUrl = upstreamUrls[randIdx]!;
	} else {
		throw new Error("Neither UPSTREAM_URL nor UPSTREAM_URLS was provided!");
	}

	const upstreamRes = await fetch(normalizeDiscordWebhook(upstreamUrl), {
		method: "POST",
		body: JSON.stringify(data),
		headers: proxyHeaders,
	});

	if (!upstreamRes.ok) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return c.json({ ok: false, data: await upstreamRes.json() }, upstreamRes.status as any);
	}

	return c.json({ ok: true, suppressed: false }, 202);
});

app.post(
	"/api/new",

	(c, next) =>
		bearerAuth({
			token: c.env.API_SECRET || [],
		})(c, next),

	vValidator(
		"json",
		object({
			name: pipe(string(), minLength(1)),
		}),
	),

	async (c) => {
		const { name } = c.req.valid("json");

		const existing = await c.env.WEBHOOK_SECRETS.get(name);
		if (existing) {
			return c.json({ ok: false, error: "already exists" }, 400);
		}

		const secret = generateSecret();
		await c.env.WEBHOOK_SECRETS.put(name, secret);
		return c.json({ ok: true, secret });
	},
);

app.onError((error, c) => {
	console.error(error);
	return c.json({ error: "An internal server error occurred" }, 500);
});

export default app;
