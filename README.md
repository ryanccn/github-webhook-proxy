# GitHub Webhook Proxy

This [Cloudflare Worker](https://workers.cloudflare.com/) built on [Hono](https://hono.dev/) proxies requests from GitHub to upstream webhooks like [Discord](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) and filters out specific events such as those triggered by Renovate.
