import prompts from "prompts";
import { object, parse as vParse, string, url, pipe } from "valibot";

import { config } from "dotenv";
import { bold, cyan, green, magenta } from "kleur/colors";

const f = async <T>(url: string | URL, options?: RequestInit): Promise<T> => {
	const resp = await fetch(url, options);
	if (!resp.ok) {
		throw new Error(`Fetching ${url} failed with ${resp.status} ${resp.statusText}`);
	}

	return resp.json() as T;
};

const envSchema = object({
	GITHUB_TOKEN: string(),
	API_URL: pipe(string(), url()),
	API_SECRET: string(),
});

config({ path: ".env.setup" });

const { GITHUB_TOKEN, API_URL, API_SECRET } = vParse(envSchema, process.env);

const githubHeaders = {
	"accept": "application/vnd.github+json",
	"x-github-api-version": "2022-11-28",
	"authorization": `Bearer ${GITHUB_TOKEN}`,
};

const { login: username } = await f<{ login: string }>(`https://api.github.com/user`, {
	headers: githubHeaders,
});
console.log(`Authorized as ${magenta(username)}`);

let repos: string[] = [];

let page = 1;

while (true) {
	const data = await f<{ name: string; private: boolean; fork: boolean; archived: boolean }[]>(
		`https://api.github.com/users/${username}/repos?page=${page}`,
		{ headers: githubHeaders },
	);

	if (data.length === 0) break;

	repos = repos.concat(data.filter((r) => !r.private && !r.fork && !r.archived).map((r) => r.name));

	page += 1;
}

console.log(`Found ${green(repos.length)} public repositories`);

for (const repo of repos) {
	const webhooks = await f<{ config: { url: string; secret: string } }[]>(
		`https://api.github.com/repos/${username}/${repo}/hooks?per_page=100`,
		{ headers: githubHeaders },
	);

	if (webhooks.some((hook) => hook.config.url.startsWith(API_URL))) {
		continue;
	}

	const { confirm } = await prompts([
		{
			type: "confirm",
			name: "confirm",
			message: `The repository ${cyan(repo)} does not have a webhook configured. Configure?`,
		},
	]);

	if (!confirm) {
		continue;
	}

	const { secret } = await f<{ secret: string }>(new URL("/api/new", API_URL), {
		method: "POST",
		body: JSON.stringify({ name: repo }),
		headers: {
			"authorization": `Bearer ${API_SECRET}`,
			"content-type": "application/json",
		},
	});

	await f(`https://api.github.com/repos/${username}/${repo}/hooks`, {
		method: "POST",
		body: JSON.stringify({
			name: "web",
			config: {
				url: new URL(`/${repo}`, API_URL),
				content_type: "json",
				secret,
				insecure_ssl: 0,
			},
			events: ["discussion", "issues", "meta", "pull_request", "push", "release"],
		}),
		headers: { ...githubHeaders, "content-type": "application/json" },
	});

	console.log(green(`Configured webhook for repository ${bold(repo)}`));
}
