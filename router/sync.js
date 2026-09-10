import express from "express";
import { getRoles, syncUsers, validateRoleKey, validateSyncKey } from "../controllers/sync/PortalSyncController.js";

const router = express.Router();

router.get("/roles",      validateRoleKey, getRoles);
router.post("/sync-users", validateSyncKey, syncUsers);

export default router;
