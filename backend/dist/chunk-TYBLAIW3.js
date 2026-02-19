import {
  arsipService
} from "./chunk-AA22IUFJ.js";
import {
  arsipVitalService
} from "./chunk-DJJ3PCUL.js";
import {
  arsipTerjagaService
} from "./chunk-GLXWJ4TZ.js";
import {
  db,
  env
} from "./chunk-64MUSQBB.js";
import {
  approvalHistory,
  approvalRequests,
  approvalSteps,
  archiveLending,
  auditLog,
  digitalSignatures,
  dosir,
  dosirSuratKeluar,
  dosirSuratMasuk,
  fileAttachments,
  jadwalRetensiArsip,
  klasifikasiArsip,
  klasifikasiJraMapping,
  layananArsip,
  notificationReads,
  penyusutanArsip,
  penyusutanItems,
  suratDistributions,
  suratKeluar,
  suratMasuk,
  tunjukSilang
} from "./chunk-F55GPJUN.js";
import {
  arsip,
  arsipElektronik,
  autentikasi,
  storageLocations,
  unitKerja,
  users
} from "./chunk-MR7OZFZ4.js";

// src/app.ts
import express2 from "express";
import cors from "cors";
import path5 from "path";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { toNodeHandler } from "better-auth/node";

// src/config/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
var auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL || "http://localhost:3001",
  basePath: "/api/auth",
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true
  }),
  emailAndPassword: {
    enabled: true,
    // Enable email/password for testing
    autoSignIn: true
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET
    }
  },
  trustedOrigins: env.NODE_ENV === "production" ? [env.FRONTEND_URL] : [env.FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"],
  session: {
    expiresIn: 60 * 60 * 24,
    // 24 hours — hardened for government document security
    updateAge: 60 * 60 * 4
    // 4 hours — refresh session more frequently
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
        required: false
      }
    }
  },
  advanced: {
    database: {
      generateId: "uuid"
      // Use UUID for PostgreSQL
    }
  },
  logger: {
    level: env.NODE_ENV === "production" ? "error" : "debug"
  }
});

// src/middlewares/rate-limiter.middleware.ts
import rateLimit from "express-rate-limit";
var isDev = env.NODE_ENV === "development" || env.NODE_ENV === "test";
var generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  max: isDev ? 1e4 : 500,
  // Relaxed in dev/test; 500 per window in production
  message: {
    error: "Too Many Requests",
    message: "Too many requests from this IP, please try again after 15 minutes"
  },
  standardHeaders: true,
  legacyHeaders: false
});
var authLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  max: isDev ? 1e4 : 5,
  // Relaxed in dev/test; 5 per window in production
  message: {
    error: "Too Many Attempts",
    message: "Too many login attempts from this IP, please try again after 15 minutes"
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
  // Don't count successful logins
});
var signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1e3,
  // 1 hour
  max: isDev ? 1e4 : 3,
  // Relaxed in dev/test; 3 per hour in production
  message: {
    error: "Too Many Signups",
    message: "Too many signup attempts from this IP, please try again after an hour"
  },
  standardHeaders: true,
  legacyHeaders: false
});
var sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  max: 20,
  message: {
    error: "Too Many Requests",
    message: "Too many sensitive operations from this IP, please try again later"
  },
  standardHeaders: true,
  legacyHeaders: false
});
var exportLimiter = rateLimit({
  windowMs: 60 * 1e3,
  // 1 minute
  max: 5,
  message: {
    error: "Too Many Exports",
    message: "Terlalu banyak permintaan export. Coba lagi setelah 1 menit."
  },
  standardHeaders: true,
  legacyHeaders: false
});
var uploadLimiter = rateLimit({
  windowMs: 60 * 1e3,
  // 1 minute
  max: 10,
  message: {
    error: "Too Many Uploads",
    message: "Terlalu banyak upload. Coba lagi setelah 1 menit."
  },
  standardHeaders: true,
  legacyHeaders: false
});
var ocrLimiter = rateLimit({
  windowMs: 60 * 1e3,
  // 1 minute
  max: 3,
  message: {
    error: "Too Many OCR Requests",
    message: "Terlalu banyak permintaan OCR. Coba lagi setelah 1 menit."
  },
  standardHeaders: true,
  legacyHeaders: false
});

// src/middlewares/auth.middleware.ts
import { eq } from "drizzle-orm";

// src/utils/logger.ts
import pino from "pino";
var isProduction = env.NODE_ENV === "production";
var logger = pino({
  level: isProduction ? "info" : "debug",
  ...isProduction ? {
    // Production: JSON, no pretty-print, redact sensitive fields
    formatters: {
      level(label) {
        return { level: label };
      }
    },
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "password", "token"],
      censor: "[REDACTED]"
    }
  } : {
    // Development: pretty-printed with colors
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
        singleLine: false
      }
    }
  }
});
function createLogger(component) {
  return logger.child({ component });
}

// src/middlewares/auth.middleware.ts
var log = createLogger("AuthMiddleware");
async function authMiddleware(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: req.headers
    });
    if (!session) {
      return res.status(401).json({ error: "Unauthorized: No valid session" });
    }
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      unitKerjaId: users.unitKerjaId
    }).from(users).where(eq(users.id, session.user.id)).limit(1);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized: User not found" });
    }
    req.user = user;
    next();
  } catch (error) {
    log.error({ err: error }, "Auth middleware error");
    res.status(500).json({ error: "Internal server error" });
  }
}

// src/middlewares/csrf.middleware.ts
import crypto from "crypto";
var CSRF_COOKIE_NAME = "csrf-token";
var CSRF_HEADER_NAME = "x-csrf-token";
var SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}
function csrfCookieSetter(req, res, next) {
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    const token = generateToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      // Must be readable by JavaScript
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 60 * 60 * 1e3
      // 8 hours — tighter security for CSRF tokens
    });
  }
  next();
}
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.includes(req.method)) {
    return next();
  }
  if (req.path.startsWith("/auth")) {
    return next();
  }
  if (req.path.startsWith("/dev") && process.env.NODE_ENV !== "production") {
    return next();
  }
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];
  if (!cookieToken || !headerToken) {
    res.status(403).json({
      error: "CSRF Validation Failed",
      message: "Missing CSRF token. Please refresh the page and try again."
    });
    return;
  }
  if (cookieToken.length !== headerToken.length) {
    res.status(403).json({
      error: "CSRF Validation Failed",
      message: "Invalid CSRF token. Please refresh the page and try again."
    });
    return;
  }
  const valid = crypto.timingSafeEqual(
    Buffer.from(cookieToken),
    Buffer.from(headerToken)
  );
  if (!valid) {
    res.status(403).json({
      error: "CSRF Validation Failed",
      message: "Invalid CSRF token. Please refresh the page and try again."
    });
    return;
  }
  next();
}

// src/middlewares/sanitize.middleware.ts
var SKIP_FIELDS = /* @__PURE__ */ new Set(["extractedText", "password", "currentPassword", "newPassword"]);
function stripTags(str) {
  return str.replace(/<[^>]*>/g, "");
}
function sanitizeValue(value, key) {
  if (key && SKIP_FIELDS.has(key)) {
    return value;
  }
  if (typeof value === "string") {
    let sanitized = stripTags(value);
    sanitized = sanitized.replace(/\s+/g, " ").trim();
    return sanitized;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const sanitized = {};
    for (const [k, v] of Object.entries(value)) {
      sanitized[k] = sanitizeValue(v, k);
    }
    return sanitized;
  }
  return value;
}
function sanitizeInput(req, res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body);
  }
  next();
}

// src/config/swagger.ts
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
var log2 = createLogger("Swagger");
var options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "SIMSA ATR/BPN API Documentation",
      version: "1.0.0",
      description: `
# Sistem Informasi Manajemen Surat dan Arsip (SIMSA)
API untuk pengelolaan surat masuk, surat keluar, dan arsip di lingkungan ATR/BPN.

## Authentication
API ini menggunakan cookie-based session authentication melalui Better Auth.

## Rate Limiting
- General API: 100 requests per 15 minutes
- Auth endpoints: 5 requests per 15 minutes
            `,
      contact: {
        name: "ATR/BPN IT Support"
      }
    },
    servers: [
      {
        url: env.BETTER_AUTH_URL || "http://localhost:3001",
        description: env.NODE_ENV === "production" ? "Production server" : "Development server"
      }
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description: "Session token cookie set after successful login"
        }
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Validation failed" },
            details: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  message: { type: "string" }
                }
              }
            }
          }
        },
        Pagination: {
          type: "object",
          properties: {
            page: { type: "integer", example: 1 },
            limit: { type: "integer", example: 20 },
            total: { type: "integer", example: 100 },
            totalPages: { type: "integer", example: 5 }
          }
        },
        SuratMasuk: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            unitKerjaId: { type: "string", format: "uuid" },
            nomorAgenda: { type: "string" },
            tanggalTerima: { type: "string", format: "date" },
            nomorSurat: { type: "string" },
            tanggalSurat: { type: "string", format: "date" },
            dari: { type: "string" },
            perihal: { type: "string" },
            sifatSurat: { type: "string", enum: ["biasa", "segera", "sangat_segera", "rahasia", "undangan", "penting"] },
            status: { type: "string", enum: ["belum_dibalas", "sudah_dibalas"] },
            isArchived: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        SuratKeluar: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            unitKerjaId: { type: "string", format: "uuid" },
            nomorSurat: { type: "string" },
            tanggalSurat: { type: "string", format: "date" },
            tujuan: { type: "string" },
            perihal: { type: "string" },
            sifatSurat: { type: "string", enum: ["biasa", "segera", "sangat_segera", "rahasia", "undangan", "penting"] },
            status: { type: "string", enum: ["draft", "dikirim", "arsip"] },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        Arsip: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            unitKerjaId: { type: "string", format: "uuid" },
            kodeSurat: { type: "string" },
            deskripsi: { type: "string" },
            jenisArsip: { type: "string", enum: ["masuk", "keluar"] },
            klasifikasiId: { type: "string", format: "uuid" },
            retentionPeriod: { type: "integer" },
            lokasiPenyimpanan: { type: "string" },
            createdAt: { type: "string", format: "date-time" }
          }
        }
      }
    },
    security: [{ cookieAuth: [] }],
    tags: [
      { name: "Auth", description: "Authentication endpoints" },
      { name: "Surat Masuk", description: "Incoming mail management" },
      { name: "Surat Keluar", description: "Outgoing mail management" },
      { name: "Arsip", description: "Archive management" },
      { name: "Dashboard", description: "Dashboard statistics" },
      { name: "Users", description: "User management" },
      { name: "Settings", description: "Application settings" }
    ]
  },
  apis: ["./src/routes/*.ts"]
  // Path to the API routes
};
var swaggerSpec = swaggerJsdoc(options);
function setupSwagger(app2) {
  app2.get("/api/docs/json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
  app2.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "SIMSA API Documentation"
  }));
  log2.info("Swagger UI available at /api/docs");
}

// src/utils/errors.ts
var AppError = class extends Error {
  statusCode;
  isOperational;
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
};
var DatabaseError = class extends AppError {
  constructor(message = "Terjadi kesalahan pada database. Silakan coba lagi.") {
    super(message, 500);
  }
};

// src/routes/surat-masuk.routes.ts
import { Router } from "express";
import multer from "multer";
import path from "path";

// src/services/surat-masuk.service.ts
import { eq as eq2, and, desc, sql, gte, lte, or, ilike } from "drizzle-orm";
var SuratMasukService = class {
  async findAll(filters) {
    const { unitKerjaId, tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, search, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [
      eq2(suratMasuk.unitKerjaId, unitKerjaId),
      eq2(suratMasuk.isDeleted, false)
      // Exclude soft-deleted records
    ];
    if (tahun) {
      conditions.push(eq2(suratMasuk.tahun, tahun));
    }
    if (tanggalDari) {
      conditions.push(gte(suratMasuk.tanggalSurat, tanggalDari));
    }
    if (tanggalSampai) {
      conditions.push(lte(suratMasuk.tanggalSurat, tanggalSampai));
    }
    if (jenisSurat) {
      conditions.push(eq2(suratMasuk.jenisSurat, jenisSurat));
    }
    if (sifatSurat) {
      conditions.push(eq2(suratMasuk.sifatSurat, sifatSurat));
    }
    if (status) {
      conditions.push(eq2(suratMasuk.status, status));
    }
    if (search && search.trim()) {
      const searchPattern = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(suratMasuk.perihal, searchPattern),
          ilike(suratMasuk.nomorSurat, searchPattern),
          ilike(suratMasuk.dari, searchPattern)
        )
      );
    }
    const countResult = await db.select({ count: sql`count(*)::int` }).from(suratMasuk).where(and(...conditions));
    const count5 = countResult?.[0]?.count ?? 0;
    const data = await db.select().from(suratMasuk).where(and(...conditions)).orderBy(desc(suratMasuk.createdAt)).limit(limit).offset(offset);
    return {
      data: data || [],
      pagination: {
        page,
        limit,
        total: count5,
        totalPages: Math.ceil(count5 / limit) || 1
      }
    };
  }
  async findById(id) {
    const [result] = await db.select().from(suratMasuk).where(eq2(suratMasuk.id, id)).limit(1);
    return result || null;
  }
  async create(data) {
    const tahun = data.tahun || (/* @__PURE__ */ new Date()).getFullYear();
    try {
      const result = await db.transaction(async (tx) => {
        const [lastSurat] = await tx.select({ noUrut: suratMasuk.noUrut }).from(suratMasuk).where(and(
          eq2(suratMasuk.unitKerjaId, data.unitKerjaId),
          eq2(suratMasuk.tahun, tahun)
        )).orderBy(desc(suratMasuk.noUrut)).limit(1).for("update");
        const noUrut = (lastSurat?.noUrut || 0) + 1;
        const [inserted] = await tx.insert(suratMasuk).values({ ...data, noUrut, tahun }).returning();
        return inserted;
      });
      return result;
    } catch (error) {
      if (error.code === "40001" || error.code === "40P01") {
        throw new DatabaseError("Terjadi konflik saat membuat nomor urut surat. Silakan coba lagi.");
      }
      throw error;
    }
  }
  async update(id, data) {
    const [result] = await db.update(suratMasuk).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq2(suratMasuk.id, id)).returning();
    return result;
  }
  async delete(id, deletedByUserId) {
    const [result] = await db.update(suratMasuk).set({
      isDeleted: true,
      deletedAt: /* @__PURE__ */ new Date(),
      deletedBy: deletedByUserId || null,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq2(suratMasuk.id, id)).returning();
    return result;
  }
  async hardDelete(id) {
    const [result] = await db.delete(suratMasuk).where(eq2(suratMasuk.id, id)).returning();
    return result;
  }
  async restore(id) {
    const [result] = await db.update(suratMasuk).set({
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq2(suratMasuk.id, id)).returning();
    return result;
  }
  async archive(id) {
    return this.update(id, { isArchived: true });
  }
  async getNextNumber(unitKerjaId, tahun) {
    const year = tahun || (/* @__PURE__ */ new Date()).getFullYear();
    const [lastSurat] = await db.select({ noUrut: suratMasuk.noUrut }).from(suratMasuk).where(and(
      eq2(suratMasuk.unitKerjaId, unitKerjaId),
      eq2(suratMasuk.tahun, year)
    )).orderBy(desc(suratMasuk.noUrut)).limit(1);
    return (lastSurat?.noUrut || 0) + 1;
  }
  async getStats(unitKerjaId, tahun) {
    const conditions = [eq2(suratMasuk.unitKerjaId, unitKerjaId)];
    if (tahun) {
      conditions.push(eq2(suratMasuk.tahun, tahun));
    }
    const stats = await db.select({
      total: sql`count(*)::int`,
      belumDibalas: sql`count(*) filter (where ${suratMasuk.status} = 'belum_dibalas')::int`,
      sudahDibalas: sql`count(*) filter (where ${suratMasuk.status} = 'sudah_dibalas')::int`,
      diarsipkan: sql`count(*) filter (where ${suratMasuk.isArchived} = true)::int`
    }).from(suratMasuk).where(and(...conditions));
    return stats[0];
  }
  // Get surat keluar yang merupakan balasan dari surat masuk ini
  async getBalasan(suratMasukId) {
    const { suratKeluar: suratKeluar3 } = await import("./schema-X7T7ECFS.js");
    const balasan = await db.select().from(suratKeluar3).where(eq2(suratKeluar3.balasanUntuk, suratMasukId)).orderBy(desc(suratKeluar3.createdAt));
    return balasan;
  }
  // Get all pending surat masuk (belum dibalas) for reply selection dropdown
  async getPendingForReply(unitKerjaId) {
    const pending = await db.select({
      id: suratMasuk.id,
      nomorSurat: suratMasuk.nomorSurat,
      perihal: suratMasuk.perihal,
      tanggalSurat: suratMasuk.tanggalSurat,
      dari: suratMasuk.dari
    }).from(suratMasuk).where(and(
      eq2(suratMasuk.unitKerjaId, unitKerjaId),
      eq2(suratMasuk.status, "belum_dibalas")
    )).orderBy(desc(suratMasuk.tanggalSurat));
    return pending;
  }
  // Get full detail with linked arsip info
  async findByIdWithLinks(id) {
    const surat = await this.findById(id);
    if (!surat) return null;
    const balasan = await this.getBalasan(id);
    const { arsip: arsip3 } = await import("./schema-X7T7ECFS.js");
    const [arsipEntry] = await db.select().from(arsip3).where(and(
      eq2(arsip3.sourceSuratId, id),
      eq2(arsip3.jenisArsip, "masuk")
    )).limit(1);
    return {
      ...surat,
      balasan,
      arsipEntry: arsipEntry || null
    };
  }
};
var suratMasukService = new SuratMasukService();

// src/config/permissions.ts
function isReadOnlyRole(role) {
  return role === "auditor" || role === "user";
}

// src/middlewares/role.middleware.ts
function canWriteMiddleware() {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userRole = req.user.role;
    if (isReadOnlyRole(userRole)) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Read-only access. You cannot modify data."
      });
    }
    next();
  };
}
function canReadMiddleware() {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  };
}

// src/middlewares/validate.middleware.ts
import { ZodError } from "zod";
var log3 = createLogger("Validation");
function validate(schema, source = "body") {
  return (req, res, next) => {
    try {
      const data = schema.parse(req[source]);
      if (source === "query") {
        res.locals.validatedQuery = data;
      } else if (source === "body") {
        req.body = data;
      } else if (source === "params") {
        Object.assign(req.params, data);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message
        }));
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors
        });
      }
      log3.error({ err: error }, "Validation middleware error:");
      next(error);
    }
  };
}
function validateBody(schema) {
  return validate(schema, "body");
}
function validateQuery(schema) {
  return validate(schema, "query");
}
function validateIdParam(paramName = "id") {
  return (req, res, next) => {
    const id = req.params[paramName];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format",
        message: `Parameter '${paramName}' must be a valid UUID`
      });
    }
    next();
  };
}

// src/validators/schemas.ts
import { z } from "zod";
var uuidSchema = z.string().uuid("Invalid UUID format");
var dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");
var timestampSchema = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
var paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});
var createSuratMasukSchema = z.object({
  unitKerjaId: z.string().min(1, "Unit kerja is required").max(50),
  noUrut: z.coerce.number().int().positive().optional(),
  // Auto-generated if not provided
  tahun: z.coerce.number().int().min(2e3).max(2100).optional(),
  // Defaults to current year
  jenisSurat: z.string().max(100).optional(),
  sifatSurat: z.string().max(50).optional(),
  // Biasa, Segera, Sangat Segera
  nomorSurat: z.string().min(1, "Nomor surat is required").max(255),
  tanggalSurat: dateSchema,
  perihal: z.string().min(1, "Perihal is required").max(2e3),
  dari: z.string().min(1, "Pengirim is required").max(255),
  // Field name is 'dari' in DB
  kepada: z.string().max(255).optional(),
  status: z.enum(["belum_dibalas", "sudah_dibalas"]).optional().default("belum_dibalas"),
  disposisi: z.union([z.string(), z.array(z.string())]).transform((val) => {
    if (Array.isArray(val)) return val;
    if (!val) return void 0;
    return [val];
  }).optional(),
  keterangan: z.string().max(2e3).optional(),
  linkDokumen: z.string().url().optional().or(z.literal("")),
  klasifikasiKode: z.string().max(50).optional(),
  klasifikasiUraian: z.string().max(1e3).optional()
});
var updateSuratMasukSchema = createSuratMasukSchema.partial().omit({ unitKerjaId: true });
var querySuratMasukSchema = paginationSchema.extend({
  unitKerjaId: z.string().optional(),
  tahun: z.coerce.number().int().min(2e3).max(2100).optional(),
  tanggalDari: dateSchema.optional(),
  tanggalSampai: dateSchema.optional(),
  jenisSurat: z.string().max(100).optional(),
  sifatSurat: z.enum(["biasa", "segera", "sangat_segera", "rahasia", "undangan", "penting"]).optional(),
  status: z.enum(["pending", "diproses", "selesai", "arsip", "belum_dibalas", "sudah_dibalas"]).optional(),
  search: z.string().max(255).optional()
});
var createSuratKeluarSchema = z.object({
  unitKerjaId: z.string().min(1, "Unit kerja is required").max(50),
  nomorSurat: z.string().min(1, "Nomor surat is required").max(255),
  tanggalSurat: dateSchema,
  tujuan: z.string().min(1, "Tujuan is required").max(500),
  perihal: z.string().min(1, "Perihal is required").max(1e3),
  klasifikasiId: uuidSchema.optional(),
  sifat: z.enum(["biasa", "penting", "rahasia", "sangat_rahasia"]).optional().default("biasa"),
  lampiran: z.string().max(255).optional(),
  konseptor: z.string().max(255).optional(),
  penandatangan: z.string().max(255).optional(),
  catatan: z.string().max(2e3).optional()
});
var updateSuratKeluarSchema = createSuratKeluarSchema.partial().omit({ unitKerjaId: true });
var querySuratKeluarSchema = paginationSchema.extend({
  unitKerjaId: z.string().optional(),
  tahun: z.coerce.number().int().min(2e3).max(2100).optional(),
  tanggalDari: dateSchema.optional(),
  tanggalSampai: dateSchema.optional(),
  naskahDinas: z.string().max(100).optional(),
  klasifikasiFasilitatif: z.string().max(255).optional(),
  klasifikasiSubstantif: z.string().max(255).optional(),
  status: z.enum(["draft", "dikirim", "arsip"]).optional(),
  search: z.string().max(255).optional()
});
var createArsipSchema = z.object({
  unitKerjaId: z.string().min(1, "Unit kerja is required").max(50),
  kodeSurat: z.string().min(1, "Kode surat is required").max(100),
  deskripsi: z.string().min(1, "Deskripsi is required").max(2e3),
  jenisSurat: z.enum(["masuk", "keluar"]),
  sumberSuratId: uuidSchema.optional(),
  klasifikasiId: uuidSchema.optional(),
  retentionPeriod: z.coerce.number().int().min(1).max(100).optional().default(5),
  tanggalMulai: dateSchema.optional(),
  tanggalBerakhir: dateSchema.optional(),
  lokasiPenyimpanan: z.string().max(255).optional(),
  catatan: z.string().max(2e3).optional(),
  klasifikasiKeamanan: z.enum(["biasa", "terbatas", "rahasia", "sangat_rahasia"]).optional().default("biasa")
});
var updateArsipSchema = createArsipSchema.partial().omit({ unitKerjaId: true });
var queryArsipSchema = paginationSchema.extend({
  unitKerjaId: z.string().optional(),
  tahun: z.coerce.number().int().min(2e3).max(2100).optional(),
  jenisSurat: z.enum(["masuk", "keluar"]).optional(),
  klasifikasiId: uuidSchema.optional(),
  expiring: z.coerce.boolean().optional(),
  search: z.string().max(255).optional()
});
var createArsipVitalSchema = z.object({
  arsipId: uuidSchema,
  unitKerjaId: z.string().min(1, "Unit kerja is required").max(50),
  kategoriVital: z.enum(["hak_keperdataan", "operasional", "keuangan", "keamanan"]),
  tingkatKekritisan: z.enum(["sangat_kritis", "kritis", "penting"]),
  alasanPenetapan: z.string().max(2e3).optional(),
  metodeProteksi: z.enum(["duplikasi", "dispersal", "vault", "digital_backup"]).optional(),
  lokasiBackup: z.string().max(255).optional(),
  mediaBackup: z.string().max(100).optional(),
  jadwalBackup: z.enum(["harian", "mingguan", "bulanan", "tahunan"]).optional(),
  tanggalPenetapan: dateSchema.optional(),
  tanggalReviewSelanjutnya: dateSchema.optional(),
  statusProteksi: z.enum(["terlindungi", "perlu_review", "belum_diproteksi"]).optional().default("belum_diproteksi"),
  penanggungJawab: z.string().max(255).optional()
});
var updateArsipVitalSchema = createArsipVitalSchema.partial().omit({ arsipId: true, unitKerjaId: true });
var queryArsipVitalSchema = paginationSchema.extend({
  unitKerjaId: z.string().optional(),
  kategoriVital: z.enum(["hak_keperdataan", "operasional", "keuangan", "keamanan"]).optional(),
  tingkatKekritisan: z.enum(["sangat_kritis", "kritis", "penting"]).optional(),
  statusProteksi: z.enum(["terlindungi", "perlu_review", "belum_diproteksi"]).optional(),
  search: z.string().max(255).optional()
});
var createArsipTerjagaSchema = z.object({
  arsipId: uuidSchema,
  unitKerjaId: z.string().min(1, "Unit kerja is required").max(50),
  kategoriTerjaga: z.enum(["kekayaan_negara", "hak_keperdataan", "pertanahan"]),
  dasarHukum: z.string().max(2e3).optional(),
  uraianIsi: z.string().max(2e3).optional(),
  statusPelaporan: z.enum(["belum_dilaporkan", "dilaporkan", "terverifikasi"]).optional().default("belum_dilaporkan"),
  tanggalPelaporan: dateSchema.optional(),
  nomorLaporanANRI: z.string().max(100).optional(),
  periodePelaporanHari: z.coerce.number().int().min(1).max(3650).optional().default(365),
  tanggalPenetapan: dateSchema.optional(),
  tanggalReviewSelanjutnya: dateSchema.optional(),
  statusKepatuhan: z.enum(["patuh", "terlambat", "belum_dinilai"]).optional().default("belum_dinilai"),
  catatan: z.string().max(2e3).optional()
});
var updateArsipTerjagaSchema = createArsipTerjagaSchema.partial().omit({ arsipId: true, unitKerjaId: true });
var queryArsipTerjagaSchema = paginationSchema.extend({
  unitKerjaId: z.string().optional(),
  kategoriTerjaga: z.enum(["kekayaan_negara", "hak_keperdataan", "pertanahan"]).optional(),
  statusPelaporan: z.enum(["belum_dilaporkan", "dilaporkan", "terverifikasi"]).optional(),
  statusKepatuhan: z.enum(["patuh", "terlambat", "belum_dinilai"]).optional(),
  search: z.string().max(255).optional()
});
var createAutentikasiSchema = z.object({
  nomorBeritaAcara: z.string().min(1, "Nomor berita acara is required").max(100),
  tanggalAutentikasi: dateSchema,
  kegiatan: z.string().min(1, "Kegiatan is required").max(255),
  itemArsipIds: z.array(uuidSchema).min(1, "At least one archive must be selected"),
  // Optional overrides for PDF generation if needed
  jabatanPenandaTangan: z.string().max(100).optional(),
  tempatDilakukan: z.string().max(150).optional()
});
var queryAutentikasiSchema = paginationSchema.extend({
  search: z.string().max(255).optional(),
  tanggalDari: dateSchema.optional(),
  tanggalSampai: dateSchema.optional()
});
var createDosirSchema = z.object({
  judul: z.string().min(1, "Judul is required").max(500),
  deskripsi: z.string().max(2e3).optional(),
  kategori: z.string().max(100).optional(),
  tanggalMulai: dateSchema.optional()
});
var updateDosirSchema = z.object({
  judul: z.string().min(1).max(500).optional(),
  deskripsi: z.string().max(2e3).optional().nullable(),
  status: z.enum(["open", "closed", "archived"]).optional(),
  kategori: z.string().max(100).optional().nullable(),
  tanggalMulai: dateSchema.optional().nullable(),
  tanggalSelesai: dateSchema.optional().nullable()
});
var queryDosirSchema = paginationSchema.extend({
  status: z.enum(["open", "closed", "archived"]).optional(),
  kategori: z.string().max(100).optional(),
  search: z.string().max(255).optional()
});
var linkSuratToDosirSchema = z.object({
  type: z.enum(["masuk", "keluar"]),
  suratId: uuidSchema,
  notes: z.string().max(2e3).optional()
});
var createDistributionSchema = z.object({
  suratMasukId: uuidSchema,
  sourceUnitId: z.string().min(1, "Source unit is required").max(50),
  targetUnitId: z.string().min(1, "Target unit is required").max(50),
  instruction: z.string().max(2e3).optional(),
  ccUnits: z.array(z.string().max(50)).optional()
});
var rejectDistributionSchema = z.object({
  reason: z.string().min(1, "Alasan penolakan harus diisi").max(2e3)
});
var queryDistributionSchema = paginationSchema.extend({
  unitKerjaId: z.string().max(50).optional(),
  status: z.enum(["sent", "received", "processed", "rejected"]).optional()
});
var createPenyusutanSchema = z.object({
  unitKerjaId: z.string().min(1, "Unit kerja is required").max(50),
  jenisPenyusutan: z.enum(["pemindahan", "pemusnahan", "penyerahan", "alih_media"]),
  arsipIds: z.array(uuidSchema).min(1, "Minimal satu arsip harus dipilih"),
  keterangan: z.string().max(2e3).optional()
});
var updatePenyusutanStatusSchema = z.object({
  catatan: z.string().max(2e3).optional()
});
var removePenyusutanItemsSchema = z.object({
  arsipIds: z.array(uuidSchema).min(1, "Minimal satu arsip harus dipilih")
});
var createStorageLocationSchema = z.object({
  unitKerjaId: z.string().min(1, "Unit kerja is required").max(50),
  code: z.string().min(1, "Kode lokasi is required").max(50),
  name: z.string().min(1, "Nama lokasi is required").max(255),
  level: z.enum(["gedung", "ruang", "rak", "box"]),
  parentId: uuidSchema.optional().nullable(),
  description: z.string().max(2e3).optional(),
  capacity: z.coerce.number().int().positive().optional()
});
var updateStorageLocationSchema = createStorageLocationSchema.partial().omit({ unitKerjaId: true });
var borrowArchiveSchema = z.object({
  lendingType: z.enum(["arsip", "box"]),
  arsipId: uuidSchema.optional(),
  // Required when lendingType = 'arsip'
  storageLocationId: uuidSchema.optional(),
  // Required when lendingType = 'box'
  borrowerName: z.string().min(1, "Nama peminjam is required").max(255),
  departmentUnit: z.string().max(255).optional(),
  dueDate: dateSchema,
  purpose: z.string().max(2e3).optional()
}).refine(
  (data) => {
    if (data.lendingType === "arsip") return !!data.arsipId;
    if (data.lendingType === "box") return !!data.storageLocationId;
    return true;
  },
  { message: "arsipId required for arsip lending, storageLocationId required for box lending" }
);
var extendLendingSchema = z.object({
  newDueDate: dateSchema
});
var createLayananArsipSchema = z.object({
  jenisLayanan: z.enum(["penggandaan", "legalisasi"]),
  arsipId: uuidSchema,
  jumlahRangkap: z.coerce.number().int().min(1).max(100).optional().default(1),
  keperluan: z.string().min(1, "Keperluan harus diisi").max(2e3),
  keterangan: z.string().max(2e3).optional()
});
var updateLayananStatusSchema = z.object({
  status: z.enum(["diproses", "selesai", "ditolak"]),
  notes: z.string().max(2e3).optional()
});
var markAllReadSchema = z.object({
  notificationIds: z.array(z.string()).min(1, "Minimal satu notifikasi harus dipilih")
});

// src/services/audit-log.service.ts
import { eq as eq3, and as and2, desc as desc2, sql as sql2, gte as gte2, lte as lte2, ilike as ilike2, or as or2 } from "drizzle-orm";
var log4 = createLogger("AuditLogService");
var auditLogService = {
  // Track consecutive audit failures for alerting
  _consecutiveFailures: 0,
  /**
   * Log an action to audit trail
   */
  async logAction(data) {
    try {
      await db.insert(auditLog).values({
        userId: data.userId || null,
        userEmail: data.userEmail || null,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId || null,
        changes: data.changes || null,
        ipAddress: data.ipAddress || null
      });
      auditLogService._consecutiveFailures = 0;
    } catch (error) {
      log4.error({ err: error }, "Failed to log audit action:");
      auditLogService._consecutiveFailures = (auditLogService._consecutiveFailures || 0) + 1;
      if (auditLogService._consecutiveFailures >= 5) {
        log4.error("[CRITICAL] Audit logging has failed 5+ times consecutively. Investigate immediately.");
      }
    }
  },
  /**
   * List audit logs with filters and pagination
   */
  async listLogs(filters = {}) {
    const { entityType, entityId, action, userId, search, startDate, endDate, page = 1, limit = 50 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (entityType) {
      conditions.push(eq3(auditLog.entityType, entityType));
    }
    if (entityId) {
      conditions.push(eq3(auditLog.entityId, entityId));
    }
    if (action) {
      conditions.push(eq3(auditLog.action, action));
    }
    if (userId) {
      conditions.push(eq3(auditLog.userId, userId));
    }
    if (search) {
      conditions.push(
        or2(
          ilike2(auditLog.userEmail, `%${search}%`),
          ilike2(auditLog.action, `%${search}%`),
          ilike2(auditLog.entityType, `%${search}%`)
        )
      );
    }
    if (startDate) {
      conditions.push(gte2(auditLog.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte2(auditLog.createdAt, endDate));
    }
    const whereClause = conditions.length > 0 ? and2(...conditions) : void 0;
    const [{ count: count5 }] = await db.select({ count: sql2`count(*)::int` }).from(auditLog).where(whereClause);
    const logs = await db.select({
      id: auditLog.id,
      userId: auditLog.userId,
      userEmail: auditLog.userEmail,
      userName: users.name,
      userImage: users.image,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      changes: auditLog.changes,
      ipAddress: auditLog.ipAddress,
      createdAt: auditLog.createdAt
    }).from(auditLog).leftJoin(users, eq3(auditLog.userId, users.id)).where(whereClause).orderBy(desc2(auditLog.createdAt)).limit(limit).offset(offset);
    return {
      data: logs,
      pagination: {
        page,
        limit,
        total: count5,
        totalPages: Math.ceil(count5 / limit)
      }
    };
  },
  /**
   * Get audit history for a specific entity
   */
  async getEntityHistory(entityType, entityId) {
    return db.select({
      id: auditLog.id,
      userId: auditLog.userId,
      userEmail: auditLog.userEmail,
      userName: users.name,
      action: auditLog.action,
      changes: auditLog.changes,
      ipAddress: auditLog.ipAddress,
      createdAt: auditLog.createdAt
    }).from(auditLog).leftJoin(users, eq3(auditLog.userId, users.id)).where(
      and2(
        eq3(auditLog.entityType, entityType),
        eq3(auditLog.entityId, entityId)
      )
    ).orderBy(desc2(auditLog.createdAt));
  },
  /**
   * Get action label in Indonesian
   */
  getActionLabel(action) {
    const labels = {
      "create": "Membuat",
      "update": "Mengubah",
      "delete": "Menghapus",
      "archive": "Mengarsipkan",
      "restore": "Memulihkan",
      "status_change": "Mengubah Status",
      "distribute": "Mendistribusikan",
      "receive_distribution": "Menerima Distribusi",
      "process_distribution": "Memproses Distribusi",
      "reject_distribution": "Menolak Distribusi"
    };
    return labels[action] || action;
  },
  /**
   * Get entity type label in Indonesian
   */
  getEntityTypeLabel(entityType) {
    const labels = {
      "surat_masuk": "Surat Masuk",
      "surat_keluar": "Surat Keluar",
      "arsip": "Arsip",
      "user": "User",
      "surat_distribution": "Distribusi Surat",
      "autentikasi": "Autentikasi Alih Media"
    };
    return labels[entityType] || entityType;
  }
};
var audit_log_service_default = auditLogService;

// src/routes/surat-masuk.routes.ts
var log5 = createLogger("SuratMasukRoutes");
var storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), "uploads", "surat-masuk"));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
var upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".zip", ".rar"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  }
});
var router = Router();
router.use(authMiddleware);
router.get("/", validateQuery(querySuratMasukSchema), async (req, res, next) => {
  try {
    const validatedQuery = res.locals.validatedQuery || {};
    const { tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, search, page, limit } = validatedQuery;
    const unitKerjaId = validatedQuery.unitKerjaId || "ditjen";
    const result = await suratMasukService.findAll({
      unitKerjaId,
      tahun,
      tanggalDari,
      tanggalSampai,
      jenisSurat,
      sifatSurat,
      status,
      search,
      page,
      limit
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router.get("/stats", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const stats = await suratMasukService.getStats(
      unitKerjaId,
      tahun ? Number(tahun) : void 0
    );
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});
router.get("/next-number", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const nextNumber = await suratMasukService.getNextNumber(
      unitKerjaId,
      tahun ? Number(tahun) : void 0
    );
    res.json({ success: true, data: { nextNumber } });
  } catch (error) {
    next(error);
  }
});
router.get("/pending-for-reply", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const pending = await suratMasukService.getPendingForReply(unitKerjaId);
    res.json({ success: true, data: pending });
  } catch (error) {
    next(error);
  }
});
router.get("/:id", validateIdParam(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await suratMasukService.findById(id);
    if (!result) {
      return res.status(404).json({ error: "Surat masuk not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router.post(
  "/",
  canWriteMiddleware(),
  upload.single("file"),
  async (req, res, next) => {
    try {
      const file = req.file;
      const bodyValidation = createSuratMasukSchema.safeParse(req.body);
      if (!bodyValidation.success) {
        const errors = bodyValidation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message
        }));
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors
        });
      }
      const result = await suratMasukService.create({
        ...bodyValidation.data,
        createdBy: req.user?.id,
        filePath: file ? `/uploads/surat-masuk/${file.filename}` : null,
        fileOriginalName: file ? file.originalname : null
      });
      await audit_log_service_default.logAction({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: "create",
        entityType: "surat_masuk",
        entityId: result.id,
        changes: { after: { nomorSurat: result.nomorSurat, perihal: result.perihal } },
        ipAddress: req.ip
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router.put(
  "/:id",
  validateIdParam(),
  canWriteMiddleware(),
  upload.single("file"),
  async (req, res, next) => {
    try {
      const id = req.params.id;
      const file = req.file;
      log5.info({ id, hasFile: !!file }, "[PUT /surat-masuk/:id] Request received");
      log5.info({ bodyKeys: Object.keys(req.body) }, "[PUT /surat-masuk/:id] Body keys");
      const existing = await suratMasukService.findById(id);
      if (!existing) {
        return res.status(404).json({ error: "Surat masuk not found" });
      }
      const bodyValidation = updateSuratMasukSchema.safeParse(req.body);
      log5.info({ valid: bodyValidation.success }, "[PUT /surat-masuk/:id] Validation result");
      if (!bodyValidation.success) {
        log5.info({ errors: bodyValidation.error.issues }, "[PUT /surat-masuk/:id] Validation errors");
      }
      let updateData;
      if (bodyValidation.success) {
        updateData = bodyValidation.data;
      } else {
        const knownFields = [
          "jenisSurat",
          "sifatSurat",
          "nomorSurat",
          "tanggalSurat",
          "perihal",
          "dari",
          "kepada",
          "status",
          "disposisi",
          "keterangan",
          "linkDokumen",
          "klasifikasiKode",
          "klasifikasiUraian"
        ];
        updateData = {};
        for (const field of knownFields) {
          if (req.body[field] !== void 0 && req.body[field] !== "") {
            updateData[field] = req.body[field];
          }
        }
        if (req.body.disposisi) {
          updateData.disposisi = Array.isArray(req.body.disposisi) ? req.body.disposisi : [req.body.disposisi];
        }
      }
      if (file) {
        updateData.filePath = `/uploads/surat-masuk/${file.filename}`;
        updateData.fileOriginalName = file.originalname;
      }
      log5.info({ updateKeys: Object.keys(updateData) }, "[PUT /surat-masuk/:id] Update data keys");
      const result = await suratMasukService.update(id, updateData);
      await audit_log_service_default.logAction({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: "update",
        entityType: "surat_masuk",
        entityId: id,
        changes: { before: existing, after: result, fields: Object.keys(updateData) },
        ipAddress: req.ip
      });
      res.json({ success: true, data: result });
    } catch (error) {
      log5.error({ err: error }, "[PUT /surat-masuk/:id] Error:");
      next(error);
    }
  }
);
router.delete("/:id", validateIdParam(), canWriteMiddleware(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const existing = await suratMasukService.findById(id);
    const result = await suratMasukService.delete(id);
    if (!result) {
      return res.status(404).json({ error: "Surat masuk not found" });
    }
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "delete",
      entityType: "surat_masuk",
      entityId: id,
      changes: { before: { nomorSurat: existing?.nomorSurat, perihal: existing?.perihal } },
      ipAddress: req.ip
    });
    res.json({ success: true, message: "Surat masuk deleted successfully" });
  } catch (error) {
    next(error);
  }
});
router.post("/:id/archive-full", canWriteMiddleware(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const { arsipService: arsipService2 } = await import("./arsip.service-ZF66C72U.js");
    const result = await arsipService2.archiveFromSuratMasuk(id, {
      ...req.body,
      createdBy: req.user?.id
    });
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "archive",
      entityType: "surat_masuk",
      entityId: id,
      changes: { after: { arsipId: result.id, isArchived: true } },
      ipAddress: req.ip
    });
    res.json({ success: true, data: result, message: "Surat masuk diarsipkan ke modul Arsip" });
  } catch (error) {
    if (error.message === "Surat masuk sudah diarsipkan") {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router.post("/:id/archive", canWriteMiddleware(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await suratMasukService.archive(id);
    if (!result) {
      return res.status(404).json({ error: "Surat masuk not found" });
    }
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "archive",
      entityType: "surat_masuk",
      entityId: id,
      changes: { after: { isArchived: true } },
      ipAddress: req.ip
    });
    res.json({ success: true, data: result, message: "Surat masuk archived successfully" });
  } catch (error) {
    next(error);
  }
});
router.get("/:id/balasan", async (req, res, next) => {
  try {
    const id = req.params.id;
    const balasan = await suratMasukService.getBalasan(id);
    res.json({ success: true, data: balasan });
  } catch (error) {
    next(error);
  }
});
router.get("/:id/with-links", async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await suratMasukService.findByIdWithLinks(id);
    if (!result) {
      return res.status(404).json({ error: "Surat masuk not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
var surat_masuk_routes_default = router;

// src/routes/surat-keluar.routes.ts
import { Router as Router2 } from "express";
import multer2 from "multer";
import path2 from "path";

// src/services/surat-keluar.service.ts
import { eq as eq4, and as and3, desc as desc3, sql as sql3, gte as gte3, lte as lte3, like as like2 } from "drizzle-orm";
var SuratKeluarService = class {
  async findAll(filters) {
    const { unitKerjaId, tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif, search, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [
      eq4(suratKeluar.unitKerjaId, unitKerjaId),
      eq4(suratKeluar.isDeleted, false)
      // Exclude soft-deleted records
    ];
    if (tahun) {
      conditions.push(eq4(suratKeluar.tahun, tahun));
    }
    if (tanggalDari) {
      conditions.push(gte3(suratKeluar.tanggalSurat, tanggalDari));
    }
    if (tanggalSampai) {
      conditions.push(lte3(suratKeluar.tanggalSurat, tanggalSampai));
    }
    if (naskahDinas) {
      conditions.push(eq4(suratKeluar.naskahDinas, naskahDinas));
    }
    if (klasifikasiFasilitatif) {
      conditions.push(like2(suratKeluar.klasifikasiFasilitatif, `%${klasifikasiFasilitatif}%`));
    }
    if (klasifikasiSubstantif) {
      conditions.push(like2(suratKeluar.klasifikasiSubstantif, `%${klasifikasiSubstantif}%`));
    }
    const countResult = await db.select({ count: sql3`count(*)::int` }).from(suratKeluar).where(and3(...conditions));
    const count5 = countResult?.[0]?.count ?? 0;
    const data = await db.select().from(suratKeluar).where(and3(...conditions)).orderBy(desc3(suratKeluar.createdAt)).limit(limit).offset(offset);
    return {
      data: data || [],
      pagination: {
        page,
        limit,
        total: count5,
        totalPages: Math.ceil(count5 / limit) || 1
      }
    };
  }
  async findById(id) {
    const [result] = await db.select().from(suratKeluar).where(eq4(suratKeluar.id, id)).limit(1);
    return result || null;
  }
  async create(data) {
    const tahun = data.tahun || (/* @__PURE__ */ new Date()).getFullYear();
    try {
      const result = await db.transaction(async (tx) => {
        const [lastSurat] = await tx.select({ noUrut: suratKeluar.noUrut }).from(suratKeluar).where(and3(
          eq4(suratKeluar.unitKerjaId, data.unitKerjaId),
          eq4(suratKeluar.tahun, tahun)
        )).orderBy(desc3(suratKeluar.noUrut)).limit(1).for("update");
        const noUrut = (lastSurat?.noUrut || 0) + 1;
        const [inserted] = await tx.insert(suratKeluar).values({ ...data, noUrut, tahun }).returning();
        if (data.balasanUntuk) {
          await tx.update(suratMasuk).set({ status: "sudah_dibalas", updatedAt: /* @__PURE__ */ new Date() }).where(eq4(suratMasuk.id, data.balasanUntuk));
        }
        return inserted;
      });
      return result;
    } catch (error) {
      if (error.code === "40001" || error.code === "40P01") {
        throw new DatabaseError("Terjadi konflik saat membuat nomor urut surat. Silakan coba lagi.");
      }
      throw error;
    }
  }
  async update(id, data) {
    const [result] = await db.update(suratKeluar).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq4(suratKeluar.id, id)).returning();
    return result;
  }
  async delete(id, deletedByUserId) {
    const [result] = await db.update(suratKeluar).set({
      isDeleted: true,
      deletedAt: /* @__PURE__ */ new Date(),
      deletedBy: deletedByUserId || null,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq4(suratKeluar.id, id)).returning();
    return result;
  }
  async hardDelete(id) {
    const [result] = await db.delete(suratKeluar).where(eq4(suratKeluar.id, id)).returning();
    return result;
  }
  async restore(id) {
    const [result] = await db.update(suratKeluar).set({
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq4(suratKeluar.id, id)).returning();
    return result;
  }
  async archive(id) {
    return this.update(id, { isArchived: true });
  }
  async getNextNumber(unitKerjaId, tahun) {
    const year = tahun || (/* @__PURE__ */ new Date()).getFullYear();
    const [lastSurat] = await db.select({ noUrut: suratKeluar.noUrut }).from(suratKeluar).where(and3(
      eq4(suratKeluar.unitKerjaId, unitKerjaId),
      eq4(suratKeluar.tahun, year)
    )).orderBy(desc3(suratKeluar.noUrut)).limit(1);
    return (lastSurat?.noUrut || 0) + 1;
  }
  async getStats(unitKerjaId, tahun) {
    const conditions = [eq4(suratKeluar.unitKerjaId, unitKerjaId)];
    if (tahun) {
      conditions.push(eq4(suratKeluar.tahun, tahun));
    }
    const stats = await db.select({
      total: sql3`count(*)::int`,
      diarsipkan: sql3`count(*) filter (where ${suratKeluar.isArchived} = true)::int`
    }).from(suratKeluar).where(and3(...conditions));
    return stats[0];
  }
  // Get source surat masuk yang dibalas oleh surat keluar ini
  async getSourceSuratMasuk(suratKeluarId) {
    const sk = await this.findById(suratKeluarId);
    if (!sk || !sk.balasanUntuk) return null;
    const [sourceSurat] = await db.select().from(suratMasuk).where(eq4(suratMasuk.id, sk.balasanUntuk)).limit(1);
    return sourceSurat || null;
  }
  // Get full detail with linked data
  async findByIdWithLinks(id) {
    const surat = await this.findById(id);
    if (!surat) return null;
    const sourceSuratMasuk = surat.balasanUntuk ? await this.getSourceSuratMasuk(id) : null;
    const { arsip: arsip3 } = await import("./schema-X7T7ECFS.js");
    const [arsipEntry] = await db.select().from(arsip3).where(and3(
      eq4(arsip3.sourceSuratId, id),
      eq4(arsip3.jenisArsip, "keluar")
    )).limit(1);
    return {
      ...surat,
      sourceSuratMasuk,
      arsipEntry: arsipEntry || null
    };
  }
};
var suratKeluarService = new SuratKeluarService();

// src/routes/surat-keluar.routes.ts
var storage2 = multer2.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path2.join(process.cwd(), "uploads", "surat-keluar"));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path2.extname(file.originalname));
  }
});
var upload2 = multer2({
  storage: storage2,
  limits: { fileSize: 10 * 1024 * 1024 },
  // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".zip", ".rar"];
    const ext = path2.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  }
});
var router2 = Router2();
router2.use(authMiddleware);
router2.get("/", validateQuery(querySuratKeluarSchema), async (req, res, next) => {
  try {
    const validatedQuery = res.locals.validatedQuery || {};
    const { tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif, search, page, limit } = validatedQuery;
    const unitKerjaId = validatedQuery.unitKerjaId || "ditjen";
    const result = await suratKeluarService.findAll({
      unitKerjaId,
      tahun,
      tanggalDari,
      tanggalSampai,
      naskahDinas,
      klasifikasiFasilitatif,
      klasifikasiSubstantif,
      search,
      page,
      limit
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router2.get("/next-number", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const nextNumber = await suratKeluarService.getNextNumber(
      unitKerjaId,
      tahun ? Number(tahun) : void 0
    );
    res.json({ success: true, data: { nextNumber } });
  } catch (error) {
    next(error);
  }
});
router2.get("/stats", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const stats = await suratKeluarService.getStats(
      unitKerjaId,
      tahun ? Number(tahun) : void 0
    );
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});
router2.get("/:id", validateIdParam(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await suratKeluarService.findById(id);
    if (!result) {
      return res.status(404).json({ error: "Surat keluar not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router2.post(
  "/",
  canWriteMiddleware(),
  upload2.single("file"),
  async (req, res, next) => {
    try {
      const file = req.file;
      const result = await suratKeluarService.create({
        ...req.body,
        createdBy: req.user?.id,
        filePath: file ? `/uploads/surat-keluar/${file.filename}` : null,
        fileOriginalName: file ? file.originalname : null
      });
      await audit_log_service_default.logAction({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: "create",
        entityType: "surat_keluar",
        entityId: result.id,
        changes: { after: { nomorSurat: result.nomorSurat, perihal: result.perihal } },
        ipAddress: req.ip
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router2.put(
  "/:id",
  validateIdParam(),
  canWriteMiddleware(),
  upload2.single("file"),
  async (req, res, next) => {
    try {
      const id = req.params.id;
      const file = req.file;
      const existing = await suratKeluarService.findById(id);
      if (!existing) {
        return res.status(404).json({ error: "Surat keluar not found" });
      }
      const bodyValidation = updateSuratKeluarSchema.safeParse(req.body);
      let updateData;
      if (bodyValidation.success) {
        updateData = bodyValidation.data;
      } else {
        const knownFields = [
          "nomorSurat",
          "tanggalSurat",
          "tujuan",
          "perihal",
          "sifat",
          "lampiran",
          "konseptor",
          "penandatangan",
          "catatan",
          "naskahDinas",
          "klasifikasiFasilitatifKode",
          "klasifikasiFasilitatif",
          "klasifikasiSubstantifKode",
          "klasifikasiSubstantif",
          "linkDokumen",
          "keterangan"
        ];
        updateData = {};
        for (const field of knownFields) {
          if (req.body[field] !== void 0 && req.body[field] !== "") {
            updateData[field] = req.body[field];
          }
        }
      }
      if (file) {
        updateData.filePath = `/uploads/surat-keluar/${file.filename}`;
        updateData.fileOriginalName = file.originalname;
      }
      const result = await suratKeluarService.update(id, updateData);
      await audit_log_service_default.logAction({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: "update",
        entityType: "surat_keluar",
        entityId: id,
        changes: { before: existing, after: result, fields: Object.keys(updateData) },
        ipAddress: req.ip
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router2.delete("/:id", validateIdParam(), canWriteMiddleware(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const existing = await suratKeluarService.findById(id);
    const result = await suratKeluarService.delete(id);
    if (!result) {
      return res.status(404).json({ error: "Surat keluar not found" });
    }
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "delete",
      entityType: "surat_keluar",
      entityId: id,
      changes: { before: { nomorSurat: existing?.nomorSurat, perihal: existing?.perihal } },
      ipAddress: req.ip
    });
    res.json({ success: true, message: "Surat keluar deleted successfully" });
  } catch (error) {
    next(error);
  }
});
router2.post("/:id/archive-full", canWriteMiddleware(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const { arsipService: arsipService2 } = await import("./arsip.service-ZF66C72U.js");
    const result = await arsipService2.archiveFromSuratKeluar(id, {
      ...req.body,
      createdBy: req.user?.id
    });
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "archive",
      entityType: "surat_keluar",
      entityId: id,
      changes: { after: { arsipId: result.id, isArchived: true } },
      ipAddress: req.ip
    });
    res.json({ success: true, data: result, message: "Surat keluar diarsipkan ke modul Arsip" });
  } catch (error) {
    if (error.message === "Surat keluar sudah diarsipkan") {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router2.post("/:id/archive", canWriteMiddleware(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await suratKeluarService.archive(id);
    if (!result) {
      return res.status(404).json({ error: "Surat keluar not found" });
    }
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "archive",
      entityType: "surat_keluar",
      entityId: id,
      changes: { after: { isArchived: true } },
      ipAddress: req.ip
    });
    res.json({ success: true, data: result, message: "Surat keluar archived successfully" });
  } catch (error) {
    next(error);
  }
});
router2.get("/:id/source", async (req, res, next) => {
  try {
    const id = req.params.id;
    const source = await suratKeluarService.getSourceSuratMasuk(id);
    res.json({ success: true, data: source });
  } catch (error) {
    next(error);
  }
});
router2.get("/:id/with-links", async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await suratKeluarService.findByIdWithLinks(id);
    if (!result) {
      return res.status(404).json({ error: "Surat keluar not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
var surat_keluar_routes_default = router2;

// src/routes/arsip.routes.ts
import { Router as Router3 } from "express";

// src/services/fulltext-search.service.ts
import { and as and4, or as or3, ilike as ilike3, eq as eq5, desc as desc4, sql as sql4 } from "drizzle-orm";
var STOPWORDS = /* @__PURE__ */ new Set([
  "yang",
  "dan",
  "di",
  "ke",
  "dari",
  "untuk",
  "dengan",
  "pada",
  "ini",
  "itu",
  "adalah",
  "dalam",
  "akan",
  "atau",
  "sebagai",
  "oleh",
  "bahwa",
  "tersebut",
  "dapat",
  "tidak",
  "juga",
  "kami",
  "anda",
  "saya",
  "mereka",
  "kita",
  "ada",
  "telah",
  "sudah",
  "belum",
  "harus",
  "bisa",
  "lebih",
  "sangat",
  "sesuai"
]);
var FullTextSearchService = class {
  // Extract and clean search terms from query
  extractSearchTerms(query) {
    return query.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, " ").split(/\s+/).filter((term) => term.length > 2).filter((term) => !STOPWORDS.has(term));
  }
  // Generate fuzzy pattern for a term (simple Levenshtein-like approach)
  generateFuzzyPattern(term) {
    if (term.length <= 3) return `%${term}%`;
    return `%${term}%`;
  }
  // Search arsip with enhanced full-text search capability
  async search(params) {
    const {
      query,
      unitKerjaId,
      jenisArsip,
      tahun,
      page = 1,
      limit = 20,
      fuzzy = false,
      sortBy = "relevance"
    } = params;
    const offset = (page - 1) * limit;
    const searchTerms = this.extractSearchTerms(query);
    const searchPattern = `%${query}%`;
    const searchConditions = or3(
      ilike3(arsip.nomorBerkas, searchPattern),
      ilike3(arsip.uraianBerkas, searchPattern),
      ilike3(arsip.nomorSuratOriginal, searchPattern),
      ilike3(arsip.perihalOriginal, searchPattern),
      ilike3(arsip.extractedText, searchPattern),
      ilike3(arsip.keterangan, searchPattern),
      // Search in JRA fields
      ilike3(arsip.jraKode, searchPattern),
      ilike3(arsip.jraUraian, searchPattern)
    );
    const filterConditions = [
      eq5(arsip.unitKerjaId, unitKerjaId),
      searchConditions
    ];
    if (jenisArsip) {
      filterConditions.push(eq5(arsip.jenisArsip, jenisArsip));
    }
    if (tahun) {
      filterConditions.push(eq5(arsip.tahun, tahun));
    }
    const countResult = await db.select({ count: sql4`count(*)::int` }).from(arsip).where(and4(...filterConditions));
    const total = countResult[0]?.count || 0;
    const results = await db.select({
      id: arsip.id,
      nomorBerkas: arsip.nomorBerkas,
      uraianBerkas: arsip.uraianBerkas,
      nomorSuratOriginal: arsip.nomorSuratOriginal,
      perihalOriginal: arsip.perihalOriginal,
      tanggalArsip: arsip.tanggalArsip,
      tahun: arsip.tahun,
      jenisArsip: arsip.jenisArsip,
      extractedText: arsip.extractedText,
      keterangan: arsip.keterangan,
      jraKode: arsip.jraKode,
      jraUraian: arsip.jraUraian
    }).from(arsip).where(and4(...filterConditions)).orderBy(desc4(arsip.createdAt)).limit(limit).offset(offset);
    const data = results.map((row) => {
      const { matchSnippet, matchScore, matchedFields, highlightedText } = this.calculateMatchDetails(row, query, searchTerms);
      return {
        id: row.id,
        nomorBerkas: row.nomorBerkas,
        uraianBerkas: row.uraianBerkas,
        nomorSuratOriginal: row.nomorSuratOriginal,
        perihalOriginal: row.perihalOriginal,
        tanggalArsip: row.tanggalArsip,
        tahun: row.tahun,
        jenisArsip: row.jenisArsip,
        matchSnippet,
        matchScore,
        highlightedText,
        matchedFields
      };
    });
    if (sortBy === "relevance") {
      data.sort((a, b) => b.matchScore - a.matchScore);
    }
    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      searchTerms
    };
  }
  // Calculate match details for a single result
  calculateMatchDetails(row, query, searchTerms) {
    const lowerQuery = query.toLowerCase();
    let matchSnippet = null;
    let matchScore = 0;
    const matchedFields = [];
    let highlightedText = null;
    if (row.nomorSuratOriginal?.toLowerCase().includes(lowerQuery)) {
      matchedFields.push("nomorSurat");
      matchScore += 10;
      if (!matchSnippet) {
        matchSnippet = `Nomor: ${row.nomorSuratOriginal}`;
      }
    } else if (row.nomorSuratOriginal) {
      const termMatches = searchTerms.filter(
        (term) => row.nomorSuratOriginal.toLowerCase().includes(term)
      );
      if (termMatches.length > 0) {
        matchedFields.push("nomorSurat");
        matchScore += 5 * termMatches.length;
      }
    }
    if (row.perihalOriginal?.toLowerCase().includes(lowerQuery)) {
      matchedFields.push("perihal");
      matchScore += 8;
      if (!matchSnippet) {
        matchSnippet = `Perihal: ${row.perihalOriginal?.substring(0, 100)}...`;
      }
    } else if (row.perihalOriginal) {
      const termMatches = searchTerms.filter(
        (term) => row.perihalOriginal.toLowerCase().includes(term)
      );
      if (termMatches.length > 0) {
        matchedFields.push("perihal");
        matchScore += 4 * termMatches.length;
      }
    }
    if (row.uraianBerkas?.toLowerCase().includes(lowerQuery)) {
      matchedFields.push("uraianBerkas");
      matchScore += 6;
      if (!matchSnippet) {
        matchSnippet = `Uraian: ${row.uraianBerkas?.substring(0, 100)}...`;
      }
    } else if (row.uraianBerkas) {
      const termMatches = searchTerms.filter(
        (term) => row.uraianBerkas.toLowerCase().includes(term)
      );
      if (termMatches.length > 0) {
        matchedFields.push("uraianBerkas");
        matchScore += 3 * termMatches.length;
      }
    }
    if (row.extractedText) {
      const lowerText = row.extractedText.toLowerCase();
      const matchIndex = lowerText.indexOf(lowerQuery);
      if (matchIndex !== -1) {
        matchedFields.push("extractedText");
        matchScore += 5;
        const start = Math.max(0, matchIndex - 50);
        const end = Math.min(row.extractedText.length, matchIndex + query.length + 50);
        const snippet = row.extractedText.substring(start, end);
        highlightedText = this.highlightTerms(snippet, [query]);
        if (!matchSnippet) {
          matchSnippet = (start > 0 ? "..." : "") + snippet + (end < row.extractedText.length ? "..." : "");
        }
      } else {
        const termMatches = searchTerms.filter((term) => lowerText.includes(term));
        if (termMatches.length > 0) {
          matchedFields.push("extractedText");
          matchScore += 2 * termMatches.length;
          const firstMatch = termMatches[0];
          const termIndex = lowerText.indexOf(firstMatch);
          if (termIndex !== -1) {
            const start = Math.max(0, termIndex - 50);
            const end = Math.min(row.extractedText.length, termIndex + 100);
            const snippet = row.extractedText.substring(start, end);
            highlightedText = this.highlightTerms(snippet, termMatches);
            if (!matchSnippet) {
              matchSnippet = (start > 0 ? "..." : "") + snippet + (end < row.extractedText.length ? "..." : "");
            }
          }
        }
      }
    }
    if (row.keterangan?.toLowerCase().includes(lowerQuery)) {
      matchedFields.push("keterangan");
      matchScore += 3;
    }
    if (row.jraKode?.toLowerCase().includes(lowerQuery)) {
      matchedFields.push("jraKode");
      matchScore += 4;
    }
    if (row.jraUraian?.toLowerCase().includes(lowerQuery)) {
      matchedFields.push("jraUraian");
      matchScore += 4;
    }
    return { matchSnippet, matchScore, matchedFields, highlightedText };
  }
  // Highlight search terms in text
  highlightTerms(text, terms) {
    let highlighted = text;
    terms.forEach((term) => {
      const regex = new RegExp(`(${term})`, "gi");
      highlighted = highlighted.replace(regex, "**$1**");
    });
    return highlighted;
  }
  // Get suggestions for autocomplete
  async getSuggestions(query, unitKerjaId, limit = 10) {
    const searchPattern = `%${query}%`;
    const nomorResults = await db.selectDistinct({ value: arsip.nomorSuratOriginal }).from(arsip).where(and4(
      eq5(arsip.unitKerjaId, unitKerjaId),
      ilike3(arsip.nomorSuratOriginal, searchPattern)
    )).limit(limit);
    const perihalResults = await db.selectDistinct({ value: arsip.perihalOriginal }).from(arsip).where(and4(
      eq5(arsip.unitKerjaId, unitKerjaId),
      ilike3(arsip.perihalOriginal, searchPattern)
    )).limit(limit);
    const suggestions = [];
    nomorResults.forEach((r) => {
      if (r.value) suggestions.push(r.value);
    });
    perihalResults.forEach((r) => {
      if (r.value && r.value.length <= 100) {
        suggestions.push(r.value);
      }
    });
    return suggestions.slice(0, limit);
  }
  // Search by keywords extracted from OCR
  async searchByKeywords(keywords, unitKerjaId, options2) {
    const { limit = 20, offset = 0 } = options2 || {};
    const keywordConditions = keywords.map(
      (keyword) => ilike3(arsip.extractedText, `%${keyword}%`)
    );
    const filterConditions = [
      eq5(arsip.unitKerjaId, unitKerjaId),
      or3(...keywordConditions)
    ];
    const countResult = await db.select({ count: sql4`count(*)::int` }).from(arsip).where(and4(...filterConditions));
    const results = await db.select({
      id: arsip.id,
      nomorBerkas: arsip.nomorBerkas,
      uraianBerkas: arsip.uraianBerkas,
      nomorSuratOriginal: arsip.nomorSuratOriginal,
      perihalOriginal: arsip.perihalOriginal,
      tanggalArsip: arsip.tanggalArsip,
      tahun: arsip.tahun,
      jenisArsip: arsip.jenisArsip
    }).from(arsip).where(and4(...filterConditions)).orderBy(desc4(arsip.createdAt)).limit(limit).offset(offset);
    return {
      data: results,
      total: countResult[0]?.count || 0
    };
  }
  // Get related documents based on keywords
  async getRelatedDocuments(arsipId, unitKerjaId, limit = 5) {
    const sourceDoc = await db.select({ extractedText: arsip.extractedText }).from(arsip).where(eq5(arsip.id, arsipId)).limit(1);
    if (!sourceDoc.length || !sourceDoc[0].extractedText) {
      return [];
    }
    const sourceText = sourceDoc[0].extractedText;
    const keywords = this.extractSearchTerms(sourceText.substring(0, 2e3));
    const topKeywords = keywords.slice(0, 5);
    if (topKeywords.length === 0) return [];
    const keywordConditions = topKeywords.map(
      (keyword) => ilike3(arsip.extractedText, `%${keyword}%`)
    );
    const results = await db.select({
      id: arsip.id,
      nomorBerkas: arsip.nomorBerkas,
      uraianBerkas: arsip.uraianBerkas,
      nomorSuratOriginal: arsip.nomorSuratOriginal,
      perihalOriginal: arsip.perihalOriginal
    }).from(arsip).where(and4(
      eq5(arsip.unitKerjaId, unitKerjaId),
      sql4`${arsip.id} != ${arsipId}`,
      // Exclude source document
      or3(...keywordConditions)
    )).orderBy(desc4(arsip.createdAt)).limit(limit);
    return results;
  }
};
var fullTextSearchService = new FullTextSearchService();

// src/routes/arsip.routes.ts
var router3 = Router3();
router3.use(authMiddleware);
router3.get("/", validateQuery(queryArsipSchema), async (req, res, next) => {
  try {
    const validatedQuery = res.locals.validatedQuery || {};
    let { unitKerjaId, jenisSurat, tahun, search, page, limit } = validatedQuery;
    if (unitKerjaId === "null" || unitKerjaId === "undefined") {
      unitKerjaId = void 0;
    }
    const result = await arsipService.findAll({
      unitKerjaId,
      jenisArsip: jenisSurat,
      tahun,
      search,
      page,
      limit
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router3.get("/expiring", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { daysAhead } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const data = await arsipService.getExpiring(
      unitKerjaId,
      daysAhead ? Number(daysAhead) : 30
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
router3.get("/stats", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const stats = await arsipService.getStats(
      unitKerjaId,
      tahun ? Number(tahun) : void 0
    );
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});
router3.get("/search/fulltext", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { q, jenisArsip, tahun, page, limit } = req.query;
    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const result = await fullTextSearchService.search({
      query: q,
      unitKerjaId,
      jenisArsip: typeof jenisArsip === "string" ? jenisArsip : void 0,
      tahun: tahun ? Number(tahun) : void 0,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router3.get("/search/suggestions", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { q, limit } = req.query;
    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const suggestions = await fullTextSearchService.getSuggestions(
      q,
      unitKerjaId,
      limit ? Number(limit) : 10
    );
    res.json({ success: true, data: suggestions });
  } catch (error) {
    next(error);
  }
});
router3.get("/search/keywords", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { keywords, page, limit } = req.query;
    if (!keywords || typeof keywords !== "string") {
      return res.status(400).json({ error: "Keywords parameter is required" });
    }
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const keywordList = keywords.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
    if (keywordList.length === 0) {
      return res.status(400).json({ error: "At least one keyword is required" });
    }
    const pageNum = page ? Number(page) : 1;
    const limitNum = limit ? Number(limit) : 20;
    const result = await fullTextSearchService.searchByKeywords(
      keywordList,
      unitKerjaId,
      { limit: limitNum, offset: (pageNum - 1) * limitNum }
    );
    res.json({
      success: true,
      data: result.data,
      total: result.total,
      page: pageNum,
      totalPages: Math.ceil(result.total / limitNum)
    });
  } catch (error) {
    next(error);
  }
});
router3.get("/:id/related", async (req, res, next) => {
  try {
    const { id } = req.params;
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { limit } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const related = await fullTextSearchService.getRelatedDocuments(
      id,
      unitKerjaId,
      limit ? Number(limit) : 5
    );
    res.json({ success: true, data: related });
  } catch (error) {
    next(error);
  }
});
router3.get("/:id", validateIdParam(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await arsipService.findById(id);
    if (!result) {
      return res.status(404).json({ error: "Arsip not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router3.post(
  "/",
  canWriteMiddleware(),
  validateBody(createArsipSchema),
  async (req, res, next) => {
    try {
      const result = await arsipService.create({
        ...req.body,
        createdBy: req.user?.id
      });
      await audit_log_service_default.logAction({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: "create",
        entityType: "arsip",
        entityId: result.id,
        changes: { after: { nomorBerkas: result.nomorBerkas, jenisArsip: result.jenisArsip } },
        ipAddress: req.ip
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router3.put(
  "/:id",
  validateIdParam(),
  canWriteMiddleware(),
  validateBody(updateArsipSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = await arsipService.findById(id);
      const result = await arsipService.update(id, req.body);
      if (!result) {
        return res.status(404).json({ error: "Arsip not found" });
      }
      await audit_log_service_default.logAction({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: "update",
        entityType: "arsip",
        entityId: id,
        changes: { before: existing ?? void 0, after: result, fields: Object.keys(req.body) },
        ipAddress: req.ip
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router3.delete("/:id", validateIdParam(), canWriteMiddleware(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await arsipService.findById(id);
    const result = await arsipService.delete(id);
    if (!result) {
      return res.status(404).json({ error: "Arsip not found" });
    }
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "delete",
      entityType: "arsip",
      entityId: id,
      changes: { before: { nomorBerkas: existing?.nomorBerkas } },
      ipAddress: req.ip
    });
    res.json({ success: true, message: "Arsip deleted successfully" });
  } catch (error) {
    next(error);
  }
});
var arsip_routes_default = router3;

// src/routes/upload.routes.ts
import { Router as Router4 } from "express";
import multer3 from "multer";

// src/services/file-attachment.service.ts
import { eq as eq6, and as and5 } from "drizzle-orm";

// src/services/google-drive.service.ts
import { google } from "googleapis";
import { Readable } from "stream";
var log6 = createLogger("GoogleDriveService");
var auth2 = new google.auth.GoogleAuth({
  credentials: {
    client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  },
  scopes: ["https://www.googleapis.com/auth/drive.file"]
});
var drive = google.drive({ version: "v3", auth: auth2 });
var GoogleDriveService = class {
  defaultFolderId;
  constructor() {
    this.defaultFolderId = env.GOOGLE_DRIVE_FOLDER_ID || "";
  }
  // Upload file to Google Drive
  async uploadFile(options2) {
    const { fileName, mimeType, buffer, folderId } = options2;
    const targetFolderId = folderId || this.defaultFolderId;
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: targetFolderId ? [targetFolderId] : void 0
      },
      media: {
        mimeType,
        body: stream
      },
      fields: "id, name, mimeType, webViewLink, webContentLink, size"
    });
    const domain = process.env.GOOGLE_WORKSPACE_DOMAIN;
    if (domain) {
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: {
          role: "reader",
          type: "domain",
          domain
        }
      });
    } else {
      if (process.env.NODE_ENV === "production") {
        log6.warn("[GoogleDrive] WARNING: GOOGLE_WORKSPACE_DOMAIN not set. Files will be shared with anyone who has the link. Set this env var for domain-restricted access.");
      }
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: {
          role: "reader",
          type: "anyone"
        }
      });
    }
    return {
      id: response.data.id,
      name: response.data.name,
      mimeType: response.data.mimeType,
      webViewLink: response.data.webViewLink,
      webContentLink: response.data.webContentLink || void 0,
      size: response.data.size || void 0
    };
  }
  // Get file metadata
  async getFile(fileId) {
    try {
      const response = await drive.files.get({
        fileId,
        fields: "id, name, mimeType, webViewLink, webContentLink, size"
      });
      return {
        id: response.data.id,
        name: response.data.name,
        mimeType: response.data.mimeType,
        webViewLink: response.data.webViewLink,
        webContentLink: response.data.webContentLink || void 0,
        size: response.data.size || void 0
      };
    } catch (error) {
      log6.error({ err: error }, "Failed to get file:");
      return null;
    }
  }
  // Delete file from Google Drive
  async deleteFile(fileId) {
    try {
      await drive.files.delete({ fileId });
      return true;
    } catch (error) {
      log6.error({ err: error }, "Failed to delete file:");
      return false;
    }
  }
  // List files in folder
  async listFiles(folderId) {
    const targetFolderId = folderId || this.defaultFolderId;
    const response = await drive.files.list({
      q: `'${targetFolderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, webViewLink, webContentLink, size)",
      orderBy: "createdTime desc"
    });
    return (response.data.files || []).map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink,
      webContentLink: file.webContentLink || void 0,
      size: file.size || void 0
    }));
  }
  // Create folder
  async createFolder(name, parentFolderId) {
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentFolderId ? [parentFolderId] : void 0
      },
      fields: "id"
    });
    return response.data.id;
  }
};
var googleDriveService = new GoogleDriveService();

// src/services/file-attachment.service.ts
import crypto2 from "crypto";
function mapSuratTypeToEntityType(suratType) {
  const mapping = {
    masuk: "surat_masuk",
    keluar: "surat_keluar",
    arsip: "arsip"
  };
  return mapping[suratType] || suratType;
}
var FileAttachmentService = class {
  // Upload file and create attachment record
  async create(data) {
    const hash = crypto2.createHash("sha256").update(data.buffer).digest("hex");
    const driveFile = await googleDriveService.uploadFile({
      fileName: data.fileName,
      mimeType: data.mimeType,
      buffer: data.buffer,
      folderId: data.folderId
    });
    const [attachment] = await db.insert(fileAttachments).values({
      entityId: data.suratId,
      entityType: mapSuratTypeToEntityType(data.suratType),
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: data.buffer.length,
      driveFileId: driveFile.id,
      fileUrl: driveFile.webViewLink
    }).returning();
    return { ...attachment, hash };
  }
  // Get attachments for a surat
  async findBySurat(suratId, suratType) {
    const entityType = mapSuratTypeToEntityType(suratType);
    return db.select().from(fileAttachments).where(
      and5(
        eq6(fileAttachments.entityId, suratId),
        eq6(fileAttachments.entityType, entityType)
      )
    );
  }
  // Get single attachment
  async findById(id) {
    const [result] = await db.select().from(fileAttachments).where(eq6(fileAttachments.id, id)).limit(1);
    return result || null;
  }
  // Delete attachment (also deletes from Drive)
  async delete(id) {
    const attachment = await this.findById(id);
    if (!attachment) return false;
    if (attachment.driveFileId) {
      await googleDriveService.deleteFile(attachment.driveFileId);
    }
    await db.delete(fileAttachments).where(eq6(fileAttachments.id, id));
    return true;
  }
};
var fileAttachmentService = new FileAttachmentService();

// src/routes/upload.routes.ts
var log7 = createLogger("UploadRoutes");
var router4 = Router4();
router4.use(uploadLimiter);
var upload3 = multer3({
  storage: multer3.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
    // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "image/jpeg",
      "image/png",
      "image/gif"
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF, Word, Excel, and images are allowed."));
    }
  }
});
router4.post(
  "/:suratType/:suratId",
  authMiddleware,
  upload3.single("file"),
  async (req, res) => {
    try {
      const suratType = req.params.suratType;
      const suratId = req.params.suratId;
      const { folderId } = req.body;
      if (!["masuk", "keluar", "arsip"].includes(suratType)) {
        return res.status(400).json({ error: "Invalid surat type" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const attachment = await fileAttachmentService.create({
        suratId,
        suratType,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        folderId
      });
      res.status(201).json({
        success: true,
        data: attachment,
        hash: attachment.hash,
        // Return hash to client
        message: "File uploaded successfully"
      });
    } catch (error) {
      log7.error({ err: error }, "Upload error:");
      res.status(500).json({ error: error.message || "Upload failed" });
    }
  }
);
router4.get("/:suratType/:suratId", authMiddleware, async (req, res) => {
  try {
    const suratType = req.params.suratType;
    const suratId = req.params.suratId;
    const attachments = await fileAttachmentService.findBySurat(suratId, suratType);
    res.json({
      success: true,
      data: attachments
    });
  } catch (error) {
    log7.error({ err: error }, "Get attachments error:");
    res.status(500).json({ error: error.message || "Failed to get attachments" });
  }
});
router4.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await fileAttachmentService.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: "Attachment not found" });
    }
    res.json({
      success: true,
      message: "Attachment deleted successfully"
    });
  } catch (error) {
    log7.error({ err: error }, "Delete attachment error:");
    res.status(500).json({ error: error.message || "Delete failed" });
  }
});
var upload_routes_default = router4;

// src/routes/unit-kerja.routes.ts
import { Router as Router5 } from "express";
var router5 = Router5();
router5.use(authMiddleware);
router5.get("/", async (req, res, next) => {
  try {
    const data = await db.select().from(unitKerja);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
var unit_kerja_routes_default = router5;

// src/routes/migration.routes.ts
import { Router as Router6 } from "express";
import multer4 from "multer";

// src/services/migration.service.ts
import { parse } from "csv-parse/sync";
function parseDate(dateStr) {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [day, month, year] = dateStr.split("/");
    return `${year}-${month}-${day}`;
  }
  const dateTimeMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dateTimeMatch) {
    const [, day, month, year] = dateTimeMatch;
    return `${year}-${month}-${day}`;
  }
  return null;
}
function getCurrentYear() {
  return (/* @__PURE__ */ new Date()).getFullYear();
}
function getToday() {
  return (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
}
var migrationService = {
  /**
   * Import Surat Masuk from CSV content
   * Headers from Manajemen Surat Dirjen: ID, No, Jenis Surat, Sifat Surat, Nomor Surat, 
   *                   Tanggal Surat, Perihal, Dari, Kepada, Status, Disposisi, Timestamp
   */
  async importSuratMasuk(csvContent, unitKerjaId, createdBy) {
    const result = {
      success: true,
      imported: 0,
      skipped: 0,
      errors: []
    };
    try {
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true
      });
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        try {
          const nomorSurat = row["Nomor Surat"];
          const noStr = row["No"];
          const perihal = row["Perihal"];
          if (!nomorSurat && !noStr) continue;
          if (nomorSurat === "Nomor Surat") continue;
          if (!perihal) {
            result.skipped++;
            continue;
          }
          const tanggalSurat = parseDate(row["Tanggal Surat"]);
          const noUrut = parseInt(noStr || "0") || result.imported + 1;
          const tahun = tanggalSurat ? parseInt(tanggalSurat.substring(0, 4)) : getCurrentYear();
          await db.insert(suratMasuk).values({
            unitKerjaId,
            noUrut,
            tahun,
            jenisSurat: row["Jenis Surat"] || "Surat Dinas",
            sifatSurat: row["Sifat Surat"] || "Biasa",
            nomorSurat: nomorSurat || "",
            tanggalSurat: tanggalSurat || getToday(),
            perihal,
            dari: row["Dari"] || "",
            kepada: row["Kepada"] || "",
            status: row["Status"] || "belum_dibalas",
            disposisi: row["Disposisi"] ? [row["Disposisi"]] : [],
            createdBy
          });
          result.imported++;
        } catch (rowError) {
          result.errors.push(`Row ${i + 1}: ${rowError.message}`);
        }
      }
    } catch (error) {
      result.success = false;
      result.errors.push(`Parse error: ${error.message}`);
    }
    return result;
  },
  /**
   * Import Surat Keluar from CSV content
   */
  async importSuratKeluar(csvContent, unitKerjaId, createdBy) {
    const result = {
      success: true,
      imported: 0,
      skipped: 0,
      errors: []
    };
    try {
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true
      });
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        try {
          const nomorSurat = row["Nomor Surat"];
          const noStr = row["No"];
          const perihal = row["Perihal"];
          if (!nomorSurat && !noStr) continue;
          if (nomorSurat === "Nomor Surat") continue;
          if (!perihal) {
            result.skipped++;
            continue;
          }
          const tanggalSurat = parseDate(row["Tanggal Surat"]);
          const noUrut = parseInt(noStr || "0") || result.imported + 1;
          const tahun = tanggalSurat ? parseInt(tanggalSurat.substring(0, 4)) : getCurrentYear();
          await db.insert(suratKeluar).values({
            unitKerjaId,
            noUrut,
            tahun,
            naskahDinas: row["Naskah Dinas"] || row["Jenis Surat"] || "Surat Dinas",
            nomorSurat: nomorSurat || "",
            tanggalSurat: tanggalSurat || getToday(),
            perihal,
            kepada: row["Kepada"] || row["Tujuan"] || "",
            createdBy
          });
          result.imported++;
        } catch (rowError) {
          result.errors.push(`Row ${i + 1}: ${rowError.message}`);
        }
      }
    } catch (error) {
      result.success = false;
      result.errors.push(`Parse error: ${error.message}`);
    }
    return result;
  },
  /**
   * Import Arsip from CSV content
   */
  async importArsip(csvContent, unitKerjaId, createdBy) {
    const result = {
      success: true,
      imported: 0,
      skipped: 0,
      errors: []
    };
    try {
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true
      });
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        try {
          const uraian = row["Uraian"] || row["Uraian Berkas"] || row["Deskripsi"] || row["Perihal"];
          if (!uraian) {
            result.skipped++;
            continue;
          }
          const tanggal = parseDate(row["Tanggal"] || row["Tanggal Arsip"]);
          const tahun = tanggal ? parseInt(tanggal.substring(0, 4)) : getCurrentYear();
          await db.insert(arsip).values({
            unitKerjaId,
            jenisArsip: row["Jenis Arsip"] || row["Jenis"] || "masuk",
            tahun,
            nomorBerkas: row["Nomor Berkas"] || row["No"] || "",
            kodeKlasifikasi: row["Kode Klasifikasi"] || row["Kode"] || "",
            uraianBerkas: uraian,
            tingkatPerkembangan: row["Tingkat Perkembangan"] || "",
            tanggalArsip: tanggal || getToday(),
            kurunWaktu: row["Kurun"] || row["Kurun Waktu"] || "",
            jumlah: parseInt(row["Jumlah"] || "1") || 1,
            keterangan: row["Keterangan"] || "",
            createdBy
          });
          result.imported++;
        } catch (rowError) {
          result.errors.push(`Row ${i + 1}: ${rowError.message}`);
        }
      }
    } catch (error) {
      result.success = false;
      result.errors.push(`Parse error: ${error.message}`);
    }
    return result;
  }
};

// src/routes/migration.routes.ts
var router6 = Router6();
var upload4 = multer4({ storage: multer4.memoryStorage() });
router6.use(authMiddleware);
router6.post(
  "/surat-masuk",
  canWriteMiddleware(),
  upload4.single("file"),
  async (req, res, next) => {
    try {
      const unitKerjaId = req.body.unitKerjaId || req.user?.unitKerjaId || "ditjen";
      if (!unitKerjaId) {
        return res.status(400).json({
          success: false,
          error: "unitKerjaId is required"
        });
      }
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "CSV file is required"
        });
      }
      const csvContent = req.file.buffer.toString("utf-8");
      const result = await migrationService.importSuratMasuk(
        csvContent,
        unitKerjaId,
        req.user?.id
      );
      res.json({
        success: result.success,
        message: `Imported ${result.imported} records, skipped ${result.skipped}`,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);
router6.post(
  "/surat-keluar",
  canWriteMiddleware(),
  upload4.single("file"),
  async (req, res, next) => {
    try {
      const unitKerjaId = req.body.unitKerjaId || req.user?.unitKerjaId || "ditjen";
      if (!unitKerjaId) {
        return res.status(400).json({
          success: false,
          error: "unitKerjaId is required"
        });
      }
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "CSV file is required"
        });
      }
      const csvContent = req.file.buffer.toString("utf-8");
      const result = await migrationService.importSuratKeluar(
        csvContent,
        unitKerjaId,
        req.user?.id
      );
      res.json({
        success: result.success,
        message: `Imported ${result.imported} records, skipped ${result.skipped}`,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);
router6.post(
  "/arsip",
  canWriteMiddleware(),
  upload4.single("file"),
  async (req, res, next) => {
    try {
      const unitKerjaId = req.body.unitKerjaId || req.user?.unitKerjaId || "ditjen";
      if (!unitKerjaId) {
        return res.status(400).json({
          success: false,
          error: "unitKerjaId is required"
        });
      }
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "CSV file is required"
        });
      }
      const csvContent = req.file.buffer.toString("utf-8");
      const result = await migrationService.importArsip(
        csvContent,
        unitKerjaId,
        req.user?.id
      );
      res.json({
        success: result.success,
        message: `Imported ${result.imported} records, skipped ${result.skipped}`,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);
var migration_routes_default = router6;

// src/routes/dashboard.routes.ts
import { Router as Router7 } from "express";

// src/services/dashboard.service.ts
import { sql as sql5, eq as eq7, and as and6, gte as gte4, lte as lte4, count, inArray as inArray2 } from "drizzle-orm";
var log8 = createLogger("DashboardService");
var dashboardService = {
  async getStats(unitKerjaId, tahun) {
    const currentYear = tahun || (/* @__PURE__ */ new Date()).getFullYear();
    const currentMonth = (/* @__PURE__ */ new Date()).getMonth() + 1;
    const currentDate = /* @__PURE__ */ new Date();
    const thirtyDaysFromNow = new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1e3);
    const unitMasukFilter = unitKerjaId ? sql5`AND ${suratMasuk.unitKerjaId} = ${unitKerjaId}` : sql5``;
    const unitKeluarFilter = unitKerjaId ? sql5`AND ${suratKeluar.unitKerjaId} = ${unitKerjaId}` : sql5``;
    const unitArsipFilter = unitKerjaId ? sql5`AND ${arsip.unitKerjaId} = ${unitKerjaId}` : sql5``;
    const startOfMonth = `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`;
    const endOfMonth = new Date(currentYear, currentMonth, 0).toISOString().split("T")[0];
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear}-12-31`;
    const [
      [totalMasukResult],
      [totalKeluarResult],
      [totalArsipResult],
      [arsipMasukResult],
      [arsipKeluarResult],
      [expiringResult],
      [masukBulanIniResult],
      [keluarBulanIniResult],
      masukMonthlyRaw,
      keluarMonthlyRaw,
      masukStatusBreakdown,
      keluarJenisBreakdown
    ] = await Promise.all([
      // Total counts (ALL years)
      db.select({ count: count() }).from(suratMasuk).where(unitKerjaId ? eq7(suratMasuk.unitKerjaId, unitKerjaId) : void 0),
      db.select({ count: count() }).from(suratKeluar).where(unitKerjaId ? eq7(suratKeluar.unitKerjaId, unitKerjaId) : void 0),
      db.select({ count: count() }).from(arsip).where(unitKerjaId ? eq7(arsip.unitKerjaId, unitKerjaId) : void 0),
      // Arsip masuk/keluar breakdown
      db.select({ count: count() }).from(arsip).where(and6(eq7(arsip.jenisArsip, "masuk"), ...unitKerjaId ? [eq7(arsip.unitKerjaId, unitKerjaId)] : [])),
      db.select({ count: count() }).from(arsip).where(and6(eq7(arsip.jenisArsip, "keluar"), ...unitKerjaId ? [eq7(arsip.unitKerjaId, unitKerjaId)] : [])),
      // Expiring archives (next 30 days)
      db.select({ count: count() }).from(arsip).where(and6(
        gte4(arsip.tanggalKadaluarsa, currentDate.toISOString().split("T")[0]),
        lte4(arsip.tanggalKadaluarsa, thirtyDaysFromNow.toISOString().split("T")[0]),
        ...unitKerjaId ? [eq7(arsip.unitKerjaId, unitKerjaId)] : []
      )),
      // Current month counts
      db.select({ count: count() }).from(suratMasuk).where(and6(
        gte4(suratMasuk.tanggalSurat, startOfMonth),
        lte4(suratMasuk.tanggalSurat, endOfMonth),
        ...unitKerjaId ? [eq7(suratMasuk.unitKerjaId, unitKerjaId)] : []
      )),
      db.select({ count: count() }).from(suratKeluar).where(and6(
        gte4(suratKeluar.tanggalSurat, startOfMonth),
        lte4(suratKeluar.tanggalSurat, endOfMonth),
        ...unitKerjaId ? [eq7(suratKeluar.unitKerjaId, unitKerjaId)] : []
      )),
      // Monthly trend: 1 aggregated query per table instead of 24 sequential queries
      db.select({
        month: sql5`EXTRACT(MONTH FROM ${suratMasuk.tanggalSurat})::int`,
        count: count()
      }).from(suratMasuk).where(and6(
        gte4(suratMasuk.tanggalSurat, yearStart),
        lte4(suratMasuk.tanggalSurat, yearEnd),
        ...unitKerjaId ? [eq7(suratMasuk.unitKerjaId, unitKerjaId)] : []
      )).groupBy(sql5`EXTRACT(MONTH FROM ${suratMasuk.tanggalSurat})`),
      db.select({
        month: sql5`EXTRACT(MONTH FROM ${suratKeluar.tanggalSurat})::int`,
        count: count()
      }).from(suratKeluar).where(and6(
        gte4(suratKeluar.tanggalSurat, yearStart),
        lte4(suratKeluar.tanggalSurat, yearEnd),
        ...unitKerjaId ? [eq7(suratKeluar.unitKerjaId, unitKerjaId)] : []
      )).groupBy(sql5`EXTRACT(MONTH FROM ${suratKeluar.tanggalSurat})`),
      // Status breakdowns (year-filtered)
      db.select({ status: suratMasuk.status, count: count() }).from(suratMasuk).where(and6(eq7(suratMasuk.tahun, currentYear), ...unitKerjaId ? [eq7(suratMasuk.unitKerjaId, unitKerjaId)] : [])).groupBy(suratMasuk.status),
      db.select({ status: suratKeluar.naskahDinas, count: count() }).from(suratKeluar).where(and6(eq7(suratKeluar.tahun, currentYear), ...unitKerjaId ? [eq7(suratKeluar.unitKerjaId, unitKerjaId)] : [])).groupBy(suratKeluar.naskahDinas)
    ]);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
    const masukByMonth = new Map(masukMonthlyRaw.map((r) => [r.month, r.count]));
    const keluarByMonth = new Map(keluarMonthlyRaw.map((r) => [r.month, r.count]));
    const monthlyTrend = monthNames.map((name, i) => ({
      month: name,
      masuk: masukByMonth.get(i + 1) || 0,
      keluar: keluarByMonth.get(i + 1) || 0
    }));
    return {
      totalMasuk: totalMasukResult?.count || 0,
      totalKeluar: totalKeluarResult?.count || 0,
      totalArsip: totalArsipResult?.count || 0,
      arsipMasuk: arsipMasukResult?.count || 0,
      arsipKeluar: arsipKeluarResult?.count || 0,
      segmenKadaluarsa: expiringResult?.count || 0,
      masukBulanIni: masukBulanIniResult?.count || 0,
      keluarBulanIni: keluarBulanIniResult?.count || 0,
      monthlyTrend,
      statusBreakdown: {
        masuk: masukStatusBreakdown.map((s) => ({ status: s.status || "Unknown", count: s.count })),
        keluar: keluarJenisBreakdown.map((s) => ({ status: s.status || "Unknown", count: s.count }))
      }
    };
  },
  async getRecentActivity(unitKerjaId, limit = 10) {
    const recentMasuk = await db.select({
      id: suratMasuk.id,
      type: sql5`'masuk'`,
      nomorSurat: suratMasuk.nomorSurat,
      perihal: suratMasuk.perihal,
      tanggal: suratMasuk.tanggalSurat,
      createdAt: suratMasuk.createdAt
    }).from(suratMasuk).where(unitKerjaId ? eq7(suratMasuk.unitKerjaId, unitKerjaId) : void 0).orderBy(sql5`${suratMasuk.createdAt} DESC`).limit(limit);
    const recentKeluar = await db.select({
      id: suratKeluar.id,
      type: sql5`'keluar'`,
      nomorSurat: suratKeluar.nomorSurat,
      perihal: suratKeluar.perihal,
      tanggal: suratKeluar.tanggalSurat,
      createdAt: suratKeluar.createdAt
    }).from(suratKeluar).where(unitKerjaId ? eq7(suratKeluar.unitKerjaId, unitKerjaId) : void 0).orderBy(sql5`${suratKeluar.createdAt} DESC`).limit(limit);
    const combined = [...recentMasuk, ...recentKeluar].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
    return combined;
  },
  async getExpiringArchives(unitKerjaId, daysAhead = 30) {
    const currentDate = /* @__PURE__ */ new Date();
    const futureDate = new Date(currentDate.getTime() + daysAhead * 24 * 60 * 60 * 1e3);
    const expiringArchives = await db.select({
      id: arsip.id,
      uraianBerkas: arsip.uraianBerkas,
      kodeKlasifikasi: arsip.kodeKlasifikasi,
      tanggalKadaluarsa: arsip.tanggalKadaluarsa
    }).from(arsip).where(and6(
      ...unitKerjaId ? [eq7(arsip.unitKerjaId, unitKerjaId)] : [],
      gte4(arsip.tanggalKadaluarsa, currentDate.toISOString().split("T")[0]),
      lte4(arsip.tanggalKadaluarsa, futureDate.toISOString().split("T")[0])
    )).orderBy(arsip.tanggalKadaluarsa).limit(10);
    return expiringArchives.map((a) => ({
      ...a,
      daysLeft: Math.ceil(
        (new Date(a.tanggalKadaluarsa).getTime() - currentDate.getTime()) / (1e3 * 60 * 60 * 24)
      )
    }));
  },
  async getUnitKerjaComparison(unitKerjaId, tahun) {
    try {
      const currentYear = tahun || (/* @__PURE__ */ new Date()).getFullYear();
      let targetUnitIds = [];
      if (!unitKerjaId) {
        const allTopUnits = await db.select({ id: unitKerja.id, name: unitKerja.name }).from(unitKerja).where(sql5`${unitKerja.parentId} IS NULL`);
        targetUnitIds = allTopUnits.map((u) => u.id);
      } else {
        const children = await db.select({ id: unitKerja.id, name: unitKerja.name }).from(unitKerja).where(eq7(unitKerja.parentId, unitKerjaId));
        if (children.length > 0) {
          targetUnitIds = children.map((c) => c.id);
        } else {
          const currentUnit = await db.select({ parentId: unitKerja.parentId }).from(unitKerja).where(eq7(unitKerja.id, unitKerjaId));
          const parentId = currentUnit[0]?.parentId;
          if (parentId) {
            const siblings = await db.select({ id: unitKerja.id, name: unitKerja.name }).from(unitKerja).where(eq7(unitKerja.parentId, parentId));
            targetUnitIds = siblings.map((s) => s.id);
          } else {
            targetUnitIds = [unitKerjaId];
          }
        }
        if (!targetUnitIds.includes(unitKerjaId)) {
          targetUnitIds.push(unitKerjaId);
        }
      }
      if (targetUnitIds.length === 0) return [];
      const [unitNames, masukCounts, keluarCounts, arsipCounts] = await Promise.all([
        db.select({ id: unitKerja.id, name: unitKerja.name }).from(unitKerja).where(inArray2(unitKerja.id, targetUnitIds)),
        db.select({ unitId: suratMasuk.unitKerjaId, count: count() }).from(suratMasuk).where(and6(
          inArray2(suratMasuk.unitKerjaId, targetUnitIds),
          eq7(suratMasuk.tahun, currentYear)
        )).groupBy(suratMasuk.unitKerjaId),
        db.select({ unitId: suratKeluar.unitKerjaId, count: count() }).from(suratKeluar).where(and6(
          inArray2(suratKeluar.unitKerjaId, targetUnitIds),
          eq7(suratKeluar.tahun, currentYear)
        )).groupBy(suratKeluar.unitKerjaId),
        db.select({ unitId: arsip.unitKerjaId, count: count() }).from(arsip).where(and6(
          inArray2(arsip.unitKerjaId, targetUnitIds),
          eq7(arsip.tahun, currentYear)
        )).groupBy(arsip.unitKerjaId)
      ]);
      const nameMap = new Map(unitNames.map((u) => [u.id, u.name]));
      const masukMap = new Map(masukCounts.map((r) => [r.unitId, r.count]));
      const keluarMap = new Map(keluarCounts.map((r) => [r.unitId, r.count]));
      const arsipMap = new Map(arsipCounts.map((r) => [r.unitId, r.count]));
      const comparisonData = targetUnitIds.map((unitId) => ({
        name: nameMap.get(unitId) || unitId,
        masuk: masukMap.get(unitId) || 0,
        keluar: keluarMap.get(unitId) || 0,
        arsip: arsipMap.get(unitId) || 0
      }));
      return comparisonData.sort((a, b) => b.masuk - a.masuk);
    } catch (error) {
      log8.error({ err: error }, "[DashboardService] Error in getUnitKerjaComparison:");
      throw error;
    }
  }
};

// src/routes/dashboard.routes.ts
var router7 = Router7();
router7.use(authMiddleware);
router7.get("/stats", async (req, res, next) => {
  try {
    const { unitKerjaId, tahun } = req.query;
    const stats = await dashboardService.getStats(
      unitKerjaId || null,
      tahun ? Number(tahun) : void 0
    );
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});
router7.get("/recent", async (req, res, next) => {
  try {
    const { unitKerjaId, limit } = req.query;
    const activity = await dashboardService.getRecentActivity(
      unitKerjaId || null,
      limit ? Number(limit) : 10
    );
    res.json({ success: true, data: activity });
  } catch (error) {
    next(error);
  }
});
router7.get("/expiring", async (req, res, next) => {
  try {
    const { unitKerjaId, daysAhead } = req.query;
    const expiring = await dashboardService.getExpiringArchives(
      unitKerjaId || null,
      daysAhead ? Number(daysAhead) : 30
    );
    res.json({ success: true, data: expiring });
  } catch (error) {
    next(error);
  }
});
router7.get("/comparison", async (req, res, next) => {
  try {
    const { unitKerjaId, tahun } = req.query;
    const comparison = await dashboardService.getUnitKerjaComparison(
      unitKerjaId || null,
      tahun ? Number(tahun) : void 0
    );
    res.json({ success: true, data: comparison });
  } catch (error) {
    next(error);
  }
});
var dashboard_routes_default = router7;

// src/routes/export.routes.ts
import { Router as Router8 } from "express";

// src/services/export.service.ts
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
var HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" }
};
var HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
var TITLE_FONT = { bold: true, size: 14, name: "Arial" };
var SUBTITLE_FONT = { bold: true, size: 10, name: "Arial" };
var DATA_FONT = { size: 9, name: "Arial" };
var THIN_BORDER = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" }
};
var CENTER_ALIGN = { horizontal: "center", vertical: "middle", wrapText: true };
var LEFT_ALIGN = { horizontal: "left", vertical: "middle", wrapText: true };
var ExportService = class {
  // ============== EXCEL EXPORTS ==============
  /**
   * Export Surat Masuk to Excel — format matches Google Spreadsheet structure
   * Columns: ID, No, Jenis Surat, Sifat Surat, Nomor Surat, Tanggal Surat,
   *          Perihal, Dari, Kepada, Status, Disposisi, Timestamp, Status Arsip
   */
  async generateExcelSuratMasuk(filters) {
    const { data } = await suratMasukService.findAll({
      ...filters,
      page: 1,
      limit: 1e4
    });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SIMSA ATR/BPN";
    workbook.created = /* @__PURE__ */ new Date();
    const worksheet = workbook.addWorksheet("Surat Masuk");
    worksheet.mergeCells("A1:M1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "DAFTAR SURAT MASUK";
    titleCell.font = TITLE_FONT;
    titleCell.alignment = CENTER_ALIGN;
    worksheet.mergeCells("A2:M2");
    const subtitleCell = worksheet.getCell("A2");
    subtitleCell.value = `Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan \u2014 Tahun ${filters.tahun || "Semua"}`;
    subtitleCell.font = { ...SUBTITLE_FONT, bold: false };
    subtitleCell.alignment = CENTER_ALIGN;
    const headerRow = 4;
    const headers = [
      "ID",
      "No",
      "Jenis Surat",
      "Sifat Surat",
      "Nomor Surat",
      "Tanggal Surat",
      "Perihal",
      "Dari",
      "Kepada",
      "Status",
      "Disposisi",
      "Timestamp",
      "Status Arsip"
    ];
    const colWidths = [20, 8, 18, 14, 28, 15, 40, 25, 25, 18, 25, 18, 14];
    headers.forEach((header, i) => {
      const cell = worksheet.getCell(headerRow, i + 1);
      cell.value = header;
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = CENTER_ALIGN;
      cell.border = THIN_BORDER;
    });
    colWidths.forEach((width, i) => {
      worksheet.getColumn(i + 1).width = width;
    });
    worksheet.getRow(headerRow).height = 25;
    data.forEach((item, index) => {
      const rowNum = headerRow + 1 + index;
      const rowData = [
        item.id || "",
        index + 1,
        item.jenisSurat || "",
        item.sifatSurat || "",
        item.nomorSurat || "",
        item.tanggalSurat || "",
        item.perihal || "",
        item.dari || "",
        item.kepada || "",
        item.status === "sudah_dibalas" ? "Sudah Dibalas" : "Belum Dibalas",
        Array.isArray(item.disposisi) ? item.disposisi.join(", ") : item.disposisi || "",
        item.createdAt ? new Date(item.createdAt).toLocaleString("id-ID") : "",
        item.isArchived ? "Diarsipkan" : "Belum"
      ];
      rowData.forEach((val, i) => {
        const cell = worksheet.getCell(rowNum, i + 1);
        cell.value = val;
        cell.font = DATA_FONT;
        cell.border = THIN_BORDER;
        cell.alignment = i === 6 || i === 7 || i === 8 || i === 10 ? LEFT_ALIGN : CENTER_ALIGN;
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
  /**
   * Export Surat Keluar to Excel — format matches Google Spreadsheet structure
   * Columns: ID, No Urut, Jenis Surat, Nomor Surat, Tanggal Surat,
   *          Perihal, Tujuan, Link Dokumen, Tanggal Input, Balasan Untuk,
   *          Klasifikasi Arsip, Klasifikasi Kode, Klasifikasi Jenis
   */
  async generateExcelSuratKeluar(filters) {
    const { data } = await suratKeluarService.findAll({
      ...filters,
      page: 1,
      limit: 1e4
    });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SIMSA ATR/BPN";
    workbook.created = /* @__PURE__ */ new Date();
    const worksheet = workbook.addWorksheet("Surat Keluar");
    worksheet.mergeCells("A1:M1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "DAFTAR SURAT KELUAR";
    titleCell.font = TITLE_FONT;
    titleCell.alignment = CENTER_ALIGN;
    worksheet.mergeCells("A2:M2");
    const subtitleCell = worksheet.getCell("A2");
    subtitleCell.value = `Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan \u2014 Tahun ${filters.tahun || "Semua"}`;
    subtitleCell.font = { ...SUBTITLE_FONT, bold: false };
    subtitleCell.alignment = CENTER_ALIGN;
    const headerRow = 4;
    const headers = [
      "ID",
      "No Urut",
      "Jenis Surat",
      "Nomor Surat",
      "Tanggal Surat",
      "Perihal",
      "Tujuan",
      "Link Dokumen",
      "Tanggal Input",
      "Balasan Untuk",
      "Klasifikasi Arsip",
      "Klasifikasi Kode",
      "Klasifikasi Jenis"
    ];
    const colWidths = [20, 10, 18, 28, 15, 40, 25, 30, 18, 20, 28, 15, 15];
    headers.forEach((header, i) => {
      const cell = worksheet.getCell(headerRow, i + 1);
      cell.value = header;
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = CENTER_ALIGN;
      cell.border = THIN_BORDER;
    });
    colWidths.forEach((width, i) => {
      worksheet.getColumn(i + 1).width = width;
    });
    worksheet.getRow(headerRow).height = 25;
    data.forEach((item, index) => {
      const rowNum = headerRow + 1 + index;
      let klasifikasiJenis = "";
      if (item.klasifikasiFasilitatif) klasifikasiJenis = "fasilitatif";
      if (item.klasifikasiSubstantif) klasifikasiJenis = "substantif";
      const rowData = [
        item.id || "",
        item.noUrut,
        item.naskahDinas || "",
        item.nomorSurat || "",
        item.tanggalSurat || "",
        item.perihal || "",
        item.kepada || "",
        item.linkDokumen || "",
        item.createdAt ? new Date(item.createdAt).toLocaleString("id-ID") : "",
        item.balasanUntuk || "",
        item.klasifikasiFasilitatif || item.klasifikasiSubstantif || "",
        item.klasifikasiFasilitatifKode || item.klasifikasiSubstantifKode || "",
        klasifikasiJenis
      ];
      rowData.forEach((val, i) => {
        const cell = worksheet.getCell(rowNum, i + 1);
        cell.value = val;
        cell.font = DATA_FONT;
        cell.border = THIN_BORDER;
        cell.alignment = i === 5 || i === 6 || i === 7 || i === 10 ? LEFT_ALIGN : CENTER_ALIGN;
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
  /**
   * Export Arsip to Excel — Formulir 4 (Daftar Arsip Aktif) per Permen ATRBPN 2/2026
   * 13 columns with multi-level header: No.Berkas, Kode Klasifikasi, Uraian Informasi Berkas,
   * Kurun Waktu Berkas, Jumlah Berkas, Item Arsip (No.Item, Uraian Informasi Arsip, Tanggal, Jml),
   * Tingkat Perkembangan, Lokasi Simpan, Tingkat Klasifikasi Keamanan & Akses, Ket.
   */
  async generateExcelArsip(filters, formulirType = "formulir4") {
    const { data } = await arsipService.findAll({
      ...filters,
      page: 1,
      limit: 1e4
    });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SIMSA ATR/BPN";
    workbook.created = /* @__PURE__ */ new Date();
    if (formulirType === "formulir6") {
      return this.generateExcelArsipFormulir6(workbook, data, filters);
    }
    return this.generateExcelArsipFormulir4(workbook, data, filters);
  }
  /**
   * Formulir 4 — DAFTAR ARSIP AKTIF
   * Permen ATRBPN 2 Tahun 2026 Kearsipan
   */
  async generateExcelArsipFormulir4(workbook, data, filters) {
    const worksheet = workbook.addWorksheet("Formulir 4 - Arsip Aktif", {
      pageSetup: {
        orientation: "landscape",
        paperSize: 9
        /* A4 */
      }
    });
    worksheet.mergeCells("A1:M1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "DAFTAR ARSIP AKTIF";
    titleCell.font = TITLE_FONT;
    titleCell.alignment = CENTER_ALIGN;
    worksheet.mergeCells("A3:B3");
    worksheet.getCell("A3").value = "Unit Pengolah";
    worksheet.getCell("A3").font = SUBTITLE_FONT;
    worksheet.mergeCells("C3:F3");
    worksheet.getCell("C3").value = ": Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan";
    worksheet.getCell("C3").font = { ...DATA_FONT, size: 10 };
    const hRow1 = 5;
    const hRow2 = 6;
    const spanCols = [
      { col: 1, label: "No.\nBerkas", width: 8 },
      { col: 2, label: "Kode\nKlasifikasi", width: 14 },
      { col: 3, label: "Uraian Informasi\nBerkas", width: 30 },
      { col: 4, label: "Kurun Waktu\nBerkas", width: 14 },
      { col: 5, label: "Jumlah\nBerkas", width: 10 }
    ];
    spanCols.forEach(({ col, label, width }) => {
      worksheet.mergeCells(hRow1, col, hRow2, col);
      const cell = worksheet.getCell(hRow1, col);
      cell.value = label;
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = CENTER_ALIGN;
      cell.border = THIN_BORDER;
      worksheet.getColumn(col).width = width;
    });
    worksheet.mergeCells(hRow1, 6, hRow1, 9);
    const itemArsipCell = worksheet.getCell(hRow1, 6);
    itemArsipCell.value = "Item Arsip";
    itemArsipCell.font = HEADER_FONT;
    itemArsipCell.fill = HEADER_FILL;
    itemArsipCell.alignment = CENTER_ALIGN;
    itemArsipCell.border = THIN_BORDER;
    const itemSubHeaders = [
      { col: 6, label: "No.\nItem", width: 8 },
      { col: 7, label: "Uraian Informasi\nArsip", width: 30 },
      { col: 8, label: "Tanggal", width: 14 },
      { col: 9, label: "Jml", width: 8 }
    ];
    itemSubHeaders.forEach(({ col, label, width }) => {
      const cell = worksheet.getCell(hRow2, col);
      cell.value = label;
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = CENTER_ALIGN;
      cell.border = THIN_BORDER;
      worksheet.getColumn(col).width = width;
    });
    const remainingCols = [
      { col: 10, label: "Tingkat\nPerkembangan", width: 14 },
      { col: 11, label: "Lokasi\nSimpan", width: 16 },
      { col: 12, label: "Tingkat Klasifikasi\nKeamanan & Akses", width: 18 },
      { col: 13, label: "Ket.", width: 14 }
    ];
    remainingCols.forEach(({ col, label, width }) => {
      worksheet.mergeCells(hRow1, col, hRow2, col);
      const cell = worksheet.getCell(hRow1, col);
      cell.value = label;
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = CENTER_ALIGN;
      cell.border = THIN_BORDER;
      worksheet.getColumn(col).width = width;
    });
    const numRow = hRow2 + 1;
    for (let i = 1; i <= 13; i++) {
      const cell = worksheet.getCell(numRow, i);
      cell.value = `(${i})`;
      cell.font = { ...DATA_FONT, italic: true, size: 8 };
      cell.alignment = CENTER_ALIGN;
      cell.border = THIN_BORDER;
    }
    worksheet.getRow(hRow1).height = 30;
    worksheet.getRow(hRow2).height = 30;
    const startRow = numRow + 1;
    data.forEach((item, index) => {
      const rowNum = startRow + index;
      const lokasi = [item.lokasiFc, item.lokasiLaci, item.lokasiFolder].filter(Boolean).join("/");
      const rowData = [
        item.nomorBerkas || String(index + 1),
        item.kodeKlasifikasi || "",
        item.uraianBerkas || "",
        item.kurunWaktu || String(item.tahun),
        item.jumlah || 1,
        item.nomorItem || "",
        item.uraianItem || "",
        item.tanggalArsip || "",
        item.jumlah || 1,
        item.tingkatPerkembangan || "",
        lokasi || "",
        item.klasifikasiKeamanan || "",
        item.keterangan || ""
      ];
      rowData.forEach((val, i) => {
        const cell = worksheet.getCell(rowNum, i + 1);
        cell.value = val;
        cell.font = DATA_FONT;
        cell.border = THIN_BORDER;
        cell.alignment = i === 2 || i === 6 ? LEFT_ALIGN : CENTER_ALIGN;
      });
    });
    const sigRow = startRow + data.length + 2;
    worksheet.mergeCells(sigRow, 9, sigRow, 13);
    worksheet.getCell(sigRow, 9).value = "........................................, ........................................";
    worksheet.getCell(sigRow, 9).alignment = CENTER_ALIGN;
    worksheet.mergeCells(sigRow + 1, 9, sigRow + 1, 13);
    worksheet.getCell(sigRow + 1, 9).value = "Pimpinan Unit Pengolah";
    worksheet.getCell(sigRow + 1, 9).font = SUBTITLE_FONT;
    worksheet.getCell(sigRow + 1, 9).alignment = CENTER_ALIGN;
    worksheet.mergeCells(sigRow + 4, 9, sigRow + 4, 13);
    worksheet.getCell(sigRow + 4, 9).value = "(Nama Lengkap)";
    worksheet.getCell(sigRow + 4, 9).alignment = CENTER_ALIGN;
    worksheet.getCell(sigRow + 4, 9).font = { ...DATA_FONT, underline: true };
    worksheet.mergeCells(sigRow + 5, 9, sigRow + 5, 13);
    worksheet.getCell(sigRow + 5, 9).value = "NIP ....................................";
    worksheet.getCell(sigRow + 5, 9).alignment = CENTER_ALIGN;
    const labelRow = sigRow + 7;
    worksheet.mergeCells(labelRow, 10, labelRow, 13);
    worksheet.getCell(labelRow, 10).value = "Formulir 4. Daftar Arsip Aktif";
    worksheet.getCell(labelRow, 10).font = { ...DATA_FONT, italic: true, size: 8 };
    worksheet.getCell(labelRow, 10).alignment = { horizontal: "right" };
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
  /**
   * Formulir 6 — DAFTAR ARSIP INAKTIF (KERTAS)
   * Permen ATRBPN 2 Tahun 2026 Kearsipan
   * Columns: No, Kode Klasifikasi, Uraian Informasi Arsip/Berkas, Kurun Waktu,
   *          Tingkat Perkembangan, Jumlah, Lokasi Simpan, Keamanan & Akses,
   *          Jangka Simpan & Nasib Akhir, Kategori Arsip, Ket.
   */
  async generateExcelArsipFormulir6(workbook, data, filters) {
    const worksheet = workbook.addWorksheet("Formulir 6 - Arsip Inaktif", {
      pageSetup: { orientation: "landscape", paperSize: 9 }
    });
    worksheet.mergeCells("A1:K1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "DAFTAR ARSIP INAKTIF (KERTAS)";
    titleCell.font = TITLE_FONT;
    titleCell.alignment = CENTER_ALIGN;
    worksheet.mergeCells("A3:B3");
    worksheet.getCell("A3").value = "Pencipta Arsip";
    worksheet.getCell("A3").font = SUBTITLE_FONT;
    worksheet.mergeCells("C3:F3");
    worksheet.getCell("C3").value = ": Kementerian ATR/BPN";
    worksheet.getCell("C3").font = { ...DATA_FONT, size: 10 };
    worksheet.mergeCells("A4:B4");
    worksheet.getCell("A4").value = "Unit Pengolah";
    worksheet.getCell("A4").font = SUBTITLE_FONT;
    worksheet.mergeCells("C4:F4");
    worksheet.getCell("C4").value = ": Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan";
    worksheet.getCell("C4").font = { ...DATA_FONT, size: 10 };
    const hRow = 6;
    const headers = [
      "No",
      "Kode\nKlasifikasi",
      "Uraian Informasi\nArsip/Berkas",
      "Kurun\nWaktu",
      "Tingkat\nPerkembangan",
      "Jumlah",
      "Lokasi Simpan\n(Rak/Boks/Folder)",
      "Keamanan\n& Akses",
      "Jangka Simpan\n& Nasib Akhir",
      "Kategori\nArsip",
      "Ket."
    ];
    const colWidths = [6, 14, 35, 12, 14, 8, 20, 14, 18, 14, 14];
    headers.forEach((header, i) => {
      const cell = worksheet.getCell(hRow, i + 1);
      cell.value = header;
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = CENTER_ALIGN;
      cell.border = THIN_BORDER;
    });
    colWidths.forEach((w, i) => {
      worksheet.getColumn(i + 1).width = w;
    });
    worksheet.getRow(hRow).height = 35;
    const numRow = hRow + 1;
    for (let i = 1; i <= 11; i++) {
      const cell = worksheet.getCell(numRow, i);
      cell.value = `(${i})`;
      cell.font = { ...DATA_FONT, italic: true, size: 8 };
      cell.alignment = CENTER_ALIGN;
      cell.border = THIN_BORDER;
    }
    const startRow = numRow + 1;
    data.forEach((item, index) => {
      const rowNum = startRow + index;
      const lokasi = [item.lokasiFc, item.lokasiLaci, item.lokasiFolder].filter(Boolean).join("/");
      const jangkaSimpan = [
        item.masaSimpanAktif ? `Aktif: ${item.masaSimpanAktif}` : "",
        item.masaSimpanInaktif ? `Inaktif: ${item.masaSimpanInaktif}` : "",
        item.hasilAkhir ? `Nasib: ${item.hasilAkhir}` : ""
      ].filter(Boolean).join("\n");
      const kategoriArsip = item.jenisArsip === "masuk" ? "Surat Masuk" : "Surat Keluar";
      const rowData = [
        index + 1,
        item.kodeKlasifikasi || "",
        item.uraianBerkas || item.uraianItem || "",
        item.kurunWaktu || String(item.tahun),
        item.tingkatPerkembangan || "",
        item.jumlah || 1,
        lokasi || "",
        item.klasifikasiKeamanan || "",
        jangkaSimpan,
        kategoriArsip,
        item.keterangan || ""
      ];
      rowData.forEach((val, i) => {
        const cell = worksheet.getCell(rowNum, i + 1);
        cell.value = val;
        cell.font = DATA_FONT;
        cell.border = THIN_BORDER;
        cell.alignment = i === 2 || i === 8 ? LEFT_ALIGN : CENTER_ALIGN;
      });
    });
    const sigRow = startRow + data.length + 2;
    worksheet.mergeCells(sigRow, 1, sigRow, 5);
    worksheet.getCell(sigRow, 1).value = "Mengetahui,\nPimpinan Unit Kearsipan";
    worksheet.getCell(sigRow, 1).font = DATA_FONT;
    worksheet.getCell(sigRow, 1).alignment = CENTER_ALIGN;
    worksheet.mergeCells(sigRow + 4, 1, sigRow + 4, 5);
    worksheet.getCell(sigRow + 4, 1).value = "(Nama Lengkap)";
    worksheet.getCell(sigRow + 4, 1).font = { ...DATA_FONT, underline: true };
    worksheet.getCell(sigRow + 4, 1).alignment = CENTER_ALIGN;
    worksheet.mergeCells(sigRow + 5, 1, sigRow + 5, 5);
    worksheet.getCell(sigRow + 5, 1).value = "NIP ....................................";
    worksheet.getCell(sigRow + 5, 1).alignment = CENTER_ALIGN;
    worksheet.mergeCells(sigRow, 7, sigRow, 11);
    worksheet.getCell(sigRow, 7).value = "........................................, ........................................\nPimpinan Unit Pengolah";
    worksheet.getCell(sigRow, 7).font = DATA_FONT;
    worksheet.getCell(sigRow, 7).alignment = CENTER_ALIGN;
    worksheet.mergeCells(sigRow + 4, 7, sigRow + 4, 11);
    worksheet.getCell(sigRow + 4, 7).value = "(Nama Lengkap)";
    worksheet.getCell(sigRow + 4, 7).font = { ...DATA_FONT, underline: true };
    worksheet.getCell(sigRow + 4, 7).alignment = CENTER_ALIGN;
    worksheet.mergeCells(sigRow + 5, 7, sigRow + 5, 11);
    worksheet.getCell(sigRow + 5, 7).value = "NIP ....................................";
    worksheet.getCell(sigRow + 5, 7).alignment = CENTER_ALIGN;
    const labelRow = sigRow + 7;
    worksheet.mergeCells(labelRow, 8, labelRow, 11);
    worksheet.getCell(labelRow, 8).value = "Formulir 6. Daftar Arsip Inaktif (Kertas)";
    worksheet.getCell(labelRow, 8).font = { ...DATA_FONT, italic: true, size: 8 };
    worksheet.getCell(labelRow, 8).alignment = { horizontal: "right" };
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
  // ============== PDF EXPORTS ==============
  async generatePdfSuratMasuk(filters) {
    const { data } = await suratMasukService.findAll({
      ...filters,
      page: 1,
      limit: 1e4
    });
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.fontSize(16).font("Helvetica-Bold").text("DAFTAR SURAT MASUK", { align: "center" });
      doc.fontSize(10).font("Helvetica").text("Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan", { align: "center" });
      doc.fontSize(9).text(`Tahun: ${filters.tahun || "Semua"} | Dicetak: ${(/* @__PURE__ */ new Date()).toLocaleDateString("id-ID")}`, { align: "center" });
      doc.moveDown(1.5);
      const tableTop = doc.y;
      const colWidths = [25, 40, 100, 80, 200, 90, 90, 90];
      const headers = ["No", "No.Urut", "Nomor Surat", "Tanggal", "Perihal", "Dari", "Kepada", "Status"];
      doc.rect(30, tableTop - 5, 782, 20).fill("#1E3A5F");
      let xPos = 30;
      doc.font("Helvetica-Bold").fontSize(8).fillColor("white");
      headers.forEach((header, i) => {
        doc.text(header, xPos + 2, tableTop, { width: colWidths[i] - 4, align: "left" });
        xPos += colWidths[i];
      });
      let yPos = tableTop + 20;
      doc.font("Helvetica").fontSize(7).fillColor("black");
      data.forEach((item, index) => {
        if (yPos > 520) {
          doc.addPage();
          yPos = 30;
        }
        if (index % 2 === 0) {
          doc.rect(30, yPos - 3, 782, 15).fill("#F5F5F5");
        }
        xPos = 30;
        const rowData = [
          String(index + 1),
          String(item.noUrut),
          item.nomorSurat || "",
          item.tanggalSurat || "",
          (item.perihal || "").substring(0, 50),
          (item.dari || "").substring(0, 20),
          (item.kepada || "").substring(0, 20),
          item.status === "sudah_dibalas" ? "Dibalas" : "Belum"
        ];
        doc.fillColor("black");
        rowData.forEach((text, i) => {
          doc.text(text, xPos + 2, yPos, { width: colWidths[i] - 4, align: "left" });
          xPos += colWidths[i];
        });
        yPos += 15;
      });
      doc.fontSize(8).text(`Total: ${data.length} surat`, 30, yPos + 20);
      doc.end();
    });
  }
  async generatePdfSuratKeluar(filters) {
    const { data } = await suratKeluarService.findAll({
      ...filters,
      page: 1,
      limit: 1e4
    });
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.fontSize(16).font("Helvetica-Bold").text("DAFTAR SURAT KELUAR", { align: "center" });
      doc.fontSize(10).font("Helvetica").text("Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan", { align: "center" });
      doc.fontSize(9).text(`Tahun: ${filters.tahun || "Semua"} | Dicetak: ${(/* @__PURE__ */ new Date()).toLocaleDateString("id-ID")}`, { align: "center" });
      doc.moveDown(1.5);
      const tableTop = doc.y;
      const colWidths = [25, 40, 110, 80, 90, 220, 100, 100];
      const headers = ["No", "No.Urut", "Nomor Surat", "Tanggal", "Naskah Dinas", "Perihal", "Kepada", "Klasifikasi"];
      doc.rect(30, tableTop - 5, 782, 20).fill("#1E3A5F");
      let xPos = 30;
      doc.font("Helvetica-Bold").fontSize(8).fillColor("white");
      headers.forEach((header, i) => {
        doc.text(header, xPos + 2, tableTop, { width: colWidths[i] - 4, align: "left" });
        xPos += colWidths[i];
      });
      let yPos = tableTop + 20;
      doc.font("Helvetica").fontSize(7).fillColor("black");
      data.forEach((item, index) => {
        if (yPos > 520) {
          doc.addPage();
          yPos = 30;
        }
        if (index % 2 === 0) {
          doc.rect(30, yPos - 3, 782, 15).fill("#F5F5F5");
        }
        xPos = 30;
        const rowData = [
          String(index + 1),
          String(item.noUrut),
          item.nomorSurat || "",
          item.tanggalSurat || "",
          (item.naskahDinas || "").substring(0, 18),
          (item.perihal || "").substring(0, 55),
          (item.kepada || "").substring(0, 22),
          (item.klasifikasiFasilitatif || "").substring(0, 22)
        ];
        doc.fillColor("black");
        rowData.forEach((text, i) => {
          doc.text(text, xPos + 2, yPos, { width: colWidths[i] - 4, align: "left" });
          xPos += colWidths[i];
        });
        yPos += 15;
      });
      doc.fontSize(8).text(`Total: ${data.length} surat`, 30, yPos + 20);
      doc.end();
    });
  }
  /**
   * Export Arsip to PDF — Formulir 4 or 6 format
   */
  async generatePdfArsip(filters, formulirType = "formulir4") {
    const { data } = await arsipService.findAll({
      ...filters,
      page: 1,
      limit: 1e4
    });
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      if (formulirType === "formulir6") {
        doc.fontSize(16).font("Helvetica-Bold").text("DAFTAR ARSIP INAKTIF (KERTAS)", { align: "center" });
        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica").text(`Pencipta Arsip      : Kementerian ATR/BPN`, 30);
        doc.text(`Unit Pengolah        : Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan`, 30);
      } else {
        doc.fontSize(16).font("Helvetica-Bold").text("DAFTAR ARSIP AKTIF", { align: "center" });
        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica").text(`Unit Pengolah : Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan`, 30);
      }
      doc.fontSize(9).text(`Dicetak: ${(/* @__PURE__ */ new Date()).toLocaleDateString("id-ID")}`, { align: "right" });
      doc.moveDown(1);
      const tableTop = doc.y;
      if (formulirType === "formulir6") {
        const colWidths = [20, 50, 180, 40, 55, 30, 70, 55, 80, 50, 70];
        const headers = ["No", "Kode\nKlas.", "Uraian Informasi Arsip/Berkas", "Kurun\nWaktu", "Tk.\nPrkbg.", "Jml", "Lokasi Simpan", "Keamanan\n& Akses", "Jangka Simpan\n& Nasib Akhir", "Kategori\nArsip", "Ket."];
        doc.rect(30, tableTop - 5, 782, 25).fill("#1E3A5F");
        let xPos = 30;
        doc.font("Helvetica-Bold").fontSize(7).fillColor("white");
        headers.forEach((header, i) => {
          doc.text(header, xPos + 2, tableTop, { width: colWidths[i] - 4, align: "center" });
          xPos += colWidths[i];
        });
        let yPos = tableTop + 28;
        doc.font("Helvetica").fontSize(6).fillColor("black");
        data.forEach((item, index) => {
          if (yPos > 520) {
            doc.addPage();
            yPos = 30;
          }
          if (index % 2 === 0) {
            doc.rect(30, yPos - 3, 782, 15).fill("#F5F5F5");
          }
          const lokasi = [item.lokasiFc, item.lokasiLaci, item.lokasiFolder].filter(Boolean).join("/");
          const jangkaSimpan = [
            item.masaSimpanAktif ? `A:${item.masaSimpanAktif}` : "",
            item.hasilAkhir || ""
          ].filter(Boolean).join(" / ");
          xPos = 30;
          const rowData = [
            String(index + 1),
            (item.kodeKlasifikasi || "").substring(0, 10),
            (item.uraianBerkas || item.uraianItem || "").substring(0, 45),
            item.kurunWaktu || String(item.tahun),
            (item.tingkatPerkembangan || "").substring(0, 12),
            String(item.jumlah || 1),
            lokasi.substring(0, 15),
            (item.klasifikasiKeamanan || "").substring(0, 12),
            jangkaSimpan.substring(0, 20),
            item.jenisArsip === "masuk" ? "SM" : "SK",
            (item.keterangan || "").substring(0, 15)
          ];
          doc.fillColor("black");
          rowData.forEach((text, i) => {
            doc.text(text, xPos + 2, yPos, { width: colWidths[i] - 4, align: "left" });
            xPos += colWidths[i];
          });
          yPos += 15;
        });
        doc.fontSize(8).text(`Total: ${data.length} arsip`, 30, yPos + 20);
        doc.fontSize(7).text("Formulir 6. Daftar Arsip Inaktif (Kertas)", 600, yPos + 35, { align: "right" });
      } else {
        const colWidths = [20, 45, 145, 40, 30, 25, 145, 40, 25, 50, 55, 55, 55];
        const headers = ["No.\nBrks", "Kode\nKlas.", "Uraian Info.\nBerkas", "Kurun\nWktu", "Jml\nBrks", "No.\nItem", "Uraian Info.\nArsip", "Tgl", "Jml", "Tk.\nPrkbg.", "Lokasi\nSimpan", "Keamanan\n& Akses", "Ket."];
        doc.rect(30, tableTop - 5, 782, 25).fill("#1E3A5F");
        let xPos = 30;
        doc.font("Helvetica-Bold").fontSize(6).fillColor("white");
        headers.forEach((header, i) => {
          doc.text(header, xPos + 1, tableTop, { width: colWidths[i] - 2, align: "center" });
          xPos += colWidths[i];
        });
        let yPos = tableTop + 28;
        doc.font("Helvetica").fontSize(6).fillColor("black");
        data.forEach((item, index) => {
          if (yPos > 520) {
            doc.addPage();
            yPos = 30;
          }
          if (index % 2 === 0) {
            doc.rect(30, yPos - 3, 782, 15).fill("#F5F5F5");
          }
          const lokasi = [item.lokasiFc, item.lokasiLaci, item.lokasiFolder].filter(Boolean).join("/");
          xPos = 30;
          const rowData = [
            item.nomorBerkas || String(index + 1),
            (item.kodeKlasifikasi || "").substring(0, 10),
            (item.uraianBerkas || "").substring(0, 35),
            item.kurunWaktu || String(item.tahun),
            String(item.jumlah || 1),
            (item.nomorItem || "").substring(0, 5),
            (item.uraianItem || "").substring(0, 35),
            item.tanggalArsip || "",
            String(item.jumlah || 1),
            (item.tingkatPerkembangan || "").substring(0, 10),
            lokasi.substring(0, 12),
            (item.klasifikasiKeamanan || "").substring(0, 12),
            (item.keterangan || "").substring(0, 12)
          ];
          doc.fillColor("black");
          rowData.forEach((text, i) => {
            doc.text(text, xPos + 1, yPos, { width: colWidths[i] - 2, align: "left" });
            xPos += colWidths[i];
          });
          yPos += 15;
        });
        doc.fontSize(8).text(`Total: ${data.length} arsip`, 30, yPos + 20);
        doc.fontSize(7).text("Formulir 4. Daftar Arsip Aktif", 600, yPos + 35, { align: "right" });
      }
      doc.end();
    });
  }
};
var exportService = new ExportService();

// src/routes/export.routes.ts
var log9 = createLogger("ExportRoutes");
var router8 = Router8();
router8.use(exportLimiter);
router8.use(authMiddleware);
router8.get("/surat-masuk/excel", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status } = req.query;
    const filters = {
      unitKerjaId,
      tahun: tahun ? Number(tahun) : void 0,
      tanggalDari,
      tanggalSampai,
      jenisSurat,
      sifatSurat,
      status
    };
    const buffer = await exportService.generateExcelSuratMasuk(filters);
    const filename = `surat-masuk-${tahun || "semua"}-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    log9.error({ err: error }, "Error exporting Surat Masuk to Excel:");
    res.status(500).json({ error: "Failed to export to Excel" });
  }
});
router8.get("/surat-masuk/pdf", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status } = req.query;
    const filters = {
      unitKerjaId,
      tahun: tahun ? Number(tahun) : void 0,
      tanggalDari,
      tanggalSampai,
      jenisSurat,
      sifatSurat,
      status
    };
    const buffer = await exportService.generatePdfSuratMasuk(filters);
    const filename = `surat-masuk-${tahun || "semua"}-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    log9.error({ err: error }, "Error exporting Surat Masuk to PDF:");
    res.status(500).json({ error: "Failed to export to PDF" });
  }
});
router8.get("/surat-keluar/excel", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif } = req.query;
    const filters = {
      unitKerjaId,
      tahun: tahun ? Number(tahun) : void 0,
      tanggalDari,
      tanggalSampai,
      naskahDinas,
      klasifikasiFasilitatif,
      klasifikasiSubstantif
    };
    const buffer = await exportService.generateExcelSuratKeluar(filters);
    const filename = `surat-keluar-${tahun || "semua"}-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    log9.error({ err: error }, "Error exporting Surat Keluar to Excel:");
    res.status(500).json({ error: "Failed to export to Excel" });
  }
});
router8.get("/surat-keluar/pdf", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif } = req.query;
    const filters = {
      unitKerjaId,
      tahun: tahun ? Number(tahun) : void 0,
      tanggalDari,
      tanggalSampai,
      naskahDinas,
      klasifikasiFasilitatif,
      klasifikasiSubstantif
    };
    const buffer = await exportService.generatePdfSuratKeluar(filters);
    const filename = `surat-keluar-${tahun || "semua"}-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    log9.error({ err: error }, "Error exporting Surat Keluar to PDF:");
    res.status(500).json({ error: "Failed to export to PDF" });
  }
});
router8.get("/arsip/excel", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { jenisArsip, tahun, formulirType } = req.query;
    const filters = {
      unitKerjaId,
      jenisArsip,
      tahun: tahun ? Number(tahun) : void 0
    };
    const fType = formulirType || "formulir4";
    const buffer = await exportService.generateExcelArsip(filters, fType);
    const label = fType === "formulir6" ? "arsip-inaktif" : "arsip-aktif";
    const filename = `${label}-${tahun || "semua"}-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    log9.error({ err: error }, "Error exporting Arsip to Excel:");
    res.status(500).json({ error: "Failed to export to Excel" });
  }
});
router8.get("/arsip/pdf", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { jenisArsip, tahun, formulirType } = req.query;
    const filters = {
      unitKerjaId,
      jenisArsip,
      tahun: tahun ? Number(tahun) : void 0
    };
    const fType = formulirType || "formulir4";
    const buffer = await exportService.generatePdfArsip(filters, fType);
    const label = fType === "formulir6" ? "arsip-inaktif" : "arsip-aktif";
    const filename = `${label}-${tahun || "semua"}-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    log9.error({ err: error }, "Error exporting Arsip to PDF:");
    res.status(500).json({ error: "Failed to export to PDF" });
  }
});
var exportRoutes = router8;

// src/routes/notification.routes.ts
import { Router as Router9 } from "express";

// src/services/notification.service.ts
import { eq as eq8, and as and7, gte as gte5, lte as lte5, desc as desc5 } from "drizzle-orm";
var NotificationService = class {
  /**
   * Get surat masuk yang belum diproses (belum diarsipkan dan belum dibalas)
   * Surat dianggap "sudah diproses" jika sudah diarsipkan ATAU sudah dibalas
   */
  async getPendingSuratMasuk(unitKerjaId, userId) {
    const readNotifications = await db.select({ notificationId: notificationReads.notificationId }).from(notificationReads).where(eq8(notificationReads.userId, userId));
    const readIds = readNotifications.map((n) => n.notificationId);
    const pendingSurat = await db.select({
      id: suratMasuk.id,
      nomorSurat: suratMasuk.nomorSurat,
      perihal: suratMasuk.perihal,
      dari: suratMasuk.dari,
      sifatSurat: suratMasuk.sifatSurat,
      tanggalSurat: suratMasuk.tanggalSurat,
      status: suratMasuk.status,
      createdAt: suratMasuk.createdAt
    }).from(suratMasuk).where(and7(
      eq8(suratMasuk.unitKerjaId, unitKerjaId),
      eq8(suratMasuk.isArchived, false),
      eq8(suratMasuk.isDeleted, false)
    )).orderBy(desc5(suratMasuk.createdAt)).limit(50);
    const unprocessedSurat = pendingSurat.filter((s) => s.status !== "sudah_dibalas");
    const currentDate = /* @__PURE__ */ new Date();
    const notifications = unprocessedSurat.map((surat) => {
      const tanggalSurat = surat.tanggalSurat ? new Date(surat.tanggalSurat) : new Date(surat.createdAt);
      const daysSince = Math.floor((currentDate.getTime() - tanggalSurat.getTime()) / (1e3 * 60 * 60 * 24));
      let type = "info";
      if (surat.sifatSurat === "sangat_segera" || daysSince > 7) {
        type = "urgent";
      } else if (surat.sifatSurat === "segera" || daysSince > 3) {
        type = "warning";
      }
      const sifatLabel = surat.sifatSurat === "sangat_segera" ? "Sangat Segera" : surat.sifatSurat === "segera" ? "Segera" : "Biasa";
      return {
        id: `surat-${surat.id}`,
        type,
        category: "surat-masuk",
        title: `Surat ${sifatLabel} belum diproses`,
        message: `${surat.nomorSurat || "Surat"} dari ${surat.dari || "Unknown"} - ${(surat.perihal || "").substring(0, 50)}${(surat.perihal || "").length > 50 ? "..." : ""}`,
        daysLeft: daysSince,
        referenceId: surat.id,
        createdAt: surat.createdAt,
        isRead: false
      };
    });
    return notifications.filter((n) => !readIds.includes(n.id));
  }
  /**
   * Get arsip yang akan kadaluarsa dalam N hari (jadwal retensi)
   */
  async getExpiringArchives(unitKerjaId, userId, daysAhead = 90) {
    const currentDate = /* @__PURE__ */ new Date();
    const futureDate = new Date(currentDate.getTime() + daysAhead * 24 * 60 * 60 * 1e3);
    const expiringArchives = await db.select({
      id: arsip.id,
      nomorBerkas: arsip.nomorBerkas,
      uraianBerkas: arsip.uraianBerkas,
      kodeKlasifikasi: arsip.kodeKlasifikasi,
      tanggalKadaluarsa: arsip.tanggalKadaluarsa,
      hasilAkhir: arsip.hasilAkhir,
      createdAt: arsip.createdAt
    }).from(arsip).where(and7(
      eq8(arsip.unitKerjaId, unitKerjaId),
      gte5(arsip.tanggalKadaluarsa, currentDate.toISOString().split("T")[0]),
      lte5(arsip.tanggalKadaluarsa, futureDate.toISOString().split("T")[0])
    )).orderBy(arsip.tanggalKadaluarsa).limit(50);
    const readNotifications = await db.select({ notificationId: notificationReads.notificationId }).from(notificationReads).where(eq8(notificationReads.userId, userId));
    const readIds = readNotifications.map((n) => n.notificationId);
    const notifications = expiringArchives.map((arc) => {
      const tanggalKadaluarsa = new Date(arc.tanggalKadaluarsa);
      const daysLeft = Math.ceil((tanggalKadaluarsa.getTime() - currentDate.getTime()) / (1e3 * 60 * 60 * 24));
      let type = "info";
      let label = "akan kadaluarsa";
      if (daysLeft <= 7) {
        type = "urgent";
        label = "segera kadaluarsa";
      } else if (daysLeft <= 30) {
        type = "warning";
        label = "mendekati kadaluarsa";
      }
      const hasilLabel = arc.hasilAkhir ? ` (${arc.hasilAkhir})` : "";
      return {
        id: `arsip-${arc.id}`,
        type,
        category: "arsip-retensi",
        title: `Arsip ${label}${hasilLabel}`,
        message: `${arc.nomorBerkas || arc.kodeKlasifikasi || "Arsip"} - ${(arc.uraianBerkas || "").substring(0, 50)}${(arc.uraianBerkas || "").length > 50 ? "..." : ""}`,
        daysLeft,
        referenceId: arc.id,
        createdAt: arc.createdAt,
        isRead: false
      };
    });
    return notifications.filter((n) => !readIds.includes(n.id));
  }
  /**
   * Get all notifications combined and sorted by priority
   * Returns separate category counts for tab-based UI
   */
  async getAllNotifications(unitKerjaId, userId, limit = 20) {
    const [pendingSurat, expiringArchives] = await Promise.all([
      this.getPendingSuratMasuk(unitKerjaId, userId),
      this.getExpiringArchives(unitKerjaId, userId, 90)
    ]);
    const allNotifications = [...pendingSurat, ...expiringArchives];
    const priorityOrder = { urgent: 0, warning: 1, info: 2 };
    allNotifications.sort((a, b) => {
      const priorityDiff = priorityOrder[a.type] - priorityOrder[b.type];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    const counts = {
      total: allNotifications.length,
      urgent: allNotifications.filter((n) => n.type === "urgent").length,
      warning: allNotifications.filter((n) => n.type === "warning").length,
      info: allNotifications.filter((n) => n.type === "info").length,
      suratMasuk: pendingSurat.length,
      arsipRetensi: expiringArchives.length
    };
    return {
      notifications: allNotifications.slice(0, limit),
      counts
    };
  }
  /**
   * Get notification count only (for badge)
   */
  async getNotificationCount(unitKerjaId, userId) {
    const { counts } = await this.getAllNotifications(unitKerjaId, userId, 100);
    return {
      total: counts.total,
      urgent: counts.urgent,
      warning: counts.warning,
      suratMasuk: counts.suratMasuk,
      arsipRetensi: counts.arsipRetensi
    };
  }
  /**
   * Mark notification as read
   */
  async markAsRead(userId, notificationId) {
    const existing = await db.query.notificationReads.findFirst({
      where: and7(
        eq8(notificationReads.userId, userId),
        eq8(notificationReads.notificationId, notificationId)
      )
    });
    if (existing) return;
    await db.insert(notificationReads).values({
      userId,
      notificationId
    });
  }
  /**
   * Mark all as read
   */
  async markAllAsRead(userId, notificationIds) {
    if (notificationIds.length === 0) return;
    for (const id of notificationIds) {
      await this.markAsRead(userId, id);
    }
  }
};
var notificationService = new NotificationService();

// src/routes/notification.routes.ts
var log10 = createLogger("NotificationRoutes");
var router9 = Router9();
router9.use(authMiddleware);
router9.get("/", async (req, res) => {
  try {
    const { limit } = req.query;
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      res.status(400).json({ error: "unitKerjaId is required" });
      return;
    }
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const result = await notificationService.getAllNotifications(
      unitKerjaId,
      userId,
      limit ? parseInt(limit) : 10
    );
    res.json(result);
  } catch (error) {
    log10.error({ err: error }, "Error fetching notifications:");
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});
router9.get("/count", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      res.status(400).json({ error: "unitKerjaId is required" });
      return;
    }
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const counts = await notificationService.getNotificationCount(unitKerjaId, userId);
    res.json(counts);
  } catch (error) {
    log10.error({ err: error }, "Error fetching notification count:");
    res.status(500).json({ error: "Failed to fetch notification count" });
  }
});
router9.get("/surat-masuk", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      res.status(400).json({ error: "unitKerjaId is required" });
      return;
    }
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const notifications = await notificationService.getPendingSuratMasuk(unitKerjaId, userId);
    res.json({ notifications });
  } catch (error) {
    log10.error({ err: error }, "Error fetching surat masuk notifications:");
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});
router9.get("/arsip", async (req, res) => {
  try {
    const { daysAhead } = req.query;
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      res.status(400).json({ error: "unitKerjaId is required" });
      return;
    }
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const notifications = await notificationService.getExpiringArchives(
      unitKerjaId,
      userId,
      daysAhead ? parseInt(daysAhead) : 30
    );
    res.json({ notifications });
  } catch (error) {
    log10.error({ err: error }, "Error fetching arsip notifications:");
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});
router9.patch("/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    await notificationService.markAsRead(userId, id);
    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    log10.error({ err: error }, "Error marking notification as read:");
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});
router9.patch("/read-all", validateBody(markAllReadSchema), async (req, res) => {
  try {
    const userId = req.user?.id;
    const { notificationIds } = req.body;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!Array.isArray(notificationIds)) {
      res.status(400).json({ error: "notificationIds must be an array" });
      return;
    }
    await notificationService.markAllAsRead(userId, notificationIds);
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    log10.error({ err: error }, "Error marking all notifications as read:");
    res.status(500).json({ error: "Failed to mark notifications as read" });
  }
});
var notificationRoutes = router9;

// src/routes/user-management.routes.ts
import { Router as Router10 } from "express";
import { eq as eq10 } from "drizzle-orm";

// src/services/user-management.service.ts
import { eq as eq9, ilike as ilike4, or as or4, and as and8, desc as desc6, sql as sql6 } from "drizzle-orm";
var VALID_ROLES = ["super_admin", "admin_dirjen", "admin_sesditjen", "user"];
var ADMIN_ROLES = ["super_admin"];
var userManagementService = {
  /**
   * List users with filters and pagination
   */
  async listUsers(filters = {}) {
    const { search, role, unitKerjaId, isActive, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (search) {
      conditions.push(
        or4(
          ilike4(users.name, `%${search}%`),
          ilike4(users.email, `%${search}%`)
        )
      );
    }
    if (role) {
      conditions.push(eq9(users.role, role));
    }
    if (unitKerjaId) {
      conditions.push(eq9(users.unitKerjaId, unitKerjaId));
    }
    if (isActive !== void 0) {
      conditions.push(eq9(users.isActive, isActive));
    }
    const whereClause = conditions.length > 0 ? and8(...conditions) : void 0;
    const [{ count: count5 }] = await db.select({ count: sql6`count(*)` }).from(users).where(whereClause);
    const userList = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
      unitKerjaId: users.unitKerjaId,
      unitKerjaName: unitKerja.name,
      jabatan: users.jabatan,
      nip: users.nip,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt
    }).from(users).leftJoin(unitKerja, eq9(users.unitKerjaId, unitKerja.id)).where(whereClause).orderBy(desc6(users.createdAt)).limit(limit).offset(offset);
    return {
      data: userList,
      pagination: {
        page,
        limit,
        total: Number(count5),
        totalPages: Math.ceil(Number(count5) / limit)
      }
    };
  },
  /**
   * Get single user by ID
   */
  async getUserById(userId) {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
      unitKerjaId: users.unitKerjaId,
      unitKerjaName: unitKerja.name,
      jabatan: users.jabatan,
      nip: users.nip,
      isActive: users.isActive,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt
    }).from(users).leftJoin(unitKerja, eq9(users.unitKerjaId, unitKerja.id)).where(eq9(users.id, userId)).limit(1);
    return user || null;
  },
  /**
   * Update user (role, unitKerja, isActive)
   */
  async updateUser(userId, data) {
    if (data.role && !VALID_ROLES.includes(data.role)) {
      throw new Error(`Invalid role: ${data.role}`);
    }
    if (data.unitKerjaId) {
      const [unit] = await db.select({ id: unitKerja.id }).from(unitKerja).where(eq9(unitKerja.id, data.unitKerjaId)).limit(1);
      if (!unit) {
        throw new Error(`Invalid unitKerjaId: ${data.unitKerjaId}`);
      }
    }
    const updateData = {
      updatedAt: /* @__PURE__ */ new Date()
    };
    if (data.role !== void 0) updateData.role = data.role;
    if (data.unitKerjaId !== void 0) updateData.unitKerjaId = data.unitKerjaId;
    if (data.isActive !== void 0) updateData.isActive = data.isActive;
    if (data.jabatan !== void 0) updateData.jabatan = data.jabatan;
    if (data.nip !== void 0) updateData.nip = data.nip;
    const [updatedUser] = await db.update(users).set(updateData).where(eq9(users.id, userId)).returning();
    if (!updatedUser) {
      return null;
    }
    return this.getUserById(userId);
  },
  /**
   * Deactivate user (soft delete)
   */
  async deactivateUser(userId) {
    return this.updateUser(userId, { isActive: false });
  },
  /**
   * Get available roles
   */
  getRoles() {
    return VALID_ROLES.map((role) => ({
      value: role,
      label: this.getRoleLabel(role)
    }));
  },
  /**
   * Get human-readable role label
   */
  getRoleLabel(role) {
    const labels = {
      "super_admin": "Super Admin",
      "admin_dirjen": "Admin Dirjen PTPP",
      "admin_sesditjen": "Admin Sesditjen",
      "user": "User"
    };
    return labels[role] || role;
  },
  /**
   * List all unit kerja for dropdown
   */
  async listUnitKerja() {
    return db.select({
      id: unitKerja.id,
      name: unitKerja.name
    }).from(unitKerja).orderBy(unitKerja.name);
  }
};
var user_management_service_default = userManagementService;

// src/validations/user-management.validation.ts
import { z as z2 } from "zod";
var roles = ["super_admin", "admin_dirjen", "admin_sesditjen", "user"];
var listUsersSchema = z2.object({
  search: z2.string().optional(),
  role: z2.enum(roles).optional(),
  unitKerjaId: z2.string().optional(),
  isActive: z2.enum(["true", "false"]).optional().transform((val) => val === "true" ? true : val === "false" ? false : void 0),
  page: z2.string().optional().default("1").transform(Number),
  limit: z2.string().optional().default("20").transform(Number)
});
var updateUserSchema = z2.object({
  role: z2.enum(roles).optional(),
  unitKerjaId: z2.string().nullable().optional(),
  isActive: z2.boolean().optional(),
  jabatan: z2.string().max(100).nullable().optional(),
  nip: z2.string().max(30).nullable().optional()
});
var userIdParamSchema = z2.object({
  userId: z2.string().uuid()
});

// src/routes/user-management.routes.ts
var log11 = createLogger("UserManagementRoutes");
var router10 = Router10();
router10.use(sensitiveLimiter);
async function requireAdmin(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: req.headers
    });
    if (!session) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const [currentUser] = await db.select({ role: users.role }).from(users).where(eq10(users.id, session.user.id)).limit(1);
    if (!currentUser || !ADMIN_ROLES.includes(currentUser.role)) {
      return res.status(403).json({
        error: "Access denied",
        message: "Super admin access required"
      });
    }
    req.currentUser = { id: session.user.id, role: currentUser.role };
    next();
  } catch (error) {
    log11.error({ err: error }, "Auth check error:");
    res.status(500).json({ error: "Internal server error" });
  }
}
router10.get("/", requireAdmin, async (req, res) => {
  try {
    const parseResult = listUsersSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation error",
        details: parseResult.error.issues
      });
    }
    const result = await user_management_service_default.listUsers(parseResult.data);
    res.json({ success: true, ...result });
  } catch (error) {
    log11.error({ err: error }, "List users error:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router10.get("/roles", requireAdmin, async (req, res) => {
  try {
    const roles2 = user_management_service_default.getRoles();
    res.json({ success: true, data: roles2 });
  } catch (error) {
    log11.error({ err: error }, "Get roles error:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router10.get("/unit-kerja", requireAdmin, async (req, res) => {
  try {
    const unitKerjaList = await user_management_service_default.listUnitKerja();
    res.json({ success: true, data: unitKerjaList });
  } catch (error) {
    log11.error({ err: error }, "Get unit kerja error:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router10.get("/:userId", requireAdmin, async (req, res) => {
  try {
    const parseResult = userIdParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation error",
        details: parseResult.error.issues
      });
    }
    const user = await user_management_service_default.getUserById(parseResult.data.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    log11.error({ err: error }, "Get user error:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router10.put("/:userId", requireAdmin, async (req, res) => {
  try {
    const paramResult = userIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(400).json({
        error: "Validation error",
        details: paramResult.error.issues
      });
    }
    const bodyResult = updateUserSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        error: "Validation error",
        details: bodyResult.error.issues
      });
    }
    const currentUser = req.currentUser;
    if (paramResult.data.userId === currentUser.id && bodyResult.data.role !== "super_admin") {
      return res.status(400).json({
        error: "Cannot change your own role"
      });
    }
    const existingUser = await user_management_service_default.getUserById(paramResult.data.userId);
    const updatedUser = await user_management_service_default.updateUser(
      paramResult.data.userId,
      bodyResult.data
    );
    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    await audit_log_service_default.logAction({
      userId: currentUser.id,
      userEmail: currentUser.email,
      action: "update",
      entityType: "user",
      entityId: paramResult.data.userId,
      changes: {
        before: { role: existingUser?.role, unitKerjaId: existingUser?.unitKerjaId, isActive: existingUser?.isActive },
        after: { role: updatedUser.role, unitKerjaId: updatedUser.unitKerjaId, isActive: updatedUser.isActive },
        fields: Object.keys(bodyResult.data)
      },
      ipAddress: req.ip
    });
    res.json({ success: true, data: updatedUser });
  } catch (error) {
    log11.error({ err: error }, "Update user error:");
    if (error.message?.includes("Invalid")) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});
router10.delete("/:userId", requireAdmin, async (req, res) => {
  try {
    const parseResult = userIdParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation error",
        details: parseResult.error.issues
      });
    }
    const currentUser = req.currentUser;
    if (parseResult.data.userId === currentUser.id) {
      return res.status(400).json({
        error: "Cannot deactivate your own account"
      });
    }
    const deactivatedUser = await user_management_service_default.deactivateUser(parseResult.data.userId);
    if (!deactivatedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    await audit_log_service_default.logAction({
      userId: currentUser.id,
      userEmail: currentUser.email,
      action: "update",
      entityType: "user",
      entityId: parseResult.data.userId,
      changes: { after: { isActive: false } },
      ipAddress: req.ip
    });
    res.json({ success: true, data: deactivatedUser, message: "User deactivated" });
  } catch (error) {
    log11.error({ err: error }, "Deactivate user error:");
    res.status(500).json({ error: "Internal server error" });
  }
});
var user_management_routes_default = router10;

// src/routes/audit-log.routes.ts
import { Router as Router11 } from "express";
var log12 = createLogger("AuditLogRoutes");
var router11 = Router11();
async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: req.headers
    });
    if (!session) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    req.currentUser = { id: session.user.id };
    next();
  } catch (error) {
    log12.error({ err: error }, "Auth check error:");
    res.status(500).json({ error: "Internal server error" });
  }
}
router11.get("/", requireAuth, async (req, res) => {
  try {
    const { entityType, entityId, action, userId, search, startDate, endDate, page, limit } = req.query;
    const filters = {};
    if (entityType) filters.entityType = entityType;
    if (entityId) filters.entityId = entityId;
    if (action) filters.action = action;
    if (userId) filters.userId = userId;
    if (search) filters.search = search;
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);
    if (page) filters.page = parseInt(page);
    if (limit) filters.limit = parseInt(limit);
    const result = await audit_log_service_default.listLogs(filters);
    res.json({ success: true, ...result });
  } catch (error) {
    log12.error({ err: error }, "List audit logs error:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router11.get("/:entityType/:entityId", requireAuth, async (req, res) => {
  try {
    const entityType = req.params.entityType;
    const entityId = req.params.entityId;
    const history = await audit_log_service_default.getEntityHistory(entityType, entityId);
    res.json({ success: true, data: history });
  } catch (error) {
    log12.error({ err: error }, "Get entity history error:");
    res.status(500).json({ error: "Internal server error" });
  }
});
var audit_log_routes_default = router11;

// src/routes/klasifikasi.routes.ts
import { Router as Router12 } from "express";

// src/services/klasifikasi.service.ts
import { eq as eq11, and as and9, like as like3, or as or5 } from "drizzle-orm";
function buildTree(items, parentKode = null) {
  return items.filter((item) => item.parentKode === parentKode).map((item) => ({
    ...item,
    children: buildTree(items, item.kode)
  }));
}
var KlasifikasiService = class {
  // Get all klasifikasi with optional filters
  async getAll(filters = {}) {
    const conditions = [];
    if (filters.tipe) {
      conditions.push(eq11(klasifikasiArsip.tipe, filters.tipe));
    }
    if (filters.activeOnly !== false) {
      conditions.push(eq11(klasifikasiArsip.isActive, true));
    }
    if (filters.search) {
      conditions.push(
        or5(
          like3(klasifikasiArsip.kode, `%${filters.search}%`),
          like3(klasifikasiArsip.jenis, `%${filters.search}%`)
        )
      );
    }
    const data = await db.select().from(klasifikasiArsip).where(conditions.length > 0 ? and9(...conditions) : void 0).orderBy(klasifikasiArsip.kode);
    return data;
  }
  // Get as tree structure
  async getTree(tipe) {
    const conditions = [eq11(klasifikasiArsip.isActive, true)];
    if (tipe) {
      conditions.push(eq11(klasifikasiArsip.tipe, tipe));
    }
    const flatData = await db.select().from(klasifikasiArsip).where(and9(...conditions)).orderBy(klasifikasiArsip.kode);
    const tree = buildTree(flatData, null);
    return tree;
  }
  // Get by kode
  async getByKode(kode) {
    const [item] = await db.select().from(klasifikasiArsip).where(eq11(klasifikasiArsip.kode, kode)).limit(1);
    return item || null;
  }
  // Get children by parent kode
  async getChildren(parentKode) {
    const children = await db.select().from(klasifikasiArsip).where(and9(
      eq11(klasifikasiArsip.parentKode, parentKode),
      eq11(klasifikasiArsip.isActive, true)
    )).orderBy(klasifikasiArsip.kode);
    return children;
  }
  // Create new klasifikasi
  async create(data) {
    const [created] = await db.insert(klasifikasiArsip).values(data).returning();
    return created;
  }
  // Update klasifikasi
  async update(kode, data) {
    const [updated] = await db.update(klasifikasiArsip).set(data).where(eq11(klasifikasiArsip.kode, kode)).returning();
    return updated || null;
  }
  // Soft delete (set isActive = false)
  async delete(kode) {
    const [deleted] = await db.update(klasifikasiArsip).set({ isActive: false }).where(eq11(klasifikasiArsip.kode, kode)).returning();
    return deleted || null;
  }
  // Get statistics
  async getStats() {
    const all = await db.select().from(klasifikasiArsip).where(eq11(klasifikasiArsip.isActive, true));
    const fasilitatif = all.filter((i) => i.tipe === "fasilitatif");
    const substantif = all.filter((i) => i.tipe === "substantif");
    return {
      total: all.length,
      fasilitatif: fasilitatif.length,
      substantif: substantif.length,
      rootFasilitatif: fasilitatif.filter((i) => i.level === 0).length,
      rootSubstantif: substantif.filter((i) => i.level === 0).length
    };
  }
};
var JRAService = class {
  async getAll(filters = {}) {
    const conditions = [];
    if (filters.tipe) {
      conditions.push(eq11(jadwalRetensiArsip.tipe, filters.tipe));
    }
    if (filters.activeOnly !== false) {
      conditions.push(eq11(jadwalRetensiArsip.isActive, true));
    }
    if (filters.search) {
      conditions.push(
        or5(
          like3(jadwalRetensiArsip.kode, `%${filters.search}%`),
          like3(jadwalRetensiArsip.uraian, `%${filters.search}%`)
        )
      );
    }
    const data = await db.select().from(jadwalRetensiArsip).where(conditions.length > 0 ? and9(...conditions) : void 0).orderBy(jadwalRetensiArsip.kode);
    return data;
  }
  async getTree(tipe) {
    const conditions = [eq11(jadwalRetensiArsip.isActive, true)];
    if (tipe) {
      conditions.push(eq11(jadwalRetensiArsip.tipe, tipe));
    }
    const flatData = await db.select().from(jadwalRetensiArsip).where(and9(...conditions)).orderBy(jadwalRetensiArsip.kode);
    const buildJRATree = (items, parentKode = null) => {
      return items.filter((item) => item.parentKode === parentKode).map((item) => ({
        ...item,
        children: buildJRATree(items, item.kode)
      }));
    };
    return buildJRATree(flatData, null);
  }
  async getByKode(kode) {
    const [item] = await db.select().from(jadwalRetensiArsip).where(eq11(jadwalRetensiArsip.kode, kode)).limit(1);
    return item || null;
  }
  async create(data) {
    const [created] = await db.insert(jadwalRetensiArsip).values(data).returning();
    return created;
  }
  async update(kode, data) {
    const [updated] = await db.update(jadwalRetensiArsip).set(data).where(eq11(jadwalRetensiArsip.kode, kode)).returning();
    return updated || null;
  }
  async delete(kode) {
    const [deleted] = await db.update(jadwalRetensiArsip).set({ isActive: false }).where(eq11(jadwalRetensiArsip.kode, kode)).returning();
    return deleted || null;
  }
};
var klasifikasiService = new KlasifikasiService();
var jraService = new JRAService();
var MappingService = class {
  // Get all thematic mappings
  async getAllMappings() {
    const data = await db.select().from(klasifikasiJraMapping).where(eq11(klasifikasiJraMapping.isActive, true)).orderBy(klasifikasiJraMapping.tema);
    return data;
  }
  // Get suggested JRA items based on klasifikasi kode
  // e.g., 'KU.01.02' → prefix 'KU' → maps to JRA prefix 'F.I' → returns all JRA items starting with 'F.I'
  async getSuggestedJRA(klasifikasiKode) {
    const prefix = this.extractPrefix(klasifikasiKode);
    const mappings = await db.select().from(klasifikasiJraMapping).where(and9(
      eq11(klasifikasiJraMapping.klasifikasiPrefix, prefix),
      eq11(klasifikasiJraMapping.isActive, true)
    ));
    if (mappings.length === 0) {
      const rootPrefix = klasifikasiKode.split(".")[0];
      if (rootPrefix !== prefix) {
        const rootMappings = await db.select().from(klasifikasiJraMapping).where(and9(
          eq11(klasifikasiJraMapping.klasifikasiPrefix, rootPrefix),
          eq11(klasifikasiJraMapping.isActive, true)
        ));
        if (rootMappings.length > 0) {
          return this.fetchJRAByPrefixes(rootMappings);
        }
      }
      return { mappings: [], suggestedJRA: [] };
    }
    return this.fetchJRAByPrefixes(mappings);
  }
  // Get JRA suggestions for a given mapping
  async fetchJRAByPrefixes(mappings) {
    const allJRA = [];
    for (const mapping of mappings) {
      const jraItems = await db.select().from(jadwalRetensiArsip).where(and9(
        like3(jadwalRetensiArsip.kode, `${mapping.jraPrefix}%`),
        eq11(jadwalRetensiArsip.isActive, true)
      )).orderBy(jadwalRetensiArsip.kode);
      allJRA.push(...jraItems);
    }
    const uniqueJRA = allJRA.filter(
      (item, index, arr) => arr.findIndex((i) => i.kode === item.kode) === index
    );
    return {
      mappings: mappings.map((m) => ({
        tema: m.tema,
        klasifikasiPrefix: m.klasifikasiPrefix,
        jraPrefix: m.jraPrefix,
        keterangan: m.keterangan
      })),
      suggestedJRA: uniqueJRA
    };
  }
  // Extract the best matching prefix from a klasifikasi kode
  extractPrefix(kode) {
    if (kode.startsWith("TU.02")) return "TU.02";
    return kode.split(".")[0];
  }
};
var mappingService = new MappingService();

// src/routes/klasifikasi.routes.ts
var log13 = createLogger("KlasifikasiRoutes");
var router12 = Router12();
router12.use(authMiddleware);
router12.get("/", async (req, res) => {
  try {
    const { tipe, search, format } = req.query;
    if (format === "tree") {
      const tree = await klasifikasiService.getTree(tipe);
      return res.json({ success: true, data: tree });
    }
    const data = await klasifikasiService.getAll({
      tipe,
      search
    });
    res.json({ success: true, data });
  } catch (error) {
    log13.error({ err: error }, "Error fetching klasifikasi:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router12.get("/stats", async (req, res) => {
  try {
    const stats = await klasifikasiService.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    log13.error({ err: error }, "Error fetching stats:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router12.get("/:kode", async (req, res) => {
  try {
    const kode = req.params.kode;
    const item = await klasifikasiService.getByKode(kode);
    if (!item) {
      return res.status(404).json({ error: "Klasifikasi not found" });
    }
    const children = await klasifikasiService.getChildren(kode);
    res.json({ success: true, data: { ...item, children } });
  } catch (error) {
    log13.error({ err: error }, "Error fetching klasifikasi:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router12.post("/", async (req, res) => {
  try {
    const { kode, jenis, keterangan, kategori, parentKode, tipe, level } = req.body;
    if (!kode || !jenis || !tipe) {
      return res.status(400).json({ error: "kode, jenis, and tipe are required" });
    }
    const existing = await klasifikasiService.getByKode(kode);
    if (existing) {
      return res.status(400).json({ error: "Kode already exists" });
    }
    const created = await klasifikasiService.create({
      kode,
      jenis,
      keterangan: keterangan || null,
      kategori: kategori || null,
      parentKode: parentKode || null,
      tipe,
      level: level ?? 0,
      isActive: true
    });
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    log13.error({ err: error }, "Error creating klasifikasi:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router12.put("/:kode", async (req, res) => {
  try {
    const kode = req.params.kode;
    const { jenis, keterangan, kategori, isActive } = req.body;
    const updated = await klasifikasiService.update(kode, {
      jenis,
      keterangan,
      kategori,
      isActive
    });
    if (!updated) {
      return res.status(404).json({ error: "Klasifikasi not found" });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    log13.error({ err: error }, "Error updating klasifikasi:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router12.delete("/:kode", async (req, res) => {
  try {
    const kode = req.params.kode;
    const deleted = await klasifikasiService.delete(kode);
    if (!deleted) {
      return res.status(404).json({ error: "Klasifikasi not found" });
    }
    res.json({ success: true, message: "Klasifikasi deleted", data: deleted });
  } catch (error) {
    log13.error({ err: error }, "Error deleting klasifikasi:");
    res.status(500).json({ error: "Internal server error" });
  }
});
var klasifikasi_routes_default = router12;

// src/routes/jra.routes.ts
import { Router as Router13 } from "express";
var log14 = createLogger("JraRoutes");
var router13 = Router13();
router13.use(authMiddleware);
router13.get("/", async (req, res) => {
  try {
    const { tipe, search, format } = req.query;
    if (format === "tree") {
      const tree = await jraService.getTree(tipe);
      return res.json({ success: true, data: tree });
    }
    const data = await jraService.getAll({
      tipe,
      search
    });
    res.json({ success: true, data });
  } catch (error) {
    log14.error({ err: error }, "Error fetching JRA:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router13.get("/:kode", async (req, res) => {
  try {
    const kode = req.params.kode;
    const item = await jraService.getByKode(kode);
    if (!item) {
      return res.status(404).json({ error: "JRA not found" });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    log14.error({ err: error }, "Error fetching JRA:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router13.post("/", async (req, res) => {
  try {
    const { kode, uraian, retensiAktif, retensiInaktif, keterangan, kategori, parentKode, tipe, level } = req.body;
    if (!kode || !uraian || !tipe) {
      return res.status(400).json({ error: "kode, uraian, and tipe are required" });
    }
    const existing = await jraService.getByKode(kode);
    if (existing) {
      return res.status(400).json({ error: "Kode already exists" });
    }
    const created = await jraService.create({
      kode,
      uraian,
      retensiAktif: retensiAktif || null,
      retensiInaktif: retensiInaktif || null,
      keterangan: keterangan || null,
      kategori: kategori || null,
      parentKode: parentKode || null,
      tipe,
      level: level ?? 0,
      isActive: true
    });
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    log14.error({ err: error }, "Error creating JRA:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router13.put("/:kode", async (req, res) => {
  try {
    const kode = req.params.kode;
    const { uraian, retensiAktif, retensiInaktif, keterangan, kategori, isActive } = req.body;
    const updated = await jraService.update(kode, {
      uraian,
      retensiAktif,
      retensiInaktif,
      keterangan,
      kategori,
      isActive
    });
    if (!updated) {
      return res.status(404).json({ error: "JRA not found" });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    log14.error({ err: error }, "Error updating JRA:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router13.delete("/:kode", async (req, res) => {
  try {
    const kode = req.params.kode;
    const deleted = await jraService.delete(kode);
    if (!deleted) {
      return res.status(404).json({ error: "JRA not found" });
    }
    res.json({ success: true, message: "JRA deleted", data: deleted });
  } catch (error) {
    log14.error({ err: error }, "Error deleting JRA:");
    res.status(500).json({ error: "Internal server error" });
  }
});
var jra_routes_default = router13;

// src/routes/arsip-picker.routes.ts
import { Router as Router14 } from "express";
var log15 = createLogger("ArsipPickerRoutes");
var router14 = Router14();
router14.get("/klasifikasi/tree", authMiddleware, async (req, res) => {
  try {
    const { tipe } = req.query;
    const tree = await klasifikasiService.getTree(tipe);
    res.json({ success: true, data: tree });
  } catch (error) {
    log15.error({ err: error }, "Error fetching klasifikasi tree:");
    res.status(500).json({ success: false, error: "Failed to fetch klasifikasi tree" });
  }
});
router14.get("/jra/:kode", authMiddleware, async (req, res) => {
  try {
    const kode = req.params.kode;
    const jra = await jraService.getByKode(kode);
    if (!jra) {
      const allJra = await jraService.getAll({ activeOnly: true });
      const bestMatch = allJra.find(
        (j) => kode.startsWith(j.kode) || j.kode.startsWith(kode)
      );
      if (bestMatch) {
        res.json({ success: true, data: bestMatch, matched: "prefix" });
        return;
      }
      res.json({ success: true, data: null, message: "No matching JRA found" });
      return;
    }
    res.json({ success: true, data: jra });
  } catch (error) {
    log15.error({ err: error }, "Error fetching JRA:");
    res.status(500).json({ success: false, error: "Failed to fetch JRA" });
  }
});
router14.post("/calculate-dates", authMiddleware, async (req, res) => {
  try {
    const { tanggalArsip, retensiAktif, retensiInaktif } = req.body;
    if (!tanggalArsip) {
      res.status(400).json({ success: false, error: "tanggalArsip is required" });
      return;
    }
    const dates = arsipService.calculateRetentionDates(tanggalArsip, retensiAktif, retensiInaktif);
    const status = arsipService.getArchiveStatus(tanggalArsip, retensiAktif, retensiInaktif);
    res.json({
      success: true,
      data: {
        ...dates,
        status
      }
    });
  } catch (error) {
    log15.error({ err: error }, "Error calculating dates:");
    res.status(500).json({ success: false, error: "Failed to calculate dates" });
  }
});
router14.get("/lifecycle", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const unitKerjaId = user?.unitKerjaId || "PTEP";
    const notifications = await arsipService.getLifecycleNotifications(unitKerjaId);
    res.json({ success: true, data: notifications });
  } catch (error) {
    log15.error({ err: error }, "Error fetching lifecycle notifications:");
    res.status(500).json({ success: false, error: "Failed to fetch lifecycle notifications" });
  }
});
var arsip_picker_routes_default = router14;

// src/routes/storage-location.routes.ts
import { Router as Router15 } from "express";

// src/services/storage-location.service.ts
import { eq as eq12, and as and10, sql as sql7, isNull as isNull2 } from "drizzle-orm";
import QRCode from "qrcode";
var StorageLocationService = class {
  async findAll(filters) {
    const { unitKerjaId, level, parentId, search, page = 1, limit = 50 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [eq12(storageLocations.unitKerjaId, unitKerjaId)];
    if (level) {
      conditions.push(eq12(storageLocations.level, level));
    }
    if (parentId === null) {
      conditions.push(isNull2(storageLocations.parentId));
    } else if (parentId) {
      conditions.push(eq12(storageLocations.parentId, parentId));
    }
    const [{ count: count5 }] = await db.select({ count: sql7`count(*)::int` }).from(storageLocations).where(and10(...conditions));
    const data = await db.select().from(storageLocations).where(and10(...conditions)).orderBy(storageLocations.code).limit(limit).offset(offset);
    return {
      data,
      pagination: {
        page,
        limit,
        total: count5,
        totalPages: Math.ceil(count5 / limit)
      }
    };
  }
  async findById(id) {
    const [result] = await db.select().from(storageLocations).where(eq12(storageLocations.id, id)).limit(1);
    return result || null;
  }
  async getTree(unitKerjaId) {
    const allLocations = await db.select().from(storageLocations).where(eq12(storageLocations.unitKerjaId, unitKerjaId)).orderBy(storageLocations.level, storageLocations.code);
    const locationMap = /* @__PURE__ */ new Map();
    const rootNodes = [];
    for (const loc of allLocations) {
      locationMap.set(loc.id, { ...loc, children: [] });
    }
    for (const loc of allLocations) {
      const node = locationMap.get(loc.id);
      if (loc.parentId && locationMap.has(loc.parentId)) {
        locationMap.get(loc.parentId).children.push(node);
      } else {
        rootNodes.push(node);
      }
    }
    return rootNodes;
  }
  async create(data) {
    if (!data.code) {
      data.code = await this.generateCode(data.unitKerjaId, data.level, data.parentId || void 0);
    }
    const [result] = await db.insert(storageLocations).values(data).returning();
    return result;
  }
  async update(id, data) {
    const [result] = await db.update(storageLocations).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq12(storageLocations.id, id)).returning();
    return result;
  }
  async delete(id) {
    const [hasChildren] = await db.select({ count: sql7`count(*)::int` }).from(storageLocations).where(eq12(storageLocations.parentId, id));
    if (hasChildren.count > 0) {
      throw new Error("Cannot delete location with children. Delete children first.");
    }
    const [hasArsip] = await db.select({ count: sql7`count(*)::int` }).from(arsip).where(eq12(arsip.storageLocationId, id));
    if (hasArsip.count > 0) {
      throw new Error("Cannot delete location with archived items. Move items first.");
    }
    const [result] = await db.delete(storageLocations).where(eq12(storageLocations.id, id)).returning();
    return result;
  }
  async generateQRCode(locationId, baseUrl) {
    const location = await this.findById(locationId);
    if (!location) {
      throw new Error("Storage location not found");
    }
    const qrUrl = `${baseUrl}/storage-locations/${locationId}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, {
      width: 300,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" }
    });
    return {
      qrDataUrl,
      qrUrl,
      location
    };
  }
  async generateArsipQRCode(arsipId, baseUrl) {
    const [arsipItem] = await db.select().from(arsip).where(eq12(arsip.id, arsipId)).limit(1);
    if (!arsipItem) {
      throw new Error("Arsip not found");
    }
    const qrUrl = `${baseUrl}/arsip/${arsipId}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, {
      width: 300,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" }
    });
    return {
      qrDataUrl,
      qrUrl,
      arsip: arsipItem
    };
  }
  async getArsipCount(locationId) {
    const [result] = await db.select({ count: sql7`count(*)::int` }).from(arsip).where(eq12(arsip.storageLocationId, locationId));
    return result.count;
  }
  async updateArsipCounts(unitKerjaId) {
    const boxes = await db.select().from(storageLocations).where(and10(
      eq12(storageLocations.unitKerjaId, unitKerjaId),
      eq12(storageLocations.level, "box")
    ));
    for (const box of boxes) {
      const count5 = await this.getArsipCount(box.id);
      await this.update(box.id, { currentCount: count5 });
    }
  }
  async generateCode(unitKerjaId, level, parentId) {
    const prefixes = {
      "gedung": "G",
      "ruang": "R",
      "rak": "RAK",
      "box": "B"
    };
    let parentCode = "";
    if (parentId) {
      const parent = await this.findById(parentId);
      if (parent) {
        parentCode = parent.code + "-";
      }
    }
    const conditions = [
      eq12(storageLocations.unitKerjaId, unitKerjaId),
      eq12(storageLocations.level, level)
    ];
    if (parentId) {
      conditions.push(eq12(storageLocations.parentId, parentId));
    } else {
      conditions.push(isNull2(storageLocations.parentId));
    }
    const [{ count: count5 }] = await db.select({ count: sql7`count(*)::int` }).from(storageLocations).where(and10(...conditions));
    const nextNum = count5 + 1;
    return `${parentCode}${prefixes[level] || level.toUpperCase()}${nextNum}`;
  }
};
var storageLocationService = new StorageLocationService();

// src/routes/storage-location.routes.ts
var router15 = Router15();
var getIpAddress = (req) => {
  const ip = req.ip;
  return Array.isArray(ip) ? ip[0] : ip;
};
router15.use(authMiddleware);
router15.get("/", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { level, parentId, search, page, limit } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const result = await storageLocationService.findAll({
      unitKerjaId,
      level,
      parentId: parentId === "null" ? null : parentId,
      search,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router15.get("/tree", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const tree = await storageLocationService.getTree(unitKerjaId);
    res.json({ success: true, data: tree });
  } catch (error) {
    next(error);
  }
});
router15.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await storageLocationService.findById(id);
    if (!result) {
      return res.status(404).json({ error: "Storage location not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router15.get("/:id/qr", async (req, res, next) => {
  try {
    const { id } = req.params;
    const host = req.get("host") || "localhost";
    const baseUrl = `${req.protocol}://${host}`;
    const result = await storageLocationService.generateQRCode(id, baseUrl);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router15.post("/", canWriteMiddleware(), validateBody(createStorageLocationSchema), async (req, res, next) => {
  try {
    const result = await storageLocationService.create(req.body);
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "create",
      entityType: "storage_location",
      entityId: result.id,
      changes: { after: { code: result.code, name: result.name, level: result.level } },
      ipAddress: getIpAddress(req)
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router15.put("/:id", canWriteMiddleware(), validateBody(updateStorageLocationSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await storageLocationService.findById(id);
    const result = await storageLocationService.update(id, req.body);
    if (!result) {
      return res.status(404).json({ error: "Storage location not found" });
    }
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "update",
      entityType: "storage_location",
      entityId: id,
      changes: { before: existing, after: result, fields: Object.keys(req.body) },
      ipAddress: getIpAddress(req)
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router15.delete("/:id", canWriteMiddleware(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await storageLocationService.findById(id);
    const result = await storageLocationService.delete(id);
    if (!result) {
      return res.status(404).json({ error: "Storage location not found" });
    }
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "delete",
      entityType: "storage_location",
      entityId: id,
      changes: { before: { code: existing?.code, name: existing?.name } },
      ipAddress: getIpAddress(req)
    });
    res.json({ success: true, message: "Storage location deleted successfully" });
  } catch (error) {
    if (error.message.includes("Cannot delete")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
var storage_location_routes_default = router15;

// src/routes/archive-lending.routes.ts
import { Router as Router16 } from "express";

// src/services/archive-lending.service.ts
import { eq as eq13, and as and11, desc as desc8, sql as sql8, lt } from "drizzle-orm";
var ArchiveLendingService = class {
  async findAll(filters) {
    const { status, lendingType, borrowerId, arsipId, storageLocationId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (status) {
      conditions.push(eq13(archiveLending.status, status));
    }
    if (lendingType) {
      conditions.push(eq13(archiveLending.lendingType, lendingType));
    }
    if (borrowerId) {
      conditions.push(eq13(archiveLending.borrowerId, borrowerId));
    }
    if (arsipId) {
      conditions.push(eq13(archiveLending.arsipId, arsipId));
    }
    if (storageLocationId) {
      conditions.push(eq13(archiveLending.storageLocationId, storageLocationId));
    }
    const whereClause = conditions.length > 0 ? and11(...conditions) : void 0;
    const [{ count: count5 }] = await db.select({ count: sql8`count(*)::int` }).from(archiveLending).where(whereClause);
    const data = await db.select({
      lending: archiveLending,
      borrower: {
        id: users.id,
        name: users.name,
        email: users.email
      }
    }).from(archiveLending).leftJoin(users, eq13(archiveLending.borrowerId, users.id)).where(whereClause).orderBy(desc8(archiveLending.createdAt)).limit(limit).offset(offset);
    return {
      data: data.map((d) => ({ ...d.lending, borrower: d.borrower })),
      pagination: {
        page,
        limit,
        total: count5,
        totalPages: Math.ceil(count5 / limit)
      }
    };
  }
  async findById(id) {
    const [result] = await db.select().from(archiveLending).where(eq13(archiveLending.id, id)).limit(1);
    return result || null;
  }
  async getHistoryByArsipId(arsipId) {
    return await db.select().from(archiveLending).where(eq13(archiveLending.arsipId, arsipId)).orderBy(desc8(archiveLending.borrowDate));
  }
  async getHistoryByLocationId(locationId) {
    return await db.select().from(archiveLending).where(eq13(archiveLending.storageLocationId, locationId)).orderBy(desc8(archiveLending.borrowDate));
  }
  async borrow(data) {
    const borrowDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    if (data.lendingType === "arsip" && !data.arsipId) {
      throw new Error("arsipId is required for per-arsip lending");
    }
    if (data.lendingType === "box" && !data.storageLocationId) {
      throw new Error("storageLocationId is required for per-box lending");
    }
    if (data.lendingType === "arsip" && data.arsipId) {
      const [existingArsip] = await db.select().from(arsip).where(eq13(arsip.id, data.arsipId)).limit(1);
      if (!existingArsip) {
        throw new Error("Arsip not found");
      }
      if (existingArsip.lendingStatus === "borrowed") {
        throw new Error("Arsip is already borrowed");
      }
    }
    const [lending] = await db.insert(archiveLending).values({
      ...data,
      borrowDate,
      status: "borrowed"
    }).returning();
    if (data.lendingType === "arsip" && data.arsipId) {
      await db.update(arsip).set({ lendingStatus: "borrowed", updatedAt: /* @__PURE__ */ new Date() }).where(eq13(arsip.id, data.arsipId));
    }
    if (data.lendingType === "box" && data.storageLocationId) {
      await db.update(arsip).set({ lendingStatus: "borrowed", updatedAt: /* @__PURE__ */ new Date() }).where(eq13(arsip.storageLocationId, data.storageLocationId));
    }
    return lending;
  }
  async return(lendingId, notes) {
    const lending = await this.findById(lendingId);
    if (!lending) {
      throw new Error("Lending record not found");
    }
    if (lending.status === "returned") {
      throw new Error("Already returned");
    }
    const returnDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const [updated] = await db.update(archiveLending).set({
      status: "returned",
      returnDate,
      notes: notes || lending.notes,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq13(archiveLending.id, lendingId)).returning();
    if (lending.lendingType === "arsip" && lending.arsipId) {
      await db.update(arsip).set({ lendingStatus: "available", updatedAt: /* @__PURE__ */ new Date() }).where(eq13(arsip.id, lending.arsipId));
    }
    if (lending.lendingType === "box" && lending.storageLocationId) {
      await db.update(arsip).set({ lendingStatus: "available", updatedAt: /* @__PURE__ */ new Date() }).where(eq13(arsip.storageLocationId, lending.storageLocationId));
    }
    return updated;
  }
  async extend(lendingId, newDueDate) {
    const lending = await this.findById(lendingId);
    if (!lending) {
      throw new Error("Lending record not found");
    }
    if (lending.status === "returned") {
      throw new Error("Cannot extend returned item");
    }
    const [updated] = await db.update(archiveLending).set({
      dueDate: newDueDate,
      status: "borrowed",
      // Reset overdue status
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq13(archiveLending.id, lendingId)).returning();
    return updated;
  }
  async getOverdue() {
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const overdue = await db.select({
      lending: archiveLending,
      borrower: {
        id: users.id,
        name: users.name,
        email: users.email
      }
    }).from(archiveLending).leftJoin(users, eq13(archiveLending.borrowerId, users.id)).where(and11(
      eq13(archiveLending.status, "borrowed"),
      lt(archiveLending.dueDate, todayStr)
    )).orderBy(archiveLending.dueDate);
    for (const item of overdue) {
      await db.update(archiveLending).set({ status: "overdue", updatedAt: /* @__PURE__ */ new Date() }).where(eq13(archiveLending.id, item.lending.id));
    }
    return overdue.map((d) => ({
      ...d.lending,
      status: "overdue",
      borrower: d.borrower,
      daysOverdue: Math.ceil(((/* @__PURE__ */ new Date()).getTime() - new Date(d.lending.dueDate).getTime()) / (1e3 * 60 * 60 * 24))
    }));
  }
  async getStats() {
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const stats = await db.select({
      total: sql8`count(*)::int`,
      borrowed: sql8`count(*) filter (where ${archiveLending.status} = 'borrowed')::int`,
      overdue: sql8`count(*) filter (where ${archiveLending.status} = 'borrowed' and ${archiveLending.dueDate} < ${todayStr})::int`,
      returned: sql8`count(*) filter (where ${archiveLending.status} = 'returned')::int`
    }).from(archiveLending);
    return stats[0];
  }
};
var archiveLendingService = new ArchiveLendingService();

// src/routes/archive-lending.routes.ts
var router16 = Router16();
var getIpAddress2 = (req) => {
  const ip = req.ip;
  return Array.isArray(ip) ? ip[0] : ip;
};
router16.use(authMiddleware);
router16.get("/", async (req, res, next) => {
  try {
    const { status, lendingType, borrowerId, arsipId, storageLocationId, page, limit } = req.query;
    const result = await archiveLendingService.findAll({
      status,
      lendingType,
      borrowerId,
      arsipId,
      storageLocationId,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router16.get("/overdue", async (req, res, next) => {
  try {
    const data = await archiveLendingService.getOverdue();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
router16.get("/stats", async (req, res, next) => {
  try {
    const stats = await archiveLendingService.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});
router16.get("/arsip/:arsipId", async (req, res, next) => {
  try {
    const { arsipId } = req.params;
    const data = await archiveLendingService.getHistoryByArsipId(arsipId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
router16.get("/location/:locationId", async (req, res, next) => {
  try {
    const { locationId } = req.params;
    const data = await archiveLendingService.getHistoryByLocationId(locationId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
router16.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await archiveLendingService.findById(id);
    if (!result) {
      return res.status(404).json({ error: "Lending record not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router16.post("/borrow", canWriteMiddleware(), sensitiveLimiter, validateBody(borrowArchiveSchema), async (req, res, next) => {
  try {
    const { lendingType, arsipId, storageLocationId, borrowerName, departmentUnit, dueDate, purpose } = req.body;
    if (!lendingType || !["arsip", "box"].includes(lendingType)) {
      return res.status(400).json({ error: 'lendingType must be "arsip" or "box"' });
    }
    if (!borrowerName || !dueDate) {
      return res.status(400).json({ error: "borrowerName and dueDate are required" });
    }
    const result = await archiveLendingService.borrow({
      lendingType,
      arsipId,
      storageLocationId,
      borrowerId: req.user.id,
      borrowerName,
      departmentUnit,
      dueDate,
      purpose,
      approvedBy: req.user?.id,
      createdBy: req.user?.id
    });
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "create",
      entityType: "archive_lending",
      entityId: result.id,
      changes: { after: { lendingType, borrowerName, dueDate } },
      ipAddress: getIpAddress2(req)
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("required") || error.message.includes("already borrowed") || error.message.includes("not found")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router16.put("/:id/return", canWriteMiddleware(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const result = await archiveLendingService.return(id, notes);
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "update",
      entityType: "archive_lending",
      entityId: id,
      changes: { after: { status: "returned", returnDate: result.returnDate } },
      ipAddress: getIpAddress2(req)
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("not found") || error.message.includes("Already returned")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router16.put("/:id/extend", canWriteMiddleware(), validateBody(extendLendingSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newDueDate } = req.body;
    if (!newDueDate) {
      return res.status(400).json({ error: "newDueDate is required" });
    }
    const result = await archiveLendingService.extend(id, newDueDate);
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "update",
      entityType: "archive_lending",
      entityId: id,
      changes: { after: { newDueDate } },
      ipAddress: getIpAddress2(req)
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("not found") || error.message.includes("Cannot extend")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router16.get("/qr/arsip/:arsipId", async (req, res, next) => {
  try {
    const { arsipId } = req.params;
    const host = req.get("host") || "localhost";
    const baseUrl = `${req.protocol}://${host}`;
    const result = await storageLocationService.generateArsipQRCode(arsipId, baseUrl);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("not found")) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});
var archive_lending_routes_default = router16;

// src/routes/dosir.routes.ts
import { Router as Router17 } from "express";

// src/services/dosir.service.ts
import { eq as eq14, and as and12, desc as desc9, ilike as ilike5, or as or6, sql as sql9, inArray as inArray3 } from "drizzle-orm";
var dosirService = {
  /**
   * Create a new dosir (case file)
   */
  async create(data) {
    const [newDosir] = await db.insert(dosir).values({
      unitKerjaId: data.unitKerjaId,
      kode: data.kode,
      judul: data.judul,
      deskripsi: data.deskripsi || null,
      kategori: data.kategori || null,
      tanggalMulai: data.tanggalMulai || null,
      createdBy: data.createdBy || null
    }).returning();
    return newDosir;
  },
  /**
   * Update dosir details
   */
  async update(id, data) {
    const [updated] = await db.update(dosir).set({
      ...data,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq14(dosir.id, id)).returning();
    return updated;
  },
  /**
   * Delete dosir (cascade deletes junction table entries)
   */
  async delete(id) {
    await db.delete(dosir).where(eq14(dosir.id, id));
    return { success: true };
  },
  /**
   * Get single dosir by ID with linked surat
   */
  async getById(id) {
    const [result] = await db.select().from(dosir).where(eq14(dosir.id, id));
    if (!result) return null;
    const linkedMasuk = await db.select({
      link: dosirSuratMasuk,
      surat: suratMasuk
    }).from(dosirSuratMasuk).innerJoin(suratMasuk, eq14(dosirSuratMasuk.suratMasukId, suratMasuk.id)).where(eq14(dosirSuratMasuk.dosirId, id));
    const linkedKeluar = await db.select({
      link: dosirSuratKeluar,
      surat: suratKeluar
    }).from(dosirSuratKeluar).innerJoin(suratKeluar, eq14(dosirSuratKeluar.suratKeluarId, suratKeluar.id)).where(eq14(dosirSuratKeluar.dosirId, id));
    return {
      ...result,
      suratMasuk: linkedMasuk.map((l) => ({ ...l.surat, addedAt: l.link.addedAt, notes: l.link.notes })),
      suratKeluar: linkedKeluar.map((l) => ({ ...l.surat, addedAt: l.link.addedAt, notes: l.link.notes }))
    };
  },
  /**
   * Get all dosir with filters
   */
  async getAll(filters = {}) {
    const { unitKerjaId, status, kategori, search, limit = 50, offset = 0 } = filters;
    let query = db.select().from(dosir);
    const conditions = [];
    if (unitKerjaId) conditions.push(eq14(dosir.unitKerjaId, unitKerjaId));
    if (status) conditions.push(eq14(dosir.status, status));
    if (kategori) conditions.push(eq14(dosir.kategori, kategori));
    if (search) {
      conditions.push(
        or6(
          ilike5(dosir.judul, `%${search}%`),
          ilike5(dosir.kode, `%${search}%`),
          ilike5(dosir.deskripsi, `%${search}%`)
        )
      );
    }
    if (conditions.length > 0) {
      query = query.where(and12(...conditions));
    }
    const results = await query.orderBy(desc9(dosir.createdAt)).limit(limit).offset(offset);
    const dosirIds = results.map((d) => d.id);
    const masukCounts = dosirIds.length > 0 ? await db.select({
      dosirId: dosirSuratMasuk.dosirId,
      count: sql9`count(*)::int`.as("count")
    }).from(dosirSuratMasuk).where(inArray3(dosirSuratMasuk.dosirId, dosirIds)).groupBy(dosirSuratMasuk.dosirId) : [];
    const keluarCounts = dosirIds.length > 0 ? await db.select({
      dosirId: dosirSuratKeluar.dosirId,
      count: sql9`count(*)::int`.as("count")
    }).from(dosirSuratKeluar).where(inArray3(dosirSuratKeluar.dosirId, dosirIds)).groupBy(dosirSuratKeluar.dosirId) : [];
    const masukMap = new Map(masukCounts.map((c) => [c.dosirId, c.count]));
    const keluarMap = new Map(keluarCounts.map((c) => [c.dosirId, c.count]));
    return results.map((d) => ({
      ...d,
      suratMasukCount: masukMap.get(d.id) || 0,
      suratKeluarCount: keluarMap.get(d.id) || 0,
      totalSurat: (masukMap.get(d.id) || 0) + (keluarMap.get(d.id) || 0)
    }));
  },
  /**
   * Get chronological timeline of all surat in a dosir
   */
  async getTimeline(dosirId) {
    const masukList = await db.select({
      id: suratMasuk.id,
      type: sql9`'masuk'`.as("type"),
      tanggal: suratMasuk.tanggalSurat,
      nomorSurat: suratMasuk.nomorSurat,
      perihal: suratMasuk.perihal,
      dari: suratMasuk.dari,
      kepada: suratMasuk.kepada,
      addedAt: dosirSuratMasuk.addedAt
    }).from(dosirSuratMasuk).innerJoin(suratMasuk, eq14(dosirSuratMasuk.suratMasukId, suratMasuk.id)).where(eq14(dosirSuratMasuk.dosirId, dosirId));
    const keluarList = await db.select({
      id: suratKeluar.id,
      type: sql9`'keluar'`.as("type"),
      tanggal: suratKeluar.tanggalSurat,
      nomorSurat: suratKeluar.nomorSurat,
      perihal: suratKeluar.perihal,
      dari: sql9`'Internal'`.as("dari"),
      kepada: suratKeluar.kepada,
      addedAt: dosirSuratKeluar.addedAt
    }).from(dosirSuratKeluar).innerJoin(suratKeluar, eq14(dosirSuratKeluar.suratKeluarId, suratKeluar.id)).where(eq14(dosirSuratKeluar.dosirId, dosirId));
    const timeline = [...masukList, ...keluarList].sort((a, b) => {
      const dateA = a.tanggal ? new Date(a.tanggal).getTime() : 0;
      const dateB = b.tanggal ? new Date(b.tanggal).getTime() : 0;
      return dateA - dateB;
    });
    return timeline;
  },
  /**
   * Add surat masuk to dosir
   */
  async addSuratMasuk(dosirId, suratMasukId, notes) {
    const [link] = await db.insert(dosirSuratMasuk).values({
      dosirId,
      suratMasukId,
      notes: notes || null
    }).returning();
    return link;
  },
  /**
   * Add surat keluar to dosir
   */
  async addSuratKeluar(dosirId, suratKeluarId, notes) {
    const [link] = await db.insert(dosirSuratKeluar).values({
      dosirId,
      suratKeluarId,
      notes: notes || null
    }).returning();
    return link;
  },
  /**
   * Remove surat masuk from dosir
   */
  async removeSuratMasuk(dosirId, suratMasukId) {
    await db.delete(dosirSuratMasuk).where(
      and12(
        eq14(dosirSuratMasuk.dosirId, dosirId),
        eq14(dosirSuratMasuk.suratMasukId, suratMasukId)
      )
    );
    return { success: true };
  },
  /**
   * Remove surat keluar from dosir
   */
  async removeSuratKeluar(dosirId, suratKeluarId) {
    await db.delete(dosirSuratKeluar).where(
      and12(
        eq14(dosirSuratKeluar.dosirId, dosirId),
        eq14(dosirSuratKeluar.suratKeluarId, suratKeluarId)
      )
    );
    return { success: true };
  },
  /**
   * Get stats for dosir
   */
  async getStats(unitKerjaId) {
    const conditions = unitKerjaId ? eq14(dosir.unitKerjaId, unitKerjaId) : void 0;
    const stats = await db.select({
      status: dosir.status,
      count: sql9`count(*)::int`.as("count")
    }).from(dosir).where(conditions).groupBy(dosir.status);
    const total = stats.reduce((sum, s) => sum + s.count, 0);
    const open = stats.find((s) => s.status === "open")?.count || 0;
    const closed = stats.find((s) => s.status === "closed")?.count || 0;
    const archived = stats.find((s) => s.status === "archived")?.count || 0;
    return { total, open, closed, archived };
  },
  /**
   * Generate next kode for a unit kerja
   */
  async generateKode(unitKerjaId) {
    const year = (/* @__PURE__ */ new Date()).getFullYear();
    const prefix = `${unitKerjaId}-${year}`;
    const existing = await db.select({ kode: dosir.kode }).from(dosir).where(ilike5(dosir.kode, `${prefix}%`)).orderBy(desc9(dosir.kode)).limit(1);
    let nextNumber = 1;
    if (existing.length > 0) {
      const lastKode = existing[0].kode;
      const match = lastKode.match(/-(\d+)$/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }
    return `${prefix}-${nextNumber.toString().padStart(3, "0")}`;
  },
  /**
   * Get dosir IDs that a specific surat belongs to
   */
  async getDosirForSurat(suratId, type) {
    if (type === "masuk") {
      const links = await db.select({ dosir }).from(dosirSuratMasuk).innerJoin(dosir, eq14(dosirSuratMasuk.dosirId, dosir.id)).where(eq14(dosirSuratMasuk.suratMasukId, suratId));
      return links.map((l) => l.dosir);
    } else {
      const links = await db.select({ dosir }).from(dosirSuratKeluar).innerJoin(dosir, eq14(dosirSuratKeluar.dosirId, dosir.id)).where(eq14(dosirSuratKeluar.suratKeluarId, suratId));
      return links.map((l) => l.dosir);
    }
  }
};

// src/routes/dosir.routes.ts
var log16 = createLogger("DosirRoutes");
var router17 = Router17();
router17.use(authMiddleware);
router17.get("/", async (req, res) => {
  try {
    const user = req.user;
    const { status, kategori, search, limit, offset } = req.query;
    const data = await dosirService.getAll({
      unitKerjaId: user?.unitKerjaId,
      status,
      kategori,
      search,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0
    });
    res.json({ success: true, data });
  } catch (error) {
    log16.error({ err: error }, "Error fetching dosir:");
    res.status(500).json({ success: false, error: "Failed to fetch dosir" });
  }
});
router17.get("/stats", async (req, res) => {
  try {
    const user = req.user;
    const stats = await dosirService.getStats(user?.unitKerjaId);
    res.json({ success: true, data: stats });
  } catch (error) {
    log16.error({ err: error }, "Error fetching stats:");
    res.status(500).json({ success: false, error: "Failed to fetch stats" });
  }
});
router17.get("/generate-kode", async (req, res) => {
  try {
    const user = req.user;
    const unitKerjaId = user?.unitKerjaId || "PTEP";
    const kode = await dosirService.generateKode(unitKerjaId);
    res.json({ success: true, data: { kode } });
  } catch (error) {
    log16.error({ err: error }, "Error generating kode:");
    res.status(500).json({ success: false, error: "Failed to generate kode" });
  }
});
router17.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await dosirService.getById(id);
    if (!data) {
      res.status(404).json({ success: false, error: "Dosir not found" });
      return;
    }
    res.json({ success: true, data });
  } catch (error) {
    log16.error({ err: error }, "Error fetching dosir:");
    res.status(500).json({ success: false, error: "Failed to fetch dosir" });
  }
});
router17.get("/:id/timeline", async (req, res) => {
  try {
    const { id } = req.params;
    const timeline = await dosirService.getTimeline(id);
    res.json({ success: true, data: timeline });
  } catch (error) {
    log16.error({ err: error }, "Error fetching timeline:");
    res.status(500).json({ success: false, error: "Failed to fetch timeline" });
  }
});
router17.post("/", validateBody(createDosirSchema), async (req, res) => {
  try {
    const user = req.user;
    const { kode, judul, deskripsi, kategori, tanggalMulai } = req.body;
    if (!judul) {
      res.status(400).json({ success: false, error: "Judul is required" });
      return;
    }
    const unitKerjaId = user?.unitKerjaId || "PTEP";
    const generatedKode = kode || await dosirService.generateKode(unitKerjaId);
    const data = await dosirService.create({
      unitKerjaId,
      kode: generatedKode,
      judul,
      deskripsi,
      kategori,
      tanggalMulai,
      createdBy: user?.id
    });
    await auditLogService.logAction({
      userId: user?.id,
      userEmail: user?.email,
      action: "create",
      entityType: "dosir",
      entityId: data.id,
      changes: { after: data },
      ipAddress: req.ip || req.get("x-forwarded-for") || ""
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    log16.error({ err: error }, "Error creating dosir:");
    res.status(500).json({ success: false, error: "Failed to create dosir" });
  }
});
router17.put("/:id", validateBody(updateDosirSchema), async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const updateData = req.body;
    const before = await dosirService.getById(id);
    const data = await dosirService.update(id, updateData);
    if (!data) {
      res.status(404).json({ success: false, error: "Dosir not found" });
      return;
    }
    await auditLogService.logAction({
      userId: user?.id,
      userEmail: user?.email,
      action: "update",
      entityType: "dosir",
      entityId: id,
      changes: { before: before ?? void 0, after: data },
      ipAddress: req.ip || req.get("x-forwarded-for") || ""
    });
    res.json({ success: true, data });
  } catch (error) {
    log16.error({ err: error }, "Error updating dosir:");
    res.status(500).json({ success: false, error: "Failed to update dosir" });
  }
});
router17.delete("/:id", sensitiveLimiter, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const before = await dosirService.getById(id);
    await dosirService.delete(id);
    await auditLogService.logAction({
      userId: user?.id,
      userEmail: user?.email,
      action: "delete",
      entityType: "dosir",
      entityId: id,
      changes: { before: before ?? void 0 },
      ipAddress: req.ip || req.get("x-forwarded-for") || ""
    });
    res.json({ success: true, message: "Dosir deleted" });
  } catch (error) {
    log16.error({ err: error }, "Error deleting dosir:");
    res.status(500).json({ success: false, error: "Failed to delete dosir" });
  }
});
router17.post("/:id/surat", validateBody(linkSuratToDosirSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { type, suratId, notes } = req.body;
    if (!type || !suratId) {
      res.status(400).json({ success: false, error: "type and suratId required" });
      return;
    }
    let link;
    if (type === "masuk") {
      link = await dosirService.addSuratMasuk(id, suratId, notes);
    } else if (type === "keluar") {
      link = await dosirService.addSuratKeluar(id, suratId, notes);
    } else {
      res.status(400).json({ success: false, error: "Invalid type. Use masuk or keluar" });
      return;
    }
    res.status(201).json({ success: true, data: link });
  } catch (error) {
    if (error.code === "23505") {
      res.status(409).json({ success: false, error: "Surat already linked to this dosir" });
      return;
    }
    log16.error({ err: error }, "Error linking surat:");
    res.status(500).json({ success: false, error: "Failed to link surat" });
  }
});
router17.delete("/:id/surat/:type/:suratId", async (req, res) => {
  try {
    const { id, type, suratId } = req.params;
    if (type === "masuk") {
      await dosirService.removeSuratMasuk(id, suratId);
    } else if (type === "keluar") {
      await dosirService.removeSuratKeluar(id, suratId);
    } else {
      res.status(400).json({ success: false, error: "Invalid type" });
      return;
    }
    res.json({ success: true, message: "Surat removed from dosir" });
  } catch (error) {
    log16.error({ err: error }, "Error unlinking surat:");
    res.status(500).json({ success: false, error: "Failed to unlink surat" });
  }
});
var dosir_routes_default = router17;

// src/routes/retention.routes.ts
import { Router as Router18 } from "express";
var log17 = createLogger("RetentionRoutes");
var router18 = Router18();
router18.use(authMiddleware);
router18.get("/summary", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const summary = await arsipService.getRetentionSummary(unitKerjaId);
    res.json({ success: true, data: summary });
  } catch (error) {
    log17.error({ err: error }, "Error fetching retention summary:");
    res.status(500).json({ error: "Failed to fetch retention summary" });
  }
});
router18.get("/candidates", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { hasilAkhir, status, page, limit } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const result = await arsipService.getDisposalCandidates(
      unitKerjaId,
      {
        hasilAkhir,
        status,
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 20
      }
    );
    res.json({ success: true, ...result });
  } catch (error) {
    log17.error({ err: error }, "Error fetching disposal candidates:");
    res.status(500).json({ error: "Failed to fetch disposal candidates" });
  }
});
router18.post("/disposal-report", async (req, res) => {
  try {
    const unitKerjaId = req.body.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { archiveIds } = req.body;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const reportData = await arsipService.generateDisposalReportData(
      unitKerjaId,
      archiveIds
    );
    res.json({ success: true, data: reportData });
  } catch (error) {
    log17.error({ err: error }, "Error generating disposal report:");
    res.status(500).json({ error: "Failed to generate disposal report" });
  }
});
router18.get("/lifecycle", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const lifecycle = await arsipService.getLifecycleNotifications(unitKerjaId);
    res.json({ success: true, data: lifecycle });
  } catch (error) {
    log17.error({ err: error }, "Error fetching lifecycle notifications:");
    res.status(500).json({ error: "Failed to fetch lifecycle notifications" });
  }
});
var retentionRoutes = router18;

// src/routes/bulk-upload.routes.ts
import { Router as Router19 } from "express";
import multer5 from "multer";

// src/services/ocr.service.ts
import Tesseract from "tesseract.js";
var log18 = createLogger("OcrService");
var pdfjs = null;
async function loadPdfJs() {
  if (!pdfjs) {
    try {
      pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs";
    } catch (e) {
      log18.warn("Failed to load pdfjs-dist legacy build, PDF extraction disabled");
      pdfjs = null;
    }
  }
  return pdfjs;
}
var STOPWORDS2 = /* @__PURE__ */ new Set([
  "yang",
  "dan",
  "di",
  "ke",
  "dari",
  "untuk",
  "dengan",
  "pada",
  "ini",
  "itu",
  "adalah",
  "dalam",
  "akan",
  "atau",
  "sebagai",
  "oleh",
  "bahwa",
  "tersebut",
  "dapat",
  "tidak",
  "juga",
  "kami",
  "anda",
  "saya",
  "mereka",
  "kita",
  "ada",
  "telah",
  "sudah",
  "belum",
  "harus",
  "bisa",
  "lebih",
  "sangat",
  "sesuai",
  "atas",
  "bawah",
  "antara",
  "tentang",
  "kepada",
  "melalui",
  "perihal",
  "hal",
  "nomor",
  "tanggal",
  "tahun",
  "bulan",
  "hari",
  "surat",
  "bersama",
  "demikian",
  "hormat",
  "menteri",
  "direktur",
  "kepala",
  "sekretaris",
  "tempat",
  "yth"
]);
var OCRService = class {
  // Extract text from PDF buffer
  async extractTextFromPDF(buffer) {
    try {
      const pdf = await loadPdfJs();
      if (!pdf) {
        return "[PDF extraction tidak tersedia]";
      }
      const pdfData = new Uint8Array(buffer);
      const pdfDoc = await pdf.getDocument({ data: pdfData }).promise;
      let fullText = "";
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(" ");
        fullText += pageText + "\n";
      }
      return fullText.trim();
    } catch (error) {
      log18.error({ err: error }, "Error extracting text from PDF:");
      throw error;
    }
  }
  // Perform OCR on an image buffer using Tesseract
  async performOCR(imageBuffer) {
    try {
      const { data: { text } } = await Tesseract.recognize(
        imageBuffer,
        "ind+eng",
        // Indonesian + English
        {
          logger: (m) => log18.info(`OCR Progress: ${m.status} - ${Math.round((m.progress || 0) * 100)}%`)
        }
      );
      return text;
    } catch (error) {
      log18.error({ err: error }, "OCR Error:");
      throw error;
    }
  }
  // Extract keywords from text
  extractKeywords(text) {
    const words = text.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 3).filter((word) => !STOPWORDS2.has(word)).filter((word) => !/^\d+$/.test(word));
    const wordFreq = {};
    words.forEach((word) => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    return Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word]) => word);
  }
  // Extract summary from first paragraph
  extractSummary(text) {
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 50);
    if (paragraphs.length === 0) return null;
    let summary = paragraphs[0].trim().replace(/\s+/g, " ");
    if (summary.length > 300) {
      summary = summary.substring(0, 297) + "...";
    }
    return summary;
  }
  // Extract metadata from text using regex patterns
  extractMetadata(text) {
    const normalizedText = text.replace(/\s+/g, " ").trim();
    const nomorPatterns = [
      /(?:Nomor|No\.?)[\s:]+([A-Z0-9][\w.\-\/]+(?:[\s]?[\w.\-\/]+)*)(?=\s*(?:\n|Hal|Perihal|Lampiran|Sifat|$))/i,
      /([A-Z]{1,3}[.\-\/]\d+[.\-\/][A-Z0-9.\-\/]+)/i
    ];
    let nomorSurat = null;
    for (const pattern of nomorPatterns) {
      const match = normalizedText.match(pattern);
      if (match) {
        nomorSurat = match[1].trim();
        break;
      }
    }
    const perihalPatterns = [
      /(?:Perihal|Hal)[\s:]+(.+?)(?:(?=\n|Kepada|Yth)|$)/i,
      /(?:Perihal|Hal)[\s:]+([^\n]+)/i
    ];
    let perihal = null;
    for (const pattern of perihalPatterns) {
      const match = text.match(pattern);
      if (match) {
        perihal = match[1].trim().substring(0, 500);
        break;
      }
    }
    const bulanMap = {
      "januari": "01",
      "februari": "02",
      "maret": "03",
      "april": "04",
      "mei": "05",
      "juni": "06",
      "juli": "07",
      "agustus": "08",
      "september": "09",
      "oktober": "10",
      "november": "11",
      "desember": "12"
    };
    const tanggalPattern = /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i;
    let tanggalSurat = null;
    const tanggalMatch = text.match(tanggalPattern);
    if (tanggalMatch) {
      const day = tanggalMatch[1].padStart(2, "0");
      const month = bulanMap[tanggalMatch[2].toLowerCase()];
      const year = tanggalMatch[3];
      tanggalSurat = `${year}-${month}-${day}`;
    }
    const pengirimPatterns = [
      /(?:Dari|Pengirim)[\s:]+([^\n]+)/i,
      /(?:a\.n\.|atas nama)[\s.]+([^\n,]+)/i,
      /(?:Kepala|Direktur|Kasubdit|Kabid)\s+([^\n,]+)/i
    ];
    let pengirim = null;
    for (const pattern of pengirimPatterns) {
      const match = text.match(pattern);
      if (match) {
        pengirim = match[1].trim().substring(0, 255);
        break;
      }
    }
    const penerimaPatterns = [
      /(?:Kepada\s+)?Yth\.?[\s:]+([^\n]+)/i,
      /Kepada[\s:]+([^\n]+)/i
    ];
    let penerima = null;
    for (const pattern of penerimaPatterns) {
      const match = text.match(pattern);
      if (match) {
        penerima = match[1].trim().substring(0, 500);
        break;
      }
    }
    const tembusan = [];
    const tembusanMatch = text.match(/Tembusan[\s:]+([^]*?)(?=\n\s*\n|\n\d+\.\s+\w+:)/i);
    if (tembusanMatch) {
      const tembusanText = tembusanMatch[1];
      const tembusanItems = tembusanText.split(/[;\n]/);
      tembusanItems.forEach((item) => {
        const cleaned = item.replace(/^\d+[\.\)]?\s*/, "").trim();
        if (cleaned.length > 3 && cleaned.length < 200) {
          tembusan.push(cleaned);
        }
      });
    }
    const lampiranPatterns = [
      /Lampiran[\s:]+(\d+\s*(?:lembar|berkas|set|eks|buah)?[^\n]*)/i,
      /Lamp\.?[\s:]+(\d+\s*(?:lembar|berkas|set|eks|buah)?[^\n]*)/i
    ];
    let lampiran = null;
    for (const pattern of lampiranPatterns) {
      const match = text.match(pattern);
      if (match) {
        lampiran = match[1].trim().substring(0, 255);
        break;
      }
    }
    const sifatPatterns = [
      /Sifat[\s:]+([^\n]+)/i,
      /\b(SANGAT SEGERA|SEGERA|BIASA|PENTING|RAHASIA|TERBATAS)\b/i
    ];
    let sifatSurat = null;
    for (const pattern of sifatPatterns) {
      const match = text.match(pattern);
      if (match) {
        sifatSurat = match[1].trim().toUpperCase().substring(0, 50);
        break;
      }
    }
    const keamananPatterns = [
      /Klasifikasi[\s:]+([^\n]+)/i,
      /\b(RAHASIA|SANGAT RAHASIA|TERBATAS|BIASA)\b/i
    ];
    let klasifikasiKeamanan = null;
    for (const pattern of keamananPatterns) {
      const match = text.match(pattern);
      if (match) {
        klasifikasiKeamanan = match[1].trim().toUpperCase().substring(0, 100);
        break;
      }
    }
    const jenisPatterns = [
      /\b(SURAT DINAS|NOTA DINAS|MEMORANDUM|MEMO|SURAT KEPUTUSAN|SURAT EDARAN|SURAT UNDANGAN|SURAT PERINTAH|INSTRUKSI|SURAT TUGAS|BERITA ACARA)\b/i
    ];
    let jenisSurat = null;
    for (const pattern of jenisPatterns) {
      const match = text.match(pattern);
      if (match) {
        jenisSurat = this.formatJenisSurat(match[1]);
        break;
      }
    }
    const keywords = this.extractKeywords(text);
    const summary = this.extractSummary(text);
    return {
      nomorSurat,
      perihal,
      tanggalSurat,
      pengirim,
      extractedText: text.substring(0, 5e4),
      // Limit stored text
      penerima,
      tembusan: tembusan.slice(0, 10),
      // Max 10 tembusan
      lampiran,
      sifatSurat,
      klasifikasiKeamanan,
      jenisSurat,
      keywords,
      summary
    };
  }
  // Format jenis surat to proper case
  formatJenisSurat(jenis) {
    const formatMap = {
      "surat dinas": "Surat Dinas",
      "nota dinas": "Nota Dinas",
      "memorandum": "Memorandum",
      "memo": "Memorandum",
      "surat keputusan": "Surat Keputusan",
      "surat edaran": "Surat Edaran",
      "surat undangan": "Surat Undangan",
      "surat perintah": "Surat Perintah",
      "instruksi": "Instruksi",
      "surat tugas": "Surat Tugas",
      "berita acara": "Berita Acara"
    };
    return formatMap[jenis.toLowerCase()] || jenis;
  }
  // Process a PDF file - try text extraction first, then OCR if needed
  async processPDF(buffer) {
    try {
      let extractedText = await this.extractTextFromPDF(buffer);
      if (extractedText.length < 50) {
        log18.info("PDF text extraction yielded little text, attempting OCR...");
        extractedText = "[OCR diperlukan untuk dokumen scan - fitur dalam pengembangan]";
      }
      const metadata = this.extractMetadata(extractedText);
      return {
        success: true,
        text: extractedText,
        metadata
      };
    } catch (error) {
      log18.error({ err: error }, "PDF processing error:");
      return {
        success: false,
        text: "",
        metadata: {
          nomorSurat: null,
          perihal: null,
          tanggalSurat: null,
          pengirim: null,
          extractedText: "",
          penerima: null,
          tembusan: [],
          lampiran: null,
          sifatSurat: null,
          klasifikasiKeamanan: null,
          jenisSurat: null,
          keywords: [],
          summary: null
        },
        error: error.message || "Failed to process PDF"
      };
    }
  }
  // Helper method to serialize metadata as JSON for storage
  serializeMetadata(metadata) {
    return JSON.stringify({
      penerima: metadata.penerima,
      tembusan: metadata.tembusan,
      lampiran: metadata.lampiran,
      sifatSurat: metadata.sifatSurat,
      klasifikasiKeamanan: metadata.klasifikasiKeamanan,
      jenisSurat: metadata.jenisSurat,
      keywords: metadata.keywords,
      summary: metadata.summary
    });
  }
  // Helper method to parse serialized metadata
  parseMetadata(jsonString) {
    try {
      return JSON.parse(jsonString);
    } catch {
      return {};
    }
  }
};
var ocrService = new OCRService();

// src/services/bulk-upload.service.ts
import { v4 as uuidv4 } from "uuid";
var log19 = createLogger("BulkUploadService");
var batchStorage = /* @__PURE__ */ new Map();
var BulkUploadService = class {
  MAX_FILES = 50;
  ALLOWED_TYPES = ["application/pdf"];
  // Validate files before processing
  validateFiles(files) {
    const errors = [];
    if (files.length === 0) {
      errors.push("Tidak ada file yang diupload");
    }
    if (files.length > this.MAX_FILES) {
      errors.push(`Maksimum ${this.MAX_FILES} file per upload. Anda mengupload ${files.length} file.`);
    }
    files.forEach((file, index) => {
      if (!this.ALLOWED_TYPES.includes(file.mimeType)) {
        errors.push(`File "${file.fileName}" bukan PDF. Hanya file PDF yang diperbolehkan.`);
      }
    });
    return {
      valid: errors.length === 0,
      errors
    };
  }
  // Create a new batch for tracking
  createBatch(files, unitKerjaId, createdBy) {
    const batchId = uuidv4();
    const items = files.map((file) => ({
      id: uuidv4(),
      fileName: file.fileName,
      status: "pending",
      progress: 0
    }));
    const batch = {
      batchId,
      unitKerjaId,
      createdBy,
      totalFiles: files.length,
      processedFiles: 0,
      items,
      status: "pending",
      createdAt: /* @__PURE__ */ new Date()
    };
    batchStorage.set(batchId, batch);
    return batch;
  }
  // Get batch status
  getBatch(batchId) {
    return batchStorage.get(batchId) || null;
  }
  // Process a batch of files
  async processBatch(batchId, files, folderId) {
    const batch = batchStorage.get(batchId);
    if (!batch) {
      throw new Error("Batch not found");
    }
    batch.status = "processing";
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const item = batch.items[i];
      try {
        item.status = "processing";
        item.progress = 10;
        const ocrResult = await ocrService.processPDF(file.buffer);
        item.progress = 70;
        if (ocrResult.success) {
          item.metadata = ocrResult.metadata;
          item.progress = 100;
          item.status = "completed";
        } else {
          item.error = ocrResult.error;
          item.status = "failed";
        }
      } catch (error) {
        log19.error(`Error processing file ${file.fileName}:`, error);
        item.status = "failed";
        item.error = error.message || "Processing failed";
      }
      batch.processedFiles++;
      batchStorage.set(batchId, batch);
    }
    const completedCount = batch.items.filter((i) => i.status === "completed").length;
    if (completedCount === batch.totalFiles) {
      batch.status = "completed";
    } else if (completedCount > 0) {
      batch.status = "partial";
    } else {
      batch.status = "completed";
    }
    batchStorage.set(batchId, batch);
    return batch;
  }
  // Confirm and save batch items as arsip records
  async confirmBatch(batchId, confirmedItems, files, folderId) {
    const batch = batchStorage.get(batchId);
    if (!batch) {
      throw new Error("Batch not found");
    }
    let created = 0;
    let failed = 0;
    const arsipIds = [];
    for (const confirmedItem of confirmedItems) {
      const batchItem = batch.items.find((i) => i.id === confirmedItem.itemId);
      if (!batchItem || batchItem.status !== "completed") {
        failed++;
        continue;
      }
      try {
        const [newArsip] = await db.insert(arsip).values({
          unitKerjaId: batch.unitKerjaId,
          jenisArsip: confirmedItem.jenisArsip || "masuk",
          tahun: confirmedItem.tahun || (/* @__PURE__ */ new Date()).getFullYear(),
          nomorBerkas: confirmedItem.nomorBerkas || batchItem.metadata?.nomorSurat,
          uraianBerkas: confirmedItem.uraianBerkas || batchItem.metadata?.perihal,
          kodeKlasifikasi: confirmedItem.kodeKlasifikasi,
          tanggalArsip: batchItem.metadata?.tanggalSurat || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
          nomorSuratOriginal: batchItem.metadata?.nomorSurat,
          perihalOriginal: batchItem.metadata?.perihal,
          tanggalSuratOriginal: batchItem.metadata?.tanggalSurat,
          extractedText: batchItem.metadata?.extractedText,
          ocrStatus: "completed",
          ocrProcessedAt: /* @__PURE__ */ new Date(),
          createdBy: batch.createdBy
        }).returning();
        arsipIds.push(newArsip.id);
        batchItem.arsipId = newArsip.id;
        const fileBuffer = files.get(confirmedItem.itemId);
        if (fileBuffer) {
          await fileAttachmentService.create({
            suratId: newArsip.id,
            suratType: "arsip",
            fileName: batchItem.fileName,
            mimeType: "application/pdf",
            buffer: fileBuffer,
            folderId
          });
        }
        created++;
      } catch (error) {
        log19.error(`Error saving arsip for ${batchItem.fileName}:`, error);
        batchItem.error = error.message;
        failed++;
      }
    }
    batchStorage.set(batchId, batch);
    return { created, failed, arsipIds };
  }
  // Clean up old batches (call periodically)
  cleanupOldBatches(maxAgeMs = 36e5) {
    const now = Date.now();
    for (const [batchId, batch] of batchStorage.entries()) {
      if (now - batch.createdAt.getTime() > maxAgeMs) {
        batchStorage.delete(batchId);
      }
    }
  }
};
var bulkUploadService = new BulkUploadService();

// src/routes/bulk-upload.routes.ts
var log20 = createLogger("BulkUploadRoutes");
var router19 = Router19();
var upload5 = multer5({
  storage: multer5.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    // 50MB per file
    files: 50
    // Max 50 files
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Hanya file PDF yang diperbolehkan"));
    }
  }
});
router19.post(
  "/",
  authMiddleware,
  uploadLimiter,
  upload5.array("files", 50),
  async (req, res) => {
    try {
      const { unitKerjaId, folderId } = req.body;
      const files = req.files;
      if (!unitKerjaId) {
        return res.status(400).json({
          success: false,
          error: "unitKerjaId diperlukan"
        });
      }
      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Tidak ada file yang diupload"
        });
      }
      const uploadFiles = files.map((f) => ({
        fileName: f.originalname,
        mimeType: f.mimetype,
        buffer: f.buffer
      }));
      const validation = bulkUploadService.validateFiles(uploadFiles);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          errors: validation.errors
        });
      }
      const userId = req.user?.id || "unknown";
      const batch = bulkUploadService.createBatch(uploadFiles, unitKerjaId, userId);
      bulkUploadService.processBatch(batch.batchId, uploadFiles, folderId).catch((error) => {
        log20.error({ err: error }, "Batch processing error:");
      });
      res.json({
        success: true,
        data: {
          batchId: batch.batchId,
          totalFiles: batch.totalFiles,
          status: batch.status,
          message: "Upload dimulai. Gunakan GET /api/bulk-upload/:batchId untuk memonitor status."
        }
      });
    } catch (error) {
      log20.error({ err: error }, "Bulk upload error:");
      res.status(500).json({
        success: false,
        error: error.message || "Upload gagal"
      });
    }
  }
);
router19.get("/:batchId", authMiddleware, async (req, res) => {
  try {
    const { batchId } = req.params;
    const batch = bulkUploadService.getBatch(batchId);
    if (!batch) {
      return res.status(404).json({
        success: false,
        error: "Batch tidak ditemukan"
      });
    }
    res.json({
      success: true,
      data: batch
    });
  } catch (error) {
    log20.error({ err: error }, "Get batch error:");
    res.status(500).json({
      success: false,
      error: error.message || "Gagal mengambil status batch"
    });
  }
});
router19.post("/:batchId/confirm", authMiddleware, async (req, res) => {
  try {
    const { batchId } = req.params;
    const { items, folderId } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        error: "Items array diperlukan"
      });
    }
    const filesMap = /* @__PURE__ */ new Map();
    const result = await bulkUploadService.confirmBatch(
      batchId,
      items,
      filesMap,
      folderId
    );
    res.json({
      success: true,
      data: result,
      message: `${result.created} arsip berhasil disimpan, ${result.failed} gagal`
    });
  } catch (error) {
    log20.error({ err: error }, "Confirm batch error:");
    res.status(500).json({
      success: false,
      error: error.message || "Gagal menyimpan arsip"
    });
  }
});
var bulk_upload_routes_default = router19;

// src/routes/distribution.routes.ts
import { Router as Router20 } from "express";

// src/services/distribution.service.ts
import { eq as eq15, and as and13, desc as desc10, sql as sql10 } from "drizzle-orm";
var DistributionService = class {
  /**
   * Create a new distribution (send surat from Ditjen to target unit)
   */
  async distribute(data) {
    const [existing] = await db.select().from(suratDistributions).where(and13(
      eq15(suratDistributions.suratMasukId, data.suratMasukId),
      eq15(suratDistributions.targetUnitId, data.targetUnitId)
    )).limit(1);
    if (existing) {
      throw new Error("Surat sudah didistribusikan ke unit ini");
    }
    const [result] = await db.insert(suratDistributions).values({
      suratMasukId: data.suratMasukId,
      sourceUnitId: data.sourceUnitId,
      targetUnitId: data.targetUnitId,
      instruction: data.instruction,
      ccUnits: data.ccUnits ? JSON.stringify(data.ccUnits) : null,
      sentBy: data.sentBy,
      status: "sent",
      sentAt: /* @__PURE__ */ new Date()
    }).returning();
    return result;
  }
  /**
   * Get inbox (incoming distributions for a unit)
   */
  async findInbox(unitKerjaId, filters = {}) {
    const { status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [eq15(suratDistributions.targetUnitId, unitKerjaId)];
    if (status) {
      conditions.push(eq15(suratDistributions.status, status));
    }
    const [{ count: count5 }] = await db.select({ count: sql10`count(*)::int` }).from(suratDistributions).where(and13(...conditions));
    const data = await db.select({
      distribution: suratDistributions,
      surat: {
        id: suratMasuk.id,
        nomorSurat: suratMasuk.nomorSurat,
        perihal: suratMasuk.perihal,
        dari: suratMasuk.dari,
        tanggalSurat: suratMasuk.tanggalSurat,
        sifatSurat: suratMasuk.sifatSurat
      },
      sourceUnit: {
        id: unitKerja.id,
        name: unitKerja.name
      }
    }).from(suratDistributions).innerJoin(suratMasuk, eq15(suratDistributions.suratMasukId, suratMasuk.id)).innerJoin(unitKerja, eq15(suratDistributions.sourceUnitId, unitKerja.id)).where(and13(...conditions)).orderBy(desc10(suratDistributions.sentAt)).limit(limit).offset(offset);
    return {
      data: data.map((d) => ({
        ...d.distribution,
        surat: d.surat,
        sourceUnit: d.sourceUnit
      })),
      pagination: {
        page,
        limit,
        total: count5,
        totalPages: Math.ceil(count5 / limit)
      }
    };
  }
  /**
   * Get outbox (sent distributions from a unit)
   */
  async findOutbox(unitKerjaId, filters = {}) {
    const { status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [eq15(suratDistributions.sourceUnitId, unitKerjaId)];
    if (status) {
      conditions.push(eq15(suratDistributions.status, status));
    }
    const [{ count: count5 }] = await db.select({ count: sql10`count(*)::int` }).from(suratDistributions).where(and13(...conditions));
    const data = await db.select({
      distribution: suratDistributions,
      surat: {
        id: suratMasuk.id,
        nomorSurat: suratMasuk.nomorSurat,
        perihal: suratMasuk.perihal,
        dari: suratMasuk.dari,
        tanggalSurat: suratMasuk.tanggalSurat
      },
      targetUnit: {
        id: unitKerja.id,
        name: unitKerja.name
      }
    }).from(suratDistributions).innerJoin(suratMasuk, eq15(suratDistributions.suratMasukId, suratMasuk.id)).innerJoin(unitKerja, eq15(suratDistributions.targetUnitId, unitKerja.id)).where(and13(...conditions)).orderBy(desc10(suratDistributions.sentAt)).limit(limit).offset(offset);
    return {
      data: data.map((d) => ({
        ...d.distribution,
        surat: d.surat,
        targetUnit: d.targetUnit
      })),
      pagination: {
        page,
        limit,
        total: count5,
        totalPages: Math.ceil(count5 / limit)
      }
    };
  }
  /**
   * Mark distribution as received by target unit
   */
  async receive(distributionId, receivedBy) {
    const [distribution] = await db.select().from(suratDistributions).where(eq15(suratDistributions.id, distributionId)).limit(1);
    if (!distribution) {
      throw new Error("Distribution not found");
    }
    if (distribution.status !== "sent") {
      throw new Error("Distribution sudah diterima atau diproses");
    }
    const [result] = await db.update(suratDistributions).set({
      status: "received",
      receivedAt: /* @__PURE__ */ new Date(),
      receivedBy,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq15(suratDistributions.id, distributionId)).returning();
    return result;
  }
  /**
   * Mark distribution as processed/completed
   */
  async process(distributionId) {
    const [distribution] = await db.select().from(suratDistributions).where(eq15(suratDistributions.id, distributionId)).limit(1);
    if (!distribution) {
      throw new Error("Distribution not found");
    }
    if (distribution.status === "processed") {
      throw new Error("Distribution sudah selesai diproses");
    }
    const [result] = await db.update(suratDistributions).set({
      status: "processed",
      processedAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq15(suratDistributions.id, distributionId)).returning();
    return result;
  }
  /**
   * Reject distribution (return to sender)
   */
  async reject(distributionId, reason) {
    const [distribution] = await db.select().from(suratDistributions).where(eq15(suratDistributions.id, distributionId)).limit(1);
    if (!distribution) {
      throw new Error("Distribution not found");
    }
    if (distribution.status === "processed" || distribution.status === "rejected") {
      throw new Error("Distribution tidak bisa ditolak");
    }
    const [result] = await db.update(suratDistributions).set({
      status: "rejected",
      rejectionReason: reason,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq15(suratDistributions.id, distributionId)).returning();
    return result;
  }
  /**
   * Get distribution by ID with full details
   */
  async findById(id) {
    const [result] = await db.select({
      distribution: suratDistributions,
      surat: suratMasuk
    }).from(suratDistributions).innerJoin(suratMasuk, eq15(suratDistributions.suratMasukId, suratMasuk.id)).where(eq15(suratDistributions.id, id)).limit(1);
    return result ? { ...result.distribution, surat: result.surat } : null;
  }
  /**
   * Get statistics for dashboard
   */
  async getStats(unitKerjaId) {
    const inboxStats = await db.select({
      total: sql10`count(*)::int`,
      pending: sql10`count(*) filter (where ${suratDistributions.status} = 'sent')::int`,
      received: sql10`count(*) filter (where ${suratDistributions.status} = 'received')::int`,
      processed: sql10`count(*) filter (where ${suratDistributions.status} = 'processed')::int`,
      rejected: sql10`count(*) filter (where ${suratDistributions.status} = 'rejected')::int`
    }).from(suratDistributions).where(eq15(suratDistributions.targetUnitId, unitKerjaId));
    const outboxStats = await db.select({
      total: sql10`count(*)::int`,
      pending: sql10`count(*) filter (where ${suratDistributions.status} = 'sent')::int`,
      processed: sql10`count(*) filter (where ${suratDistributions.status} = 'processed')::int`,
      rejected: sql10`count(*) filter (where ${suratDistributions.status} = 'rejected')::int`
    }).from(suratDistributions).where(eq15(suratDistributions.sourceUnitId, unitKerjaId));
    return {
      inbox: inboxStats[0],
      outbox: outboxStats[0]
    };
  }
  /**
   * Get distributable units (units that can receive distributions)
   */
  async getDistributableUnits(excludeUnitId) {
    const conditions = [eq15(unitKerja.canReceiveDistribution, true)];
    if (excludeUnitId) {
      conditions.push(sql10`${unitKerja.id} != ${excludeUnitId}`);
    }
    const units = await db.select({
      id: unitKerja.id,
      name: unitKerja.name,
      unitType: unitKerja.unitType
    }).from(unitKerja).where(and13(...conditions)).orderBy(unitKerja.name);
    return units;
  }
  /**
   * Check if surat is already distributed
   */
  async isDistributed(suratMasukId) {
    const [result] = await db.select({ count: sql10`count(*)::int` }).from(suratDistributions).where(eq15(suratDistributions.suratMasukId, suratMasukId));
    return result.count > 0;
  }
  /**
   * Get distribution history for a surat
   */
  async getHistoryBySurat(suratMasukId) {
    return await db.select({
      distribution: suratDistributions,
      targetUnit: {
        id: unitKerja.id,
        name: unitKerja.name
      }
    }).from(suratDistributions).innerJoin(unitKerja, eq15(suratDistributions.targetUnitId, unitKerja.id)).where(eq15(suratDistributions.suratMasukId, suratMasukId)).orderBy(desc10(suratDistributions.sentAt));
  }
};
var distributionService = new DistributionService();

// src/routes/distribution.routes.ts
var router20 = Router20();
var getIpAddress3 = (req) => {
  const ip = req.ip;
  return Array.isArray(ip) ? ip[0] : ip;
};
router20.use(authMiddleware);
router20.get("/units", async (req, res, next) => {
  try {
    const { excludeUnitId } = req.query;
    const units = await distributionService.getDistributableUnits(excludeUnitId);
    res.json({ success: true, data: units });
  } catch (error) {
    next(error);
  }
});
router20.get("/inbox", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { status, page, limit } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const result = await distributionService.findInbox(unitKerjaId, {
      status,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router20.get("/outbox", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { status, page, limit } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const result = await distributionService.findOutbox(unitKerjaId, {
      status,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router20.get("/stats", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const stats = await distributionService.getStats(unitKerjaId);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});
router20.get("/surat/:suratId", async (req, res, next) => {
  try {
    const suratId = req.params.suratId;
    const history = await distributionService.getHistoryBySurat(suratId);
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
});
router20.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await distributionService.findById(id);
    if (!result) {
      return res.status(404).json({ error: "Distribution not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router20.post("/", canWriteMiddleware(), validateBody(createDistributionSchema), async (req, res, next) => {
  try {
    const { suratMasukId, sourceUnitId, targetUnitId, instruction, ccUnits } = req.body;
    if (!suratMasukId || !sourceUnitId || !targetUnitId) {
      return res.status(400).json({ error: "suratMasukId, sourceUnitId, and targetUnitId are required" });
    }
    const result = await distributionService.distribute({
      suratMasukId,
      sourceUnitId,
      targetUnitId,
      instruction,
      ccUnits,
      sentBy: req.user?.id
    });
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "distribute",
      entityType: "surat_distribution",
      entityId: result.id,
      changes: { after: { targetUnitId, instruction } },
      ipAddress: getIpAddress3(req)
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("sudah didistribusikan")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router20.put("/:id/receive", canWriteMiddleware(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await distributionService.receive(id, req.user?.id || "");
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "receive_distribution",
      entityType: "surat_distribution",
      entityId: id,
      changes: { after: { status: "received" } },
      ipAddress: getIpAddress3(req)
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("not found") || error.message.includes("sudah")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router20.put("/:id/process", canWriteMiddleware(), async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await distributionService.process(id);
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "process_distribution",
      entityType: "surat_distribution",
      entityId: id,
      changes: { after: { status: "processed" } },
      ipAddress: getIpAddress3(req)
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("not found") || error.message.includes("sudah")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router20.put("/:id/reject", canWriteMiddleware(), validateBody(rejectDistributionSchema), async (req, res, next) => {
  try {
    const id = req.params.id;
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ error: "Alasan penolakan wajib diisi" });
    }
    const result = await distributionService.reject(id, reason);
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "reject_distribution",
      entityType: "surat_distribution",
      entityId: id,
      changes: { after: { status: "rejected", reason } },
      ipAddress: getIpAddress3(req)
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message.includes("not found") || error.message.includes("tidak bisa")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
var distribution_routes_default = router20;

// src/routes/report.routes.ts
import { Router as Router21 } from "express";

// src/services/report.service.ts
import { eq as eq16, and as and14, desc as desc11, sql as sql11, gte as gte6, lte as lte7 } from "drizzle-orm";
var ReportService = class {
  // ==================== SURAT MASUK REPORTS ====================
  async getSuratMasukReport(filters) {
    const { unitKerjaId, year, tanggalDari, tanggalSampai, page = 1, limit = 50 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [eq16(suratMasuk.unitKerjaId, unitKerjaId)];
    if (tanggalDari) {
      conditions.push(gte6(suratMasuk.tanggalSurat, tanggalDari));
    }
    if (tanggalSampai) {
      conditions.push(lte7(suratMasuk.tanggalSurat, tanggalSampai));
    }
    if (year && !tanggalDari && !tanggalSampai) {
      conditions.push(eq16(suratMasuk.tahun, year));
    }
    const countResult = await db.select({ count: sql11`count(*)::int` }).from(suratMasuk).where(and14(...conditions));
    const total = countResult?.[0]?.count ?? 0;
    const data = await db.select({
      id: suratMasuk.id,
      noUrut: suratMasuk.noUrut,
      nomorSurat: suratMasuk.nomorSurat,
      tanggalSurat: suratMasuk.tanggalSurat,
      dari: suratMasuk.dari,
      kepada: suratMasuk.kepada,
      perihal: suratMasuk.perihal,
      jenisSurat: suratMasuk.jenisSurat,
      sifatSurat: suratMasuk.sifatSurat,
      status: suratMasuk.status,
      isArchived: suratMasuk.isArchived,
      createdAt: suratMasuk.createdAt
    }).from(suratMasuk).where(and14(...conditions)).orderBy(desc11(suratMasuk.tanggalSurat)).limit(limit).offset(offset);
    const stats = await this.getSuratMasukStats(unitKerjaId, year);
    return {
      data,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }
  async getSuratMasukStats(unitKerjaId, year) {
    const currentYear = year || (/* @__PURE__ */ new Date()).getFullYear();
    const conditions = [
      eq16(suratMasuk.unitKerjaId, unitKerjaId),
      eq16(suratMasuk.tahun, currentYear)
    ];
    const stats = await db.select({
      total: sql11`count(*)::int`,
      belumDibalas: sql11`count(*) filter (where ${suratMasuk.status} = 'belum_dibalas')::int`,
      sudahDibalas: sql11`count(*) filter (where ${suratMasuk.status} = 'sudah_dibalas')::int`,
      diarsipkan: sql11`count(*) filter (where ${suratMasuk.isArchived} = true)::int`
    }).from(suratMasuk).where(and14(...conditions));
    const monthlyBreakdown = await db.select({
      month: sql11`extract(month from ${suratMasuk.tanggalSurat})::int`,
      count: sql11`count(*)::int`
    }).from(suratMasuk).where(and14(...conditions)).groupBy(sql11`extract(month from ${suratMasuk.tanggalSurat})`).orderBy(sql11`extract(month from ${suratMasuk.tanggalSurat})`);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const monthlyData = monthNames.map((name, index) => {
      const found = monthlyBreakdown.find((m) => m.month === index + 1);
      return { month: name, count: found?.count || 0 };
    });
    return {
      summary: stats[0] || { total: 0, belumDibalas: 0, sudahDibalas: 0, diarsipkan: 0 },
      monthly: monthlyData
    };
  }
  // ==================== SURAT KELUAR REPORTS ====================
  async getSuratKeluarReport(filters) {
    const { unitKerjaId, year, tanggalDari, tanggalSampai, page = 1, limit = 50 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [eq16(suratKeluar.unitKerjaId, unitKerjaId)];
    if (tanggalDari) {
      conditions.push(gte6(suratKeluar.tanggalSurat, tanggalDari));
    }
    if (tanggalSampai) {
      conditions.push(lte7(suratKeluar.tanggalSurat, tanggalSampai));
    }
    if (year && !tanggalDari && !tanggalSampai) {
      conditions.push(eq16(suratKeluar.tahun, year));
    }
    const countResult = await db.select({ count: sql11`count(*)::int` }).from(suratKeluar).where(and14(...conditions));
    const total = countResult?.[0]?.count ?? 0;
    const data = await db.select({
      id: suratKeluar.id,
      noUrut: suratKeluar.noUrut,
      nomorSurat: suratKeluar.nomorSurat,
      tanggalSurat: suratKeluar.tanggalSurat,
      kepada: suratKeluar.kepada,
      perihal: suratKeluar.perihal,
      naskahDinas: suratKeluar.naskahDinas,
      isArchived: suratKeluar.isArchived,
      createdAt: suratKeluar.createdAt
    }).from(suratKeluar).where(and14(...conditions)).orderBy(desc11(suratKeluar.tanggalSurat)).limit(limit).offset(offset);
    const stats = await this.getSuratKeluarStats(unitKerjaId, year);
    return {
      data,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }
  async getSuratKeluarStats(unitKerjaId, year) {
    const currentYear = year || (/* @__PURE__ */ new Date()).getFullYear();
    const conditions = [
      eq16(suratKeluar.unitKerjaId, unitKerjaId),
      eq16(suratKeluar.tahun, currentYear)
    ];
    const stats = await db.select({
      total: sql11`count(*)::int`,
      diarsipkan: sql11`count(*) filter (where ${suratKeluar.isArchived} = true)::int`
    }).from(suratKeluar).where(and14(...conditions));
    const monthlyBreakdown = await db.select({
      month: sql11`extract(month from ${suratKeluar.tanggalSurat})::int`,
      count: sql11`count(*)::int`
    }).from(suratKeluar).where(and14(...conditions)).groupBy(sql11`extract(month from ${suratKeluar.tanggalSurat})`).orderBy(sql11`extract(month from ${suratKeluar.tanggalSurat})`);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const monthlyData = monthNames.map((name, index) => {
      const found = monthlyBreakdown.find((m) => m.month === index + 1);
      return { month: name, count: found?.count || 0 };
    });
    return {
      summary: stats[0] || { total: 0, diarsipkan: 0 },
      monthly: monthlyData
    };
  }
  // ==================== ARSIP REPORTS ====================
  async getArsipReport(filters) {
    const { unitKerjaId, type = "all", mediaType, daysAhead = 30, year, page = 1, limit = 50 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [eq16(arsip.unitKerjaId, unitKerjaId)];
    const now = /* @__PURE__ */ new Date();
    const futureDate = /* @__PURE__ */ new Date();
    futureDate.setDate(now.getDate() + daysAhead);
    if (type === "expiring") {
      conditions.push(gte6(arsip.tanggalKadaluarsa, now.toISOString().split("T")[0]));
      conditions.push(lte7(arsip.tanggalKadaluarsa, futureDate.toISOString().split("T")[0]));
    } else if (type === "permanent") {
      conditions.push(eq16(arsip.retensiInaktif, "Permanen"));
    } else if (type === "destroyed") {
      conditions.push(eq16(arsip.hasilAkhir, "Musnah"));
    }
    if (mediaType && mediaType !== "all") {
      conditions.push(eq16(arsip.mediaType, mediaType));
    }
    if (year) {
      conditions.push(eq16(arsip.tahun, year));
    }
    const countResult = await db.select({ count: sql11`count(*)::int` }).from(arsip).where(and14(...conditions));
    const total = countResult?.[0]?.count ?? 0;
    const data = await db.select({
      id: arsip.id,
      kodeKlasifikasi: arsip.kodeKlasifikasi,
      jenisArsip: arsip.jenisArsip,
      mediaType: arsip.mediaType,
      nomorBerkas: arsip.nomorBerkas,
      uraianBerkas: arsip.uraianBerkas,
      tanggalArsip: arsip.tanggalArsip,
      tahun: arsip.tahun,
      retensiAktif: arsip.retensiAktif,
      retensiInaktif: arsip.retensiInaktif,
      tanggalKadaluarsa: arsip.tanggalKadaluarsa,
      hasilAkhir: arsip.hasilAkhir,
      createdAt: arsip.createdAt
    }).from(arsip).where(and14(...conditions)).orderBy(desc11(arsip.createdAt)).limit(limit).offset(offset);
    const stats = await this.getArsipStats(unitKerjaId, year);
    return {
      data,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }
  async getArsipStats(unitKerjaId, year) {
    const conditions = [eq16(arsip.unitKerjaId, unitKerjaId)];
    if (year) {
      conditions.push(eq16(arsip.tahun, year));
    }
    const now = /* @__PURE__ */ new Date();
    const next30Days = /* @__PURE__ */ new Date();
    next30Days.setDate(now.getDate() + 30);
    const stats = await db.select({
      total: sql11`count(*)::int`,
      masuk: sql11`count(*) filter (where ${arsip.jenisArsip} = 'masuk')::int`,
      keluar: sql11`count(*) filter (where ${arsip.jenisArsip} = 'keluar')::int`,
      permanen: sql11`count(*) filter (where ${arsip.retensiInaktif} = 'Permanen')::int`
    }).from(arsip).where(and14(...conditions));
    const byClassification = await db.select({
      kode: arsip.kodeKlasifikasi,
      count: sql11`count(*)::int`
    }).from(arsip).where(and14(...conditions)).groupBy(arsip.kodeKlasifikasi).orderBy(desc11(sql11`count(*)`)).limit(10);
    const byMediaType = await db.select({
      mediaType: arsip.mediaType,
      count: sql11`count(*)::int`
    }).from(arsip).where(and14(...conditions)).groupBy(arsip.mediaType).orderBy(desc11(sql11`count(*)`));
    return {
      summary: stats[0] || { total: 0, masuk: 0, keluar: 0, permanen: 0 },
      byClassification,
      byMediaType
    };
  }
  // ==================== LENDING REPORTS ====================
  async getLendingReport(filters) {
    const { status = "all", tanggalDari, tanggalSampai, page = 1, limit = 50 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (status !== "all") {
      conditions.push(eq16(archiveLending.status, status));
    }
    if (tanggalDari) {
      conditions.push(gte6(archiveLending.borrowDate, tanggalDari));
    }
    if (tanggalSampai) {
      conditions.push(lte7(archiveLending.borrowDate, tanggalSampai));
    }
    const whereClause = conditions.length > 0 ? and14(...conditions) : void 0;
    const countResult = await db.select({ count: sql11`count(*)::int` }).from(archiveLending).where(whereClause);
    const total = countResult?.[0]?.count ?? 0;
    const data = await db.select({
      id: archiveLending.id,
      lendingType: archiveLending.lendingType,
      borrowerName: archiveLending.borrowerName,
      departmentUnit: archiveLending.departmentUnit,
      borrowDate: archiveLending.borrowDate,
      dueDate: archiveLending.dueDate,
      returnDate: archiveLending.returnDate,
      status: archiveLending.status,
      purpose: archiveLending.purpose
    }).from(archiveLending).where(whereClause).orderBy(desc11(archiveLending.borrowDate)).limit(limit).offset(offset);
    const stats = await this.getLendingStats();
    return {
      data,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }
  async getLendingStats() {
    const now = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const stats = await db.select({
      total: sql11`count(*)::int`,
      borrowed: sql11`count(*) filter (where ${archiveLending.status} = 'borrowed')::int`,
      returned: sql11`count(*) filter (where ${archiveLending.status} = 'returned')::int`,
      overdue: sql11`count(*) filter (where ${archiveLending.status} = 'borrowed' and ${archiveLending.dueDate} < ${now})::int`
    }).from(archiveLending);
    const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
    const monthlyLending = await db.select({
      month: sql11`extract(month from ${archiveLending.borrowDate})::int`,
      count: sql11`count(*)::int`
    }).from(archiveLending).where(sql11`extract(year from ${archiveLending.borrowDate}) = ${currentYear}`).groupBy(sql11`extract(month from ${archiveLending.borrowDate})`).orderBy(sql11`extract(month from ${archiveLending.borrowDate})`);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const monthlyData = monthNames.map((name, index) => {
      const found = monthlyLending.find((m) => m.month === index + 1);
      return { month: name, count: found?.count || 0 };
    });
    return {
      summary: stats[0] || { total: 0, borrowed: 0, returned: 0, overdue: 0 },
      monthly: monthlyData
    };
  }
  // ==================== SUMMARY REPORTS ====================
  async getSummaryReport(unitKerjaId, year) {
    const currentYear = year || (/* @__PURE__ */ new Date()).getFullYear();
    const suratMasukStats = await this.getSuratMasukStats(unitKerjaId, currentYear);
    const suratKeluarStats = await this.getSuratKeluarStats(unitKerjaId, currentYear);
    const arsipStats = await this.getArsipStats(unitKerjaId, currentYear);
    const lendingStats = await this.getLendingStats();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const combinedMonthly = monthNames.map((month, index) => ({
      month,
      masuk: suratMasukStats.monthly[index]?.count || 0,
      keluar: suratKeluarStats.monthly[index]?.count || 0
    }));
    return {
      year: currentYear,
      suratMasuk: suratMasukStats.summary,
      suratKeluar: suratKeluarStats.summary,
      arsip: arsipStats.summary,
      peminjaman: lendingStats.summary,
      monthlyTrend: combinedMonthly
    };
  }
};
var reportService = new ReportService();

// src/routes/report.routes.ts
var log21 = createLogger("ReportRoutes");
var router21 = Router21();
router21.use(authMiddleware);
router21.get("/surat-masuk", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { year, month, tanggalDari, tanggalSampai, period, page, limit } = req.query;
    if (!unitKerjaId) {
      res.status(400).json({ error: "unitKerjaId is required" });
      return;
    }
    const filters = {
      unitKerjaId,
      year: year ? parseInt(year) : void 0,
      month: month ? parseInt(month) : void 0,
      tanggalDari,
      tanggalSampai,
      period,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50
    };
    const report = await reportService.getSuratMasukReport(filters);
    res.json(report);
  } catch (error) {
    log21.error({ err: error }, "Error getting surat masuk report:");
    res.status(500).json({ error: "Failed to generate report" });
  }
});
router21.get("/surat-keluar", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { year, tanggalDari, tanggalSampai, period, page, limit } = req.query;
    if (!unitKerjaId) {
      res.status(400).json({ error: "unitKerjaId is required" });
      return;
    }
    const filters = {
      unitKerjaId,
      year: year ? parseInt(year) : void 0,
      tanggalDari,
      tanggalSampai,
      period,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50
    };
    const report = await reportService.getSuratKeluarReport(filters);
    res.json(report);
  } catch (error) {
    log21.error({ err: error }, "Error getting surat keluar report:");
    res.status(500).json({ error: "Failed to generate report" });
  }
});
router21.get("/arsip", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { type, mediaType, daysAhead, year, page, limit } = req.query;
    if (!unitKerjaId) {
      res.status(400).json({ error: "unitKerjaId is required" });
      return;
    }
    const filters = {
      unitKerjaId,
      type: type || "all",
      mediaType,
      daysAhead: daysAhead ? parseInt(daysAhead) : 30,
      year: year ? parseInt(year) : void 0,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50
    };
    const report = await reportService.getArsipReport(filters);
    res.json(report);
  } catch (error) {
    log21.error({ err: error }, "Error getting arsip report:");
    res.status(500).json({ error: "Failed to generate report" });
  }
});
router21.get("/lending", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { status, tanggalDari, tanggalSampai, page, limit } = req.query;
    const filters = {
      unitKerjaId: unitKerjaId || void 0,
      status: status || "all",
      tanggalDari,
      tanggalSampai,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50
    };
    const report = await reportService.getLendingReport(filters);
    res.json(report);
  } catch (error) {
    log21.error({ err: error }, "Error getting lending report:");
    res.status(500).json({ error: "Failed to generate report" });
  }
});
router21.get("/summary", async (req, res) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { year } = req.query;
    if (!unitKerjaId) {
      res.status(400).json({ error: "unitKerjaId is required" });
      return;
    }
    const report = await reportService.getSummaryReport(
      unitKerjaId,
      year ? parseInt(year) : void 0
    );
    res.json(report);
  } catch (error) {
    log21.error({ err: error }, "Error getting summary report:");
    res.status(500).json({ error: "Failed to generate report" });
  }
});
router21.get("/export/:type/:format", async (req, res) => {
  try {
    const { type, format } = req.params;
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { year, tanggalDari, tanggalSampai, arsipType, mediaType } = req.query;
    if (!unitKerjaId) {
      res.status(400).json({ error: "unitKerjaId is required" });
      return;
    }
    let buffer;
    const filename = `laporan-${type}-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}`;
    const filters = {
      unitKerjaId,
      tahun: year ? parseInt(year) : void 0,
      tanggalDari,
      tanggalSampai
    };
    if (type === "surat-masuk") {
      if (format === "excel") {
        buffer = await exportService.generateExcelSuratMasuk(filters);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      } else {
        buffer = await exportService.generatePdfSuratMasuk(filters);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      }
    } else if (type === "surat-keluar") {
      if (format === "excel") {
        buffer = await exportService.generateExcelSuratKeluar(filters);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      } else {
        buffer = await exportService.generatePdfSuratKeluar(filters);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      }
    } else if (type === "arsip") {
      filters.jenisArsip = arsipType;
      filters.mediaType = mediaType;
      if (format === "excel") {
        buffer = await exportService.generateExcelArsip(filters);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      } else {
        buffer = await exportService.generatePdfArsip(filters);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      }
    } else {
      res.status(400).json({ error: "Invalid report type" });
      return;
    }
    res.send(buffer);
  } catch (error) {
    log21.error({ err: error }, "Error exporting report:");
    res.status(500).json({ error: "Failed to export report" });
  }
});
var reportRoutes = router21;

// src/routes/settings.routes.ts
import { Router as Router22 } from "express";

// src/services/settings.service.ts
import { eq as eq17 } from "drizzle-orm";
var SettingsService = class {
  // ==================== PROFILE SETTINGS ====================
  async getProfile(userId) {
    const [user] = await db.select().from(users).where(eq17(users.id, userId)).limit(1);
    return user || null;
  }
  async updateProfile(userId, data) {
    const [updated] = await db.update(users).set({
      ...data,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq17(users.id, userId)).returning();
    return updated || null;
  }
  // ==================== UNIT KERJA SETTINGS ====================
  async getUnitKerjaSettings(unitKerjaId) {
    const [unit] = await db.select().from(unitKerja).where(eq17(unitKerja.id, unitKerjaId)).limit(1);
    return unit || null;
  }
  async getAllUnitKerja() {
    const units = await db.select().from(unitKerja).orderBy(unitKerja.name);
    return units;
  }
  async updateUnitKerja(unitKerjaId, data) {
    const [updated] = await db.update(unitKerja).set({
      ...data,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq17(unitKerja.id, unitKerjaId)).returning();
    return updated || null;
  }
  async createUnitKerja(data) {
    const [created] = await db.insert(unitKerja).values(data).returning();
    return created;
  }
  // ==================== SURAT TEMPLATES ====================
  // Note: Templates are stored as a simple JSON config
  // In a full implementation, this could be a separate table
  suratTemplates = /* @__PURE__ */ new Map();
  async getSuratTemplates(unitKerjaId) {
    const defaultTemplate = {
      unitKerjaId,
      masukFormat: "{noUrut}/SM/{tahun}",
      keluarFormat: "{noUrut}/{naskahDinas}/{bulan}/{tahun}"
    };
    return this.suratTemplates.get(unitKerjaId) || defaultTemplate;
  }
  async updateSuratTemplates(unitKerjaId, templates) {
    const existing = await this.getSuratTemplates(unitKerjaId);
    const updated = { ...existing, ...templates, unitKerjaId };
    this.suratTemplates.set(unitKerjaId, updated);
    return updated;
  }
  // Generate surat number based on template
  generateSuratNumber(template, data) {
    let result = template;
    result = result.replace("{noUrut}", String(data.noUrut).padStart(3, "0"));
    result = result.replace("{tahun}", String(data.tahun));
    result = result.replace("{bulan}", data.bulan ? String(data.bulan).padStart(2, "0") : "");
    result = result.replace("{unitKerja}", data.unitKerja || "");
    result = result.replace("{naskahDinas}", data.naskahDinas || "");
    result = result.replace(/\/+/g, "/").replace(/\/$/, "");
    return result;
  }
  // ==================== APP PREFERENCES ====================
  // User preferences stored in a simple key-value style
  userPreferences = /* @__PURE__ */ new Map();
  async getUserPreferences(userId) {
    return this.userPreferences.get(userId) || {
      theme: "light",
      language: "id",
      notificationsEnabled: true,
      emailNotifications: false
    };
  }
  async updateUserPreferences(userId, preferences) {
    const existing = await this.getUserPreferences(userId);
    const updated = { ...existing, ...preferences };
    this.userPreferences.set(userId, updated);
    return updated;
  }
};
var settingsService = new SettingsService();

// src/routes/settings.routes.ts
var log22 = createLogger("SettingsRoutes");
var router22 = Router22();
router22.get("/profile", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const profile = await settingsService.getProfile(userId);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(profile);
  } catch (error) {
    log22.error({ err: error }, "Error getting profile:");
    res.status(500).json({ error: "Failed to get profile" });
  }
});
router22.put("/profile", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { name, image } = req.body;
    const updated = await settingsService.updateProfile(userId, { name, image });
    if (!updated) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(updated);
  } catch (error) {
    log22.error({ err: error }, "Error updating profile:");
    res.status(500).json({ error: "Failed to update profile" });
  }
});
router22.get("/unit-kerja", async (req, res) => {
  try {
    const units = await settingsService.getAllUnitKerja();
    res.json(units);
  } catch (error) {
    log22.error({ err: error }, "Error getting unit kerja:");
    res.status(500).json({ error: "Failed to get unit kerja" });
  }
});
router22.get("/unit-kerja/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const unit = await settingsService.getUnitKerjaSettings(id);
    if (!unit) {
      res.status(404).json({ error: "Unit kerja not found" });
      return;
    }
    res.json(unit);
  } catch (error) {
    log22.error({ err: error }, "Error getting unit kerja:");
    res.status(500).json({ error: "Failed to get unit kerja" });
  }
});
router22.put("/unit-kerja/:id", async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!["super_admin", "admin_dirjen", "admin_sesditjen"].includes(userRole)) {
      res.status(403).json({ error: "Forbidden: Admin access required" });
      return;
    }
    const { id } = req.params;
    const { name, description, driveFolderId, driveUploadFolderId, canReceiveDistribution } = req.body;
    const updated = await settingsService.updateUnitKerja(id, {
      name,
      description,
      driveFolderId,
      driveUploadFolderId,
      canReceiveDistribution
    });
    if (!updated) {
      res.status(404).json({ error: "Unit kerja not found" });
      return;
    }
    res.json(updated);
  } catch (error) {
    log22.error({ err: error }, "Error updating unit kerja:");
    res.status(500).json({ error: "Failed to update unit kerja" });
  }
});
router22.post("/unit-kerja", async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "super_admin") {
      res.status(403).json({ error: "Forbidden: Super admin access required" });
      return;
    }
    const { id, name, description, parentId, unitType, driveFolderId, driveUploadFolderId } = req.body;
    if (!id || !name) {
      res.status(400).json({ error: "ID and name are required" });
      return;
    }
    const created = await settingsService.createUnitKerja({
      id,
      name,
      description,
      parentId,
      unitType,
      driveFolderId,
      driveUploadFolderId
    });
    res.status(201).json(created);
  } catch (error) {
    log22.error({ err: error }, "Error creating unit kerja:");
    res.status(500).json({ error: "Failed to create unit kerja" });
  }
});
router22.get("/surat-templates", async (req, res) => {
  try {
    const unitKerjaId = req.user?.unitKerjaId || "dirjen";
    const templates = await settingsService.getSuratTemplates(unitKerjaId);
    res.json(templates);
  } catch (error) {
    log22.error({ err: error }, "Error getting surat templates:");
    res.status(500).json({ error: "Failed to get templates" });
  }
});
router22.put("/surat-templates", async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!["super_admin", "admin_dirjen", "admin_sesditjen"].includes(userRole)) {
      res.status(403).json({ error: "Forbidden: Admin access required" });
      return;
    }
    const unitKerjaId = req.user?.unitKerjaId || "dirjen";
    const { masukFormat, keluarFormat } = req.body;
    const updated = await settingsService.updateSuratTemplates(unitKerjaId, {
      masukFormat,
      keluarFormat
    });
    res.json(updated);
  } catch (error) {
    log22.error({ err: error }, "Error updating surat templates:");
    res.status(500).json({ error: "Failed to update templates" });
  }
});
router22.get("/preferences", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const preferences = await settingsService.getUserPreferences(userId);
    res.json(preferences);
  } catch (error) {
    log22.error({ err: error }, "Error getting preferences:");
    res.status(500).json({ error: "Failed to get preferences" });
  }
});
router22.put("/preferences", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { theme, language, notificationsEnabled, emailNotifications } = req.body;
    const updated = await settingsService.updateUserPreferences(userId, {
      theme,
      language,
      notificationsEnabled,
      emailNotifications
    });
    res.json(updated);
  } catch (error) {
    log22.error({ err: error }, "Error updating preferences:");
    res.status(500).json({ error: "Failed to update preferences" });
  }
});
var settingsRoutes = router22;

// src/routes/search.routes.ts
import { Router as Router23 } from "express";

// src/services/global-search.service.ts
import { or as or8, ilike as ilike6, desc as desc12, and as and15, eq as eq18 } from "drizzle-orm";
var GlobalSearchService = class {
  DEFAULT_LIMIT = 20;
  MAX_LIMIT = 100;
  /**
   * Search across all modules
   */
  async search(params) {
    const {
      query,
      unitKerjaId,
      modules = ["surat_masuk", "surat_keluar", "arsip", "dosir"],
      tahun,
      limit = this.DEFAULT_LIMIT,
      page = 1
    } = params;
    if (!query || query.trim().length < 2) {
      return this.emptyResponse();
    }
    const searchTerms = this.extractSearchTerms(query);
    const results = [];
    const counts = { surat_masuk: 0, surat_keluar: 0, arsip: 0, dosir: 0, total: 0 };
    const searchPromises = [];
    if (modules.includes("surat_masuk")) {
      searchPromises.push(
        this.searchSuratMasuk(searchTerms, unitKerjaId, tahun).then((items) => {
          counts.surat_masuk = items.length;
          results.push(...items);
        })
      );
    }
    if (modules.includes("surat_keluar")) {
      searchPromises.push(
        this.searchSuratKeluar(searchTerms, unitKerjaId, tahun).then((items) => {
          counts.surat_keluar = items.length;
          results.push(...items);
        })
      );
    }
    if (modules.includes("arsip")) {
      searchPromises.push(
        this.searchArsip(searchTerms, unitKerjaId).then((items) => {
          counts.arsip = items.length;
          results.push(...items);
        })
      );
    }
    if (modules.includes("dosir")) {
      searchPromises.push(
        this.searchDosir(searchTerms, unitKerjaId).then((items) => {
          counts.dosir = items.length;
          results.push(...items);
        })
      );
    }
    await Promise.all(searchPromises);
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    counts.total = results.length;
    const offset = (page - 1) * Math.min(limit, this.MAX_LIMIT);
    const paginatedResults = results.slice(offset, offset + limit);
    return {
      results: paginatedResults,
      counts,
      pagination: {
        page,
        limit,
        total: counts.total
      }
    };
  }
  /**
   * Search in file content (OCR extracted text)
   */
  async searchByContent(query, unitKerjaId) {
    const searchTerms = this.extractSearchTerms(query);
    if (searchTerms.length === 0) return [];
    const likePattern = `%${searchTerms.join("%")}%`;
    const arsipResults = await db.select().from(arsip).where(and15(
      ilike6(arsip.extractedText, likePattern),
      unitKerjaId ? eq18(arsip.unitKerjaId, unitKerjaId) : void 0
    )).limit(50);
    return arsipResults.map((row) => ({
      type: "arsip",
      id: row.id,
      title: row.nomorSuratOriginal || "Arsip",
      subtitle: row.uraianBerkas || "",
      excerpt: this.highlightExcerpt(row.extractedText || "", searchTerms),
      matchedIn: ["content"],
      createdAt: row.createdAt,
      metadata: {
        kodeKlasifikasi: row.kodeKlasifikasi,
        jenisArsip: row.jenisArsip
      }
    }));
  }
  /**
   * Search Surat Masuk
   */
  async searchSuratMasuk(terms, unitKerjaId, tahun) {
    const conditions = [];
    for (const term of terms) {
      conditions.push(
        or8(
          ilike6(suratMasuk.nomorSurat, `%${term}%`),
          ilike6(suratMasuk.perihal, `%${term}%`),
          ilike6(suratMasuk.dari, `%${term}%`),
          ilike6(suratMasuk.kepada, `%${term}%`),
          ilike6(suratMasuk.keterangan, `%${term}%`)
        )
      );
    }
    if (unitKerjaId) {
      conditions.push(eq18(suratMasuk.unitKerjaId, unitKerjaId));
    }
    if (tahun) {
      conditions.push(eq18(suratMasuk.tahun, tahun));
    }
    const rows = await db.select().from(suratMasuk).where(and15(...conditions)).orderBy(desc12(suratMasuk.createdAt)).limit(50);
    return rows.map((row) => {
      const matchedIn = [];
      const searchText = terms.join(" ").toLowerCase();
      if (row.nomorSurat?.toLowerCase().includes(searchText)) matchedIn.push("nomor");
      if (row.perihal?.toLowerCase().includes(searchText)) matchedIn.push("perihal");
      if (row.dari?.toLowerCase().includes(searchText)) matchedIn.push("dari");
      return {
        type: "surat_masuk",
        id: row.id,
        title: row.nomorSurat || `SM-${row.noUrut}/${row.tahun}`,
        subtitle: row.dari || "",
        excerpt: row.perihal || "",
        matchedIn: matchedIn.length > 0 ? matchedIn : ["perihal"],
        createdAt: row.createdAt,
        metadata: {
          tanggalSurat: row.tanggalSurat,
          status: row.status,
          jenisSurat: row.jenisSurat
        }
      };
    });
  }
  /**
   * Search Surat Keluar
   */
  async searchSuratKeluar(terms, unitKerjaId, tahun) {
    const conditions = [];
    for (const term of terms) {
      conditions.push(
        or8(
          ilike6(suratKeluar.nomorSurat, `%${term}%`),
          ilike6(suratKeluar.perihal, `%${term}%`),
          ilike6(suratKeluar.kepada, `%${term}%`)
        )
      );
    }
    if (unitKerjaId) {
      conditions.push(eq18(suratKeluar.unitKerjaId, unitKerjaId));
    }
    if (tahun) {
      conditions.push(eq18(suratKeluar.tahun, tahun));
    }
    const rows = await db.select().from(suratKeluar).where(and15(...conditions)).orderBy(desc12(suratKeluar.createdAt)).limit(50);
    return rows.map((row) => ({
      type: "surat_keluar",
      id: row.id,
      title: row.nomorSurat || `SK-${row.noUrut}/${row.tahun}`,
      subtitle: row.kepada || "",
      excerpt: row.perihal || "",
      matchedIn: ["perihal"],
      createdAt: row.createdAt,
      metadata: {
        tanggalSurat: row.tanggalSurat,
        naskahDinas: row.naskahDinas
      }
    }));
  }
  /**
   * Search Arsip
   */
  async searchArsip(terms, unitKerjaId) {
    const conditions = [];
    for (const term of terms) {
      conditions.push(
        or8(
          ilike6(arsip.nomorSuratOriginal, `%${term}%`),
          ilike6(arsip.perihalOriginal, `%${term}%`),
          ilike6(arsip.uraianBerkas, `%${term}%`),
          ilike6(arsip.kodeKlasifikasi, `%${term}%`),
          ilike6(arsip.keterangan, `%${term}%`)
        )
      );
    }
    if (unitKerjaId) {
      conditions.push(eq18(arsip.unitKerjaId, unitKerjaId));
    }
    const rows = await db.select().from(arsip).where(and15(...conditions)).orderBy(desc12(arsip.createdAt)).limit(50);
    return rows.map((row) => ({
      type: "arsip",
      id: row.id,
      title: row.nomorSuratOriginal || row.kodeKlasifikasi || "Arsip",
      subtitle: row.kodeKlasifikasi || "",
      excerpt: row.uraianBerkas || row.perihalOriginal || "",
      matchedIn: ["uraian"],
      createdAt: row.createdAt,
      metadata: {
        jenisArsip: row.jenisArsip,
        tingkatPerkembangan: row.tingkatPerkembangan
      }
    }));
  }
  /**
   * Search Dosir
   */
  async searchDosir(terms, unitKerjaId) {
    const conditions = [];
    for (const term of terms) {
      conditions.push(
        or8(
          ilike6(dosir.judul, `%${term}%`),
          ilike6(dosir.kode, `%${term}%`),
          ilike6(dosir.deskripsi, `%${term}%`)
        )
      );
    }
    if (unitKerjaId) {
      conditions.push(eq18(dosir.unitKerjaId, unitKerjaId));
    }
    const rows = await db.select().from(dosir).where(and15(...conditions)).orderBy(desc12(dosir.createdAt)).limit(50);
    return rows.map((row) => ({
      type: "dosir",
      id: row.id,
      title: row.judul,
      subtitle: row.kode || "",
      excerpt: row.deskripsi || "",
      matchedIn: ["judul"],
      createdAt: row.createdAt,
      metadata: {
        kategori: row.kategori,
        status: row.status
      }
    }));
  }
  /**
   * Extract search terms from query
   */
  extractSearchTerms(query) {
    return query.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((term) => term.length > 1);
  }
  /**
   * Highlight matching text in excerpt
   */
  highlightExcerpt(text, terms) {
    if (!text) return "";
    let excerpt = text.substring(0, 200);
    terms.forEach((term) => {
      const regex = new RegExp(`(${term})`, "gi");
      excerpt = excerpt.replace(regex, "**$1**");
    });
    return excerpt + (text.length > 200 ? "..." : "");
  }
  /**
   * Empty response helper
   */
  emptyResponse() {
    return {
      results: [],
      counts: { surat_masuk: 0, surat_keluar: 0, arsip: 0, dosir: 0, total: 0 },
      pagination: { page: 1, limit: 20, total: 0 }
    };
  }
};
var globalSearchService = new GlobalSearchService();

// src/routes/search.routes.ts
var router23 = Router23();
router23.use(authMiddleware);
router23.get("/", async (req, res, next) => {
  try {
    const { q, modules, unitKerjaId, tahun, limit, page } = req.query;
    if (!q || typeof q !== "string") {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "q" is required'
      });
    }
    const result = await globalSearchService.search({
      query: q,
      unitKerjaId,
      modules: modules ? modules.split(",") : void 0,
      tahun: tahun ? Number(tahun) : void 0,
      limit: limit ? Number(limit) : void 0,
      page: page ? Number(page) : void 0
    });
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});
router23.get("/content", ocrLimiter, async (req, res, next) => {
  try {
    const { q, unitKerjaId } = req.query;
    if (!q || typeof q !== "string") {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "q" is required'
      });
    }
    const results = await globalSearchService.searchByContent(
      q,
      unitKerjaId
    );
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    next(error);
  }
});
router23.get("/suggestions", async (req, res, next) => {
  try {
    const { q, unitKerjaId } = req.query;
    if (!q || typeof q !== "string" || q.length < 2) {
      return res.json({ success: true, data: [] });
    }
    const result = await globalSearchService.search({
      query: q,
      unitKerjaId,
      limit: 5
    });
    const suggestions = result.results.map((r) => ({
      type: r.type,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle
    }));
    res.json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    next(error);
  }
});
var search_routes_default = router23;

// src/routes/dev-auth.routes.ts
import { Router as Router24 } from "express";
import { eq as eq19 } from "drizzle-orm";
var log23 = createLogger("DevAuthRoutes");
var router24 = Router24();
router24.use(authLimiter);
router24.post("/dev-login", async (req, res) => {
  if (env.NODE_ENV !== "development") {
    res.status(403).json({
      error: "Forbidden",
      message: "Dev login is only available in development environment"
    });
    return;
  }
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  try {
    const user = await db.query.users.findFirst({
      where: eq19(users.email, email)
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const session = await auth.api.signInEmail({
      body: {
        email,
        password: "dev-bypass"
        // Will be overridden below
      },
      asResponse: false
    }).catch(() => null);
    if (!session) {
      const headers = new Headers();
      const internalCtx = await auth.internal?.createSession?.({
        userId: user.id,
        request: req
      }).catch(() => null);
      if (internalCtx) {
        const token2 = internalCtx.token || internalCtx.session?.token;
        if (token2) {
          res.cookie("better-auth.session_token", token2, {
            httpOnly: true,
            secure: false,
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1e3
          });
          res.json({
            success: true,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role
            },
            token: token2
          });
          return;
        }
      }
      const { v4: uuidv42 } = await import("uuid");
      const token = uuidv42();
      const expiresAt = /* @__PURE__ */ new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const { sessions } = await import("./schema-X7T7ECFS.js");
      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      });
      res.cookie("better-auth.session_token", token, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1e3
      });
      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        token
      });
      return;
    }
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    log23.error({ err: error }, "Dev login error:");
    res.status(500).json({ error: "Internal server error" });
  }
});
var dev_auth_routes_default = router24;

// src/routes/penyusutan.routes.ts
import { Router as Router25 } from "express";

// src/services/penyusutan.service.ts
import { eq as eq20, and as and16, desc as desc13, sql as sql13, inArray as inArray4 } from "drizzle-orm";
var STATUS_FLOW = {
  draft: "proposed",
  proposed: "reviewed",
  reviewed: "approved",
  approved: "executed",
  executed: null
  // Terminal state
};
var JENIS_TO_DISPOSAL_STATUS = {
  pemindahan: "proposed_pindah",
  pemusnahan: "proposed_musnah",
  penyerahan: "proposed_serah",
  alih_media: "proposed_alih_media"
};
var PenyusutanService = class {
  /**
   * List all penyusutan batches with pagination
   */
  async findAll(filters) {
    const { unitKerjaId, jenisPenyusutan, status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [eq20(penyusutanArsip.unitKerjaId, unitKerjaId)];
    if (jenisPenyusutan) conditions.push(eq20(penyusutanArsip.jenisPenyusutan, jenisPenyusutan));
    if (status) conditions.push(eq20(penyusutanArsip.status, status));
    const [data, countResult] = await Promise.all([
      db.select().from(penyusutanArsip).where(and16(...conditions)).orderBy(desc13(penyusutanArsip.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql13`count(*)` }).from(penyusutanArsip).where(and16(...conditions))
    ]);
    const total = Number(countResult[0]?.count || 0);
    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }
  /**
   * Get single batch with its items and arsip details
   */
  async findById(id) {
    const batch = await db.select().from(penyusutanArsip).where(eq20(penyusutanArsip.id, id));
    if (!batch[0]) return null;
    const items = await db.select({
      item: penyusutanItems,
      arsip
    }).from(penyusutanItems).leftJoin(arsip, eq20(penyusutanItems.arsipId, arsip.id)).where(eq20(penyusutanItems.penyusutanId, id)).orderBy(penyusutanItems.nomorUrut);
    return {
      ...batch[0],
      items: items.map((i) => ({
        ...i.item,
        arsip: i.arsip
      }))
    };
  }
  /**
   * Create a new penyusutan batch with arsip items
   */
  async create(data) {
    const { arsipIds, ...batchData } = data;
    const now = /* @__PURE__ */ new Date();
    const nomorBA = data.nomorBA || `BA-${data.jenisPenyusutan.toUpperCase().substring(0, 3)}-${data.unitKerjaId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [batch] = await db.insert(penyusutanArsip).values({
      unitKerjaId: batchData.unitKerjaId,
      jenisPenyusutan: batchData.jenisPenyusutan,
      nomorBA,
      keterangan: batchData.keterangan,
      totalBerkas: arsipIds.length,
      createdBy: batchData.createdBy,
      status: "draft"
    }).returning();
    if (arsipIds.length > 0) {
      const itemsToInsert = arsipIds.map((arsipId, index) => ({
        penyusutanId: batch.id,
        arsipId,
        nomorUrut: index + 1
      }));
      await db.insert(penyusutanItems).values(itemsToInsert);
      const disposalStatus = JENIS_TO_DISPOSAL_STATUS[data.jenisPenyusutan] || "active";
      await db.update(arsip).set({
        disposalStatus,
        disposalBatchId: batch.id,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(inArray4(arsip.id, arsipIds));
    }
    return batch;
  }
  /**
   * Advance the workflow status of a batch
   */
  async updateStatus(id, metadata) {
    const batch = await db.select().from(penyusutanArsip).where(eq20(penyusutanArsip.id, id));
    if (!batch[0]) throw new Error("Penyusutan batch not found");
    const currentStatus = batch[0].status;
    const nextStatus = STATUS_FLOW[currentStatus];
    if (!nextStatus) throw new Error(`Cannot advance from status: ${currentStatus}`);
    if (metadata?.user) {
      const { role, unitKerjaId } = metadata.user;
      if (currentStatus === "draft" && nextStatus === "proposed") {
        if (batch[0].unitKerjaId !== unitKerjaId && role !== "super_admin") {
          throw new Error("Unauthorized: You can only propose for your own unit");
        }
      }
      if (currentStatus === "proposed" && nextStatus === "reviewed") {
        if (!["super_admin", "admin_kementerian", "admin_dirjen", "admin_sesditjen"].includes(role)) {
          throw new Error("Unauthorized: Insufficient role to review");
        }
      }
      if (currentStatus === "reviewed" && nextStatus === "approved") {
        if (!["super_admin", "admin_kementerian", "pejabat_eselon_1"].includes(role)) {
          throw new Error("Unauthorized: Insufficient role to approve");
        }
      }
      if (currentStatus === "approved" && nextStatus === "executed") {
        if (!["super_admin", "admin_kementerian"].includes(role)) {
          throw new Error("Unauthorized: Insufficient role to execute");
        }
      }
    }
    const updateData = {
      status: nextStatus,
      updatedAt: /* @__PURE__ */ new Date()
    };
    if (nextStatus === "proposed") updateData.tanggalUsul = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    if (nextStatus === "reviewed") updateData.tanggalReview = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    if (nextStatus === "approved") {
      updateData.tanggalPersetujuan = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      updateData.approvedBy = metadata?.user?.id;
    }
    if (nextStatus === "executed") updateData.tanggalPelaksanaan = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    if (metadata?.catatan) updateData.catatanPanitia = metadata.catatan;
    const [updated] = await db.update(penyusutanArsip).set(updateData).where(eq20(penyusutanArsip.id, id)).returning();
    if (nextStatus === "executed") {
      const items = await db.select({ arsipId: penyusutanItems.arsipId }).from(penyusutanItems).where(eq20(penyusutanItems.penyusutanId, id));
      const arsipIds = items.map((i) => i.arsipId);
      if (arsipIds.length > 0) {
        await db.update(arsip).set({ disposalStatus: "executed", updatedAt: /* @__PURE__ */ new Date() }).where(inArray4(arsip.id, arsipIds));
      }
    }
    if (nextStatus === "approved") {
      const items = await db.select({ arsipId: penyusutanItems.arsipId }).from(penyusutanItems).where(eq20(penyusutanItems.penyusutanId, id));
      const arsipIds = items.map((i) => i.arsipId);
      if (arsipIds.length > 0) {
        await db.update(arsip).set({ disposalStatus: "approved", updatedAt: /* @__PURE__ */ new Date() }).where(inArray4(arsip.id, arsipIds));
      }
    }
    return updated;
  }
  /**
   * Add arsip items to an existing draft batch
   */
  async addItems(batchId, arsipIds) {
    const batch = await db.select().from(penyusutanArsip).where(eq20(penyusutanArsip.id, batchId));
    if (!batch[0]) throw new Error("Batch not found");
    if (batch[0].status !== "draft") throw new Error("Can only add items to draft batches");
    const existingItems = await db.select({ nomorUrut: penyusutanItems.nomorUrut }).from(penyusutanItems).where(eq20(penyusutanItems.penyusutanId, batchId)).orderBy(desc13(penyusutanItems.nomorUrut)).limit(1);
    const startNum = (existingItems[0]?.nomorUrut || 0) + 1;
    const itemsToInsert = arsipIds.map((arsipId, index) => ({
      penyusutanId: batchId,
      arsipId,
      nomorUrut: startNum + index
    }));
    await db.insert(penyusutanItems).values(itemsToInsert);
    const disposalStatus = JENIS_TO_DISPOSAL_STATUS[batch[0].jenisPenyusutan] || "active";
    await db.update(arsip).set({ disposalStatus, disposalBatchId: batchId, updatedAt: /* @__PURE__ */ new Date() }).where(inArray4(arsip.id, arsipIds));
    const countResult = await db.select({ count: sql13`count(*)` }).from(penyusutanItems).where(eq20(penyusutanItems.penyusutanId, batchId));
    await db.update(penyusutanArsip).set({ totalBerkas: Number(countResult[0]?.count || 0), updatedAt: /* @__PURE__ */ new Date() }).where(eq20(penyusutanArsip.id, batchId));
    return { added: arsipIds.length };
  }
  /**
   * Remove items from a draft batch
   */
  async removeItems(batchId, arsipIds) {
    const batch = await db.select().from(penyusutanArsip).where(eq20(penyusutanArsip.id, batchId));
    if (!batch[0]) throw new Error("Batch not found");
    if (batch[0].status !== "draft") throw new Error("Can only remove items from draft batches");
    await db.delete(penyusutanItems).where(and16(
      eq20(penyusutanItems.penyusutanId, batchId),
      inArray4(penyusutanItems.arsipId, arsipIds)
    ));
    await db.update(arsip).set({ disposalStatus: "active", disposalBatchId: null, updatedAt: /* @__PURE__ */ new Date() }).where(inArray4(arsip.id, arsipIds));
    const countResult = await db.select({ count: sql13`count(*)` }).from(penyusutanItems).where(eq20(penyusutanItems.penyusutanId, batchId));
    await db.update(penyusutanArsip).set({ totalBerkas: Number(countResult[0]?.count || 0), updatedAt: /* @__PURE__ */ new Date() }).where(eq20(penyusutanArsip.id, batchId));
    return { removed: arsipIds.length };
  }
  /**
   * Delete a draft batch
   */
  async deleteBatch(id) {
    const batch = await db.select().from(penyusutanArsip).where(eq20(penyusutanArsip.id, id));
    if (!batch[0]) throw new Error("Batch not found");
    if (batch[0].status !== "draft") throw new Error("Can only delete draft batches");
    const items = await db.select({ arsipId: penyusutanItems.arsipId }).from(penyusutanItems).where(eq20(penyusutanItems.penyusutanId, id));
    const arsipIds = items.map((i) => i.arsipId);
    if (arsipIds.length > 0) {
      await db.update(arsip).set({ disposalStatus: "active", disposalBatchId: null, updatedAt: /* @__PURE__ */ new Date() }).where(inArray4(arsip.id, arsipIds));
    }
    await db.delete(penyusutanArsip).where(eq20(penyusutanArsip.id, id));
    return { deleted: true };
  }
  /**
   * Get disposal candidates based on type using existing arsipService logic
   */
  async getCandidates(unitKerjaId, jenisPenyusutan) {
    const allArchives = await db.select().from(arsip).where(and16(
      eq20(arsip.unitKerjaId, unitKerjaId),
      eq20(arsip.disposalStatus, "active")
    ));
    const candidates = allArchives.filter((arch) => {
      if (!arch.tanggalArsip) return false;
      const status = arsipService.getArchiveStatus(
        arch.tanggalArsip,
        arch.retensiAktif,
        arch.retensiInaktif
      );
      switch (jenisPenyusutan) {
        case "pemindahan":
          return status === "inaktif" || status === "akan_kadaluarsa";
        case "pemusnahan":
          return (status === "kadaluarsa" || status === "akan_kadaluarsa") && arch.hasilAkhir === "Musnah";
        case "penyerahan":
          return status === "kadaluarsa" && arch.hasilAkhir === "Permanen";
        default:
          return false;
      }
    });
    return candidates;
  }
  /**
   * Generate Daftar Arsip Aktif data (Formulir 4)
   */
  async generateDaftarArsipAktif(unitKerjaId, tahun) {
    const conditions = [eq20(arsip.unitKerjaId, unitKerjaId)];
    if (tahun) conditions.push(eq20(arsip.tahun, tahun));
    const allArchives = await db.select().from(arsip).where(and16(...conditions)).orderBy(arsip.kodeKlasifikasi, arsip.nomorBerkas);
    const aktifArchives = allArchives.filter((arch) => {
      if (!arch.tanggalArsip) return true;
      const status = arsipService.getArchiveStatus(
        arch.tanggalArsip,
        arch.retensiAktif,
        arch.retensiInaktif
      );
      return status === "aktif" || status === "akan_inaktif";
    });
    return {
      unitKerjaId,
      tahun: tahun || (/* @__PURE__ */ new Date()).getFullYear(),
      tanggalCetak: (/* @__PURE__ */ new Date()).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
      totalBerkas: aktifArchives.length,
      daftarArsip: aktifArchives.map((arch, index) => ({
        no: index + 1,
        nomorBerkas: arch.nomorBerkas || "-",
        kodeKlasifikasi: arch.kodeKlasifikasi || "-",
        uraianBerkas: arch.uraianBerkas || "-",
        kurunWaktu: arch.kurunWaktu || "-",
        jumlah: arch.jumlah || 1,
        nomorItem: arch.nomorItem || "-",
        uraianItem: arch.uraianItem || "-",
        tanggalArsip: arch.tanggalArsip || "-",
        tingkatPerkembangan: arch.tingkatPerkembangan || "-",
        lokasiSimpan: [arch.lokasiFc, arch.lokasiLaci, arch.lokasiFolder].filter(Boolean).join("/") || "-",
        klasifikasiKeamanan: arch.klasifikasiKeamanan || "Biasa",
        keterangan: arch.keterangan || "-"
      }))
    };
  }
  /**
   * Generate Daftar Arsip Inaktif data (Formulir 6)
   */
  async generateDaftarArsipInaktif(unitKerjaId, tahun) {
    const conditions = [eq20(arsip.unitKerjaId, unitKerjaId)];
    if (tahun) conditions.push(eq20(arsip.tahun, tahun));
    const allArchives = await db.select().from(arsip).where(and16(...conditions)).orderBy(arsip.kodeKlasifikasi, arsip.nomorBerkas);
    const inaktifArchives = allArchives.filter((arch) => {
      if (!arch.tanggalArsip) return false;
      const status = arsipService.getArchiveStatus(
        arch.tanggalArsip,
        arch.retensiAktif,
        arch.retensiInaktif
      );
      return status === "inaktif" || status === "akan_kadaluarsa" || status === "kadaluarsa";
    });
    return {
      unitKerjaId,
      tahun: tahun || (/* @__PURE__ */ new Date()).getFullYear(),
      tanggalCetak: (/* @__PURE__ */ new Date()).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
      totalBerkas: inaktifArchives.length,
      daftarArsip: inaktifArchives.map((arch, index) => ({
        no: index + 1,
        nomorArsip: arch.nomorBerkas || "-",
        kodeKlasifikasi: arch.kodeKlasifikasi || "-",
        uraianInformasiArsip: arch.uraianBerkas || arch.uraianItem || "-",
        kurunWaktu: arch.kurunWaktu || "-",
        jumlah: arch.jumlah || 1,
        tingkatPerkembangan: arch.tingkatPerkembangan || "-",
        lokasiSimpan: [arch.lokasiFc, arch.lokasiLaci, arch.lokasiFolder].filter(Boolean).join("/") || "-",
        klasifikasiKeamanan: arch.klasifikasiKeamanan || "Biasa",
        jangkaSimpan: `${arch.retensiAktif || "-"} / ${arch.retensiInaktif || "-"}`,
        nasibAkhir: arch.hasilAkhir || "-",
        kategoriArsip: arch.jraKode || "-",
        keterangan: arch.keterangan || "-"
      }))
    };
  }
};
var penyusutanService = new PenyusutanService();

// src/services/print-template.service.ts
import PDFDocument2 from "pdfkit";
var PrintTemplateService = class {
  FONT_SIZE = { title: 14, subtitle: 11, body: 9, small: 8 };
  MARGIN = { top: 50, bottom: 50, left: 50, right: 50 };
  // ==================== FORMULIR 4: DAFTAR ARSIP AKTIF ====================
  async generateDaftarArsipAktif(unitKerjaId, tahun) {
    const data = await penyusutanService.generateDaftarArsipAktif(unitKerjaId, tahun);
    const doc = new PDFDocument2({ size: "A4", layout: "landscape", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.fontSize(this.FONT_SIZE.title).font("Helvetica-Bold").text("DAFTAR ARSIP AKTIF", { align: "center" });
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica").text(`KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(this.FONT_SIZE.body).text(`Unit Pengolah: ${data.unitKerjaId}`).text(`Tahun: ${data.tahun}`).text(`Tanggal Cetak: ${data.tanggalCetak}`);
    doc.moveDown();
    const cols = [
      { header: "No", width: 25 },
      { header: "No. Berkas", width: 55 },
      { header: "Kode Klas.", width: 55 },
      { header: "Uraian Berkas", width: 130 },
      { header: "Kurun Waktu", width: 60 },
      { header: "Jml", width: 25 },
      { header: "No. Item", width: 45 },
      { header: "Tgl. Arsip", width: 55 },
      { header: "Tk. Perk.", width: 45 },
      { header: "Lokasi", width: 60 },
      { header: "Kls. Keamanan", width: 55 },
      { header: "Keterangan", width: 80 }
    ];
    let x = this.MARGIN.left;
    const startY = doc.y;
    doc.fontSize(this.FONT_SIZE.small).font("Helvetica-Bold");
    cols.forEach((col) => {
      doc.rect(x, startY, col.width, 20).stroke();
      doc.text(col.header, x + 2, startY + 3, { width: col.width - 4, align: "center" });
      x += col.width;
    });
    doc.font("Helvetica").fontSize(this.FONT_SIZE.small);
    let y = startY + 20;
    for (const item of data.daftarArsip) {
      if (y > 500) {
        doc.addPage();
        y = this.MARGIN.top;
      }
      x = this.MARGIN.left;
      const rowHeight = 18;
      const values = [
        String(item.no),
        item.nomorBerkas,
        item.kodeKlasifikasi,
        item.uraianBerkas,
        item.kurunWaktu,
        String(item.jumlah),
        item.nomorItem,
        item.tanggalArsip,
        item.tingkatPerkembangan,
        item.lokasiSimpan,
        item.klasifikasiKeamanan,
        item.keterangan
      ];
      cols.forEach((col, i) => {
        doc.rect(x, y, col.width, rowHeight).stroke();
        doc.text(values[i] || "-", x + 2, y + 3, {
          width: col.width - 4,
          height: rowHeight - 4,
          ellipsis: true
        });
        x += col.width;
      });
      y += rowHeight;
    }
    doc.moveDown(2);
    const footerY = y + 30;
    doc.fontSize(this.FONT_SIZE.body);
    doc.text(`Total Berkas: ${data.totalBerkas}`, this.MARGIN.left, footerY);
    doc.moveDown(2);
    const sigY = footerY + 40;
    doc.text(`${data.tanggalCetak}`, 500, sigY);
    doc.text("Pimpinan Unit Pengolah,", 500, sigY + 15);
    doc.moveDown(4);
    doc.text("____________________", 500, sigY + 70);
    doc.text("NIP.", 500, sigY + 85);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // ==================== FORMULIR 6: DAFTAR ARSIP INAKTIF ====================
  async generateDaftarArsipInaktif(unitKerjaId, tahun) {
    const data = await penyusutanService.generateDaftarArsipInaktif(unitKerjaId, tahun);
    const doc = new PDFDocument2({ size: "A4", layout: "landscape", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.fontSize(this.FONT_SIZE.title).font("Helvetica-Bold").text("DAFTAR ARSIP INAKTIF", { align: "center" });
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica").text("KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(this.FONT_SIZE.body).text(`Unit Pengolah: ${data.unitKerjaId}`).text(`Tahun: ${data.tahun}`).text(`Tanggal Cetak: ${data.tanggalCetak}`);
    doc.moveDown();
    const cols = [
      { header: "No", width: 25 },
      { header: "No. Arsip", width: 50 },
      { header: "Kode Klas.", width: 55 },
      { header: "Uraian Informasi Arsip", width: 130 },
      { header: "Kurun Waktu", width: 55 },
      { header: "Jml", width: 25 },
      { header: "Tk. Perk.", width: 45 },
      { header: "Lokasi", width: 60 },
      { header: "Kls. Keamanan", width: 55 },
      { header: "Jangka Simpan", width: 60 },
      { header: "Nasib Akhir", width: 50 },
      { header: "Ket.", width: 60 }
    ];
    let x = this.MARGIN.left;
    const startY = doc.y;
    doc.fontSize(this.FONT_SIZE.small).font("Helvetica-Bold");
    cols.forEach((col) => {
      doc.rect(x, startY, col.width, 20).stroke();
      doc.text(col.header, x + 2, startY + 3, { width: col.width - 4, align: "center" });
      x += col.width;
    });
    doc.font("Helvetica").fontSize(this.FONT_SIZE.small);
    let y = startY + 20;
    for (const item of data.daftarArsip) {
      if (y > 500) {
        doc.addPage();
        y = this.MARGIN.top;
      }
      x = this.MARGIN.left;
      const rowHeight = 18;
      const values = [
        String(item.no),
        item.nomorArsip,
        item.kodeKlasifikasi,
        item.uraianInformasiArsip,
        item.kurunWaktu,
        String(item.jumlah),
        item.tingkatPerkembangan,
        item.lokasiSimpan,
        item.klasifikasiKeamanan,
        item.jangkaSimpan,
        item.nasibAkhir,
        item.keterangan
      ];
      cols.forEach((col, i) => {
        doc.rect(x, y, col.width, rowHeight).stroke();
        doc.text(values[i] || "-", x + 2, y + 3, {
          width: col.width - 4,
          height: rowHeight - 4,
          ellipsis: true
        });
        x += col.width;
      });
      y += rowHeight;
    }
    const footerY = y + 30;
    doc.fontSize(this.FONT_SIZE.body);
    doc.text(`Total Berkas: ${data.totalBerkas}`, this.MARGIN.left, footerY);
    const sigY = footerY + 40;
    doc.text("Mengetahui,", this.MARGIN.left, sigY);
    doc.text("Pimpinan Unit Kearsipan,", this.MARGIN.left, sigY + 15);
    doc.text("____________________", this.MARGIN.left, sigY + 70);
    doc.text("NIP.", this.MARGIN.left, sigY + 85);
    doc.text(`${data.tanggalCetak}`, 500, sigY);
    doc.text("Pimpinan Unit Pengolah,", 500, sigY + 15);
    doc.text("____________________", 500, sigY + 70);
    doc.text("NIP.", 500, sigY + 85);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // ==================== FORMULIR 16: DAFTAR ARSIP USUL MUSNAH ====================
  async generateDaftarUsulMusnah(penyusutanId) {
    const batch = await penyusutanService.findById(penyusutanId);
    if (!batch) throw new Error("Batch not found");
    const doc = new PDFDocument2({ size: "A4", layout: "landscape", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.fontSize(this.FONT_SIZE.title).font("Helvetica-Bold").text("DAFTAR ARSIP USUL MUSNAH", { align: "center" });
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica").text("KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(this.FONT_SIZE.body).text(`Nomor: ${batch.nomorBA || "-"}`).text(`Unit Kerja: ${batch.unitKerjaId}`).text(`Tanggal Usul: ${batch.tanggalUsul || "-"}`);
    doc.moveDown();
    const cols = [
      { header: "No", width: 25 },
      { header: "Kode Klas.", width: 55 },
      { header: "Jenis Arsip", width: 130 },
      { header: "Kurun Waktu", width: 60 },
      { header: "Jumlah", width: 40 },
      { header: "Tk. Perk.", width: 45 },
      { header: "JRA", width: 50 },
      { header: "Retensi Aktif", width: 55 },
      { header: "Retensi Inaktif", width: 55 },
      { header: "Ket.", width: 80 }
    ];
    this.drawItemTable(doc, cols, batch.items, batch);
    this.addSignatureBlock(doc, doc.y + 30, batch);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // ==================== FORMULIR 14: DAFTAR ARSIP USUL PINDAH ====================
  async generateDaftarUsulPindah(penyusutanId) {
    const batch = await penyusutanService.findById(penyusutanId);
    if (!batch) throw new Error("Batch not found");
    const doc = new PDFDocument2({ size: "A4", layout: "landscape", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.fontSize(this.FONT_SIZE.title).font("Helvetica-Bold").text("DAFTAR ARSIP USUL PINDAH", { align: "center" });
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica").text("KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(this.FONT_SIZE.body).text(`Nomor: ${batch.nomorBA || "-"}`).text(`Unit Pengolah: ${batch.unitKerjaId}`).text(`Tanggal Usul: ${batch.tanggalUsul || "-"}`);
    doc.moveDown();
    const cols = [
      { header: "No", width: 25 },
      { header: "Kode Klas.", width: 55 },
      { header: "Jenis Arsip", width: 130 },
      { header: "Kurun Waktu", width: 60 },
      { header: "Jumlah", width: 40 },
      { header: "Tk. Perk.", width: 45 },
      { header: "JRA", width: 50 },
      { header: "Retensi Aktif", width: 55 },
      { header: "Retensi Inaktif", width: 55 },
      { header: "Ket.", width: 80 }
    ];
    this.drawItemTable(doc, cols, batch.items, batch);
    const sigY = doc.y + 30;
    doc.fontSize(this.FONT_SIZE.body);
    doc.text("Yang Menyerahkan,", this.MARGIN.left, sigY);
    doc.text("Pimpinan Unit Pengolah", this.MARGIN.left, sigY + 15);
    doc.text("____________________", this.MARGIN.left, sigY + 70);
    doc.text("NIP. ________________", this.MARGIN.left, sigY + 85);
    doc.text("Yang Menerima,", 350, sigY);
    doc.text("Pimpinan Unit Kearsipan", 350, sigY + 15);
    doc.text("____________________", 350, sigY + 70);
    doc.text("NIP. ________________", 350, sigY + 85);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // ==================== FORMULIR 17: DAFTAR ARSIP USUL SERAH ====================
  async generateDaftarUsulSerah(penyusutanId) {
    const batch = await penyusutanService.findById(penyusutanId);
    if (!batch) throw new Error("Batch not found");
    const doc = new PDFDocument2({ size: "A4", layout: "landscape", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.fontSize(this.FONT_SIZE.title).font("Helvetica-Bold").text("DAFTAR ARSIP USUL SERAH", { align: "center" });
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica").text("KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(this.FONT_SIZE.body).text(`Nomor: ${batch.nomorBA || "-"}`).text(`Unit Kerja: ${batch.unitKerjaId}`).text(`Tanggal Usul: ${batch.tanggalUsul || "-"}`);
    doc.moveDown();
    const cols = [
      { header: "No", width: 25 },
      { header: "Kode Klas.", width: 55 },
      { header: "Jenis Arsip", width: 130 },
      { header: "Kurun Waktu", width: 60 },
      { header: "Jumlah", width: 40 },
      { header: "Tk. Perk.", width: 45 },
      { header: "JRA", width: 50 },
      { header: "Retensi Aktif", width: 55 },
      { header: "Retensi Inaktif", width: 55 },
      { header: "Ket.", width: 80 }
    ];
    this.drawItemTable(doc, cols, batch.items, batch);
    const sigY = doc.y + 30;
    doc.fontSize(this.FONT_SIZE.body);
    doc.text("Yang Menyerahkan,", this.MARGIN.left, sigY);
    doc.text("Pimpinan Unit Kearsipan", this.MARGIN.left, sigY + 15);
    doc.text("____________________", this.MARGIN.left, sigY + 70);
    doc.text("NIP. ________________", this.MARGIN.left, sigY + 85);
    doc.text("Yang Menerima,", 350, sigY);
    doc.text("Lembaga Kearsipan", 350, sigY + 15);
    doc.text("____________________", 350, sigY + 70);
    doc.text("NIP. ________________", 350, sigY + 85);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // ==================== BERITA ACARA PEMINDAHAN (Formulir 15) ====================
  async generateBeritaAcaraPemindahan(penyusutanId) {
    const batch = await penyusutanService.findById(penyusutanId);
    if (!batch) throw new Error("Batch not found");
    const doc = new PDFDocument2({ size: "A4", layout: "portrait", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    this.addKopSurat(doc);
    doc.fontSize(this.FONT_SIZE.title).font("Helvetica-Bold").text("BERITA ACARA PEMINDAHAN ARSIP", { align: "center" });
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica-Bold").text(`Nomor: ${batch.nomorBA || "..........................."}`, { align: "center" });
    doc.moveDown();
    const tanggal = this.formatTanggal(batch);
    doc.fontSize(10).font("Helvetica");
    doc.text(`Pada hari ini, ${tanggal}, kami yang bertanda tangan di bawah ini:`);
    doc.moveDown(0.5);
    doc.text(`    Unit Pengolah  : ${batch.unitKerjaId}`);
    doc.text(`    Unit Kearsipan : _________________________`);
    doc.moveDown();
    doc.text("Telah melakukan pemindahan arsip dari Unit Pengolah ke Unit Kearsipan, sesuai dengan ketentuan Jadwal Retensi Arsip (JRA) yang berlaku. Arsip yang dipindahkan telah melewati masa retensi aktif dan memenuhi persyaratan untuk dipindahkan ke Unit Kearsipan.");
    doc.moveDown();
    doc.text("Adapun arsip yang dipindahkan adalah sebagaimana daftar terlampir, dengan rincian sebagai berikut:");
    doc.moveDown();
    doc.font("Helvetica-Bold");
    doc.text(`Total Berkas   : ${batch.totalBerkas}`);
    doc.text(`Total Volume   : ${batch.totalVolume || "-"}`);
    doc.moveDown();
    this.drawBeritaAcaraTable(doc, batch.items);
    doc.moveDown(2);
    doc.fontSize(10).font("Helvetica");
    doc.text("Demikian Berita Acara Pemindahan Arsip ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.");
    doc.moveDown();
    if (batch.catatanPanitia) {
      doc.text(`Catatan: ${batch.catatanPanitia}`);
      doc.moveDown();
    }
    const sigY = doc.y + 20;
    doc.fontSize(this.FONT_SIZE.body);
    doc.text("Yang Menyerahkan,", this.MARGIN.left, sigY);
    doc.text("Pimpinan Unit Pengolah", this.MARGIN.left, sigY + 15);
    doc.text("____________________", this.MARGIN.left, sigY + 70);
    doc.text("NIP. ________________", this.MARGIN.left, sigY + 85);
    doc.text("Yang Menerima,", 350, sigY);
    doc.text("Pimpinan Unit Kearsipan", 350, sigY + 15);
    doc.text("____________________", 350, sigY + 70);
    doc.text("NIP. ________________", 350, sigY + 85);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // ==================== BERITA ACARA PEMUSNAHAN (Formulir 18) ====================
  async generateBeritaAcaraPemusnahan(penyusutanId) {
    const batch = await penyusutanService.findById(penyusutanId);
    if (!batch) throw new Error("Batch not found");
    const doc = new PDFDocument2({ size: "A4", layout: "portrait", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    this.addKopSurat(doc);
    doc.fontSize(this.FONT_SIZE.title).font("Helvetica-Bold").text("BERITA ACARA PEMUSNAHAN ARSIP", { align: "center" });
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica-Bold").text(`Nomor: ${batch.nomorBA || "..........................."}`, { align: "center" });
    doc.moveDown();
    const tanggal = this.formatTanggal(batch);
    doc.fontSize(10).font("Helvetica");
    doc.text(`Pada hari ini, ${tanggal}, bertempat di Kantor Kementerian ATR/BPN, kami yang bertanda tangan di bawah ini:`);
    doc.moveDown(0.5);
    doc.text(`    Unit Kerja : ${batch.unitKerjaId}`);
    doc.moveDown();
    doc.text("Berdasarkan pertimbangan panitia penilai penyusutan arsip, telah dilakukan pemusnahan terhadap arsip yang telah melampaui masa retensinya dan berketerangan musnah berdasarkan Jadwal Retensi Arsip (JRA) yang berlaku.");
    doc.moveDown();
    doc.text("Pemusnahan arsip dilakukan dengan cara:");
    doc.moveDown(0.3);
    doc.text("    \u25A1  Dibakar");
    doc.text("    \u25A1  Dicacah");
    doc.text("    \u25A1  Dilebur");
    doc.text("    \u25A1  Lainnya: _______________");
    doc.moveDown();
    doc.text("Adapun arsip yang dimusnahkan adalah sebagai berikut:");
    doc.moveDown();
    doc.font("Helvetica-Bold");
    doc.text(`Total Berkas   : ${batch.totalBerkas}`);
    doc.text(`Total Volume   : ${batch.totalVolume || "-"}`);
    doc.moveDown();
    this.drawBeritaAcaraTable(doc, batch.items);
    doc.moveDown(2);
    doc.fontSize(10).font("Helvetica");
    doc.text("Demikian Berita Acara Pemusnahan Arsip ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.");
    doc.moveDown();
    if (batch.catatanPanitia) {
      doc.text(`Catatan Panitia: ${batch.catatanPanitia}`);
      doc.moveDown();
    }
    const sigY = doc.y + 20;
    doc.fontSize(this.FONT_SIZE.body);
    doc.text("Mengetahui,", this.MARGIN.left, sigY);
    doc.text("Pimpinan Unit Kerja", this.MARGIN.left, sigY + 15);
    doc.text("____________________", this.MARGIN.left, sigY + 70);
    doc.text("NIP. ________________", this.MARGIN.left, sigY + 85);
    doc.text("Ketua Tim", 220, sigY);
    doc.text("Penilai Arsip", 220, sigY + 15);
    doc.text("____________________", 220, sigY + 70);
    doc.text("NIP. ________________", 220, sigY + 85);
    doc.text("Pelaksana", 400, sigY);
    doc.text("Pemusnahan", 400, sigY + 15);
    doc.text("____________________", 400, sigY + 70);
    doc.text("NIP. ________________", 400, sigY + 85);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // ==================== BERITA ACARA ALIH MEDIA ====================
  async generateBeritaAcaraAlihMedia(penyusutanId) {
    const batch = await penyusutanService.findById(penyusutanId);
    if (!batch) throw new Error("Batch not found");
    const doc = new PDFDocument2({ size: "A4", layout: "portrait", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    this.addKopSurat(doc);
    doc.fontSize(this.FONT_SIZE.title).font("Helvetica-Bold").text("BERITA ACARA ALIH MEDIA ARSIP", { align: "center" });
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica-Bold").text(`Nomor: ${batch.nomorBA || "..........................."}`, { align: "center" });
    doc.moveDown();
    const tanggal = this.formatTanggal(batch);
    doc.fontSize(10).font("Helvetica");
    doc.text(`Pada hari ini, ${tanggal}, kami yang bertanda tangan di bawah ini:`);
    doc.moveDown(0.5);
    doc.text(`    Unit Kerja : ${batch.unitKerjaId}`);
    doc.moveDown();
    doc.text("Telah melakukan alih media terhadap arsip dari bentuk media asal ke bentuk media tujuan, sesuai dengan ketentuan peraturan perundang-undangan yang berlaku. Proses alih media dilaksanakan dengan memperhatikan keautentikan, keutuhan, keamanan, dan keselamatan informasi arsip.");
    doc.moveDown();
    doc.text("Alih media dilakukan:");
    doc.moveDown(0.3);
    doc.text("    Media Asal   : \u25A1 Kertas  \u25A1 Mikrofilm  \u25A1 Media Lainnya: _________");
    doc.text("    Media Tujuan : \u25A1 Digital (PDF/A)  \u25A1 Mikrofilm  \u25A1 Media Lainnya: _________");
    doc.text("    Resolusi     : ___________ DPI");
    doc.text("    Format File  : \u25A1 PDF/A  \u25A1 TIFF  \u25A1 JPEG  \u25A1 Lainnya: _________");
    doc.moveDown();
    doc.text("Adapun arsip yang telah dialih-mediakan adalah sebagai berikut:");
    doc.moveDown();
    doc.font("Helvetica-Bold");
    doc.text(`Total Berkas   : ${batch.totalBerkas}`);
    doc.text(`Total Volume   : ${batch.totalVolume || "-"}`);
    doc.moveDown();
    const cols = [
      { header: "No", width: 25 },
      { header: "Kode Klasifikasi", width: 70 },
      { header: "Uraian Arsip", width: 150 },
      { header: "Kurun Waktu", width: 65 },
      { header: "Jumlah", width: 35 },
      { header: "Media Asal", width: 55 },
      { header: "Media Tujuan", width: 55 },
      { header: "Ket.", width: 45 }
    ];
    let x = this.MARGIN.left;
    const startY = doc.y;
    doc.fontSize(this.FONT_SIZE.small).font("Helvetica-Bold");
    cols.forEach((col) => {
      doc.rect(x, startY, col.width, 18).stroke();
      doc.text(col.header, x + 2, startY + 3, { width: col.width - 4, align: "center" });
      x += col.width;
    });
    doc.font("Helvetica").fontSize(this.FONT_SIZE.small);
    let y = startY + 18;
    for (const item of batch.items) {
      if (y > 700) {
        doc.addPage();
        y = this.MARGIN.top;
      }
      x = this.MARGIN.left;
      const rowHeight = 16;
      const a = item.arsip;
      const values = [
        String(item.nomorUrut || "-"),
        a?.kodeKlasifikasi || "-",
        a?.uraianBerkas || a?.uraianItem || "-",
        a?.kurunWaktu || "-",
        String(a?.jumlah || 1),
        "Kertas",
        "Digital",
        item.keterangan || a?.keterangan || "-"
      ];
      cols.forEach((col, i) => {
        doc.rect(x, y, col.width, rowHeight).stroke();
        doc.text(values[i], x + 2, y + 2, {
          width: col.width - 4,
          height: rowHeight - 4,
          ellipsis: true
        });
        x += col.width;
      });
      y += rowHeight;
    }
    doc.moveDown(2);
    doc.fontSize(10).font("Helvetica");
    doc.text("Hasil alih media telah diverifikasi dan dinyatakan sesuai dengan arsip asli. Demikian Berita Acara Alih Media Arsip ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.");
    doc.moveDown();
    if (batch.catatanPanitia) {
      doc.text(`Catatan: ${batch.catatanPanitia}`);
      doc.moveDown();
    }
    const sigY = doc.y + 20;
    doc.fontSize(this.FONT_SIZE.body);
    doc.text("Mengetahui,", this.MARGIN.left, sigY);
    doc.text("Pimpinan Unit Kearsipan", this.MARGIN.left, sigY + 15);
    doc.text("____________________", this.MARGIN.left, sigY + 70);
    doc.text("NIP. ________________", this.MARGIN.left, sigY + 85);
    doc.text("Pelaksana Alih Media,", 350, sigY);
    doc.text("Arsiparis/Pengelola Arsip", 350, sigY + 15);
    doc.text("____________________", 350, sigY + 70);
    doc.text("NIP. ________________", 350, sigY + 85);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // ==================== BERITA ACARA PENYERAHAN (Formulir 17) ====================
  async generateBeritaAcaraPenyerahan(penyusutanId) {
    const batch = await penyusutanService.findById(penyusutanId);
    if (!batch) throw new Error("Batch not found");
    const doc = new PDFDocument2({ size: "A4", layout: "portrait", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    this.addKopSurat(doc);
    doc.fontSize(this.FONT_SIZE.title).font("Helvetica-Bold").text("BERITA ACARA PENYERAHAN ARSIP STATIS", { align: "center" });
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica-Bold").text(`Nomor: ${batch.nomorBA || "..........................."}`, { align: "center" });
    doc.moveDown();
    const tanggal = this.formatTanggal(batch);
    doc.fontSize(10).font("Helvetica");
    doc.text(`Pada hari ini, ${tanggal}, kami yang bertanda tangan di bawah ini:`);
    doc.moveDown(0.5);
    doc.text("PIHAK PERTAMA (Yang Menyerahkan):");
    doc.text(`    Unit Kerja : ${batch.unitKerjaId}`);
    doc.text("    Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional");
    doc.moveDown(0.5);
    doc.text("PIHAK KEDUA (Yang Menerima):");
    doc.text("    Arsip Nasional Republik Indonesia (ANRI)");
    doc.text("    Jl. Ampera Raya No. 7, Cilandak, Jakarta Selatan");
    doc.moveDown();
    doc.text("Telah dilakukan penyerahan arsip statis dari Pihak Pertama kepada Pihak Kedua, sesuai dengan ketentuan peraturan perundang-undangan yang berlaku mengenai kearsipan. Arsip yang diserahkan telah memenuhi kriteria sebagai arsip statis yang memiliki nilai guna kesejarahan.");
    doc.moveDown();
    doc.text("Adapun arsip yang diserahkan adalah sebagai berikut:");
    doc.moveDown();
    doc.font("Helvetica-Bold");
    doc.text(`Total Berkas   : ${batch.totalBerkas}`);
    doc.text(`Total Volume   : ${batch.totalVolume || "-"}`);
    doc.moveDown();
    this.drawBeritaAcaraTable(doc, batch.items);
    doc.moveDown(2);
    doc.fontSize(10).font("Helvetica");
    doc.text("Demikian Berita Acara Penyerahan Arsip Statis ini dibuat dalam rangkap 2 (dua) bermeterai cukup, masing-masing mempunyai kekuatan hukum yang sama, untuk dapat dipergunakan sebagaimana mestinya.");
    doc.moveDown();
    if (batch.catatanPanitia) {
      doc.text(`Catatan: ${batch.catatanPanitia}`);
      doc.moveDown();
    }
    const sigY = doc.y + 20;
    doc.fontSize(this.FONT_SIZE.body);
    doc.text("PIHAK PERTAMA,", this.MARGIN.left, sigY);
    doc.text("Yang Menyerahkan", this.MARGIN.left, sigY + 12);
    doc.text("Pimpinan Unit Kearsipan", this.MARGIN.left, sigY + 24);
    doc.text("____________________", this.MARGIN.left, sigY + 80);
    doc.text("NIP. ________________", this.MARGIN.left, sigY + 95);
    doc.text("PIHAK KEDUA,", 350, sigY);
    doc.text("Yang Menerima", 350, sigY + 12);
    doc.text("Kepala ANRI/Pejabat Berwenang", 350, sigY + 24);
    doc.text("____________________", 350, sigY + 80);
    doc.text("NIP. ________________", 350, sigY + 95);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // ==================== BACKWARD-COMPATIBLE DISPATCHER ====================
  /**
   * Generic Berita Acara generator - dispatches to type-specific methods
   * Kept for backward compatibility with existing route
   */
  async generateBeritaAcara(penyusutanId) {
    const batch = await penyusutanService.findById(penyusutanId);
    if (!batch) throw new Error("Batch not found");
    switch (batch.jenisPenyusutan) {
      case "pemindahan":
        return this.generateBeritaAcaraPemindahan(penyusutanId);
      case "pemusnahan":
        return this.generateBeritaAcaraPemusnahan(penyusutanId);
      case "alih_media":
        return this.generateBeritaAcaraAlihMedia(penyusutanId);
      case "penyerahan":
        return this.generateBeritaAcaraPenyerahan(penyusutanId);
      default:
        return this.generateBeritaAcaraPemindahan(penyusutanId);
    }
  }
  // ==================== SURAT PERMOHONAN ARSIP STATIS (Formulir 24) ====================
  async generateSuratPermohonanPenyerahan(penyusutanId) {
    const batch = await penyusutanService.findById(penyusutanId);
    if (!batch) throw new Error("Batch not found");
    const doc = new PDFDocument2({ size: "A4", layout: "portrait", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    this.addKopSurat(doc);
    const tanggal = this.formatTanggal(batch);
    const nomor = batch.nomorBA ? batch.nomorBA.replace("BA", "SP") : "...........................";
    doc.fontSize(this.FONT_SIZE.body).font("Helvetica");
    doc.text(`Jakarta, ${tanggal}`, { align: "right" });
    doc.moveDown();
    const startY = doc.y;
    doc.text(`Nomor     : ${nomor}`);
    doc.text(`Sifat     : Biasa`);
    doc.text(`Lampiran  : 1 (satu) berkas`);
    doc.text(`Hal       : Penyerahan Arsip Statis`);
    doc.moveDown(2);
    doc.text("Yth. Kepala Arsip Nasional Republik Indonesia");
    doc.text("di Jakarta");
    doc.moveDown(2);
    doc.text("Sesuai dengan Jadwal Retensi Arsip (JRA) dan berdasarkan penilaian kembali arsip, dengan ini kami sampaikan bahwa arsip-arsip sebagaimana terlampir telah dinilai sebagai arsip statis dan telah habis masa retensinya di unit kerja kami.", { align: "justify" });
    doc.moveDown();
    doc.text("Sehubungan dengan hal tersebut, kami mengajukan permohonan untuk menyerahkan arsip statis tersebut kepada Arsip Nasional Republik Indonesia (ANRI) sesuai dengan ketentuan peraturan perundang-undangan yang berlaku.", { align: "justify" });
    doc.moveDown();
    doc.text("Demikian surat permohonan ini kami sampaikan, atas perhatian dan kerjasamanya diucapkan terima kasih.", { align: "justify" });
    doc.moveDown(3);
    const sigX = 350;
    doc.text("Pimpinan Unit Kerja,", sigX, doc.y);
    doc.moveDown(4);
    doc.text("____________________", sigX, doc.y);
    doc.text("NIP. ________________", sigX, doc.y);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // ==================== SHARED HELPERS ====================
  /**
   * Add KOP SURAT header
   */
  addKopSurat(doc) {
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica-Bold").text("KEMENTERIAN AGRARIA DAN TATA RUANG/", { align: "center" }).text("BADAN PERTANAHAN NASIONAL", { align: "center" });
    doc.moveDown(0.5);
  }
  /**
   * Format tanggal from batch data
   */
  formatTanggal(batch) {
    return batch.tanggalPelaksanaan || batch.tanggalPersetujuan || (/* @__PURE__ */ new Date()).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  }
  /**
   * Draw standard items table for daftar usul templates
   */
  drawItemTable(doc, cols, items, batch) {
    let x = this.MARGIN.left;
    const startY = doc.y;
    doc.fontSize(this.FONT_SIZE.small).font("Helvetica-Bold");
    cols.forEach((col) => {
      doc.rect(x, startY, col.width, 20).stroke();
      doc.text(col.header, x + 2, startY + 3, { width: col.width - 4, align: "center" });
      x += col.width;
    });
    doc.font("Helvetica").fontSize(this.FONT_SIZE.small);
    let y = startY + 20;
    for (const item of items) {
      if (y > 500) {
        doc.addPage();
        y = this.MARGIN.top;
      }
      x = this.MARGIN.left;
      const rowHeight = 18;
      const a = item.arsip;
      const values = [
        String(item.nomorUrut || "-"),
        a?.kodeKlasifikasi || "-",
        a?.uraianBerkas || a?.uraianItem || "-",
        a?.kurunWaktu || "-",
        String(a?.jumlah || 1),
        a?.tingkatPerkembangan || "-",
        a?.jraKode || "-",
        a?.retensiAktif || "-",
        a?.retensiInaktif || "-",
        item.keterangan || a?.keterangan || "-"
      ];
      cols.forEach((col, i) => {
        doc.rect(x, y, col.width, rowHeight).stroke();
        doc.text(values[i], x + 2, y + 3, {
          width: col.width - 4,
          height: rowHeight - 4,
          ellipsis: true
        });
        x += col.width;
      });
      y += rowHeight;
    }
    const footerY = y + 20;
    doc.fontSize(this.FONT_SIZE.body);
    doc.text(`Total Berkas: ${batch.totalBerkas}`, this.MARGIN.left, footerY);
  }
  /**
   * Draw standard berita acara items table (portrait layout)
   */
  drawBeritaAcaraTable(doc, items) {
    const cols = [
      { header: "No", width: 25 },
      { header: "Kode Klasifikasi", width: 80 },
      { header: "Uraian Arsip", width: 180 },
      { header: "Kurun Waktu", width: 70 },
      { header: "Jumlah", width: 40 },
      { header: "Ket.", width: 100 }
    ];
    let x = this.MARGIN.left;
    const startY = doc.y;
    doc.fontSize(this.FONT_SIZE.small).font("Helvetica-Bold");
    cols.forEach((col) => {
      doc.rect(x, startY, col.width, 18).stroke();
      doc.text(col.header, x + 2, startY + 3, { width: col.width - 4, align: "center" });
      x += col.width;
    });
    doc.font("Helvetica").fontSize(this.FONT_SIZE.small);
    let y = startY + 18;
    for (const item of items) {
      if (y > 700) {
        doc.addPage();
        y = this.MARGIN.top;
      }
      x = this.MARGIN.left;
      const rowHeight = 16;
      const a = item.arsip;
      const values = [
        String(item.nomorUrut || "-"),
        a?.kodeKlasifikasi || "-",
        a?.uraianBerkas || a?.uraianItem || "-",
        a?.kurunWaktu || "-",
        String(a?.jumlah || 1),
        item.keterangan || a?.keterangan || "-"
      ];
      cols.forEach((col, i) => {
        doc.rect(x, y, col.width, rowHeight).stroke();
        doc.text(values[i], x + 2, y + 2, {
          width: col.width - 4,
          height: rowHeight - 4,
          ellipsis: true
        });
        x += col.width;
      });
      y += rowHeight;
    }
  }
  /**
   * Add standard signature block to document
   */
  addSignatureBlock(doc, startY, batch) {
    doc.fontSize(this.FONT_SIZE.body);
    doc.text("Mengetahui,", this.MARGIN.left, startY);
    doc.text("Kepala Sub Bagian Tata Usaha", this.MARGIN.left, startY + 15);
    doc.text("____________________", this.MARGIN.left, startY + 70);
    doc.text("NIP. ________________", this.MARGIN.left, startY + 85);
    const tanggal = this.formatTanggal(batch);
    doc.text(tanggal, 350, startY);
    doc.text("Arsiparis/Pengelola Arsip", 350, startY + 15);
    doc.text("____________________", 350, startY + 70);
    doc.text("NIP. ________________", 350, startY + 85);
  }
  // ==================== ARSIP VITAL & TERJAGA ====================
  async generateDaftarArsipVital(unitKerjaId) {
    const { data } = await import("./arsip-vital.service-4RZN3R2G.js").then((m) => m.arsipVitalService.findAll({ unitKerjaId, limit: 1e3 }));
    const doc = new PDFDocument2({ size: "A4", layout: "landscape", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    this.addHeader(doc, "DAFTAR ARSIP VITAL");
    doc.fontSize(this.FONT_SIZE.body).text(`Unit Kerja: ${unitKerjaId}`).text(`Tanggal Cetak: ${(/* @__PURE__ */ new Date()).toLocaleDateString("id-ID")}`);
    doc.moveDown();
    const cols = [
      { header: "No", width: 30 },
      { header: "No. Berkas", width: 70 },
      { header: "Kode Klas.", width: 60 },
      { header: "Uraian Informasi", width: 170 },
      { header: "Kurun Waktu", width: 70 },
      { header: "Media", width: 60 },
      { header: "Lokasi Simpan", width: 80 },
      { header: "Ket.", width: 60 }
    ];
    let y = doc.y;
    this.drawTableHeaders(doc, cols, y, this.MARGIN.left);
    y += 20;
    doc.font("Helvetica").fontSize(this.FONT_SIZE.small);
    data.forEach((item, index) => {
      if (y > 500) {
        doc.addPage();
        y = this.MARGIN.top;
        this.drawTableHeaders(doc, cols, y, this.MARGIN.left);
        y += 20;
      }
      const values = [
        String(index + 1),
        item.nomorBerkas || "-",
        item.kodeKlasifikasi || "-",
        item.uraianBerkas || "-",
        item.kurunWaktu || "-",
        // Need to ensure these fields exist in join
        "Kertas",
        // Default or fetch
        item.lokasiBackup || "-",
        item.kategoriVital || "-"
      ];
      this.drawTableRow(doc, cols, values, y, this.MARGIN.left);
      y += 18;
    });
    doc.moveDown(2);
    this.addSignature(doc, "Pimpinan Unit Kearsipan", y + 30);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  async generateDaftarArsipTerjaga(unitKerjaId) {
    const { data } = await import("./arsip-terjaga.service-AJ5H4OLI.js").then((m) => m.arsipTerjagaService.findAll({ unitKerjaId, limit: 1e3 }));
    const doc = new PDFDocument2({ size: "A4", layout: "landscape", margin: this.MARGIN.left });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    this.addHeader(doc, "DAFTAR ARSIP TERJAGA");
    doc.fontSize(this.FONT_SIZE.body).text(`Unit Kerja: ${unitKerjaId}`).text(`Tanggal Cetak: ${(/* @__PURE__ */ new Date()).toLocaleDateString("id-ID")}`);
    doc.moveDown();
    const cols = [
      { header: "No", width: 30 },
      { header: "No. Berkas", width: 70 },
      { header: "Kode Klas.", width: 60 },
      { header: "Uraian Informasi", width: 170 },
      { header: "Kurun Waktu", width: 70 },
      { header: "Pencipta", width: 80 },
      { header: "Kondisi", width: 60 },
      { header: "Ket.", width: 60 }
    ];
    let y = doc.y;
    this.drawTableHeaders(doc, cols, y, this.MARGIN.left);
    y += 20;
    doc.font("Helvetica").fontSize(this.FONT_SIZE.small);
    data.forEach((item, index) => {
      if (y > 500) {
        doc.addPage();
        y = this.MARGIN.top;
        this.drawTableHeaders(doc, cols, y, this.MARGIN.left);
        y += 20;
      }
      const values = [
        String(index + 1),
        item.nomorBerkas || "-",
        item.kodeKlasifikasi || "-",
        item.uraianBerkas || "-",
        item.kurunWaktu || "-",
        "ATR/BPN",
        // Default
        "Baik",
        item.kategoriTerjaga || "-"
      ];
      this.drawTableRow(doc, cols, values, y, this.MARGIN.left);
      y += 18;
    });
    doc.moveDown(2);
    this.addSignature(doc, "Pimpinan Unit Kearsipan", y + 30);
    doc.end();
    return new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
  // Helpers (assuming they don't exist, I'll check file content or add them inline/private if needed, but keeping it simple)
  // Actually, I should use the existing private methods if valid, or just implement inline as above. 
  // The previous code had inline drawing. I'll stick to that style or minimal duplication.
  addHeader(doc, title) {
    doc.fontSize(this.FONT_SIZE.title).font("Helvetica-Bold").text(title, { align: "center" });
    doc.fontSize(this.FONT_SIZE.subtitle).font("Helvetica").text("KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL", { align: "center" });
    doc.moveDown(0.5);
  }
  drawTableHeaders(doc, cols, y, startX) {
    doc.fontSize(this.FONT_SIZE.small).font("Helvetica-Bold");
    let x = startX;
    cols.forEach((col) => {
      doc.rect(x, y, col.width, 20).stroke();
      doc.text(col.header, x + 2, y + 5, { width: col.width - 4, align: "center" });
      x += col.width;
    });
  }
  drawTableRow(doc, cols, values, y, startX) {
    let x = startX;
    const rowHeight = 18;
    cols.forEach((col, i) => {
      doc.rect(x, y, col.width, rowHeight).stroke();
      doc.text(values[i], x + 2, y + 4, { width: col.width - 4, height: rowHeight - 4, ellipsis: true });
      x += col.width;
    });
  }
  addSignature(doc, role, y) {
    const x = 500;
    doc.text(`Jakarta, ${(/* @__PURE__ */ new Date()).toLocaleDateString("id-ID")}`, x, y);
    doc.text(role + ",", x, y + 15);
    doc.moveDown(4);
    doc.text("____________________", x, doc.y + 40);
  }
};
var printTemplateService = new PrintTemplateService();

// src/routes/penyusutan.routes.ts
var router25 = Router25();
router25.use(authMiddleware);
router25.get("/print/daftar-arsip-aktif", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const pdf = await printTemplateService.generateDaftarArsipAktif(
      unitKerjaId,
      tahun ? Number(tahun) : void 0
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=daftar-arsip-aktif-${unitKerjaId}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
router25.get("/print/daftar-arsip-inaktif", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const pdf = await printTemplateService.generateDaftarArsipInaktif(
      unitKerjaId,
      tahun ? Number(tahun) : void 0
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=daftar-arsip-inaktif-${unitKerjaId}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
router25.get("/candidates", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { type } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    if (!type || typeof type !== "string") {
      return res.status(400).json({ error: "type (pemindahan|pemusnahan|penyerahan) is required" });
    }
    const candidates = await penyusutanService.getCandidates(unitKerjaId, type);
    res.json({ success: true, data: candidates, total: candidates.length });
  } catch (error) {
    next(error);
  }
});
router25.get("/", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { jenisPenyusutan, status, page, limit } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const result = await penyusutanService.findAll({
      unitKerjaId,
      jenisPenyusutan,
      status,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router25.get("/:id", async (req, res, next) => {
  try {
    const result = await penyusutanService.findById(String(req.params.id));
    if (!result) {
      return res.status(404).json({ error: "Batch not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router25.post("/", canWriteMiddleware(), sensitiveLimiter, validateBody(createPenyusutanSchema), async (req, res, next) => {
  try {
    const { jenisPenyusutan, nomorBA, keterangan, arsipIds } = req.body;
    const unitKerjaId = req.body.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId || !jenisPenyusutan || !arsipIds || !Array.isArray(arsipIds)) {
      return res.status(400).json({
        error: "unitKerjaId, jenisPenyusutan, and arsipIds[] are required"
      });
    }
    const result = await penyusutanService.create({
      unitKerjaId,
      jenisPenyusutan,
      nomorBA,
      keterangan,
      arsipIds,
      createdBy: req.user?.id
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router25.put("/:id/status", canWriteMiddleware(), sensitiveLimiter, validateBody(updatePenyusutanStatusSchema), async (req, res, next) => {
  try {
    const { catatan } = req.body;
    const result = await penyusutanService.updateStatus(String(req.params.id), {
      catatan,
      user: req.user ? {
        id: req.user.id,
        role: req.user.role,
        unitKerjaId: req.user.unitKerjaId || ""
      } : void 0
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message?.includes("Cannot advance")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router25.post("/:id/items", canWriteMiddleware(), async (req, res, next) => {
  try {
    const { arsipIds } = req.body;
    if (!arsipIds || !Array.isArray(arsipIds)) {
      return res.status(400).json({ error: "arsipIds[] is required" });
    }
    const result = await penyusutanService.addItems(String(req.params.id), arsipIds);
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.message?.includes("draft")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router25.delete("/:id/items", canWriteMiddleware(), sensitiveLimiter, validateBody(removePenyusutanItemsSchema), async (req, res, next) => {
  try {
    const { arsipIds } = req.body;
    if (!arsipIds || !Array.isArray(arsipIds)) {
      return res.status(400).json({ error: "arsipIds[] is required" });
    }
    const result = await penyusutanService.removeItems(String(req.params.id), arsipIds);
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.message?.includes("draft")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router25.delete("/:id", canWriteMiddleware(), sensitiveLimiter, async (req, res, next) => {
  try {
    const result = await penyusutanService.deleteBatch(String(req.params.id));
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.message?.includes("draft")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});
router25.get("/:id/print/usul-musnah", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const pdf = await printTemplateService.generateDaftarUsulMusnah(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=usul-musnah-${id}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
router25.get("/:id/print/usul-pindah", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const pdf = await printTemplateService.generateDaftarUsulPindah(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=usul-pindah-${id}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
router25.get("/:id/print/usul-serah", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const pdf = await printTemplateService.generateDaftarUsulSerah(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=usul-serah-${id}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
router25.get("/:id/print/berita-acara", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const pdf = await printTemplateService.generateBeritaAcara(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=berita-acara-${id}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
router25.get("/:id/print/berita-acara-pemindahan", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const pdf = await printTemplateService.generateBeritaAcaraPemindahan(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=ba-pemindahan-${id}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
router25.get("/:id/print/berita-acara-pemusnahan", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const pdf = await printTemplateService.generateBeritaAcaraPemusnahan(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=ba-pemusnahan-${id}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
router25.get("/:id/print/berita-acara-alih-media", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const pdf = await printTemplateService.generateBeritaAcaraAlihMedia(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=ba-alih-media-${id}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
router25.get("/:id/print/berita-acara-penyerahan", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const pdf = await printTemplateService.generateBeritaAcaraPenyerahan(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=ba-penyerahan-${id}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
router25.get("/:id/print/surat-permohonan-penyerahan", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const pdf = await printTemplateService.generateSuratPermohonanPenyerahan(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=surat-permohonan-${id}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
var penyusutan_routes_default = router25;

// src/routes/arsip-vital.routes.ts
import { Router as Router26 } from "express";
var router26 = Router26();
router26.get("/print/daftar", canReadMiddleware(), async (req, res, next) => {
  try {
    const unitKerjaId = req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) return res.status(400).json({ error: "Unit Kerja ID required" });
    const pdfBuffer = await printTemplateService.generateDaftarArsipVital(unitKerjaId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="daftar-arsip-vital-${unitKerjaId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});
router26.use(authMiddleware);
router26.get("/", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { kategoriVital, tingkatKekritisan, statusProteksi, search, page, limit } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const result = await arsipVitalService.findAll({
      unitKerjaId,
      kategoriVital,
      tingkatKekritisan,
      statusProteksi,
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router26.get("/stats", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const stats = await arsipVitalService.getStats(unitKerjaId);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});
router26.get("/due-review", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { daysAhead } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const data = await arsipVitalService.getDueForReview(
      unitKerjaId,
      daysAhead ? Number(daysAhead) : 30
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
router26.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await arsipVitalService.findById(id);
    if (!result) {
      return res.status(404).json({ error: "Arsip vital not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router26.post(
  "/",
  canWriteMiddleware(),
  validateBody(createArsipVitalSchema),
  async (req, res, next) => {
    try {
      const result = await arsipVitalService.create({
        ...req.body,
        createdBy: req.user?.id
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router26.put(
  "/:id",
  canWriteMiddleware(),
  validateBody(updateArsipVitalSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = await arsipVitalService.findById(id);
      if (!existing) {
        return res.status(404).json({ error: "Arsip vital not found" });
      }
      const result = await arsipVitalService.update(id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router26.delete("/:id", canWriteMiddleware(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await arsipVitalService.findById(id);
    if (!existing) {
      return res.status(404).json({ error: "Arsip vital not found" });
    }
    await arsipVitalService.delete(id);
    res.json({ success: true, message: "Arsip vital designation removed" });
  } catch (error) {
    next(error);
  }
});
var arsip_vital_routes_default = router26;

// src/routes/arsip-terjaga.routes.ts
import { Router as Router27 } from "express";
var router27 = Router27();
router27.get("/print/daftar", canReadMiddleware(), async (req, res, next) => {
  try {
    const unitKerjaId = req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) return res.status(400).json({ error: "Unit Kerja ID required" });
    const pdfBuffer = await printTemplateService.generateDaftarArsipTerjaga(unitKerjaId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="daftar-arsip-terjaga-${unitKerjaId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});
router27.use(authMiddleware);
router27.get("/", async (req, res, next) => {
  try {
    const { kategoriTerjaga, statusPelaporan, statusKepatuhan, search, page, limit } = req.query;
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const result = await arsipTerjagaService.findAll({
      unitKerjaId,
      kategoriTerjaga,
      statusPelaporan,
      statusKepatuhan,
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router27.get("/stats", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const stats = await arsipTerjagaService.getStats(unitKerjaId);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});
router27.get("/due-reporting", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { daysAhead } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const data = await arsipTerjagaService.getDueForReporting(
      unitKerjaId,
      daysAhead ? Number(daysAhead) : 30
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
router27.get("/laporan-anri", async (req, res, next) => {
  try {
    const unitKerjaId = req.query.unitKerjaId || req.user?.unitKerjaId || "ditjen";
    const { tahun } = req.query;
    if (!unitKerjaId) {
      return res.status(400).json({ error: "unitKerjaId is required" });
    }
    const data = await arsipTerjagaService.generateLaporanANRI(
      unitKerjaId,
      tahun ? Number(tahun) : void 0
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
router27.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await arsipTerjagaService.findById(id);
    if (!result) {
      return res.status(404).json({ error: "Arsip terjaga not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router27.post(
  "/",
  canWriteMiddleware(),
  validateBody(createArsipTerjagaSchema),
  async (req, res, next) => {
    try {
      const result = await arsipTerjagaService.create({
        ...req.body,
        createdBy: req.user?.id
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router27.put(
  "/:id",
  canWriteMiddleware(),
  validateBody(updateArsipTerjagaSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = await arsipTerjagaService.findById(id);
      if (!existing) {
        return res.status(404).json({ error: "Arsip terjaga not found" });
      }
      const result = await arsipTerjagaService.update(id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router27.put(
  "/:id/report",
  canWriteMiddleware(),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { nomorLaporan, tanggalPelaporan } = req.body;
      if (!nomorLaporan || !tanggalPelaporan) {
        return res.status(400).json({ error: "nomorLaporan and tanggalPelaporan are required" });
      }
      const existing = await arsipTerjagaService.findById(id);
      if (!existing) {
        return res.status(404).json({ error: "Arsip terjaga not found" });
      }
      const result = await arsipTerjagaService.markAsReported(id, nomorLaporan, tanggalPelaporan);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router27.delete("/:id", canWriteMiddleware(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await arsipTerjagaService.findById(id);
    if (!existing) {
      return res.status(404).json({ error: "Arsip terjaga not found" });
    }
    await arsipTerjagaService.delete(id);
    res.json({ success: true, message: "Arsip terjaga designation removed" });
  } catch (error) {
    next(error);
  }
});
var arsip_terjaga_routes_default = router27;

// src/routes/arsip-elektronik.routes.ts
import { Router as Router28 } from "express";

// src/services/arsip-elektronik.service.ts
import { eq as eq21, and as and17, desc as desc14, count as count2 } from "drizzle-orm";
var ArsipElektronikService = class {
  async findAll(filters = {}) {
    const { page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (filters.formatFile) conditions.push(eq21(arsipElektronik.formatFile, filters.formatFile));
    if (filters.statusVerifikasi) conditions.push(eq21(arsipElektronik.statusVerifikasi, filters.statusVerifikasi));
    if (filters.mediaAsal) conditions.push(eq21(arsipElektronik.mediaAsal, filters.mediaAsal));
    const whereClause = conditions.length > 0 ? and17(...conditions) : void 0;
    const [data, totalResult] = await Promise.all([
      db.select().from(arsipElektronik).where(whereClause).orderBy(desc14(arsipElektronik.createdAt)).limit(limit).offset(offset),
      db.select({ count: count2() }).from(arsipElektronik).where(whereClause)
    ]);
    return {
      data,
      total: totalResult[0]?.count || 0,
      page,
      limit,
      totalPages: Math.ceil((totalResult[0]?.count || 0) / limit)
    };
  }
  async findByArsipId(arsipId) {
    const results = await db.select().from(arsipElektronik).where(eq21(arsipElektronik.arsipId, arsipId)).orderBy(desc14(arsipElektronik.versiDokumen));
    return results;
  }
  async findById(id) {
    const results = await db.select().from(arsipElektronik).where(eq21(arsipElektronik.id, id));
    return results[0] || null;
  }
  async create(data) {
    const result = await db.insert(arsipElektronik).values({
      ...data,
      updatedAt: /* @__PURE__ */ new Date()
    }).returning();
    return result[0];
  }
  async update(id, data) {
    const result = await db.update(arsipElektronik).set({
      ...data,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq21(arsipElektronik.id, id)).returning();
    return result[0];
  }
  async verify(id, userId, status, catatan) {
    const result = await db.update(arsipElektronik).set({
      statusVerifikasi: status,
      verifiedBy: userId,
      verifiedAt: /* @__PURE__ */ new Date(),
      catatanVerifikasi: catatan || null,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq21(arsipElektronik.id, id)).returning();
    return result[0];
  }
  async delete(id) {
    await db.delete(arsipElektronik).where(eq21(arsipElektronik.id, id));
  }
  async findPendingVerification(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const whereClause = eq21(arsipElektronik.statusVerifikasi, "pending");
    const [data, totalResult] = await Promise.all([
      db.select().from(arsipElektronik).where(whereClause).orderBy(desc14(arsipElektronik.createdAt)).limit(limit).offset(offset),
      db.select({ count: count2() }).from(arsipElektronik).where(whereClause)
    ]);
    return {
      data,
      total: totalResult[0]?.count || 0,
      page,
      limit
    };
  }
  async getStats() {
    const [byFormat, byStatus, byMedia, totalResult] = await Promise.all([
      db.select({
        formatFile: arsipElektronik.formatFile,
        count: count2()
      }).from(arsipElektronik).groupBy(arsipElektronik.formatFile),
      db.select({
        statusVerifikasi: arsipElektronik.statusVerifikasi,
        count: count2()
      }).from(arsipElektronik).groupBy(arsipElektronik.statusVerifikasi),
      db.select({
        mediaAsal: arsipElektronik.mediaAsal,
        count: count2()
      }).from(arsipElektronik).groupBy(arsipElektronik.mediaAsal),
      db.select({ count: count2() }).from(arsipElektronik)
    ]);
    return {
      total: totalResult[0]?.count || 0,
      byFormat,
      byStatus,
      byMedia
    };
  }
  async addPreservationAction(data) {
    const { preservasiTrack } = await import("./preservasi-track-KVZUUUYE.js");
    const result = await db.insert(preservasiTrack).values({
      ...data,
      performedAt: /* @__PURE__ */ new Date()
    }).returning();
    return result[0];
  }
  async getPreservationHistory(arsipElektronikId) {
    const { preservasiTrack, users: users3 } = await import("./schema-X7T7ECFS.js");
    const results = await db.select({
      id: preservasiTrack.id,
      action: preservasiTrack.action,
      details: preservasiTrack.details,
      performedAt: preservasiTrack.performedAt,
      notes: preservasiTrack.notes,
      performedBy: {
        id: users3.id,
        name: users3.name,
        role: users3.role
      }
    }).from(preservasiTrack).leftJoin(users3, eq21(preservasiTrack.performedBy, users3.id)).where(eq21(preservasiTrack.arsipElektronikId, arsipElektronikId)).orderBy(desc14(preservasiTrack.performedAt));
    return results;
  }
};
var arsipElektronikService = new ArsipElektronikService();

// src/routes/arsip-elektronik.routes.ts
var router28 = Router28();
router28.use(authMiddleware);
router28.get("/", async (req, res, next) => {
  try {
    const filters = {
      formatFile: req.query.formatFile,
      statusVerifikasi: req.query.statusVerifikasi,
      mediaAsal: req.query.mediaAsal,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20
    };
    const result = await arsipElektronikService.findAll(filters);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router28.get("/stats", async (req, res, next) => {
  try {
    const stats = await arsipElektronikService.getStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});
router28.get("/pending", async (req, res, next) => {
  try {
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const result = await arsipElektronikService.findPendingVerification(page, limit);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router28.get("/arsip/:arsipId", async (req, res, next) => {
  try {
    const arsipId = String(req.params.arsipId);
    const data = await arsipElektronikService.findByArsipId(arsipId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});
router28.get("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const record = await arsipElektronikService.findById(id);
    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});
router28.post("/", async (req, res, next) => {
  try {
    const data = req.body;
    if (!data.arsipId || !data.formatFile) {
      return res.status(400).json({ error: "arsipId and formatFile are required" });
    }
    const result = await arsipElektronikService.create(data);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});
router28.put("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await arsipElektronikService.update(id, req.body);
    if (!result) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router28.post("/:id/verify", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const { status, catatan } = req.body;
    if (!status || !["verified", "rejected"].includes(status)) {
      return res.status(400).json({ error: 'status must be "verified" or "rejected"' });
    }
    const userId = req.user?.id || "system";
    const result = await arsipElektronikService.verify(id, userId, status, catatan);
    if (!result) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router28.post("/:id/preservasi", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const { action, details, notes } = req.body;
    const userId = req.user?.id;
    if (!action) {
      return res.status(400).json({ error: "action is required" });
    }
    const result = await arsipElektronikService.addPreservationAction({
      arsipElektronikId: id,
      action,
      details: typeof details === "object" ? JSON.stringify(details) : details,
      performedBy: userId,
      notes
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});
router28.get("/:id/preservasi", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const history = await arsipElektronikService.getPreservationHistory(id);
    res.json(history);
  } catch (error) {
    next(error);
  }
});
router28.delete("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await arsipElektronikService.delete(id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
var arsip_elektronik_routes_default = router28;

// src/routes/tunjuk-silang.routes.ts
import { Router as Router29 } from "express";

// src/services/tunjuk-silang.service.ts
import { eq as eq22, or as or9, and as and18, desc as desc15, count as count3 } from "drizzle-orm";
var VALID_ENTITY_TYPES = ["arsip", "surat_masuk", "surat_keluar", "dosir"];
var VALID_RELASI_TYPES = ["balasan", "tindak_lanjut", "lampiran", "referensi", "revisi", "duplikat", "berkaitan"];
var TunjukSilangService = class {
  /**
   * Create a cross-reference between two entities
   */
  async create(data) {
    if (!VALID_ENTITY_TYPES.includes(data.sourceType)) {
      throw new Error(`Invalid sourceType: ${data.sourceType}`);
    }
    if (!VALID_ENTITY_TYPES.includes(data.targetType)) {
      throw new Error(`Invalid targetType: ${data.targetType}`);
    }
    if (!VALID_RELASI_TYPES.includes(data.jenisRelasi)) {
      throw new Error(`Invalid jenisRelasi: ${data.jenisRelasi}`);
    }
    const result = await db.insert(tunjukSilang).values(data).returning();
    return result[0];
  }
  /**
   * Find all cross-references for a given entity (both as source and target)
   */
  async findByEntity(entityType, entityId) {
    const results = await db.select().from(tunjukSilang).where(
      or9(
        and18(
          eq22(tunjukSilang.sourceType, entityType),
          eq22(tunjukSilang.sourceId, entityId)
        ),
        and18(
          eq22(tunjukSilang.targetType, entityType),
          eq22(tunjukSilang.targetId, entityId)
        )
      )
    ).orderBy(desc15(tunjukSilang.createdAt));
    return results.map((ref) => {
      const isSource = ref.sourceType === entityType && ref.sourceId === entityId;
      return {
        ...ref,
        direction: isSource ? "outgoing" : "incoming",
        relatedType: isSource ? ref.targetType : ref.sourceType,
        relatedId: isSource ? ref.targetId : ref.sourceId
      };
    });
  }
  /**
   * Find a single cross-reference by ID
   */
  async findById(id) {
    const results = await db.select().from(tunjukSilang).where(eq22(tunjukSilang.id, id));
    return results[0] || null;
  }
  /**
   * Delete a cross-reference
   */
  async delete(id) {
    await db.delete(tunjukSilang).where(eq22(tunjukSilang.id, id));
  }
  /**
   * List all cross-references with pagination
   */
  async findAll(filters = {}) {
    const { page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (filters.jenisRelasi) conditions.push(eq22(tunjukSilang.jenisRelasi, filters.jenisRelasi));
    const whereClause = conditions.length > 0 ? and18(...conditions) : void 0;
    const [data, totalResult] = await Promise.all([
      db.select().from(tunjukSilang).where(whereClause).orderBy(desc15(tunjukSilang.createdAt)).limit(limit).offset(offset),
      db.select({ count: count3() }).from(tunjukSilang).where(whereClause)
    ]);
    return {
      data,
      total: totalResult[0]?.count || 0,
      page,
      limit,
      totalPages: Math.ceil((totalResult[0]?.count || 0) / limit)
    };
  }
  /**
   * Get statistics about cross-references
   */
  async getStats() {
    const [byRelasi, byType, totalResult] = await Promise.all([
      db.select({
        jenisRelasi: tunjukSilang.jenisRelasi,
        count: count3()
      }).from(tunjukSilang).groupBy(tunjukSilang.jenisRelasi),
      db.select({
        sourceType: tunjukSilang.sourceType,
        count: count3()
      }).from(tunjukSilang).groupBy(tunjukSilang.sourceType),
      db.select({ count: count3() }).from(tunjukSilang)
    ]);
    return { total: totalResult[0]?.count || 0, byRelasi, byType };
  }
};
var tunjukSilangService = new TunjukSilangService();

// src/routes/tunjuk-silang.routes.ts
var router29 = Router29();
router29.use(authMiddleware);
router29.get("/", async (req, res, next) => {
  try {
    const filters = {
      jenisRelasi: req.query.jenisRelasi,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20
    };
    const result = await tunjukSilangService.findAll(filters);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router29.get("/stats", async (req, res, next) => {
  try {
    const stats = await tunjukSilangService.getStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});
router29.get("/:type/:id", async (req, res, next) => {
  try {
    const entityType = String(req.params.type);
    const entityId = String(req.params.id);
    const references = await tunjukSilangService.findByEntity(entityType, entityId);
    res.json({ data: references });
  } catch (error) {
    next(error);
  }
});
router29.post("/", async (req, res, next) => {
  try {
    const { sourceType, sourceId, targetType, targetId, jenisRelasi, keterangan } = req.body;
    if (!sourceType || !sourceId || !targetType || !targetId || !jenisRelasi) {
      return res.status(400).json({
        error: "sourceType, sourceId, targetType, targetId, and jenisRelasi are required"
      });
    }
    const userId = req.user?.id;
    const result = await tunjukSilangService.create({
      sourceType,
      sourceId,
      targetType,
      targetId,
      jenisRelasi,
      keterangan: keterangan || null,
      createdBy: userId
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});
router29.delete("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await tunjukSilangService.delete(id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
var tunjuk_silang_routes_default = router29;

// src/routes/autentikasi.routes.ts
import { Router as Router30 } from "express";

// src/services/autentikasi.service.ts
import { eq as eq23, desc as desc16, ilike as ilike7, and as and19, gte as gte7, lte as lte8, inArray as inArray5, sql as sql15 } from "drizzle-orm";
import PDFDocument3 from "pdfkit";
import fs from "fs";
import path3 from "path";
var AutentikasiService = class {
  async create(data) {
    return await db.transaction(async (tx) => {
      const [newAutentikasi] = await tx.insert(autentikasi).values({
        nomorBeritaAcara: data.nomorBeritaAcara,
        tanggalAutentikasi: data.tanggalAutentikasi,
        kegiatan: data.kegiatan,
        dilakukanOleh: data.userId,
        jabatanPenandaTangan: data.jabatanPenandaTangan,
        tempatDilakukan: data.tempatDilakukan,
        jumlahArsip: data.itemArsipIds.length
      }).returning();
      await tx.update(arsipElektronik).set({ autentikasiId: newAutentikasi.id }).where(inArray5(arsipElektronik.id, data.itemArsipIds));
      const pdfPath = await this.generateBeritaAcaraPdf(newAutentikasi.id, tx);
      const [updated] = await tx.update(autentikasi).set({ fileLampiran: pdfPath }).where(eq23(autentikasi.id, newAutentikasi.id)).returning();
      return updated;
    });
  }
  async findAll(query) {
    const { page = 1, limit = 20, search, tanggalDari, tanggalSampai } = query;
    const offset = (page - 1) * limit;
    const whereClause = and19(
      search ? ilike7(autentikasi.nomorBeritaAcara, `%${search}%`) : void 0,
      tanggalDari ? gte7(autentikasi.tanggalAutentikasi, tanggalDari) : void 0,
      tanggalSampai ? lte8(autentikasi.tanggalAutentikasi, tanggalSampai) : void 0
    );
    const data = await db.query.autentikasi.findMany({
      where: whereClause,
      with: {
        petugas: {
          columns: {
            id: true,
            name: true,
            nip: true,
            jabatan: true
          }
        }
      },
      limit,
      offset,
      orderBy: [desc16(autentikasi.createdAt)]
    });
    const [countResult] = await db.select({ count: sql15`count(*)` }).from(autentikasi).where(whereClause);
    return {
      data,
      total: Number(countResult.count),
      page,
      totalPages: Math.ceil(Number(countResult.count) / limit)
    };
  }
  async findById(id) {
    return await db.query.autentikasi.findFirst({
      where: eq23(autentikasi.id, id),
      with: {
        petugas: {
          columns: {
            id: true,
            name: true,
            nip: true,
            jabatan: true
          }
        },
        itemArsip: {
          with: {
            arsip: true
          }
        }
      }
    });
  }
  async generateBeritaAcaraPdf(id, tx = db) {
    const data = await tx.query.autentikasi.findFirst({
      where: eq23(autentikasi.id, id),
      with: {
        petugas: true,
        itemArsip: {
          with: {
            arsip: true
          }
        }
      }
    });
    if (!data) throw new Error("Autentikasi not found");
    const uploadDir = path3.join(process.cwd(), "uploads", "autentikasi");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const fileName = `BA_Autentikasi_${data.nomorBeritaAcara.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
    const filePath = path3.join(uploadDir, fileName);
    const relativePath = `/uploads/autentikasi/${fileName}`;
    const doc = new PDFDocument3({ size: "A4", margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.font("Helvetica-Bold").fontSize(14).text("KEMENTERIAN AGRARIA DAN TATA RUANG/", { align: "center" });
    doc.text("BADAN PERTANAHAN NASIONAL", { align: "center" });
    doc.fontSize(12).text(data.tempatDilakukan || "KANTOR PERTANAHAN", { align: "center" });
    doc.moveDown();
    doc.lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(2);
    doc.font("Helvetica-Bold").fontSize(12).text("BERITA ACARA", { align: "center" });
    doc.text("AUTENTIKASI ARSIP HASIL ALIH MEDIA", { align: "center" });
    doc.font("Helvetica").fontSize(10).text(`Nomor: ${data.nomorBeritaAcara}`, { align: "center" });
    doc.moveDown(2);
    const tanggal = new Date(data.tanggalAutentikasi).toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    doc.font("Helvetica").fontSize(11).text("Pada hari ini ", { continued: true }).font("Helvetica-Bold").text(tanggal).font("Helvetica").text(", bertempat di ").font("Helvetica-Bold").text(data.tempatDilakukan || "Kantor Pertanahan").font("Helvetica").text(", telah dilakukan autentikasi arsip hasil alih media (digitalisasi) sebagaimana tercantum dalam daftar terlampir.");
    doc.moveDown();
    doc.text("Pelaksanaan autentikasi ini dilakukan untuk menjamin bahwa arsip hasil alih media tersebut sesuai dengan aslinya.");
    doc.moveDown(2);
    doc.text("Demikian Berita Acara ini dibuat untuk dipergunakan sebagaimana mestinya.", { align: "justify" });
    doc.moveDown(3);
    const signatureY = doc.y;
    doc.text("Dibuat oleh,", 50, signatureY, { align: "left", width: 200 });
    doc.text(data.petugas?.jabatan || "Arsiparis", 50, signatureY + 15, { align: "left", width: 200 });
    doc.moveDown(4);
    doc.text(`(${data.petugas?.name || "........................."})`, 50, doc.y, { align: "left", width: 200 });
    doc.text(`NIP. ${data.petugas?.nip || "........................."}`, 50, doc.y + 15, { align: "left", width: 200 });
    doc.text("Mengetahui,", 300, signatureY, { align: "center", width: 240 });
    doc.text(data.jabatanPenandaTangan || "Kepala Kantor", 300, signatureY + 15, { align: "center", width: 240 });
    doc.moveDown(4);
    doc.text("( ....................................... )", 300, doc.y, { align: "center", width: 240 });
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(12).text("DAFTAR ARSIP HASIL ALIH MEDIA", { align: "center" });
    doc.fontSize(10).text(`Lampiran Berita Acara Nomor: ${data.nomorBeritaAcara}`, { align: "center" });
    doc.moveDown(2);
    const tableTop = doc.y;
    const colNo = 40;
    const colKode = 80;
    const colUraian = 200;
    const colTahun = 450;
    const colKet = 500;
    doc.fontSize(10).text("No", 50, tableTop);
    doc.text("Nomor Berkas", 80, tableTop);
    doc.text("Uraian Arsip", 200, tableTop);
    doc.text("Tahun", 450, tableTop);
    doc.lineWidth(1).moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();
    let y = tableTop + 20;
    data.itemArsip.forEach((item, index) => {
      if (y > 750) {
        doc.addPage();
        y = 50;
      }
      const arsip3 = item.arsip;
      doc.font("Helvetica").fontSize(10);
      doc.text(`${index + 1}`, 50, y);
      doc.text(arsip3?.nomorBerkas || "-", 80, y);
      doc.text((arsip3?.uraianBerkas || "-").substring(0, 50), 200, y, { width: 240 });
      doc.text(`${arsip3?.tahun || "-"}`, 450, y);
      y += 20;
    });
    doc.end();
    return new Promise((resolve, reject) => {
      stream.on("finish", () => resolve(relativePath));
      stream.on("error", reject);
    });
  }
};
var autentikasiService = new AutentikasiService();

// src/middlewares/upload.middleware.ts
import multer6 from "multer";
import path4 from "path";
var storage3 = multer6.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path4.extname(file.originalname));
  }
});
var fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type"));
  }
};
var upload6 = multer6({
  storage: storage3,
  limits: {
    fileSize: 10 * 1024 * 1024
    // 10MB limit
  },
  fileFilter
});

// src/services/hash-verification.service.ts
import { eq as eq24 } from "drizzle-orm";

// src/utils/hash.utils.ts
import crypto3 from "crypto";
import fs2 from "fs";
var calculateFileHash = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto3.createHash("sha256");
    const stream = fs2.createReadStream(filePath);
    stream.on("error", (err) => reject(err));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
};

// src/services/hash-verification.service.ts
import { unlink } from "fs/promises";
var log24 = createLogger("HashVerificationService");
var HashVerificationService = class {
  /**
   * Verify an uploaded file against the database records based on its hash.
   * Dictionary:
   * - "Authentic": Hash matches a record in DB.
   * - "Unknown": Hash does not match any record.
   */
  static async verifyUploadedFile(filePath) {
    try {
      const hash = await calculateFileHash(filePath);
      await unlink(filePath).catch((err) => log24.error({ err }, "Failed to clean up temp file"));
      const record = await db.query.arsipElektronik.findFirst({
        where: eq24(arsipElektronik.hashSHA256, hash),
        with: {
          arsip: true,
          autentikasi: true
        }
      });
      if (record) {
        return {
          status: "AUTHENTIC",
          message: "Arsip ditemukan dan integritas terjamin.",
          data: {
            arsipId: record.arsipId,
            nomorBerkas: record.arsip.nomorBerkas,
            uraian: record.arsip.uraianBerkas,
            tanggalUpload: record.createdAt,
            autentikasi: record.autentikasi ? {
              nomor: record.autentikasi.nomorBeritaAcara,
              tanggal: record.autentikasi.tanggalAutentikasi
            } : null
          }
        };
      } else {
        return {
          status: "UNKNOWN",
          message: "Arsip tidak ditemukan dalam database atau telah dimodifikasi.",
          hash
        };
      }
    } catch (error) {
      await unlink(filePath).catch(() => {
      });
      throw error;
    }
  }
};

// src/routes/autentikasi.routes.ts
var router30 = Router30();
router30.use(authMiddleware);
router30.get("/", validateQuery(queryAutentikasiSchema), async (req, res, next) => {
  try {
    const query = res.locals.validatedQuery || {};
    const result = await autentikasiService.findAll(query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router30.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await autentikasiService.findById(id);
    if (!result) {
      return res.status(404).json({ error: "Autentikasi not found" });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router30.post(
  "/",
  canWriteMiddleware(),
  validateBody(createAutentikasiSchema),
  async (req, res, next) => {
    try {
      const result = await autentikasiService.create({
        ...req.body,
        userId: req.user?.id
      });
      await audit_log_service_default.logAction({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: "create",
        entityType: "autentikasi",
        // Cast to any to avoid type error if interface not updated yet
        entityId: result.id,
        changes: { after: result },
        ipAddress: req.ip
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
router30.get("/:id/pdf", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await autentikasiService.findById(id);
    if (!result || !result.fileLampiran) {
      return res.status(404).json({ error: "PDF not found" });
    }
    res.json({ success: true, url: result.fileLampiran });
  } catch (error) {
    next(error);
  }
});
router30.post(
  "/verify",
  authMiddleware,
  upload6.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "File wajib diupload" });
      }
      const result = await HashVerificationService.verifyUploadedFile(req.file.path);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Gagal memverifikasi arsip", error });
    }
  }
);
var autentikasi_routes_default = router30;

// src/routes/layanan-arsip.routes.ts
import { Router as Router31 } from "express";

// src/services/layanan-arsip.service.ts
import { eq as eq25, desc as desc17, and as and20, sql as sql16 } from "drizzle-orm";
var LayananArsipService = class {
  async create(data) {
    return await db.transaction(async (tx) => {
      const [result] = await tx.insert(layananArsip).values({
        ...data,
        updatedAt: /* @__PURE__ */ new Date()
      }).returning();
      return result;
    });
  }
  async findAll(filters = {}) {
    const { page = 1, limit = 20, status, jenisLayanan, userId } = filters;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (status) conditions.push(eq25(layananArsip.status, status));
    if (jenisLayanan) conditions.push(eq25(layananArsip.jenisLayanan, jenisLayanan));
    if (userId) conditions.push(eq25(layananArsip.diajukanOleh, userId));
    const whereClause = conditions.length > 0 ? and20(...conditions) : void 0;
    const [data, totalResult] = await Promise.all([
      db.query.layananArsip.findMany({
        where: whereClause,
        with: {
          arsip: {
            columns: {
              id: true,
              nomorBerkas: true,
              uraianBerkas: true
            }
          },
          pemohon: {
            columns: {
              id: true,
              name: true,
              unitKerjaId: true
            }
          },
          penyetuju: {
            columns: {
              id: true,
              name: true
            }
          }
        },
        orderBy: [desc17(layananArsip.createdAt)],
        limit,
        offset
      }),
      db.select({ count: sql16`count(*)` }).from(layananArsip).where(whereClause)
    ]);
    return {
      data,
      total: Number(totalResult[0]?.count || 0),
      page,
      limit,
      totalPages: Math.ceil(Number(totalResult[0]?.count || 0) / limit)
    };
  }
  async findById(id) {
    return await db.query.layananArsip.findFirst({
      where: eq25(layananArsip.id, id),
      with: {
        arsip: true,
        pemohon: true,
        penyetuju: true
      }
    });
  }
  async updateStatus(id, status, approvedBy, notes) {
    const updateData = {
      status,
      updatedAt: /* @__PURE__ */ new Date()
    };
    if (status === "selesai" || status === "diproses" || status === "ditolak") {
      if (approvedBy) updateData.disetujuiOleh = approvedBy;
      if (notes) updateData.catatanPersetujuan = notes;
      updateData.tanggalPersetujuan = /* @__PURE__ */ new Date();
    }
    const [result] = await db.update(layananArsip).set(updateData).where(eq25(layananArsip.id, id)).returning();
    return result;
  }
  async delete(id) {
    await db.delete(layananArsip).where(eq25(layananArsip.id, id));
  }
};
var layananArsipService = new LayananArsipService();

// src/routes/layanan-arsip.routes.ts
var router31 = Router31();
router31.use(authMiddleware);
router31.get("/", async (req, res, next) => {
  try {
    const { page, limit, status, jenisLayanan, myRequests } = req.query;
    const filters = {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      status,
      jenisLayanan
    };
    if (myRequests === "true") {
      filters.userId = req.user?.id;
    }
    const result = await layananArsipService.findAll(filters);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
router31.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await layananArsipService.findById(id);
    if (!result) return res.status(404).json({ error: "Data not found" });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router31.post("/", validateBody(createLayananArsipSchema), async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const result = await layananArsipService.create({
      ...req.body,
      diajukanOleh: req.user.id,
      status: "diajukan"
    });
    await audit_log_service_default.logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: "create",
      entityType: "layanan_arsip",
      entityId: result.id,
      changes: { after: result },
      ipAddress: req.ip
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router31.post("/:id/status", canWriteMiddleware(), validateBody(updateLayananStatusSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    if (!["diproses", "selesai", "ditolak"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const result = await layananArsipService.updateStatus(id, status, req.user?.id, notes);
    await audit_log_service_default.logAction({
      userId: req.user?.id,
      userEmail: req.user?.email,
      action: "update",
      entityType: "layanan_arsip",
      entityId: id,
      changes: { status, notes },
      ipAddress: req.ip
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
var layanan_arsip_routes_default = router31;

// src/routes/supervision.routes.ts
import { Router as Router32 } from "express";

// src/services/supervision.service.ts
import { eq as eq26, and as and21, desc as desc18, sql as sql17, gte as gte8, lte as lte9, count as count4 } from "drizzle-orm";
var SupervisionService = class {
  /**
   * Get daily activity stats for the last n days
   */
  async getActivityStats(days = 7) {
    const endDate = /* @__PURE__ */ new Date();
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(endDate.getDate() - days);
    const stats = await db.select({
      date: sql17`to_char(${auditLog.createdAt}, 'YYYY-MM-DD')`,
      action: auditLog.action,
      count: sql17`count(*)::int`
    }).from(auditLog).where(gte8(auditLog.createdAt, startDate)).groupBy(sql17`to_char(${auditLog.createdAt}, 'YYYY-MM-DD')`, auditLog.action).orderBy(sql17`to_char(${auditLog.createdAt}, 'YYYY-MM-DD')`);
    const dates = [...new Set(stats.map((s) => s.date))].sort();
    const actions = ["create", "update", "delete", "archive"];
    const chartData = dates.map((date) => {
      const dayStats = stats.filter((s) => s.date === date);
      const result = { date };
      actions.forEach((action) => {
        const found = dayStats.find((s) => s.action === action);
        result[action] = found?.count || 0;
      });
      return result;
    });
    return chartData;
  }
  /**
   * Get top active users
   */
  async getUserActivityStats(limit = 5) {
    const stats = await db.select({
      userId: auditLog.userId,
      userName: users.name,
      userEmail: users.email,
      // Fallback if name is null
      actionCount: sql17`count(*)::int`
    }).from(auditLog).leftJoin(users, eq26(auditLog.userId, users.id)).groupBy(auditLog.userId, users.name, users.email).orderBy(desc18(sql17`count(*)`)).limit(limit);
    return stats.map((s) => ({
      ...s,
      userName: s.userName || s.userEmail || "Unknown User"
    }));
  }
  /**
   * Get compliance statistics
   */
  async getComplianceStats() {
    const now = /* @__PURE__ */ new Date();
    const overdueRetention = await db.select({ count: count4() }).from(arsip).where(
      and21(
        lte9(arsip.tanggalKadaluarsa, now.toISOString().split("T")[0]),
        sql17`${arsip.hasilAkhir} IS NULL`
        // Assuming active if no final outcome
      )
    );
    const { arsipElektronik: arsipElektronik2 } = await import("./arsip-elektronik-2NQUX6BJ.js");
    const unverifiedElectronic = await db.select({ count: count4() }).from(arsipElektronik2).where(eq26(arsipElektronik2.statusVerifikasi, "pending"));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const newArchives = await db.select({ count: count4() }).from(arsip).where(gte8(arsip.createdAt, startOfMonth));
    return {
      overdueRetention: overdueRetention[0]?.count || 0,
      unverifiedElectronic: unverifiedElectronic[0]?.count || 0,
      newArchivesThisMonth: newArchives[0]?.count || 0
    };
  }
};
var supervisionService = new SupervisionService();

// src/routes/supervision.routes.ts
var log25 = createLogger("SupervisionRoutes");
var router32 = Router32();
router32.use(authMiddleware);
router32.get("/stats/activity", async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days) : 7;
    const stats = await supervisionService.getActivityStats(days);
    res.json(stats);
  } catch (error) {
    log25.error({ err: error }, "Error fetching activity stats:");
    res.status(500).json({ error: "Failed to fetch activity stats" });
  }
});
router32.get("/stats/users", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 5;
    const stats = await supervisionService.getUserActivityStats(limit);
    res.json(stats);
  } catch (error) {
    log25.error({ err: error }, "Error fetching user stats:");
    res.status(500).json({ error: "Failed to fetch user stats" });
  }
});
router32.get("/stats/compliance", async (req, res) => {
  try {
    const stats = await supervisionService.getComplianceStats();
    res.json(stats);
  } catch (error) {
    log25.error({ err: error }, "Error fetching compliance stats:");
    res.status(500).json({ error: "Failed to fetch compliance stats" });
  }
});
var supervision_routes_default = router32;

// src/routes/mapping.routes.ts
import { Router as Router33 } from "express";
var log26 = createLogger("MappingRoutes");
var router33 = Router33();
log26.info("\u2705 Mapping routes file loaded");
router33.use(authMiddleware);
router33.get("/klasifikasi-jra", async (req, res) => {
  try {
    const data = await mappingService.getAllMappings();
    res.json({ success: true, data, total: data.length });
  } catch (error) {
    log26.error({ err: error }, "Error fetching mappings:");
    res.status(500).json({ error: "Internal server error" });
  }
});
router33.get("/suggest-jra/:klasifikasiKode", async (req, res) => {
  try {
    const klasifikasiKode = req.params.klasifikasiKode;
    if (!klasifikasiKode) {
      return res.status(400).json({ error: "klasifikasiKode is required" });
    }
    const result = await mappingService.getSuggestedJRA(klasifikasiKode);
    res.json({
      success: true,
      klasifikasiKode,
      ...result,
      totalSuggested: result.suggestedJRA.length
    });
  } catch (error) {
    log26.error({ err: error }, "Error fetching JRA suggestions:");
    res.status(500).json({ error: "Internal server error" });
  }
});
var mapping_routes_default = router33;

// src/routes/approval.routes.ts
import express from "express";

// src/services/approval.service.ts
import { eq as eq27, and as and22, desc as desc19 } from "drizzle-orm";

// src/services/email.service.ts
import nodemailer from "nodemailer";
var log27 = createLogger("EmailService");
var EmailService = class {
  transporter = null;
  constructor() {
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    } else {
      log27.info("SMTP not configured, using stub mode");
    }
  }
  async sendEmail(options2) {
    if (!this.transporter) {
      log27.debug({ to: options2.to, subject: options2.subject }, "Email stub: message not sent (no SMTP)");
      return true;
    }
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || "noreply@simsa.atrbpn.go.id",
        to: options2.to,
        subject: options2.subject,
        text: options2.text,
        html: options2.html
      });
      return true;
    } catch (error) {
      log27.error({ err: error }, "Failed to send email");
      return false;
    }
  }
  async sendApprovalNotification(to, suratNomor, requesterName, link) {
    return this.sendEmail({
      to,
      subject: `[SIMSA] Permohonan Review Surat: ${suratNomor}`,
      text: `Halo,

${requesterName} telah mengajukan surat dengan nomor ${suratNomor} untuk Anda review.

Silakan klik link berikut untuk melihat detail:
${link}

Terima kasih.`,
      html: `
                <h3>Permohonan Review Surat</h3>
                <p>Halo,</p>
                <p><strong>${requesterName}</strong> telah mengajukan surat dengan nomor <strong>${suratNomor}</strong> untuk Anda review.</p>
                <p>Silakan klik tombol di bawah ini untuk melihat detail:</p>
                <a href="${link}" style="background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Review Surat</a>
                <br><br>
                <p>Terima kasih.</p>
            `
    });
  }
};
var emailService = new EmailService();

// src/services/approval.service.ts
var log28 = createLogger("ApprovalService");
var ApprovalService = class {
  // Submit surat for approval
  async submit(suratId, requesterId, nextApproverId, notes) {
    return await db.transaction(async (tx) => {
      let [request] = await tx.select().from(approvalRequests).where(eq27(approvalRequests.entityId, suratId)).limit(1);
      if (!request) {
        [request] = await tx.insert(approvalRequests).values({
          entityType: "surat_keluar",
          entityId: suratId,
          requesterId,
          status: "pending",
          currentStepOrder: 1
        }).returning();
      } else {
        await tx.update(approvalRequests).set({ status: "pending", currentStepOrder: 1, updatedAt: /* @__PURE__ */ new Date() }).where(eq27(approvalRequests.id, request.id));
      }
      await tx.insert(approvalSteps).values({
        requestId: request.id,
        stepOrder: 1,
        approverId: nextApproverId,
        status: "pending",
        notes
      });
      await tx.insert(approvalHistory).values({
        requestId: request.id,
        userId: requesterId,
        action: "SUBMIT",
        notes: notes || "Diserahkan ke reviewer"
      });
      await tx.update(suratKeluar).set({
        approvalStatus: "pending",
        currentApproverId: nextApproverId,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq27(suratKeluar.id, suratId));
      this.sendNotification(suratId, nextApproverId, requesterId).catch((err) => log28.error({ err }, "Failed to send submit notification"));
      return request;
    });
  }
  // Approve step
  async approve(suratId, approverId, notes, nextApproverId) {
    return await db.transaction(async (tx) => {
      const [request] = await tx.select().from(approvalRequests).where(eq27(approvalRequests.entityId, suratId)).limit(1);
      if (!request) throw new Error("Flow not found");
      const [currentStep] = await tx.select().from(approvalSteps).where(and22(
        eq27(approvalSteps.requestId, request.id),
        eq27(approvalSteps.stepOrder, request.currentStepOrder),
        eq27(approvalSteps.status, "pending")
      )).limit(1);
      if (!currentStep) throw new Error("No pending step");
      if (currentStep.approverId !== approverId) throw new Error("Unauthorized");
      await tx.update(approvalSteps).set({ status: "approved", actionAt: /* @__PURE__ */ new Date(), notes }).where(eq27(approvalSteps.id, currentStep.id));
      await tx.insert(approvalHistory).values({
        requestId: request.id,
        stepId: currentStep.id,
        userId: approverId,
        action: "APPROVE",
        notes
      });
      if (nextApproverId) {
        const nextOrder = request.currentStepOrder + 1;
        await tx.insert(approvalSteps).values({
          requestId: request.id,
          stepOrder: nextOrder,
          approverId: nextApproverId,
          status: "pending"
        });
        await tx.update(approvalRequests).set({ currentStepOrder: nextOrder, updatedAt: /* @__PURE__ */ new Date() }).where(eq27(approvalRequests.id, request.id));
        await tx.update(suratKeluar).set({ currentApproverId: nextApproverId }).where(eq27(suratKeluar.id, suratId));
        this.sendNotification(suratId, nextApproverId, request.requesterId).catch((err) => log28.error({ err }, "Failed to send approval notification"));
      } else {
        await tx.update(approvalRequests).set({ status: "approved", updatedAt: /* @__PURE__ */ new Date() }).where(eq27(approvalRequests.id, request.id));
        await tx.update(suratKeluar).set({ approvalStatus: "approved", currentApproverId: null }).where(eq27(suratKeluar.id, suratId));
      }
      return { success: true };
    });
  }
  // Reject step
  async reject(suratId, rejectorId, notes) {
    return await db.transaction(async (tx) => {
      const [request] = await tx.select().from(approvalRequests).where(eq27(approvalRequests.entityId, suratId)).limit(1);
      if (!request) throw new Error("Flow not found");
      const [currentStep] = await tx.select().from(approvalSteps).where(and22(
        eq27(approvalSteps.requestId, request.id),
        eq27(approvalSteps.stepOrder, request.currentStepOrder)
      )).limit(1);
      await tx.update(approvalSteps).set({ status: "rejected", actionAt: /* @__PURE__ */ new Date(), notes }).where(eq27(approvalSteps.id, currentStep.id));
      await tx.insert(approvalHistory).values({
        requestId: request.id,
        stepId: currentStep.id,
        userId: rejectorId,
        action: "REJECT",
        notes
      });
      await tx.update(approvalRequests).set({ status: "rejected" }).where(eq27(approvalRequests.id, request.id));
      await tx.update(suratKeluar).set({ approvalStatus: "rejected", currentApproverId: null }).where(eq27(suratKeluar.id, suratId));
      return { success: true };
    });
  }
  async getHistory(suratId) {
    const [request] = await db.select().from(approvalRequests).where(eq27(approvalRequests.entityId, suratId));
    if (!request) return [];
    return await db.select({
      action: approvalHistory.action,
      notes: approvalHistory.notes,
      createdAt: approvalHistory.createdAt,
      userName: users.name,
      userRole: users.role
    }).from(approvalHistory).leftJoin(users, eq27(approvalHistory.userId, users.id)).where(eq27(approvalHistory.requestId, request.id)).orderBy(desc19(approvalHistory.createdAt));
  }
  async sendNotification(suratId, targetUserId, requesterId) {
    try {
      const [surat] = await db.select().from(suratKeluar).where(eq27(suratKeluar.id, suratId));
      const [targetUser] = await db.select().from(users).where(eq27(users.id, targetUserId));
      const [requester] = await db.select().from(users).where(eq27(users.id, requesterId));
      if (surat && targetUser && requester) {
        await emailService.sendApprovalNotification(
          targetUser.email,
          surat.nomorSurat || "Draft",
          requester.name || "Unknown",
          process.env.APP_URL ? `${process.env.APP_URL}/surat/keluar/${suratId}` : `http://localhost:5173/surat/keluar/${suratId}`
        );
      }
    } catch (err) {
      log28.error({ err }, "Failed to send notification");
    }
  }
};
var approvalService = new ApprovalService();

// src/services/signature.service.ts
import { eq as eq28 } from "drizzle-orm";
import crypto4 from "crypto";
var SignatureService = class {
  // Simulate signing process
  async sign(suratId, signerId, passphrase) {
    if (!passphrase) throw new Error("Passphrase required");
    return await db.transaction(async (tx) => {
      const [surat] = await tx.select().from(suratKeluar).where(eq28(suratKeluar.id, suratId)).limit(1);
      if (!surat) throw new Error("Surat not found");
      if (surat.isSigned) throw new Error("Surat already signed");
      const signatureId = crypto4.randomUUID();
      const timestamp = /* @__PURE__ */ new Date();
      const documentHash = crypto4.createHash("sha256").update(suratId + timestamp.toISOString()).digest("hex");
      const verifyUrl = process.env.APP_URL ? `${process.env.APP_URL}/verify/${signatureId}` : `http://localhost:5173/verify/${signatureId}`;
      const [signature] = await tx.insert(digitalSignatures).values({
        id: signatureId,
        entityType: "surat_keluar",
        entityId: suratId,
        signerId,
        certificateId: "MOCK-CERT-" + Date.now(),
        // Mock Cert ID
        signedAt: timestamp,
        qrCodeContent: verifyUrl,
        documentHash,
        signatureValue: "MOCK-SIG-" + crypto4.randomBytes(16).toString("hex"),
        isValid: true,
        visualPage: 1,
        // Default to first page
        visualX: 100,
        visualY: 100
      }).returning();
      await tx.update(suratKeluar).set({
        isSigned: true,
        signedAt: timestamp,
        approvalStatus: "signed",
        // Final status
        updatedAt: timestamp
      }).where(eq28(suratKeluar.id, suratId));
      const [request] = await tx.select().from(approvalRequests).where(eq28(approvalRequests.entityId, suratId)).limit(1);
      if (request) {
        await tx.update(approvalRequests).set({ status: "signed", updatedAt: timestamp }).where(eq28(approvalRequests.id, request.id));
        await tx.insert(approvalHistory).values({
          requestId: request.id,
          userId: signerId,
          action: "SIGN",
          notes: "Dokumen ditandatangani secara elektronik"
        });
      }
      return signature;
    });
  }
  async verify(signatureId) {
    const [signature] = await db.select().from(digitalSignatures).where(eq28(digitalSignatures.id, signatureId)).limit(1);
    return signature;
  }
};
var signatureService = new SignatureService();

// src/routes/approval.routes.ts
import { z as z3 } from "zod";
var router34 = express.Router();
var submitSchema = z3.object({
  suratId: z3.string().uuid(),
  nextApproverId: z3.string().uuid(),
  notes: z3.string().optional()
});
var actionSchema = z3.object({
  suratId: z3.string().uuid(),
  notes: z3.string().optional(),
  nextApproverId: z3.string().uuid().optional()
  // Optional for final approval
});
var rejectSchema = z3.object({
  suratId: z3.string().uuid(),
  notes: z3.string().min(1, "Alasan penolakan wajib diisi")
});
var signSchema = z3.object({
  suratId: z3.string().uuid(),
  passphrase: z3.string().min(1, "Passphrase wajib diisi")
});
router34.post("/submit", authMiddleware, validateBody(submitSchema), async (req, res, next) => {
  try {
    const authReq = req;
    const { suratId, nextApproverId, notes } = req.body;
    const result = await approvalService.submit(suratId, authReq.user.id, nextApproverId, notes);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router34.post("/approve", authMiddleware, validateBody(actionSchema), async (req, res, next) => {
  try {
    const authReq = req;
    const { suratId, notes, nextApproverId } = req.body;
    const result = await approvalService.approve(suratId, authReq.user.id, notes, nextApproverId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router34.post("/reject", authMiddleware, validateBody(rejectSchema), async (req, res, next) => {
  try {
    const authReq = req;
    const { suratId, notes } = req.body;
    const result = await approvalService.reject(suratId, authReq.user.id, notes);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
router34.get("/history/:suratId", authMiddleware, async (req, res, next) => {
  try {
    const { suratId } = req.params;
    const history = await approvalService.getHistory(suratId);
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
});
router34.post("/sign", authMiddleware, validateBody(signSchema), async (req, res, next) => {
  try {
    const authReq = req;
    const { suratId, passphrase } = req.body;
    const result = await signatureService.sign(suratId, authReq.user.id, passphrase);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
var approval_routes_default = router34;

// src/routes/security.routes.ts
import { Router as Router34 } from "express";

// src/middlewares/password-policy.middleware.ts
var COMMON_PASSWORDS = [
  "password",
  "password123",
  "12345678",
  "qwerty",
  "abc123",
  "monkey",
  "1234567",
  "letmein",
  "trustno1",
  "dragon",
  "baseball",
  "iloveyou",
  "master",
  "sunshine",
  "ashley",
  "bailey",
  "passw0rd",
  "shadow",
  "123123",
  "654321",
  "superman",
  "qazwsx",
  "michael",
  "football",
  "admin",
  "administrator",
  "root",
  "toor",
  "pass",
  "test"
];
function validatePassword(password) {
  const errors = [];
  let score = 0;
  if (password.length < 12) {
    errors.push("Password must be at least 12 characters long");
  } else {
    score += 1;
    if (password.length >= 16) score += 1;
    if (password.length >= 20) score += 1;
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  } else {
    score += 1;
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  } else {
    score += 1;
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  } else {
    score += 1;
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character");
  } else {
    score += 1;
  }
  const lowerPassword = password.toLowerCase();
  if (COMMON_PASSWORDS.some((common) => lowerPassword.includes(common))) {
    errors.push("Password is too common or contains common words");
    score = Math.max(0, score - 2);
  }
  if (/(.)\1{2,}/.test(password)) {
    errors.push('Password should not contain repeated characters (e.g., "aaa", "111")');
    score = Math.max(0, score - 1);
  }
  if (/(?:012|123|234|345|456|567|678|789|890)/.test(password)) {
    errors.push("Password should not contain sequential numbers");
    score = Math.max(0, score - 1);
  }
  let strength;
  if (score <= 2) strength = "weak";
  else if (score <= 4) strength = "medium";
  else if (score <= 6) strength = "strong";
  else strength = "very-strong";
  return {
    isValid: errors.length === 0,
    errors,
    strength,
    score
  };
}
function checkPasswordStrength(req, res) {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({
      error: "Password is required"
    });
  }
  const validation = validatePassword(password);
  return res.json({
    isValid: validation.isValid,
    strength: validation.strength,
    score: validation.score,
    errors: validation.errors,
    suggestions: getPasswordSuggestions(validation)
  });
}
function getPasswordSuggestions(validation) {
  const suggestions = [];
  if (validation.errors.some((e) => e.includes("12 characters"))) {
    suggestions.push("Try using a passphrase with multiple words");
  }
  if (validation.errors.some((e) => e.includes("uppercase"))) {
    suggestions.push("Add some capital letters");
  }
  if (validation.errors.some((e) => e.includes("special character"))) {
    suggestions.push("Include symbols like !@#$%^&*");
  }
  if (validation.errors.some((e) => e.includes("common"))) {
    suggestions.push("Avoid common words and patterns");
  }
  if (validation.strength === "weak" || validation.strength === "medium") {
    suggestions.push("Consider using a password manager to generate a strong password");
  }
  return suggestions;
}

// src/routes/security.routes.ts
var router35 = Router34();
router35.post("/check-password", checkPasswordStrength);
var security_routes_default = router35;

// src/routes/google-drive-import.routes.ts
import { Router as Router35 } from "express";

// src/services/google-drive-import.service.ts
import { eq as eq29, and as and23 } from "drizzle-orm";
var log29 = createLogger("GoogleDriveImportService");
var GoogleDriveImportService = class {
  /**
   * Parse date string in various formats to ISO YYYY-MM-DD
   * Handles: DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.
   */
  parseDate(dateStr) {
    if (!dateStr || dateStr.trim() === "" || dateStr === "-") return null;
    const trimmed = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const ddmmyyyy = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
    if (ddmmyyyy) {
      const [, d, m, y] = ddmmyyyy;
      const day = parseInt(d);
      const month = parseInt(m);
      if (day > 12) {
        return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
      if (month > 12) {
        return `${y}-${d.padStart(2, "0")}-${m.padStart(2, "0")}`;
      }
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
    return null;
  }
  /**
   * Extract year from a date string
   */
  extractYear(dateStr) {
    const parsed = this.parseDate(dateStr);
    if (parsed) {
      return parseInt(parsed.split("-")[0]);
    }
    return (/* @__PURE__ */ new Date()).getFullYear();
  }
  /**
   * Extract spreadsheet ID from various Google Sheets URL formats
   */
  extractSpreadsheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }
  /**
   * Fetch a spreadsheet sheet as CSV using public export URL
   */
  async fetchSheetAsCSV(spreadsheetId, sheetName, gid) {
    let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;
    if (gid) {
      url += `&gid=${gid}`;
    } else if (sheetName) {
      url += `&sheet=${encodeURIComponent(sheetName)}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch spreadsheet: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }
  /**
   * List available sheets in a spreadsheet by parsing the HTML
   */
  async listSheets(spreadsheetId) {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    try {
      const response = await fetch(url);
      const html = await response.text();
      const sheets = [];
      const sheetMatches = html.matchAll(/gid=(\d+)[^"]*"[^>]*>([^<]+)</g);
      for (const match of sheetMatches) {
        sheets.push({
          gid: match[1],
          name: match[2].trim()
        });
      }
      if (sheets.length === 0) {
        const commonNames = [
          "Sheet1",
          "Surat Masuk 2021",
          "Surat Masuk 2022",
          "Surat Masuk 2023",
          "Surat Masuk 2024",
          "Surat Masuk 2025",
          "Surat Masuk 2026",
          "Surat Keluar 2023",
          "Surat Keluar 2024",
          "Surat Keluar 2025",
          "Surat Keluar 2026"
        ];
        for (const name of commonNames) {
          try {
            const testUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}&range=A1`;
            const testResp = await fetch(testUrl);
            if (testResp.ok) {
              sheets.push({ gid: "0", name });
            }
          } catch (_e) {
          }
        }
      }
      return sheets;
    } catch (error) {
      log29.error({ err: error }, "Error listing sheets:");
      return [{ gid: "0", name: "Sheet1" }];
    }
  }
  /**
   * Parse CSV text into array of arrays
   * Handles quoted fields with commas and newlines
   */
  parseCSV(csvText) {
    const rows = [];
    let currentRow = [];
    let currentField = "";
    let inQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];
      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          currentField += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ",") {
          currentRow.push(currentField.trim());
          currentField = "";
        } else if (char === "\n" || char === "\r" && nextChar === "\n") {
          currentRow.push(currentField.trim());
          if (currentRow.some((f) => f !== "")) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = "";
          if (char === "\r") i++;
        } else {
          currentField += char;
        }
      }
    }
    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some((f) => f !== "")) {
        rows.push(currentRow);
      }
    }
    return rows;
  }
  /**
   * Preview first N rows from a spreadsheet
   */
  async previewData(spreadsheetId, sheetName, maxRows = 10) {
    const csvText = await this.fetchSheetAsCSV(spreadsheetId, sheetName);
    const allRows = this.parseCSV(csvText);
    if (allRows.length === 0) {
      return { headers: [], rows: [], totalRows: 0 };
    }
    let headerRowIndex = 0;
    const headerKeywords = ["no", "jenis", "nomor", "tanggal", "perihal", "id", "surat", "dari", "kepada", "status"];
    for (let i = 0; i < Math.min(5, allRows.length); i++) {
      const rowLower = allRows[i].map((f) => f.toLowerCase());
      const matchCount = rowLower.filter((f) => headerKeywords.some((kw) => f.includes(kw))).length;
      if (matchCount >= 3) {
        headerRowIndex = i;
        break;
      }
    }
    const headers = allRows[headerRowIndex];
    const dataRows = allRows.slice(headerRowIndex + 1);
    return {
      headers,
      rows: dataRows.slice(0, maxRows),
      totalRows: dataRows.length
    };
  }
  /**
   * Import Surat Masuk from Google Spreadsheet
   * Expected columns (matched by position or header name):
   * ID, No, Jenis Surat, Sifat Surat, Nomor Surat, Tanggal Surat,
   * Perihal, Dari, Kepada, Status, Disposisi, Timestamp, Status Arsip
   */
  async importSuratMasuk(spreadsheetId, sheetName, unitKerjaId, userId) {
    const csvText = await this.fetchSheetAsCSV(spreadsheetId, sheetName);
    const allRows = this.parseCSV(csvText);
    if (allRows.length < 2) {
      return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, duplicateRows: 0, errors: ["No data found"] };
    }
    let headerRowIndex = 0;
    const headerKeywords = ["no", "jenis", "nomor", "tanggal", "perihal", "dari", "kepada"];
    for (let i = 0; i < Math.min(5, allRows.length); i++) {
      const rowLower = allRows[i].map((f) => f.toLowerCase());
      const matchCount = rowLower.filter((f) => headerKeywords.some((kw) => f.includes(kw))).length;
      if (matchCount >= 3) {
        headerRowIndex = i;
        break;
      }
    }
    const headers = allRows[headerRowIndex].map((h) => h.toLowerCase().trim());
    const dataRows = allRows.slice(headerRowIndex + 1);
    const colMap = this.buildColumnMap(headers, {
      "id": ["id"],
      "no": ["no", "no.", "nomor urut", "no urut"],
      "jenisSurat": ["jenis surat", "jenis naskah", "jenis"],
      "sifatSurat": ["sifat surat", "sifat", "urgency"],
      "nomorSurat": ["nomor surat", "no surat", "nomor"],
      "tanggalSurat": ["tanggal surat", "tanggal", "tgl"],
      "perihal": ["perihal", "subject", "hal"],
      "dari": ["dari", "asal", "pengirim", "from"],
      "kepada": ["kepada", "tujuan", "penerima", "to"],
      "status": ["status", "disposisi status"],
      "disposisi": ["disposisi"]
    });
    const errors = [];
    let importedRows = 0;
    let skippedRows = 0;
    let duplicateRows = 0;
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      try {
        const nomorSurat = this.getField(row, colMap, "nomorSurat");
        const perihal = this.getField(row, colMap, "perihal");
        if (!nomorSurat && !perihal) {
          skippedRows++;
          continue;
        }
        const noUrut = parseInt(this.getField(row, colMap, "no") || String(i + 1)) || i + 1;
        const tanggalStr = this.getField(row, colMap, "tanggalSurat");
        const parsedDate = this.parseDate(tanggalStr);
        const tahun = tanggalStr ? this.extractYear(tanggalStr) : (/* @__PURE__ */ new Date()).getFullYear();
        const effectiveTahun = isNaN(tahun) ? (/* @__PURE__ */ new Date()).getFullYear() : tahun;
        let existing;
        const hasValidNomor = nomorSurat && nomorSurat !== "-";
        if (hasValidNomor) {
          existing = await db.select({ id: suratMasuk.id }).from(suratMasuk).where(and23(
            eq29(suratMasuk.nomorSurat, nomorSurat),
            eq29(suratMasuk.tahun, effectiveTahun),
            eq29(suratMasuk.unitKerjaId, unitKerjaId)
          )).limit(1);
        } else {
          existing = await db.select({ id: suratMasuk.id }).from(suratMasuk).where(and23(
            eq29(suratMasuk.noUrut, noUrut),
            eq29(suratMasuk.tahun, effectiveTahun),
            eq29(suratMasuk.unitKerjaId, unitKerjaId)
          )).limit(1);
        }
        if (existing.length > 0) {
          duplicateRows++;
          continue;
        }
        const disposisiRaw = this.getField(row, colMap, "disposisi");
        const disposisiArr = disposisiRaw ? disposisiRaw.split(/[,;]/).map((d) => d.trim()).filter(Boolean) : [];
        const newSurat = {
          unitKerjaId,
          noUrut,
          tahun: effectiveTahun,
          jenisSurat: this.getField(row, colMap, "jenisSurat") || "Surat Dinas",
          sifatSurat: this.getField(row, colMap, "sifatSurat") || "Biasa",
          nomorSurat: nomorSurat || "-",
          tanggalSurat: parsedDate,
          perihal: this.getField(row, colMap, "perihal") || "",
          dari: this.getField(row, colMap, "dari") || "",
          kepada: this.getField(row, colMap, "kepada") || "",
          status: "belum_dibalas",
          disposisi: disposisiArr.length > 0 ? disposisiArr : null,
          createdBy: userId
        };
        await db.insert(suratMasuk).values(newSurat);
        importedRows++;
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
        skippedRows++;
      }
    }
    return {
      success: errors.length === 0,
      totalRows: dataRows.length,
      importedRows,
      skippedRows,
      duplicateRows,
      errors: errors.slice(0, 20)
      // Limit error list
    };
  }
  /**
   * Import Surat Keluar from Google Spreadsheet
   */
  async importSuratKeluar(spreadsheetId, sheetName, unitKerjaId, userId) {
    const csvText = await this.fetchSheetAsCSV(spreadsheetId, sheetName);
    const allRows = this.parseCSV(csvText);
    if (allRows.length < 2) {
      return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, duplicateRows: 0, errors: ["No data found"] };
    }
    let headerRowIndex = 0;
    const headerKeywords = ["no", "nomor", "tanggal", "perihal", "tujuan", "kepada", "link"];
    for (let i = 0; i < Math.min(5, allRows.length); i++) {
      const rowLower = allRows[i].map((f) => f.toLowerCase());
      const matchCount = rowLower.filter((f) => headerKeywords.some((kw) => f.includes(kw))).length;
      if (matchCount >= 3) {
        headerRowIndex = i;
        break;
      }
    }
    const headers = allRows[headerRowIndex].map((h) => h.toLowerCase().trim());
    const dataRows = allRows.slice(headerRowIndex + 1);
    const colMap = this.buildColumnMap(headers, {
      "id": ["id"],
      "noUrut": ["no urut", "no.", "no"],
      "naskahDinas": ["jenis surat", "naskah dinas", "jenis naskah", "jenis"],
      "nomorSurat": ["nomor surat", "no surat", "nomor"],
      "tanggalSurat": ["tanggal surat", "tanggal", "tgl"],
      "perihal": ["perihal", "subject", "hal"],
      "kepada": ["kepada", "tujuan", "penerima"],
      "linkDokumen": ["link dokumen", "link", "url"],
      "klasifikasiArsip": ["klasifikasi arsip", "klasifikasi"],
      "klasifikasiKode": ["klasifikasi kode", "kode klasifikasi", "kode"],
      "klasifikasiJenis": ["klasifikasi jenis", "jenis klasifikasi"]
    });
    const errors = [];
    let importedRows = 0;
    let skippedRows = 0;
    let duplicateRows = 0;
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      try {
        const nomorSurat = this.getField(row, colMap, "nomorSurat");
        const perihal = this.getField(row, colMap, "perihal");
        if (!nomorSurat && !perihal) {
          skippedRows++;
          continue;
        }
        const noUrut = parseInt(this.getField(row, colMap, "noUrut") || String(i + 1)) || i + 1;
        const tanggalStr = this.getField(row, colMap, "tanggalSurat");
        const parsedDate = this.parseDate(tanggalStr);
        const tahun = tanggalStr ? this.extractYear(tanggalStr) : (/* @__PURE__ */ new Date()).getFullYear();
        const effectiveTahun = isNaN(tahun) ? (/* @__PURE__ */ new Date()).getFullYear() : tahun;
        let existing;
        const hasValidNomor = nomorSurat && nomorSurat !== "-";
        if (hasValidNomor) {
          existing = await db.select({ id: suratKeluar.id }).from(suratKeluar).where(and23(
            eq29(suratKeluar.nomorSurat, nomorSurat),
            eq29(suratKeluar.tahun, effectiveTahun),
            eq29(suratKeluar.unitKerjaId, unitKerjaId)
          )).limit(1);
        } else {
          existing = await db.select({ id: suratKeluar.id }).from(suratKeluar).where(and23(
            eq29(suratKeluar.noUrut, noUrut),
            eq29(suratKeluar.tahun, effectiveTahun),
            eq29(suratKeluar.unitKerjaId, unitKerjaId)
          )).limit(1);
        }
        if (existing.length > 0) {
          duplicateRows++;
          continue;
        }
        const klasifikasiJenis = this.getField(row, colMap, "klasifikasiJenis");
        const klasifikasiKode = this.getField(row, colMap, "klasifikasiKode");
        const klasifikasiArsip2 = this.getField(row, colMap, "klasifikasiArsip");
        const newSurat = {
          unitKerjaId,
          noUrut,
          tahun: effectiveTahun,
          naskahDinas: this.getField(row, colMap, "naskahDinas") || "Surat Dinas",
          nomorSurat: nomorSurat || "-",
          tanggalSurat: parsedDate,
          perihal: this.getField(row, colMap, "perihal") || "",
          kepada: this.getField(row, colMap, "kepada") || "",
          linkDokumen: this.getField(row, colMap, "linkDokumen") || null,
          klasifikasiFasilitatif: klasifikasiJenis === "fasilitatif" ? klasifikasiArsip2 : null,
          klasifikasiFasilitatifKode: klasifikasiJenis === "fasilitatif" ? klasifikasiKode : null,
          klasifikasiSubstantif: klasifikasiJenis === "substantif" ? klasifikasiArsip2 : null,
          klasifikasiSubstantifKode: klasifikasiJenis === "substantif" ? klasifikasiKode : null,
          createdBy: userId
        };
        await db.insert(suratKeluar).values(newSurat);
        importedRows++;
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
        skippedRows++;
      }
    }
    return {
      success: errors.length === 0,
      totalRows: dataRows.length,
      importedRows,
      skippedRows,
      duplicateRows,
      errors: errors.slice(0, 20)
    };
  }
  /**
   * Build a column mapping from header names to column indices
   */
  buildColumnMap(headers, mapping) {
    const result = {};
    for (const [fieldName, aliases] of Object.entries(mapping)) {
      for (const alias of aliases) {
        const idx = headers.findIndex((h) => h.includes(alias));
        if (idx !== -1) {
          result[fieldName] = idx;
          break;
        }
      }
    }
    if (Object.keys(result).length < 5 && headers.length >= 8) {
      const posMap = {
        "id": 0,
        "no": 1,
        "jenisSurat": 2,
        "sifatSurat": 3,
        "nomorSurat": 4,
        "tanggalSurat": 5,
        "perihal": 6,
        "dari": 7,
        "kepada": 8,
        "status": 9,
        "disposisi": 10
      };
      for (const [k, v] of Object.entries(posMap)) {
        if (!(k in result) && v < headers.length) {
          result[k] = v;
        }
      }
    }
    return result;
  }
  /**
   * Get field value from row using column map
   */
  getField(row, colMap, fieldName) {
    const idx = colMap[fieldName];
    if (idx === void 0 || idx >= row.length) return "";
    return (row[idx] || "").trim();
  }
};
var googleDriveImportService = new GoogleDriveImportService();

// src/routes/google-drive-import.routes.ts
var log30 = createLogger("GoogleDriveImportRoutes");
var router36 = Router35();
router36.use(authMiddleware);
router36.get("/google-drive/sheets", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      res.status(400).json({ error: "Google Spreadsheet URL is required" });
      return;
    }
    const spreadsheetId = googleDriveImportService.extractSpreadsheetId(url);
    if (!spreadsheetId) {
      res.status(400).json({ error: "Invalid Google Spreadsheet URL" });
      return;
    }
    const sheets = await googleDriveImportService.listSheets(spreadsheetId);
    res.json({ spreadsheetId, sheets });
  } catch (error) {
    log30.error({ err: error }, "Error listing sheets:");
    res.status(500).json({ error: "Failed to list sheets", message: error.message });
  }
});
router36.post("/google-drive/preview", async (req, res) => {
  try {
    const { spreadsheetUrl, sheetName, maxRows } = req.body;
    if (!spreadsheetUrl) {
      res.status(400).json({ error: "spreadsheetUrl is required" });
      return;
    }
    const spreadsheetId = googleDriveImportService.extractSpreadsheetId(spreadsheetUrl);
    if (!spreadsheetId) {
      res.status(400).json({ error: "Invalid Google Spreadsheet URL" });
      return;
    }
    const preview = await googleDriveImportService.previewData(
      spreadsheetId,
      sheetName || "Sheet1",
      maxRows || 10
    );
    res.json(preview);
  } catch (error) {
    log30.error({ err: error }, "Error previewing data:");
    res.status(500).json({ error: "Failed to preview data", message: error.message });
  }
});
router36.post("/google-drive/surat-masuk", async (req, res) => {
  try {
    const { spreadsheetUrl, sheetName } = req.body;
    const unitKerjaId = req.user?.unitKerjaId || "ditjen";
    if (!spreadsheetUrl) {
      res.status(400).json({ error: "spreadsheetUrl is required" });
      return;
    }
    const spreadsheetId = googleDriveImportService.extractSpreadsheetId(spreadsheetUrl);
    if (!spreadsheetId) {
      res.status(400).json({ error: "Invalid Google Spreadsheet URL" });
      return;
    }
    const userId = req.user?.id || "system";
    const result = await googleDriveImportService.importSuratMasuk(
      spreadsheetId,
      sheetName || "Sheet1",
      unitKerjaId,
      userId
    );
    res.json(result);
  } catch (error) {
    log30.error({ err: error }, "Error importing surat masuk:");
    res.status(500).json({ error: "Failed to import", message: error.message });
  }
});
router36.post("/google-drive/surat-keluar", async (req, res) => {
  try {
    const { spreadsheetUrl, sheetName } = req.body;
    const unitKerjaId = req.user?.unitKerjaId || "ditjen";
    if (!spreadsheetUrl) {
      res.status(400).json({ error: "spreadsheetUrl is required" });
      return;
    }
    const spreadsheetId = googleDriveImportService.extractSpreadsheetId(spreadsheetUrl);
    if (!spreadsheetId) {
      res.status(400).json({ error: "Invalid Google Spreadsheet URL" });
      return;
    }
    const userId = req.user?.id || "system";
    const result = await googleDriveImportService.importSuratKeluar(
      spreadsheetId,
      sheetName || "Sheet1",
      unitKerjaId,
      userId
    );
    res.json(result);
  } catch (error) {
    log30.error({ err: error }, "Error importing surat keluar:");
    res.status(500).json({ error: "Failed to import", message: error.message });
  }
});
var google_drive_import_routes_default = router36;

// src/app.ts
var app = express2();
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowedOrigin = env.FRONTEND_URL.replace(/\/$/, "");
    if (origin === allowedOrigin || origin === allowedOrigin + "/") {
      return callback(null, true);
    }
    if (env.NODE_ENV !== "production" && origin.match(/^http:\/\/localhost:\d+$/)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "X-CSRF-Token"],
  credentials: true
}));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Allow inline styles for React
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", env.FRONTEND_URL],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      formAction: ["'self'"],
      // Prevent form submissions to external origins
      baseUri: ["'self'"],
      // Prevent base tag hijacking
      upgradeInsecureRequests: []
      // Force HTTPS for all resources
    }
  },
  hsts: {
    maxAge: 31536e3,
    // 1 year
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: "deny"
    // Prevent clickjacking
  },
  noSniff: true,
  // Prevent MIME type sniffing
  xssFilter: true,
  // Enable XSS filter
  referrerPolicy: {
    policy: "strict-origin-when-cross-origin"
  }
}));
app.use((req, res, next) => {
  const originalQuery = { ...req.query };
  Object.defineProperty(req, "query", {
    value: originalQuery,
    writable: true,
    configurable: true,
    enumerable: true
  });
  next();
});
app.use(cookieParser());
app.use("/api", csrfCookieSetter);
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    uptime: Math.floor(process.uptime())
  });
});
app.use("/api/auth", authLimiter);
app.options("/api/auth/*splat", (req, res) => {
  const origin = req.headers.origin;
  const allowedOrigin = env.FRONTEND_URL.replace(/\/$/, "");
  if (origin === allowedOrigin || origin === allowedOrigin + "/" || env.NODE_ENV !== "production" && origin?.match(/^http:\/\/localhost:\d+$/)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, X-CSRF-Token");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.status(204).end();
});
var authHandler = toNodeHandler(auth);
var wrappedAuthHandler = async (req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigin = env.FRONTEND_URL.replace(/\/$/, "");
  if (!origin || origin === allowedOrigin || origin === allowedOrigin + "/" || env.NODE_ENV !== "production" && origin?.match(/^http:\/\/localhost:\d+$/)) {
    res.setHeader("Access-Control-Allow-Origin", origin || allowedOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  try {
    await authHandler(req, res);
  } catch (error) {
    console.error("Auth handler error:", error.message);
    res.status(500).json({
      error: "Authentication Error",
      message: "Terjadi kesalahan pada proses autentikasi."
    });
  }
};
app.all("/api/auth/*splat", wrappedAuthHandler);
app.all("/api/auth/:path", wrappedAuthHandler);
app.all("/api/auth/:path/:subpath", wrappedAuthHandler);
app.use(express2.json({ limit: "10mb" }));
app.use(express2.urlencoded({ extended: true, limit: "10mb" }));
app.use(sanitizeInput);
app.use("/api", csrfProtection);
app.use(compression({
  filter: (req, res) => {
    if (req.headers["x-no-compression"]) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6
  // Compression level (0-9, 6 is default balance)
}));
var uploadsPath = path5.join(process.cwd(), "uploads");
app.use("/uploads", authMiddleware, express2.static(uploadsPath));
app.use("/api", generalLimiter);
app.use("/api/surat-masuk", surat_masuk_routes_default);
app.use("/api/surat-keluar", surat_keluar_routes_default);
app.use("/api/arsip", arsip_routes_default);
app.use("/api/upload", upload_routes_default);
app.use("/api/unit-kerja", unit_kerja_routes_default);
app.use("/api/migration", migration_routes_default);
app.use("/api/approval", approval_routes_default);
app.use("/api/dashboard", dashboard_routes_default);
app.use("/api/export", exportRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/users", user_management_routes_default);
app.use("/api/audit-log", audit_log_routes_default);
app.use("/api/klasifikasi", klasifikasi_routes_default);
app.use("/api/jra", jra_routes_default);
app.use("/api/arsip-picker", arsip_picker_routes_default);
app.use("/api/storage-locations", storage_location_routes_default);
app.use("/api/archive-lending", archive_lending_routes_default);
app.use("/api/dosir", dosir_routes_default);
app.use("/api/retention", retentionRoutes);
app.use("/api/bulk-upload", bulk_upload_routes_default);
app.use("/api/distributions", distribution_routes_default);
app.use("/api/reports", reportRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/search", search_routes_default);
app.use("/api/penyusutan", penyusutan_routes_default);
app.use("/api/arsip-vital", arsip_vital_routes_default);
app.use("/api/arsip-terjaga", arsip_terjaga_routes_default);
app.use("/api/arsip-elektronik", arsip_elektronik_routes_default);
app.use("/api/tunjuk-silang", tunjuk_silang_routes_default);
app.use("/api/autentikasi", autentikasi_routes_default);
app.use("/api/layanan-arsip", layanan_arsip_routes_default);
app.use("/api/supervision", supervision_routes_default);
app.use("/api/mapping", mapping_routes_default);
app.use("/api/security", security_routes_default);
app.use("/api/import", google_drive_import_routes_default);
if (env.NODE_ENV === "development") {
  app.use("/api/dev", dev_auth_routes_default);
}
setupSwagger(app);
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Not Found", path: req.path });
});
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.name,
      message: err.message,
      ...env.NODE_ENV === "development" && { stack: err.stack }
    });
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  res.status(500).json({
    success: false,
    error: "Internal Server Error",
    message: env.NODE_ENV === "development" ? err.message : "Terjadi kesalahan pada server."
  });
});
var app_default = app;

export {
  logger,
  app_default
};
