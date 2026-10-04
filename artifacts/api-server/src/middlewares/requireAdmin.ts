import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = getAuth(req);
  const userId = auth.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  let approvedEmails: Set<string>;
  const envAdminEmails = process.env.ADMIN_EMAILS;
  const fallbackAdminEmails = process.env.ADMIN_EMAILS_FALLBACK || "";

  if (envAdminEmails) {
    approvedEmails = new Set(
      envAdminEmails
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
  } else if (fallbackAdminEmails) {
    approvedEmails = new Set(
      fallbackAdminEmails
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
  } else {
    res.status(503).json({
      error: "Admin access is not configured. Add approved staff emails to ADMIN_EMAILS or ADMIN_EMAILS_FALLBACK environment variable.",
    });
    return;
  }

  const claims = auth.sessionClaims as Record<string, unknown> | undefined;
  const email =
    typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || !approvedEmails.has(email)) {
    res.status(403).json({ error: "This account is not approved for club administration." });
    return;
  }

  res.locals.adminEmail = email;
  next();
}