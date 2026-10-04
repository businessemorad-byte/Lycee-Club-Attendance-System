import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const studentsTable = pgTable(
  "club_students",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    massarNumber: text("massar_number").notNull(),
    classroom: text("classroom").notNull(),
    parentPhone: text("parent_phone").notNull(),
    parentAuthSigned: boolean("parent_auth_signed").notNull().default(false),
    photoAuthSigned: boolean("photo_auth_signed").notNull().default(false),
    medicalNotes: text("medical_notes"),
    status: text("status").notNull().default("ACTIVE"),
    encryptedToken: text("encrypted_token").notNull(),
    registrationDate: timestamp("registration_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("club_students_massar_number_unique").on(table.massarNumber),
    index("club_students_status_idx").on(table.status),
  ],
);

export const sessionsTable = pgTable(
  "club_sessions",
  {
    id: text("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("club_sessions_date_unique").on(table.date)],
);

export const attendanceLogsTable = pgTable(
  "club_attendance_logs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessionsTable.id),
    studentId: text("student_id")
      .notNull()
      .references(() => studentsTable.id),
    scannedAt: timestamp("scanned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    scannedBy: text("scanned_by").notNull(),
  },
  (table) => [
    uniqueIndex("club_attendance_session_student_unique").on(
      table.sessionId,
      table.studentId,
    ),
    index("club_attendance_session_idx").on(table.sessionId),
  ],
);