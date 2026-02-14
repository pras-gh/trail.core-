import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import multer from "multer";
import { isSupportedUploadFile } from "@tail-core/ingest";
import { UploadService, type UploadResponse } from "./upload.service.js";

function uploadMaxBytes(): number {
  const fallback = 25 * 1024 * 1024;
  const raw = process.env.UPLOAD_MAX_BYTES;
  const parsed = raw ? Number(raw) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Controller()
export class UploadController {
  constructor(@Inject(UploadService) private readonly uploadService: UploadService) {}

  @Post("upload")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: multer.memoryStorage(),
      limits: {
        fileSize: uploadMaxBytes()
      }
    })
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("source_id") sourceId?: string,
    @Body("external_id") externalId?: string
  ): Promise<UploadResponse> {
    if (!file) {
      throw new BadRequestException("file is required.");
    }

    if (!isSupportedUploadFile(file.mimetype, file.originalname)) {
      throw new BadRequestException("Only CSV and PDF uploads are supported.");
    }

    return this.uploadService.handleUpload(file, sourceId, externalId);
  }
}
