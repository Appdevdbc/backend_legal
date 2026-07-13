import { dbDMS, dbHris } from "../../config/db.js";
import { decrypt, extractArrayFromRaw, extractObjectFromRaw, getErrorResponse } from "../../helpers/utils.js";
import { logger } from "../../helpers/logger.js";
import { sendFeedbackNotification, sendClosingNotification } from "../../helpers/temuanMail.js";
import { uploadFileToFTP } from "../../helpers/ftpUpload.js";

/**
 * Get filtered temuan/request list for confirm closing
 */
export const getFilteredRequests = async (req, res) => {
  try {
    const { judul, tglawal, tglakhir, bu_id, div_id, auditee } = req.query;
    const { empid, type } = req.user || {};

    // Build dynamic filter
    let query = dbDMS('temuan as t')
      .select(
        't.temuan_id',
        't.temuan_judul',
        't.temuan_tglawal',
        't.temuan_tglakhir',
        't.temuan_bu',
        't.temuan_div',
        't.temuan_auditee',
        't.temuan_status',
        // 't.temuan_createdby',
        // 't.temuan_createddate',
        'bu.bu_name',
        'div.div_nama'
      )
      .leftJoin('v_mstr_div as div', function () {
        this.on('t.temuan_div', '=', dbDMS.raw('CAST(div.div_pk AS VARCHAR) COLLATE SQL_Latin1_General_CP1_CI_AS'));
      })
      .leftJoin('v_mstr_bu as bu', function () {
        this.on('t.temuan_bu', '=', dbDMS.raw('CAST(bu.bu_id AS VARCHAR) COLLATE SQL_Latin1_General_CP1_CI_AS'));
      });

    // Apply filters based on query params
    if (judul && judul.trim() !== '') {
      query = query.where('t.temuan_judul', 'like', `%${judul}%`);
    }

    if (tglawal && tglawal !== '') {
      query = query.where('t.temuan_tglawal', '>=', tglawal);
    }

    if (tglakhir && tglakhir !== '') {
      query = query.where('t.temuan_tglakhir', '<=', tglakhir);
    }

    if (bu_id && bu_id !== '') {
      query = query.where('t.temuan_bu', bu_id);
    }

    if (div_id && div_id !== '') {
      query = query.where('t.temuan_div', div_id);
    }

    if (auditee && auditee !== '') {
      query = query.where('t.temuan_auditee', 'like', `%${auditee}%`);
    }

    // Filter based on user type
    // Type 1: User can see their own requests
    // Type 2: Admin can see all
    // Type 3, 5: Corporate/Auditor can see all
    if (type === 1) {
      // Only show requests for this user's division or where they are requestee
      query = query.where(function () {
        this.where('t.temuan_auditee', 'like', `%${empid}%`)
          .orWhere('t.temuan_createdby', empid);
      });
    }

    query = query.orderBy([
      { column: 'bu.bu_name', order: 'asc' },
      { column: 'div.div_nama', order: 'asc' },
      { column: 't.temuan_judul', order: 'asc' },
      { column: 't.temuan_tglawal', order: 'asc' }
    ]);

    const requests = await query;

    // Get requestee names for each request
    const enrichedRequests = await Promise.all(
      requests.map(async (request) => {
        const requesteeIds = request.temuan_auditee ? request.temuan_auditee.split(',') : [];
        const requesteeNames = [];

        for (const empId of requesteeIds) {
          const employee = await dbHris('ptl_hris')
            .select('user_name')
            .where('Emp_Id', empId.trim())
            .first();

          if (employee) {
            requesteeNames.push(employee.user_name);
          }
        }

        return {
          ...request,
          requestee_names: requesteeNames.join(', '),
          status_text: request.temuan_status === '0' ? 'Open' : 'Closed'
        };
      })
    );

    res.status(200).json(enrichedRequests);
  } catch (error) {
    logger(error, 'GET /getFilteredRequests', req.query);
    return res.status(406).json(getErrorResponse(error));
  }
};

/**
 * Get request detail by ID
 */
