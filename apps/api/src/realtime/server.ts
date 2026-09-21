import jwt from "jsonwebtoken";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { AuthUser } from "../middleware/auth.js";

interface AccessJwt {
  sub: string;
  schoolId: string | null;
  role: string;
  type: string;
}

function accessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET is not set — see .env.example");
  }
  return secret;
}

function verifyHandshakeToken(raw: unknown): AuthUser {
  const token = typeof raw === "string" ? raw.replace(/^Bearer\s+/, "") : "";
  if (!token) {
    throw new Error("Missing token.");
  }
  const payload = jwt.verify(token, accessSecret()) as AccessJwt;
  if (payload.type !== "access" || typeof payload.sub !== "string") {
    throw new Error("Not an access token.");
  }
  return { userId: payload.sub, schoolId: payload.schoolId ?? null, role: payload.role };
}

// Realtime server (spec §12.5): namespaces look like `/school-<schoolId>`,
// one room per school, joined server-side. The namespace string is
// CLIENT-SUPPLIED and therefore NEVER trusted: the handshake verifies the
// JWT, derives school_id from it, and the ONLY namespace that connects is
// the one matching that id. Anything else — wrong school, missing token,
// non-access token — dies in the handshake with connect_error, before any
// room join or event handler runs.
export function schoolNamespaceOf(schoolId: string): string {
  return `/school-${schoolId}`;
}

// Process-wide socket server, set once by initRealtime. Route handlers
// emit through emitToSchool; contexts without a live server (unit tests)
// emit nowhere instead of crashing.
let activeIo: Server | null = null;

export function schoolRoomOf(schoolId: string): string {
  return `school:${schoolId}`;
}

export function emitToSchool(schoolId: string, event: string, payload: unknown): void {
  activeIo?.to(schoolRoomOf(schoolId)).emit(event, payload);
}

export function initRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: (process.env.FRONTEND_ORIGIN ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0),
      credentials: true,
    },
  });
  activeIo = io;

  // Dynamic namespace: every /school-* path lands here, then gets checked.
  const schools = io.of(/^\/school-[A-Za-z0-9_-]+$/);

  schools.use((socket, next) => {
    try {
      const user = verifyHandshakeToken(socket.handshake.auth?.token);
      if (!user.schoolId) {
        // Platform Owner has no school — no tenant namespace to join.
        next(new Error("No school context."));
        return;
      }
      const expected = schoolNamespaceOf(user.schoolId);
      if (socket.nsp.name !== expected) {
        next(new Error("Namespace does not match your school."));
        return;
      }
      socket.data.user = user;
      next();
    } catch {
      next(new Error("Invalid or expired token."));
    }
  });

  schools.on("connection", (socket: Socket) => {
    const user = socket.data.user as AuthUser;
    // Room derived from the VERIFIED identity, never from a client field.
    void socket.join(`school:${user.schoolId}`);
    socket.emit("ready", { userId: user.userId, schoolId: user.schoolId, role: user.role });
  });

  return io;
}
