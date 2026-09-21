import serverless from "serverless-http";

type NetlifyEvent = {
  httpMethod: string;
  headers: Record<string, string>;
  multiValueHeaders: Record<string, string[]>;
  path: string;
  body: string | null;
  isBase64Encoded: boolean;
  queryStringParameters: Record<string, string>;
  multiValueQueryStringParameters: Record<string, string[]>;
  requestContext: { http: { method: string; path: string } };
};

const envKeys = [
  "DATABASE_URL",
  "JWT_SECRET",
  "VITE_APP_ID",
  "OAUTH_SERVER_URL",
  "OWNER_OPEN_ID",
  "BUILT_IN_FORGE_API_URL",
  "BUILT_IN_FORGE_API_KEY",
] as const;

let expressHandler: ReturnType<typeof serverless> | undefined;

async function getExpressHandler() {
  if (!expressHandler) {
    for (const key of envKeys) {
      const value = Netlify.env.get(key);
      if (value) process.env[key] = value;
    }
    const { createApp } = await import("../../server/app");
    expressHandler = serverless(createApp());
  }
  return expressHandler;
}

export default async (request: Request) => {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const rawBody = request.method === "GET" || request.method === "HEAD" ? null : await request.text();
  const event: NetlifyEvent = {
    httpMethod: request.method,
    headers,
    multiValueHeaders: {},
    path: url.pathname,
    body: rawBody,
    isBase64Encoded: false,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    multiValueQueryStringParameters: {},
    requestContext: { http: { method: request.method, path: url.pathname } },
  };

  const response = await (await getExpressHandler())(event, {});
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(response.headers ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) responseHeaders.append(key, String(item));
    } else if (value !== undefined) {
      responseHeaders.set(key, String(value));
    }
  }

  return new Response(response.body ?? "", {
    status: response.statusCode ?? 200,
    headers: responseHeaders,
  });
};

export const config = {
  path: ["/api/trpc", "/api/trpc/*", "/api/oauth/*", "/api/storage/*"],
};