export const getRequestDetail = async (req, res) => {
  try {
    const { temuan_id } = req.params;

    // Get main temuan data
    const temuan = await dbDMS('temuan')
      .select('*')
      .where('temuan_id', temuan_id)
      .first();

    if (!temuan) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // Get business unit and division info
    const bu = await dbHris('master_bu_new')
      .select('bu_name')
      .where('bu_id', temuan.temuan_bu)
      .first();

    const div = await dbHris('master_div_new')
      .select('nama_div')
      .where('id_div', temuan.temuan_div)
      .first();

    // Get requestee names
    const requesteeIds = temuan.temuan_auditee ? temuan.temuan_auditee.split(',') : [];
    const requesteeNames = [];

    for (const empId of requesteeIds) {
      const employee = await dbHris('ptl_hris')
        .select('user_name', 'user_email')
        .where('Emp_Id', empId.trim())
        .first();

      if (employee) {
        requesteeNames.push({
          emp_id: empId.trim(),
          name: employee.user_name,
          email: employee.user_email
        });
      }
    }

    // Get list items (points)
    const listItems = await dbDMS('list_hdr')
      .select('*')
      .where('list_temuanid', temuan_id)
      .orderBy('list_id');

    // Get detail items (lines) for each point
    const enrichedListItems = await Promise.all(
      listItems.map(async (item) => {
        const details = await dbDMS('list_det')
          .select('*')
          .where('listdet_listid', item.list_id)
          .orderBy('listdet_id');

        return {
          ...item,
          details
        };
      })
    );

    res.status(200).json({
      ...temuan,
      bu_name: bu ? bu.bu_name : '',
      div_name: div ? div.nama_div : '',
      requestees: requesteeNames,
      status_text: temuan.temuan_status === '0' ? 'Open' : 'Closed',
      list_items: enrichedListItems
    });
  } catch (error) {
    logger(error, 'GET /getRequestDetail', req.params);
    return res.status(406).json(getErrorResponse(error));
  }
};

/**
 * Get request progress/completion status
 */
export const getRequestProgress = async (req, res) => {
  try {
    const { temuan_id } = req.params;

    // Decrypt temuan_id
    const decryptedTemuanId = decrypt(temuan_id);

    // Get all detail items for this request
    const details = await dbDMS.raw(`
      SELECT 
        tld.*,
        tl.list_judul,
        LEFT (
          RIGHT(tld.listdet_id, CHARINDEX('-', REVERSE(tld.listdet_id)) - 1),
          CHARINDEX('.', RIGHT(tld.listdet_id, CHARINDEX('-', REVERSE(tld.listdet_id)) - 1)) - 1
        ) AS list_order,
        CASE
          WHEN CHARINDEX('-', tld.listdet_id) > 0 THEN
            RIGHT(tld.listdet_id, CHARINDEX('-', REVERSE(tld.listdet_id)) - 1)
          ELSE
            NULL
          END AS listdet_order
      FROM list_det tld
      INNER JOIN list_hdr tl ON tld.listdet_listid = tl.list_id
      INNER JOIN temuan t ON tl.list_temuanid = t.temuan_id
      WHERE t.temuan_id = ?
      ORDER BY
        LEFT (
          RIGHT(tld.listdet_id, CHARINDEX('-', REVERSE(tld.listdet_id)) - 1),
          CHARINDEX('.', RIGHT(tld.listdet_id, CHARINDEX('-', REVERSE(tld.listdet_id)) - 1)) - 1
        ),
        CASE
          WHEN CHARINDEX('-', tld.listdet_id) > 0 THEN
            RIGHT(tld.listdet_id, CHARINDEX('-', REVERSE(tld.listdet_id)) - 1)
          ELSE
            NULL
          END
    `, [decryptedTemuanId]);

    // Log SQL query
    // console.log('=== listUser Query (No Pagination) ===');
    // console.log(details.toSQL().toNative());
    // console.log('=====================================');

    // Extract array from raw query result using helper
    const items = extractArrayFromRaw(details);

    // Calculate progress
    const totalItems = items.length;
    const completedItems = items.filter(item => item.listdet_status === '1').length;
    const progressPercentage = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    // Check if all items are completed
    const canClose = totalItems > 0 && completedItems === totalItems;

    res.status(200).json({
      total_items: totalItems,
      completed_items: completedItems,
      progress_percentage: progressPercentage,
      can_close: canClose,
      items
    });
  } catch (error) {
    logger(error, 'GET /getRequestProgress', req.params);
    return res.status(406).json(getErrorResponse(error));
  }
};

