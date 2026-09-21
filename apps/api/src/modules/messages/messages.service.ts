import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";

// Deterministic pair key (sorted user ids): one indexed lookup lists the
// whole conversation, in either direction.
export function threadKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

interface Actor {
  userId: string;
  role: string;
}

// §13.7 access matrix (this product's users include minors — academic
// communication only, never an open chat):
// - STUDENT → TEACHER with a real teaching link to the student's section.
//   STUDENT → anyone else (students, parents, admins): never.
// - PARENT → TEACHER linked to any linked child's section. Nowhere else.
// - TEACHER → STUDENT with a link, or PARENT of a student in their
//   sections. Never teachers/admins (staff coordination is not this
//   feature) and never unlinked families.
// - ADMIN sends nothing here (oversight reads, handled on the read path).
// A "teaching link" = class teacher of the section OR a timetable slot in
// it, AND at least one TeacherSubject row (a staffer with no subject
// qualification teaches nothing). Same relationship definition as homework
// posting — one shared meaning of "teaches" across features.
async function teacherLinkedToSection(db: PrismaClient, teacherUserId: string, sectionId: string): Promise<boolean> {
  const staff = await db.staff.findFirst({ where: { userId: teacherUserId } });
  if (!staff) {
    return false;
  }
  const section = await db.section.findFirst({ where: { id: sectionId } });
  if (!section) {
    return false;
  }
  const qualified = await db.teacherSubject.findFirst({ where: { staffId: staff.id } });
  if (!qualified) {
    return false;
  }
  if (section.classTeacherId === staff.id) {
    return true;
  }
  const scheduled = await db.timetableSlot.findFirst({
    where: { sectionId: section.id, teacherId: staff.id },
  });
  return scheduled !== null;
}

async function sectionsOfStudent(db: PrismaClient, studentUserId: string): Promise<string[]> {
  const profile = await db.student.findFirst({ where: { userId: studentUserId } });
  return profile ? [profile.sectionId] : [];
}

async function sectionsOfParent(db: PrismaClient, parentUserId: string): Promise<string[]> {
  const links = await db.studentGuardian.findMany({
    where: { parentId: parentUserId },
    select: { student: { select: { sectionId: true } } },
  });
  return [...new Set(links.map((l) => l.student.sectionId))];
}

async function sectionsOfTeacher(db: PrismaClient, teacherUserId: string): Promise<string[]> {
  const staff = await db.staff.findFirst({ where: { userId: teacherUserId } });
  if (!staff) {
    return [];
  }
  const [owned, scheduled] = await Promise.all([
    db.section.findMany({ where: { classTeacherId: staff.id }, select: { id: true } }),
    db.timetableSlot.findMany({ where: { teacherId: staff.id }, select: { sectionId: true } }),
  ]);
  return [...new Set([...owned.map((s) => s.id), ...scheduled.map((s) => s.sectionId)])];
}

// One direction: may `from` message `to`? Both must be in-school users
// (checked by callers via scoped lookups before calling).
export async function mayMessage(
  db: PrismaClient,
  from: Actor & { role: string },
  toUserId: string,
  toRole: string,
): Promise<boolean> {
  if (from.userId === toUserId) {
    return false;
  }
  if (from.role === "STUDENT" && toRole === "TEACHER") {
    const sections = await sectionsOfStudent(db, from.userId);
    for (const sectionId of sections) {
      if (await teacherLinkedToSection(db, toUserId, sectionId)) {
        return true;
      }
    }
    return false;
  }
  if (from.role === "PARENT" && toRole === "TEACHER") {
    const sections = await sectionsOfParent(db, from.userId);
    for (const sectionId of sections) {
      if (await teacherLinkedToSection(db, toUserId, sectionId)) {
        return true;
      }
    }
    return false;
  }
  if (from.role === "TEACHER" && toRole === "STUDENT") {
    const sections = await sectionsOfStudent(db, toUserId);
    const mine = new Set(await sectionsOfTeacher(db, from.userId));
    return sections.some((s) => mine.has(s));
  }
  if (from.role === "TEACHER" && toRole === "PARENT") {
    const sections = await sectionsOfParent(db, toUserId);
    const mine = new Set(await sectionsOfTeacher(db, from.userId));
    return sections.some((s) => mine.has(s));
  }
  return false;
}

