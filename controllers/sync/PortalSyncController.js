import dayjs from "dayjs";
import { db, dbHris, dbDMS } from "../../config/db.js";
import { logger } from "../../helpers/logger.js";
import { getErrorResponse } from "../../helpers/utils.js";

// ─── Middleware: validate API keys ─────────────────────────────────────────────
export const validateRoleKey = (req, res, next) => {
  const authHeader = req.headers["roleperappsdbc2026"];
  const apiKey = req.headers["x-api-key"];

  if (!authHeader && apiKey !== "roleperappsdbc2026") {
    return res.status(401).json({ error: "Unauthorized - Invalid or missing roleperappsdbc2026 or x-api-key header" });
  }
  next();
};

export const validateSyncKey = (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!key || key !== "userperappsdbc2026") {
    return res.status(401).json({ error: "Unauthorized - Invalid or missing x-api-key header" });
  }
  next();
};

// ─── GET /api/v1/roles ────────────────────────────────────────────────────────
export const getRoles = async (req, res) => {
  try {
    const roles = await dbDMS("master_role")
      .select("role_id", "role_name");

    return res.status(200).json(
      roles.map((r) => ({
        role_id: String(r.role_id),
        role_name: r.role_name,
        is_active: true,
      }))
    );
  } catch (error) {
    logger(error, "GET /api/v1/roles");
    return res.status(500).json(getErrorResponse(error));
  }
};