/**
 * Confirm closing request
 */
export const confirmClosingRequest = async (req, res) => {
  const trx = await dbDMS.transaction();

  try {
    const { temuan_id } = req.params;
    const { empid } = req.user || {};

    // Decrypt temuan_id
    const decryptedTemuanId = decrypt(temuan_id);

    // Check if request exists and is open
    const temuan = await trx('temuan')
      .select('*')
      .where('temuan_id', decryptedTemuanId)
      .first();

    if (!temuan) {
      await trx.rollback();
      return res.status(404).json({ message: 'Request not found' });
    }

    if (temuan.temuan_status === '1') {
      await trx.rollback();
      return res.status(400).json({ message: 'Request already closed' });
    }

    // Check if all items are completed
    const details = await trx.raw(`
      SELECT COUNT(*) as total, 
             SUM(CASE WHEN listdet_status = '1' THEN 1 ELSE 0 END) as completed
      FROM list_det tld
      INNER JOIN list_hdr tl ON tld.listdet_listid = tl.list_id
      WHERE tl.list_temuanid = ?
    `, [decryptedTemuanId]);

    // Extract stats from raw query result using helper
    const stats = extractObjectFromRaw(details, { total: 0, completed: 0 });

    if (stats.total > 0 && stats.completed < stats.total) {
      await trx.rollback();
      return res.status(400).json({
        message: 'Cannot close request. Not all items are completed.',
        progress: {
          total: stats.total,
          completed: stats.completed
        }
      });
    }

    // Update temuan status to closed
    await trx('temuan')
      .where('temuan_id', decryptedTemuanId)
      .update({
        temuan_status: '1',
        temuan_closedby: empid,
        temuan_closeddate: dbDMS.fn.now()
      });

    await trx.commit();

    logger({ success: true }, 'Request closed successfully', { temuan_id: decryptedTemuanId, closed_by: empid });

    res.status(200).json({
      message: 'Request closed successfully',
      temuan_id: decryptedTemuanId
    });
  } catch (error) {
    await trx.rollback();
    logger(error, 'POST /confirmClosingRequest', req.params);
    return res.status(406).json(getErrorResponse(error));
  }
};

/**
 * Reopen closed request
 */
export const reopenRequest = async (req, res) => {
  const trx = await dbDMS.transaction();

  try {
    const { temuan_id } = req.params;
    const { empid } = req.user || {};

    // Decrypt temuan_id
    const decryptedTemuanId = decrypt(temuan_id);

    // Check if request exists and is closed
    const temuan = await trx('temuan')
      .select('*')
      .where('temuan_id', decryptedTemuanId)
      .first();

    if (!temuan) {
      await trx.rollback();
      return res.status(404).json({ message: 'Request not found' });
    }

    if (temuan.temuan_status === '0') {
      await trx.rollback();
      return res.status(400).json({ message: 'Request is already open' });
    }

    // Update temuan status to open
    await trx('temuan')
      .where('temuan_id', decryptedTemuanId)
      .update({
        temuan_status: '0',
        temuan_closedby: null,
        temuan_closeddate: null
      });

    await trx.commit();

    logger({ success: true }, 'Request reopened successfully', { temuan_id: decryptedTemuanId, reopened_by: empid });

    res.status(200).json({
      message: 'Request reopened successfully',
      temuan_id: decryptedTemuanId
    });
  } catch (error) {
    await trx.rollback();
    logger(error, 'POST /reopenRequest', req.params);
    return res.status(406).json(getErrorResponse(error));
  }
};

/**
 * Get feedback data for a specific list detail item
 */
