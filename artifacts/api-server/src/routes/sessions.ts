import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { sessionsTable } from "@workspace/db";
import {
  CreateSessionBody,
  CreateSessionResponse,
  ListSessionsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sessions", async (_req, res): Promise<void> => {
  const sessions = await db
    .select()
    .from(sessionsTable)
    .orderBy(desc(sessionsTable.date));
  res.json(ListSessionsResponse.parse(sessions));
});

router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the session details and try again." });
    return;
  }
  const sessionDate = parsed.data.date.toISOString().slice(0, 10);
  if (new Date(`${sessionDate}T12:00:00.000Z`).getUTCDay() !== 5) {
    res.status(400).json({ error: "Club sessions must be scheduled for a Friday." });
    return;
  }
  if (parsed.data.startTime >= parsed.data.endTime) {
    res.status(400).json({ error: "The end time must be later than the start time." });
    return;
  }

  try {
    const [session] = await db
      .insert(sessionsTable)
      .values({
        id: randomUUID(),
        date: sessionDate,
        title: parsed.data.title.trim(),
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
      })
      .returning();
    res.status(201).json(CreateSessionResponse.parse(session));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ error: "A session already exists for this date." });
      return;
    }
    throw error;
  }
});

export default router;