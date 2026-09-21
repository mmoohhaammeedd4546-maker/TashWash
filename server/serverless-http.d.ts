declare module "serverless-http" {
  import type { RequestHandler } from "express";
  const serverless: (app: RequestHandler) => (event: unknown, context: unknown) => Promise<unknown>;
  export default serverless;
}
