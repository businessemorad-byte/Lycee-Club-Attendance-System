import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  attendanceLogsTable,
  sessionsTable,
  studentsTable,
} from "@workspace/db";
import {
  ExportSessionCsvParams,
  GetSessionReportParams,
  GetSessionReportResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function buildReport(sessionId: string) {
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  if (!session) return null;

  const [students, logs] = await Promise.all([
    db
      .select({
        id: studentsTable.id,
        fullName: studentsTable.fullName,
        massarNumber: studentsTable.massarNumber,
        classroom: studentsTable.classroom,
        parentPhone: studentsTable.parentPhone,
        parentAuthSigned: studentsTable.parentAuthSigned,
        photoAuthSigned: studentsTable.photoAuthSigned,
        status: studentsTable.status,
      })
      .from(studentsTable)
      .where(eq(studentsTable.status, "ACTIVE"))
      .orderBy(asc(studentsTable.fullName)),
    db
      .select({
        studentId: attendanceLogsTable.studentId,
        scannedAt: attendanceLogsTable.scannedAt,
      })
      .from(attendanceLogsTable)
      .where(eq(attendanceLogsTable.sessionId, session.id)),
  ]);

  const timeByStudent = new Map(
    logs.map((log) => [log.studentId, log.scannedAt]),
  );
  const present = students
    .filter((student) => timeByStudent.has(student.id))
    .map((student) => ({
      ...student,
      scannedAt: timeByStudent.get(student.id) ?? null,
    }));
  const absent = students
    .filter((student) => !timeByStudent.has(student.id))
    .map((student) => ({ ...student, scannedAt: null }));
  const totalStudents = students.length;
  const presentCount = present.length;

  return {
    session,
    totalStudents,
    presentCount,
    absentCount: absent.length,
    attendanceRate:
      totalStudents === 0 ? 0 : (presentCount / totalStudents) * 100,
    present,
    absent,
  };
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

router.get("/reports/:sessionId", async (req, res): Promise<void> => {
  const params = GetSessionReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid session ID." });
    return;
  }
  const report = await buildReport(params.data.sessionId);
  if (!report) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  res.json(GetSessionReportResponse.parse(report));
});

router.get("/reports/:sessionId/csv", async (req, res): Promise<void> => {
  const params = ExportSessionCsvParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid session ID." });
    return;
  }
  const report = await buildReport(params.data.sessionId);
  if (!report) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  const columns = [
    "Status",
    "Full name",
    "Massar number",
    "Classroom",
    "Parent phone",
    "A1 parent authorization",
    "A2 photo authorization",
    "Scan time",
  ];
  const rows = [...report.present, ...report.absent].map((student) => [
    student.scannedAt ? "Present" : "Absent",
    student.fullName,
    student.massarNumber,
    student.classroom,
    student.parentPhone,
    student.parentAuthSigned ? "Yes" : "No",
    student.photoAuthSigned ? "Yes" : "No",
    student.scannedAt?.toISOString() ?? "",
  ]);
  const csv = [columns, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  const safeDate = report.session.date.replaceAll("-", "");
  res
    .status(200)
    .type("text/csv")
    .setHeader(
      "Content-Disposition",
      `attachment; filename="club-attendance-${safeDate}.csv"`,
    )
    .send(`\uFEFF${csv}`);
});

export default router;