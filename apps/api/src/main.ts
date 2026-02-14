import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { initSentry } from "./sentry.js";

async function bootstrap(): Promise<void> {
  initSentry();

  const app = await NestFactory.create(AppModule, {
    cors: true
  });

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  console.log(`API listening on port ${port}`);
}

bootstrap().catch((error) => {
  console.error("API bootstrap failed", error);
  process.exit(1);
});
