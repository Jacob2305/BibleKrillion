import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The answer bank is server-only: it must never end up in the browser bundle,
 * or players could read every answer in dev tools. Fail if anything in the
 * CLIENT imports it (server code loaded by the dev API bridge is fine).
 */
function keepBankServerSide(): Plugin {
  const forbidden = [/[\\/]data[\\/]prompts\.json$/, /[\\/]lib[\\/]game[\\/]bank\.(ts|js)$/, /[\\/]server[\\/]/];
  return {
    name: "keep-bank-server-side",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const consumer = (this as { environment?: { config?: { consumer?: string } } }).environment?.config?.consumer;
      if (options?.ssr || consumer === "server") return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && forbidden.some((re) => re.test(resolved.id.split("?")[0]!))) {
        this.error(`"${source}" is server-only (imported from ${importer}). Fetch it from /api instead.`);
      }
      return null;
    },
  };
}

/**
 * Local stand-in for Vercel Functions: `npm run dev` serves /api/<name> by calling
 * the GET/POST export of api/<name>.ts (Web-standard Request → Response), so no
 * Vercel account or `vercel dev` is needed while developing.
 */
function devApi(): Plugin {
  return {
    name: "dev-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      const env = loadEnv(server.config.mode, server.config.root, "");
      for (const [key, value] of Object.entries(env)) process.env[key] ??= value;

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        // The dev server would otherwise serve any project file, including the answer bank.
        if (/^\/(@fs\/.*)?(data|server|scripts|supabase)\//i.test(decodeURIComponent(url.pathname)) || /prompts\.json/i.test(url.pathname)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (!url.pathname.startsWith("/api/")) return next();
        const name = url.pathname.slice("/api/".length).replace(/\/+$/, "");
        const file = join(server.config.root, "api", `${name}.ts`);
        if (!/^[a-z0-9-]+$/.test(name) || !existsSync(file)) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: `No API route /api/${name}` }));
          return;
        }
        try {
          const mod = (await server.ssrLoadModule(file)) as Record<string, unknown>;
          const method = req.method ?? "GET";
          const fn = mod[method];
          if (typeof fn !== "function") {
            res.statusCode = 405;
            res.end();
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(", "));
          }
          const hasBody = method !== "GET" && method !== "HEAD" && chunks.length > 0;
          const response = (await fn(
            new Request(url.href, { method, headers, body: hasBody ? Buffer.concat(chunks) : undefined }),
          )) as Response;
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          if (err instanceof Error) server.ssrFixStacktrace(err);
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [keepBankServerSide(), devApi(), react(), tailwindcss()],
});
