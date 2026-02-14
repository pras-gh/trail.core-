import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { pingDatabase } from "@tail-core/db";
import { captureException } from "./sentry.js";

@Controller()
export class HealthController {
  @Get("health")
  getHealth(): { ok: boolean; service: string } {
    return { ok: true, service: "api" };
  }

  @Get("health/db")
  async getDatabaseHealth(): Promise<{ ok: boolean; service: string; database: string }> {
    try {
      await pingDatabase();
      return { ok: true, service: "api", database: "reachable" };
    } catch (error) {
      captureException(error);
      throw new ServiceUnavailableException({
        ok: false,
        service: "api",
        database: "unreachable"
      });
    }
  }
}
