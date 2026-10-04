import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { studentsTable } from "@workspace/db";
import {
  CreateStudentBody,
  CreateStudentResponse,
  GetStudentBadgeParams,
  GetStudentBadgeResponse,
  GetStudentParams,
  GetStudentResponse,
  ListStudentsQueryParams,
  ListStudentsResponse,
  UpdateStudentBody,
  UpdateStudentParams,
  UpdateStudentResponse,
} from "@workspace/api-zod";
import { encryptBadge } from "../lib/badgeCrypto";

const router: IRouter = Router();

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

router.get("/students", async (req, res): Promise<void> => {
  const parsed = ListStudentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid student filters." });
    return;
  }

  const conditions = [];
  if (parsed.data.status) {
    conditions.push(eq(studentsTable.status, parsed.data.status));
  }
  const search = parsed.data.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(studentsTable.fullName, pattern),
        ilike(studentsTable.massarNumber, pattern),
        ilike(studentsTable.classroom, pattern),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(studentsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`lower(${studentsTable.fullName})`);
  res.json(ListStudentsResponse.parse(rows));
});

router.post("/students", async (req, res): Promise<void> => {
  const parsed = CreateStudentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the student details and try again." });
    return;
  }

  const [total] = await db.select({ total: count() }).from(studentsTable);
  if (Number(total.total) >= 30) {
    res.status(409).json({ error: "The club's 30-student enrollment limit has been reached." });
    return;
  }

  const input = parsed.data;
  const id = randomUUID();
  const massarNumber = input.massarNumber.trim().toUpperCase();
  try {
    const [student] = await db
      .insert(studentsTable)
      .values({
        id,
        fullName: input.fullName.trim(),
        massarNumber,
        classroom: input.classroom.trim(),
        parentPhone: input.parentPhone.trim(),
        parentAuthSigned: input.parentAuthSigned,
        photoAuthSigned: input.photoAuthSigned,
        medicalNotes: input.medicalNotes?.trim() || null,
        status: "ACTIVE",
        encryptedToken: encryptBadge(id, massarNumber),
      })
      .returning();
    res.status(201).json(CreateStudentResponse.parse(student));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "A student with this Massar number is already enrolled." });
      return;
    }
    throw error;
  }
});

router.get("/students/:studentId", async (req, res): Promise<void> => {
  const params = GetStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid student ID." });
    return;
  }
  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.studentId));
  if (!student) {
    res.status(404).json({ error: "Student not found." });
    return;
  }
  res.json(GetStudentResponse.parse(student));
});

router.patch("/students/:studentId", async (req, res): Promise<void> => {
  const params = UpdateStudentParams.safeParse(req.params);
  const parsed = UpdateStudentBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Check the student details and try again." });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Provide at least one field to update." });
    return;
  }

  const [current] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.studentId));
  if (!current) {
    res.status(404).json({ error: "Student not found." });
    return;
  }

  const massarNumber = parsed.data.massarNumber?.trim().toUpperCase();
  const update = {
    ...parsed.data,
    ...(parsed.data.fullName !== undefined && {
      fullName: parsed.data.fullName.trim(),
    }),
    ...(massarNumber !== undefined && { massarNumber }),
    ...(parsed.data.classroom !== undefined && {
      classroom: parsed.data.classroom.trim(),
    }),
    ...(parsed.data.parentPhone !== undefined && {
      parentPhone: parsed.data.parentPhone.trim(),
    }),
    ...(parsed.data.medicalNotes !== undefined && {
      medicalNotes: parsed.data.medicalNotes?.trim() || null,
    }),
    ...(massarNumber !== undefined &&
      massarNumber !== current.massarNumber && {
        encryptedToken: encryptBadge(current.id, massarNumber),
      }),
  };
  try {
    const [student] = await db
      .update(studentsTable)
      .set(update)
      .where(eq(studentsTable.id, params.data.studentId))
      .returning();
    res.json(UpdateStudentResponse.parse(student));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "A student with this Massar number is already enrolled." });
      return;
    }
    throw error;
  }
});

router.get("/students/:studentId/badge", async (req, res): Promise<void> => {
  const params = GetStudentBadgeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid student ID." });
    return;
  }
  const [student] = await db
    .select({
      id: studentsTable.id,
      encryptedToken: studentsTable.encryptedToken,
    })
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.studentId));
  if (!student) {
    res.status(404).json({ error: "Student not found." });
    return;
  }
  res.json(
    GetStudentBadgeResponse.parse({
      studentId: student.id,
      token: student.encryptedToken,
    }),
  );
});

export default router;