import { Router, type IRouter } from "express";
import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  attendanceLogsTable,
  sessionsTable,
  studentsTable,
} from "@workspace/db";
import { GetDashboardOverviewResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/club/overview", async (_req, res): Promise<void> => {
  const [counts] = await db
    .select({
      totalStudents: count(studentsTable.id),
      activeStudents: sql<number>`count(*) filter (where ${studentsTable.status} = 'ACTIVE')`,
      parentAuthorizations: sql<number>`count(*) filter (where ${studentsTable.status} = 'ACTIVE' and ${studentsTable.parentAuthSigned} = true)`,
      photoAuthorizations: sql<number>`count(*) filter (where ${studentsTable.status} = 'ACTIVE' and ${studentsTable.photoAuthSigned} = true)`,
    })
    .from(studentsTable);

  const [lastSession] = await db
    .select()
    .from(sessionsTable)
    .orderBy(desc(sessionsTable.date))
    .limit(1);

  let presentToday = 0;
  if (lastSession) {
    const [attendance] = await db
      .select({ present: count(attendanceLogsTable.id) })
      .from(attendanceLogsTable)
      .where(eq(attendanceLogsTable.sessionId, lastSession.id));
    presentToday = Number(attendance.present);
  }

  const activeCount = Number(counts.activeStudents);
  const result = {
    totalStudents: Number(counts.totalStudents),
    activeStudents: activeCount,
    parentAuthorizations: Number(counts.parentAuthorizations),
    photoAuthorizations: Number(counts.photoAuthorizations),
    lastSession: lastSession ?? null,
    attendanceRate: activeCount === 0 ? 0 : (presentToday / activeCount) * 100,
    presentToday,
  };
  res.json(GetDashboardOverviewResponse.parse(result));
});

export default router;