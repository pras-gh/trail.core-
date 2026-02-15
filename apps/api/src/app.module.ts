import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { HealthController } from "./health.controller.js";
import { UploadController } from "./upload/upload.controller.js";
import { UploadService } from "./upload/upload.service.js";

@Module({
  controllers: [HealthController, UploadController, AdminController],
  providers: [UploadService]
})
export class AppModule {}