export const getFeedbackData = async (req, res) => {
  try {
    const { listdet_id } = req.params;

    // Decrypt listdet_id
    const decryptedListdetId = decrypt(listdet_id);

    // Get detail item info
    const detailInfo = await dbDMS.raw(`
      SELECT 
        tld.*,
        tl.list_judul,
        t.temuan_id,
        t.temuan_judul,
        t.temuan_bu,
        t.temuan_div,
        t.temuan_status
      FROM list_det tld
      INNER JOIN list_hdr tl ON tld.listdet_listid = tl.list_id
      INNER JOIN temuan t ON tl.list_temuanid = t.temuan_id
      WHERE tld.listdet_id = ?
    `, [decryptedListdetId]);

    const detail = extractObjectFromRaw(detailInfo);

    if (!detail) {
      return res.status(404).json({ message: 'Detail item not found' });
    }

    // Get feedback history
    const feedbackHistory = await dbDMS.raw(`
      SELECT 
        f.*,
        emp.employee_name,
        emp.employee_photo,
        emp.map_bu_id
      FROM feedback f
      LEFT JOIN v_mstr_employee emp ON f.feedback_createdby = emp.employee_id COLLATE SQL_Latin1_General_CP1_CI_AS
      WHERE f.feedback_listdetid = ?
      ORDER BY f.feedback_date DESC
    `, [decryptedListdetId]);

    const history = extractArrayFromRaw(feedbackHistory);

    res.status(200).json({
      detail_info: detail,
      feedback_history: history
    });
  } catch (error) {
    logger(error, 'GET /getFeedbackData', req.params);
    return res.status(406).json(getErrorResponse(error));
  }
};

/**
 * Get all feedback for a request (for printing)
 */
export const getAllFeedbackByRequest = async (req, res) => {
  try {
    const { temuan_id } = req.params;

    // Decrypt temuan_id
    const decryptedTemuanId = decrypt(temuan_id);

    // Get all feedback for this request
    const feedbackData = await dbDMS.raw(`
      SELECT 
        f.*,
        emp.employee_name,
        emp.employee_photo,
        emp.map_bu_id
      FROM feedback f
      LEFT JOIN v_mstr_employee emp ON f.feedback_createdby = emp.employee_id COLLATE SQL_Latin1_General_CP1_CI_AS
      INNER JOIN list_det ld ON f.feedback_listdetid = ld.listdet_id
      INNER JOIN list_hdr lh ON ld.listdet_listid = lh.list_id
      WHERE lh.list_temuanid = ?
      ORDER BY f.feedback_date ASC
    `, [decryptedTemuanId]);

    const feedback = extractArrayFromRaw(feedbackData);

    // Get division head name for signature
    const temuanData = await dbDMS('temuan')
      .select('temuan_div')
      .where('temuan_id', decryptedTemuanId)
      .first();

    let divisionHeadName = 'LIE POH AN'; // Default
    
    if (temuanData && temuanData.temuan_div) {
      const divHeadData = await dbHris('mapping_div_chief')
        .select('divhead_name')
        .where('struc_pk', temuanData.temuan_div)
        .first();
      
      if (divHeadData && divHeadData.divhead_name) {
        divisionHeadName = divHeadData.divhead_name;
      }
    }

    res.status(200).json({
      feedback: feedback,
      division_head_name: divisionHeadName
    });
  } catch (error) {
    logger(error, 'GET /getAllFeedbackByRequest', req.params);
    return res.status(406).json(getErrorResponse(error));
  }
};

export const submitFeedback = async (req, res) => {
  const trx = await dbDMS.transaction();

  try {
    const { listdet_id, message, progress, temuan_id, bu_id, div_id, user } = req.body;
    const files = req.files || [];

    // Get empid from body (sent as 'user') or from req.user (auth middleware)
    const encryptedEmpid = user || req.user?.empid;
    const empid = decrypt(encryptedEmpid);

    if (!empid) {
      return res.status(400).json({ message: 'Employee ID is required' });
    }

    // Upload files to FTP if any
    let attachmentFiles = [];
    if (files.length > 0) {
      for (const file of files) {
        try {
          const filename = await uploadFileToFTP(file);
          attachmentFiles.push(filename);
        } catch (error) {
          logger(error, 'File upload error', { filename: file.originalname });
        }
      }
    }

    const attachmentString = attachmentFiles.length > 0 ? attachmentFiles.join(',') : null;

    let list_det = await trx('list_det')
      .where('listdet_id', listdet_id)
      .first();

    // Insert feedback
    await trx('feedback').insert({
      feedback_temuanid: list_det.listdet_listid.replace(/-[^-]*$/, ""),
      feedback_listid: list_det.listdet_listid,
      feedback_listdetid: listdet_id,
      feedback_isi: message,
      feedback_attach: attachmentString,
      feedback_createdby: empid,
      feedback_date: dbDMS.fn.now()
    });

    // Update progress
    await trx('list_det')
      .where('listdet_id', listdet_id)
      .update({
        listdet_progress: progress || 0
      });

    await trx.commit();

    // Send email notification
    try {
      await sendFeedbackNotification({
        listdet_id,
        message,
        attachments: attachmentFiles,
        progress,
        temuan_id,
        bu_id,
        div_id,
        created_by: empid
      });
    } catch (emailError) {
      logger(emailError, 'Email notification error', { listdet_id });
      // Don't fail the request if email fails
    }

    logger({ success: true }, 'Feedback submitted successfully', { listdet_id, created_by: empid });

    res.status(200).json({
      message: 'Feedback submitted successfully',
      listdet_id
    });
  } catch (error) {
    await trx.rollback();
    logger(error, 'POST /submitFeedback', req.body);
    return res.status(406).json(getErrorResponse(error));
  }
};