// ─── POST /api/v1/sync-users ──────────────────────────────────────────────────
export const syncUsers = async (req, res) => {
  const users = req.body.users;
  if (!users || !Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ error: "users array is required and cannot be empty" });
  }

  const appsId      = req.body.apps_id ?? "";
  const syncType    = req.body.sync_type ?? "MANUAL";
  const triggeredBy = req.body.triggered_by ?? "SYSTEM";
  const nonAktifLain = req.body.non_aktif_user_lain === true || req.body.non_aktif_user_lain === "true";
  const startedAt   = dayjs();
  const results     = [];
  const processedEmpIds = [];

  for (const userData of users) {
    const empId = userData.employee_id ?? null;

    if (!empId) {
      results.push(buildResult(appsId, syncType, triggeredBy, startedAt, userData, "ERROR", "employee_id is required"));
      continue;
    }

    processedEmpIds.push(empId);
    const roleId   = userData.role_id ?? null;
    const isActive = userData.is_active !== undefined ? Boolean(userData.is_active) : true;

    try {
      // Upsert user in users table
      let user = await db("users").where("user_id", empId).first();
      if (!user) {
        const hris = await dbHris("ptl_hris")
          .select("user_email", "bu_id")
          .where("Emp_Id", empId)
          .where("user_active", "Active")
          .first();

        const email = userData.employee_email ?? hris?.user_email ?? null;
        const domainCode = hris?.bu_id ?? "";

        await db("users").insert({
          user_id:      empId,
          user_nik:     userData.employee_nik ?? empId,
          user_name:    userData.employee_name ?? "",
          user_email:   email,
          user_domain:  domainCode,
          user_site:    domainCode ? (domainCode + "11") : "",
          user_active:  "Active",
          created_by:   "system",
          created_at:   dayjs().format("YYYY-MM-DD HH:mm:ss"),
          updated_by:   "system",
          updated_at:   dayjs().format("YYYY-MM-DD HH:mm:ss"),
        });
        user = await db("users").where("user_id", empId).first();
      }

      // Check user_grant_role record
      const existingGrant = await db("user_grant_role")
        .where("grant_user_id", empId)
        .whereNull("deleted_at")
        .first();

      const oldRole     = existingGrant ? String(existingGrant.grant_urole_id) : "";
      const oldIsActive = existingGrant ? true : false;
      let action;

      if (!isActive) {
        if (existingGrant) {
          await db("user_grant_role")
            .where("grant_user_id", empId)
            .whereNull("deleted_at")
            .update({
              deleted_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
              deleted_by: "system"
            });
          
          await db("users").where("user_id", empId).update({
            user_active: "Non Active",
            updated_by: "system",
            updated_at: dayjs().format("YYYY-MM-DD HH:mm:ss")
          });
          
          action = "UPDATE";
        } else {
          action = "SKIP";
        }

        // Also remove from dbDMS master_user table
        await dbDMS("master_user").where("emp_id", empId).delete();
      } else {
        if (user.user_active !== "Active") {
          await db("users").where("user_id", empId).update({
            user_active: "Active",
            updated_by: "system",
            updated_at: dayjs().format("YYYY-MM-DD HH:mm:ss")
          });
        }

        if (!existingGrant) {
          await db("user_grant_role").insert({
            grant_user_id:  empId,
            grant_urole_id: Number(roleId),
            created_by:     "system",
            created_at:     dayjs().format("YYYY-MM-DD HH:mm:ss"),
            updated_by:     "system",
            updated_at:     dayjs().format("YYYY-MM-DD HH:mm:ss"),
          });
          action = "INSERT";
        } else if (existingGrant.grant_urole_id != roleId) {
          await db("user_grant_role")
            .where("grant_user_id", empId)
            .whereNull("deleted_at")
            .update({
              grant_urole_id: Number(roleId),
              updated_by:     "system",
              updated_at:     dayjs().format("YYYY-MM-DD HH:mm:ss")
            });
          action = "UPDATE";
        } else {
          action = "SKIP";
        }

        // Also upsert in dbDMS master_user table
        const domainCode = user.user_domain || "";
        const existingMasterUser = await dbDMS("master_user")
          .where("emp_id", empId)
          .first();

        if (existingMasterUser) {
          await dbDMS("master_user")
            .where("emp_id", empId)
            .update({
              account_nik:      userData.employee_nik ?? existingMasterUser.account_nik ?? empId,
              account_username: userData.employee_nik ?? existingMasterUser.account_username ?? empId,
              account_bu:       domainCode || existingMasterUser.account_bu,
              account_type:     String(roleId),
              updated_by:       "system",
              updated_at:       dayjs().format("YYYY-MM-DD HH:mm:ss")
            });
        } else {
          await dbDMS("master_user").insert({
            account_nik:      userData.employee_nik ?? empId,
            account_username: userData.employee_nik ?? empId,
            emp_id:           empId,
            account_bu:       domainCode,
            account_type:     String(roleId),
            created_by:       "system",
            created_at:       dayjs().format("YYYY-MM-DD HH:mm:ss"),
            updated_by:       "system",
            updated_at:       dayjs().format("YYYY-MM-DD HH:mm:ss")
          });
        }
      }

      results.push(buildResult(appsId, syncType, triggeredBy, startedAt, userData, "SUCCESS", null, action, oldRole, oldIsActive, isActive));
    } catch (err) {
      results.push(buildResult(appsId, syncType, triggeredBy, startedAt, userData, "ERROR", err.message, null, null, null, isActive));
    }
  }

  // Deactivate users not in payload if requested
  if (nonAktifLain && processedEmpIds.length > 0) {
    await db("user_grant_role")
      .whereNotIn("grant_user_id", processedEmpIds)
      .whereNull("deleted_at")
      .update({
        deleted_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        deleted_by: "system"
      });

    await db("users")
      .whereNotIn("user_id", processedEmpIds)
      .update({
        user_active: "Non Active",
        updated_by: "system",
        updated_at: dayjs().format("YYYY-MM-DD HH:mm:ss")
      });

    await dbDMS("master_user")
      .whereNotIn("emp_id", processedEmpIds)
      .delete();
  }

  const endedAt   = dayjs();
  const requestId = `SYNC-${startedAt.unix()}-${Math.random().toString(36).substr(2, 6)}`;
  const inserted  = results.filter((r) => r.action === "INSERT").length;
  const updated   = results.filter((r) => r.action === "UPDATE").length;
  const skipped   = results.filter((r) => r.action === "SKIP").length;
  const errors    = results.filter((r) => r.status === "ERROR").length;

  const summary = {
    status:   errors > 0 && errors === results.length ? "ERROR" : "SUCCESS",
    inserted, updated, skipped, errors,
    total:    results.length,
  };

  const finalResults = results.map((r) => {
    r.sync_ended_at = endedAt.toISOString();
    r.duration_ms   = endedAt.diff(startedAt);
    r.metadata = {
      sync_summary: summary,
      total_users:  results.length,
      request_id:   requestId,
      changed_at:   endedAt.toISOString(),
    };
    return r;
  });

  return res.status(200).json(finalResults);
};

// ─── Helper ───────────────────────────────────────────────────────────────────
function buildResult(appsId, syncType, triggeredBy, startedAt, userData, status, errorMsg = null, action = null, oldRole = null, oldIsActive = null, isActive = true) {
  return {
    apps_id:         appsId,
    sync_type:       syncType,
    triggered_by:    triggeredBy,
    employee_nik:    userData.employee_nik ?? null,
    employee_id:     userData.employee_id ?? null,
    employee_name:   userData.employee_name ?? null,
    employee_email:  userData.employee_email ?? null,
    role_apps:       userData.role_apps ?? "",
    role_id:         userData.role_id ?? null,
    is_active:       isActive,
    old_role:        oldRole ?? "",
    old_is_active:   oldIsActive ?? true,
    action:          action ?? "ERROR",
    status,
    error_message:   errorMsg,
    sync_started_at: startedAt.toISOString(),
    sync_ended_at:   null,
    duration_ms:     null,
    metadata:        null,
  };
}