export async function sendMessage(
  db: PrismaClient,
  sender: Actor,
  receiverId: string,
  body: string,
) {
  const [senderRow, receiver] = await Promise.all([
    db.user.findUnique({ where: { id: sender.userId } }),
    db.user.findFirst({ where: { id: receiverId }, include: { role: true } }),
  ]);
  if (!receiver) {
    throw new AuthError(404, "USER_NOT_FOUND", "Recipient not found in this school.");
  }
  if (!senderRow?.schoolId) {
    // Unreachable in practice: tenant middleware guarantees a school_id on
    // every sender that reaches here (owners hold no messages.send key).
    throw new AuthError(500, "INTERNAL_ERROR", "Something went wrong.");
  }
  const allowed = await mayMessage(db, sender, receiver.id, receiver.role.name);
  if (!allowed) {
    throw new AuthError(403, "MESSAGING_NOT_ALLOWED", "You cannot message this user.");
  }
  return db.message.create({
    data: {
      schoolId: senderRow.schoolId,
      senderId: sender.userId,
      receiverId: receiver.id,
      threadId: threadKey(sender.userId, receiver.id),
      body,
    },
  });
}

export interface ThreadViewer {
  userId: string;
  role: string;
}

export interface ThreadSummary {
  user: { id: string; name: string };
  lastMessage: { body: string; createdAt: Date; fromMe: boolean };
  unread: number;
}

// Thread list: one row per conversation partner, newest first. Participants
// see their own threads; Admin sees every thread in the school (oversight).
// Unread = messages to the viewer with readAt unset (0 for the admin view,
// which is surveillance, not an inbox).
export async function listThreads(db: PrismaClient, viewer: ThreadViewer): Promise<{ threads: ThreadSummary[] }> {
  const admin = viewer.role === "SCHOOL_ADMIN";
  const messages = await db.message.findMany({
    where: admin ? {} : { OR: [{ senderId: viewer.userId }, { receiverId: viewer.userId }] },
    include: {
      sender: { select: { id: true, name: true } },
      receiver: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const byThread = new Map<string, { other: { id: string; name: string }; last: (typeof messages)[number]; unread: number }>();
  for (const message of messages) {
    // threadId is the sorted pair key — identical in both directions, so
    // one entry per conversation for participants and admin alike. The
    // display partner is the counterparty (or the latest sender for the
    // admin, who participates in none of them).
    const other =
      !admin && message.senderId === viewer.userId ? message.receiver : message.sender;
    const existing = byThread.get(message.threadId);
    if (!existing) {
      byThread.set(message.threadId, {
        other: { id: other.id, name: other.name },
        last: message,
        unread: !admin && message.receiverId === viewer.userId && !message.readAt ? 1 : 0,
      });
    } else if (!admin && message.receiverId === viewer.userId && !message.readAt) {
      existing.unread += 1;
    }
  }
  return {
    threads: [...byThread.values()].map((t) => ({
      user: t.other,
      lastMessage: { body: t.last.body, createdAt: t.last.createdAt, fromMe: t.last.senderId === viewer.userId },
      unread: t.unread,
    })),
  };
}

// Thread read: ADMIN sees any conversation in their school (oversight, not
// participation — §13.7). Everyone else sees exactly the threads they could
// participate in (either direction of the same matrix).
export async function readThread(db: PrismaClient, viewer: ThreadViewer, otherUserId: string) {
  const other = await db.user.findFirst({ where: { id: otherUserId }, include: { role: true } });
  if (!other) {
    throw new AuthError(404, "USER_NOT_FOUND", "User not found in this school.");
  }
  const messageSelect = {
    include: {
      sender: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  } as const;
  if (viewer.role === "SCHOOL_ADMIN") {
    // Oversight: every message TO or FROM this user — not the admin's own
    // (empty) pair thread, which is what a naive threadKey lookup returns.
    return db.message.findMany({
      where: { OR: [{ senderId: other.id }, { receiverId: other.id }] },
      ...messageSelect,
    });
  }
  const viewerRole = (await db.user.findUnique({ where: { id: viewer.userId }, include: { role: true } }))?.role.name;
  if (!viewerRole) {
    throw new AuthError(401, "UNAUTHENTICATED", "Authentication required.");
  }
  const forward = await mayMessage(db, { userId: viewer.userId, role: viewerRole }, other.id, other.role.name);
  const backward = await mayMessage(
    db,
    { userId: other.id, role: other.role.name },
    viewer.userId,
    viewerRole,
  );
  if (!forward && !backward) {
    throw new AuthError(403, "MESSAGING_NOT_ALLOWED", "You cannot view this conversation.");
  }
  return db.message.findMany({
    where: { threadId: threadKey(viewer.userId, other.id) },
    ...messageSelect,
  });
}
