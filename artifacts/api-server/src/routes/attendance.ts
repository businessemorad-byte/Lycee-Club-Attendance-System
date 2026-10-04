import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  attendanceLogsTable,
  sessionsTable,
  studentsTable,
} from "@workspace/db";
import { ScanAttendanceBody, ScanAttendanceResponse } from "@workspace/api-zod";
import { decryptBadge } from "../lib/badgeCrypto";

const router: IRouter = Router();

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function scanStudentView(student: typeof studentsTable.$inferSelect) {
  return {
    id: student.id,
    fullName: student.fullName,
    massarNumber: student.massarNumber,
    classroom: student.classroom,
    parentPhone: student.parentPhone,
    parentAuthSigned: student.parentAuthSigned,
    photoAuthSigned: student.photoAuthSigned,
    status: student.status,
    registrationDate: student.registrationDate,
  };
}

router.post("/attendance/scan", async (req, res): Promise<void> => {
  const parsed = ScanAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid or altered QR code." });
    return;
  }
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, parsed.data.sessionId));
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  const payload = decryptBadge(parsed.data.token);
  if (!payload) {
    res.status(400).json({ error: "Invalid or altered QR code." });
    return;
  }
  const [student] = await db
    .select()
    .from(studentsTable)
    .where(
      and(
        eq(studentsTable.id, payload.studentId),
        eq(studentsTable.massarNumber, payload.massar),
        eq(studentsTable.status, "ACTIVE"),
      ),
    );
  if (!student) {
    res.status(400).json({ error: "Invalid or altered QR code." });
    return;
  }

  const [priorLog] = await db
    .select()
    .from(attendanceLogsTable)
    .where(
      and(
        eq(attendanceLogsTable.sessionId, session.id),
        eq(attendanceLogsTable.studentId, student.id),
      ),
    );
  if (priorLog) {
    res.json(
      ScanAttendanceResponse.parse({
        status: "duplicate",
        student: scanStudentView(student),
        timestamp: priorLog.scannedAt,
        message: "This student is already marked present for this session.",
      }),
    );
    return;
  }

  let log;
  try {
    [log] = await db
      .insert(attendanceLogsTable)
      .values({
        id: randomUUID(),
        sessionId: session.id,
        studentId: student.id,
        scannedBy: String(res.locals.adminEmail),
      })
      .returning();
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
    const [concurrentLog] = await db
      .select()
      .from(attendanceLogsTable)
      .where(
        and(
          eq(attendanceLogsTable.sessionId, session.id),
          eq(attendanceLogsTable.studentId, student.id),
        ),
      );
    if (!concurrentLog) throw error;
    res.json(
      ScanAttendanceResponse.parse({
        status: "duplicate",
        student: scanStudentView(student),
        timestamp: concurrentLog.scannedAt,
        message: "This student is already marked present for this session.",
      }),
    );
    return;
  }

  const incompleteAuthorization =
    !student.parentAuthSigned || !student.photoAuthSigned;
  res.json(
    ScanAttendanceResponse.parse({
      status: incompleteAuthorization ? "warning" : "present",
      student: scanStudentView(student),
      timestamp: log.scannedAt,
      message: incompleteAuthorization
        ? `Authorization missing: ${[
            !student.parentAuthSigned && "A1 parent authorization",
            !student.photoAuthSigned && "A2 photo authorization",
          ]
            .filter(Boolean)
            .join(" and ")}.`
        : null,
    }),
  );
});

export default router;