/**
 * Confirm closing an individual list detail item
 */
export const confirmClosingItem = async (req, res) => {
  const trx = await dbDMS.transaction();

  try {
    const { listdet_id, message, temuan_id, bu_id, div_id, user } = req.body;
    const files = req.files || [];

    // Get empid from body (sent as 'user') or from req.user (auth middleware)
    const encryptedEmpid = user || req.user?.empid;
    const empid = decrypt(encryptedEmpid);

    if (!empid) {
      return res.status(400).json({ message: 'Employee ID is required' });
    }

    // Check if item exists and is open
    const item = await trx('list_det')
      .select('*')
      .where('listdet_id', listdet_id)
      .first();

    if (!item) {
      await trx.rollback();
      return res.status(404).json({ message: 'Item not found' });
    }

    if (item.listdet_status === '1') {
      await trx.rollback();
      return res.status(400).json({ message: 'Item already closed' });
    }

    // Upload files to FTP if any
    let attachmentFiles = [];
    if (files.length > 0) {
      for (const file of files) {
        try {
          const filename = await uploadFileToFTP(file);
          attachmentFiles.push(filename);
        } catch (error) {
          logger(error, 'File upload error', { filename: file.originalname });
        }
      }
    }

    const attachmentString = attachmentFiles.length > 0 ? attachmentFiles.join(',') : null;

    // Insert feedback
    await trx('feedback').insert({
      feedback_temuanid: item.listdet_listid.replace(/-[^-]*$/, ""),
      feedback_listid: item.listdet_listid,
      feedback_listdetid: listdet_id,
      feedback_isi: message,
      feedback_attach: attachmentString,
      feedback_createdby: empid,
      feedback_date: dbDMS.fn.now()
    });

    // Update item status to closed (status = '1', progress = 100)
    await trx('list_det')
      .where('listdet_id', listdet_id)
      .update({
        listdet_status: '1',
        listdet_progress: 100,
        listdet_closedate: dbDMS.fn.now()
      });

    const result = await trx('list_det')
      .count('* as total')
      .where('listdet_id', 'like', `${listdet_id.replace(/-[^-]*$/, "")}%`)
      .where('listdet_progress', '0')
      .first();

    if (result.total === 0) {
      await trx('temuan')
        .where('temuan_id', listdet_id.replace(/-[^-]*$/, ""))
        .update({
          temuan_status: '1'
        });
    }

    await trx.commit();

    // Send email notification
    try {
      await sendClosingNotification({
        listdet_id,
        message,
        attachments: attachmentFiles,
        temuan_id,
        bu_id,
        div_id,
        closed_by: empid
      });
    } catch (emailError) {
      logger(emailError, 'Email notification error', { listdet_id });
      // Don't fail the request if email fails
    }

    logger({ success: true }, 'Item closed successfully', { listdet_id, closed_by: empid });

    res.status(200).json({
      message: 'Item closed successfully',
      listdet_id
    });
  } catch (error) {
    await trx.rollback();
    logger(error, 'POST /confirmClosingItem', req.body);
    return res.status(406).json(getErrorResponse(error));
  }
};
