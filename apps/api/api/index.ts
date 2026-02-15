import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { configure as serverlessExpress } from "@vendia/serverless-express";
import express from "express";
import { AppModule } from "../src/app.module";
import { initSentry } from "../src/sentry";

type VercelHandler = (req: unknown, res: unknown) => Promise<void> | void;

let cachedHandler: VercelHandler | null = null;

async function createHandler(): Promise<VercelHandler> {
  initSentry();

  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    cors: true
  });

  await app.init();

  const proxy = serverlessExpress({
    app: expressApp
  });

  return async (req, res) => {
    await proxy(req as never, res as never);
  };
}

export default async function handler(req: unknown, res: unknown): Promise<void> {
  if (!cachedHandler) {
    cachedHandler = await createHandler();
  }

  await cachedHandler(req, res);
}
