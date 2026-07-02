import { dbDMS, dbHris } from "../../config/db.js";
import { logger } from "../../helpers/logger.js";
import { getErrorResponse } from "../../helpers/utils.js";

/**
 * Get report data for temuan
 */
export const getTemuanReport = async (req, res) => {
  try {
    const { bu_id, div_id, judul, tgl_awal, tgl_akhir, user_type, user_div, user_empid } = req.query;
    
    let query = `
      SELECT 
        t.temuan_id,
        t.temuan_judul,
        t.temuan_tglawal,
        t.temuan_tglakhir,
        t.temuan_bu,
        t.temuan_div,
        t.temuan_auditee,
        t.temuan_emailauditee,
        (SELECT bu_name FROM portal.dbo.master_bu_new WHERE bu_id = t.temuan_bu COLLATE SQL_Latin1_General_CP1_CI_AS) as bu_name,
        (SELECT nama_div FROM portal.dbo.master_div_new WHERE id_div = t.temuan_div COLLATE SQL_Latin1_General_CP1_CI_AS) as div_nama,
        
        -- Total count
        (SELECT COUNT(*) FROM list_det ld 
         INNER JOIN list_hdr lh ON ld.listdet_listid = lh.list_id 
         WHERE lh.list_temuanid = t.temuan_id) as total,
        
        -- Closed before due date
        (SELECT COUNT(*) FROM list_det ld 
         INNER JOIN list_hdr lh ON ld.listdet_listid = lh.list_id 
         WHERE lh.list_temuanid = t.temuan_id 
         AND ld.listdet_status = '1'
         AND CONVERT(datetime, ld.listdet_closedate, 120) <= CONVERT(datetime, ld.listdet_duedate, 120)) as closed,
        
        -- Closed after due date
        (SELECT COUNT(*) FROM list_det ld 
         INNER JOIN list_hdr lh ON ld.listdet_listid = lh.list_id 
         WHERE lh.list_temuanid = t.temuan_id 
         AND ld.listdet_status = '1'
         AND CONVERT(datetime, ld.listdet_closedate, 120) > CONVERT(datetime, ld.listdet_duedate, 120)) as closedafter,
        
        -- Outstanding before due date
        (SELECT COUNT(*) FROM list_det ld 
         INNER JOIN list_hdr lh ON ld.listdet_listid = lh.list_id 
         WHERE lh.list_temuanid = t.temuan_id 
         AND ld.listdet_status IN ('0', '2')
         AND GETDATE() <= CONVERT(datetime, ld.listdet_duedate, 120)) as outstanding,
        
        -- Outstanding after due date
        (SELECT COUNT(*) FROM list_det ld 
         INNER JOIN list_hdr lh ON ld.listdet_listid = lh.list_id 
         WHERE lh.list_temuanid = t.temuan_id 
         AND ld.listdet_status IN ('0', '2')
         AND GETDATE() > CONVERT(datetime, ld.listdet_duedate, 120)) as outstandingafter
        
      FROM temuan t
      WHERE 1=1
    `;
    
    const params = [];
    
    // Filter by user type
    if (user_type === '1') {
      // Type 1: Filter by user's division only
      if (user_div) {
        query += ` AND t.temuan_div = ?`;
        params.push(user_div);
      }
    }
    
    // Filter by BU
    if (bu_id) {
      query += ` AND t.temuan_bu = ?`;
      params.push(bu_id);
    }
    
    // Filter by Division
    if (div_id) {
      query += ` AND t.temuan_div = ?`;
      params.push(div_id);
    }
    
    // Filter by Judul
    if (judul) {
      query += ` AND t.temuan_judul = ?`;
      params.push(judul);
    }
    
    // Filter by Date Range
    if (tgl_awal) {
      query += ` AND t.temuan_tglawal >= ?`;
      params.push(tgl_awal);
    }
    
    if (tgl_akhir) {
      query += ` AND t.temuan_tglakhir <= ?`;
      params.push(tgl_akhir);
    }
    
    query += ` ORDER BY t.temuan_datecreated DESC`;
    
    const result = await dbDMS.raw(query, params);
    
    // Get employee names for each temuan
    const data = [];
    for (const row of result) {
      const auditeeIds = row.temuan_auditee ? row.temuan_auditee.split(',') : [];
      const auditeeNames = [];
      
      for (const empId of auditeeIds) {
        const emp = await dbHris('ptl_hris')
          .select('user_name as employee_name')
          .where('Emp_Id', empId.trim())
          .first();
        
        if (emp) {
          auditeeNames.push(emp.employee_name);
        }
      }
      
      data.push({
        ...row,
        auditee_names: auditeeNames
      });
    }
    
    res.status(200).json(data);
  } catch (error) {
    logger(error, 'GET /report/getTemuanReport', req.query);
    return res.status(406).json(getErrorResponse(error));
  }
};

/**
 * Get all judul temuan for filter dropdown
 */
export const getJudulTemuan = async (req, res) => {
  try {
    const { bu_id, user_type, user_div } = req.query;
    
    let query = dbDMS('temuan')
      .distinct('temuan_judul')
      // .select('temuan_judul')
      .whereNotNull('temuan_judul')
      .where('temuan_judul', '!=', '');
    
    // Filter by user type
    if (user_type === '1' && user_div) {
      query = query.where('temuan_div', user_div);
    }
    
    // Filter by BU if provided
    if (bu_id) {
      query = query.where('temuan_bu', bu_id);
    }
    
    query = query.orderBy('temuan_judul', 'asc');
    
    const result = await query;
    
    res.status(200).json(result);
  } catch (error) {
    logger(error, 'GET /report/getJudulTemuan', req.query);
    return res.status(406).json(getErrorResponse(error));
  }
};

/**
 * Get Business Units for filter
 */
export const getBusinessUnits = async (req, res) => {
  try {
    const businessUnits = await dbDMS('v_mstr_bu')
      .select('bu_id', 'bu_name')
      .where('bu_status', 'Active')
      .orderBy('bu_name', 'asc');
    
    res.status(200).json(businessUnits);
  } catch (error) {
    logger(error, 'GET /report/getBusinessUnits', req.query);
    return res.status(406).json(getErrorResponse(error));
  }
};

/**
 * Get Divisions by BU for filter
 */
export const getDivisionsByBU = async (req, res) => {
  try {
    const { bu_id } = req.query;
    
    const divisions = await dbHris.raw(`
      SELECT 
        b.id_div as div_id, 
        b.nama_div as div_nama
      FROM mapping_bu_div a
      LEFT JOIN master_div_new b ON a.map_div_id = b.id_div
      WHERE b.div_active = 'ACTIVE'
        AND a.map_direktorat_pk = ?
      ORDER BY b.nama_div ASC
    `, [bu_id]);
    
    res.status(200).json(divisions);
  } catch (error) {
    logger(error, 'GET /report/getDivisionsByBU', req.query);
    return res.status(406).json(getErrorResponse(error));
  }
};
