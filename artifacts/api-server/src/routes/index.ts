import { Router, type IRouter } from "express";
import healthRouter from "./health";
import overviewRouter from "./overview";
import studentsRouter from "./students";
import sessionsRouter from "./sessions";
import attendanceRouter from "./attendance";
import reportsRouter from "./reports";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAdmin);
router.use(overviewRouter);
router.use(studentsRouter);
router.use(sessionsRouter);
router.use(attendanceRouter);
router.use(reportsRouter);

export default router;
