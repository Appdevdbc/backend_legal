import nodemailer from 'nodemailer';
import { dbDMS, dbHris } from '../config/db.js';
import { getFileDownloadURL } from './ftpUpload.js';
import { logger } from './logger.js';
import dayjs from 'dayjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Send temuan notification email
 */
export const sendTemuanMail = async (data) => {
  try {
    const {
      temuan_id,
      judul,
      periode_awal,
      periode_akhir,
      bu_id,
      div_id,
      requestee_ids,
      requestee_emails,
      points,
      approval_chain
    } = data;
    
    // Get BU and Division names
    const bu = await dbHris('master_bu_new')
      .select('bu_name')
      .where('bu_id', bu_id)
      .first();
    
    // Handle multiple division IDs (comma-separated)
    let divNames = [];
    if (div_id) {
      const divIds = div_id.toString().split(',').map(id => id.trim()).filter(id => id);
      
      if (divIds.length > 0) {
        const divisions = await dbHris('master_div_new')
          .select('nama_div')
          .whereIn('id_div', divIds);
        
        divNames = divisions.map(d => d.nama_div);
      }
    }
    const div_name = divNames.length > 0 ? divNames.join(', ') : '';
    
    // Get requestee names
    const requesteeNames = [];
    for (const emp_id of requestee_ids) {
      const emp = await dbHris('ptl_hris')
        .select('user_name')
        .where('Emp_Id', emp_id)
        .first();
      if (emp) {
        requesteeNames.push(emp.user_name);
      }
    }
    
    // Generate email HTML
    const emailHtml = generateEmailTemplate({
      requesteeNames: requesteeNames.join(', '),
      bu_name: bu ? bu.bu_name : '',
      div_name: div_name,
      judul,
      periode_awal: dayjs(periode_awal).format('DD MMM YYYY'),
      periode_akhir: dayjs(periode_akhir).format('DD MMM YYYY'),
      points
    });
    
    // Setup email transporter
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT),
      secure: false, // Use false for port 587 (STARTTLS)
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD
      },
      tls: {
        // Do not fail on invalid certs
        rejectUnauthorized: false
      }
    });

    // Prepare TO recipients
    let toEmails = requestee_emails.split(',').map(email => ({
      address: email.trim()
    }));
    
    // Prepare CC recipients
    let ccEmails = [];
    
    // Add approval chain to CC
    if (approval_chain.divhead_email && approval_chain.divhead_email !== 'null') {
      ccEmails.push({ address: approval_chain.divhead_email });
    }
    
    if (approval_chain.chief_email && 
        approval_chain.chief_email !== 'null' && 
        approval_chain.chief_email !== approval_chain.divhead_email) {
      ccEmails.push({ address: approval_chain.chief_email });
    }
    
    // Get auditor team emails
    const auditorTeam = await dbDMS('master_user')
      .select('emp_id')
      .whereIn('account_type', [8]); // Auditor types
    
    for (const auditor of auditorTeam) {
      const auditorEmail = await dbHris('ptl_hris')
        .select('user_email')
        .where('Emp_Id', auditor.emp_id)
        .where('user_active', 'Active')
        .first();
      
      if (auditorEmail && auditorEmail.user_email) {
        ccEmails.push({ address: auditorEmail.user_email });
      }
    }
    
    // BCC
    let bccEmails = [];

    // Override emails for non-production environments
    if (process.env.ENVIRONMENT !== 'PRODUCTION') {
      toEmails = [
        { address: process.env.EMAILDUMMY }
      ];
      ccEmails = [];
    } else {
      bccEmails.push({ address: process.env.EMAILDUMMY });
    }
    
    // Read logo image
    const logoPath = path.join(__dirname, '../assets/images/dbc_logo.png');
    
    // Send email
    const mailOptions = {
      from: {
        name: 'LEGAL MONITORING SYSTEM',
        address: process.env.MAIL_FROM || 'legal@dbc.co.id'
      },
      to: toEmails,
      cc: ccEmails,
      bcc: bccEmails,
      subject: 'SUMMARY HASIL REQUEST',
      html: emailHtml,
      attachments: [
        {
          filename: 'dbc_logo.png',
          path: logoPath,
          cid: 'dbc' // Same as in HTML <img src="cid:dbc">
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    
    logger({ success: true, messageId: info.messageId }, 'Email sent successfully', { temuan_id });
    
    return true;
    
  } catch (error) {
    logger(error, 'Send Temuan Mail Error', data);
    throw error;
  }
};

/**
 * Generate email HTML template
 */
const generateEmailTemplate = (data) => {
  const { requesteeNames, bu_name, div_name, judul, periode_awal, periode_akhir, points } = data;
  
  // Generate table rows for points and lines
  let tableRows = '';
  let no = 1;
  
  for (const point of points) {
    // Point row with special styling
    tableRows += `
      <tr class="point-row">
        <td style="padding:12px 10px;">${no}</td>
        <td colspan="4" style="padding:12px 10px;"><strong>${point.judul}</strong></td>
      </tr>
    `;
    
    // Line rows for this point
    let subno = 1;
    for (const line of point.lines) {
      const emailNotifHtml = line.email_notif ? 
        line.email_notif.split(',').join('<br>') : '-';
      
      const attachmentHtml = line.files && line.files.length > 0 ?
        line.files.map(f => `<a href="${getFileDownloadURL(f)}" target="_blank">${f}</a>`).join('<br>') : '-';
      
      tableRows += `
        <tr>
          <td style="padding:12px 10px;">${no}.${subno}</td>
          <td style="padding:12px 10px;">${line.deskripsi}</td>
          <td style="padding:12px 10px;">${emailNotifHtml}</td>
          <td style="padding:12px 10px;">${dayjs(line.due_date).format('DD MMM YYYY')}</td>
        </tr>
      `;
      subno++;
    }
    
    no++;
  }
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { 
          font-family: Arial, sans-serif; 
          margin: 0;
          padding: 0;
          background-color: #f5f5f5;
        }
        .email-wrapper {
          max-width: 700px;
          margin: 20px auto;
          background-color: #ffffff;
        }
        .header { 
          background: linear-gradient(135deg, #2e5cb8 0%, #4a7dc9 100%);
          padding: 40px 20px;
          text-align: center;
          color: white;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 600;
          letter-spacing: 1px;
        }
        .header p {
          margin: 10px 0 0 0;
          font-size: 14px;
          opacity: 0.95;
        }
        .content {
          padding: 40px 30px;
          background-color: #ffffff;
        }
        .greeting {
          font-size: 15px;
          color: #333;
          line-height: 1.6;
          margin-bottom: 20px;
        }
        .greeting strong {
          color: #2e5cb8;
        }
        .info-message {
          font-size: 14px;
          color: #666;
          line-height: 1.8;
          margin-bottom: 30px;
        }
        .info-box {
          background-color: #f8f9fa;
          border-left: 4px solid #2e5cb8;
          padding: 25px;
          margin: 25px 0;
          border-radius: 4px;
        }
        .info-row {
          display: flex;
          padding: 8px 0;
          border-bottom: 1px solid #e9ecef;
        }
        .info-row:last-child {
          border-bottom: none;
        }
        .info-label {
          flex: 0 0 180px;
          font-weight: 600;
          color: #555;
          font-size: 14px;
        }
        .info-separator {
          flex: 0 0 20px;
          color: #999;
        }
        .info-value {
          flex: 1;
          color: #333;
          font-size: 14px;
        }
        .section-title {
          font-size: 18px;
          font-weight: 600;
          color: #2e5cb8;
          margin: 30px 0 15px 0;
          padding-bottom: 10px;
          border-bottom: 2px solid #e9ecef;
        }
        .details-table { 
          width: 100%; 
          border-collapse: collapse; 
          margin: 20px 0;
          font-size: 13px;
        }
        .details-table th { 
          background-color: #2e5cb8;
          color: white;
          padding: 12px 10px;
          text-align: left;
          font-weight: 600;
        }
        .details-table td { 
          border: 1px solid #dee2e6;
          padding: 12px 10px;
          vertical-align: top;
        }
        .details-table tr:nth-child(even) {
          background-color: #f8f9fa;
        }
        .details-table a {
          color: #2e5cb8;
          text-decoration: none;
        }
        .details-table a:hover {
          text-decoration: underline;
        }
        .point-row {
          background-color: #e7f1ff !important;
          font-weight: 600;
        }
        .button-container {
          text-align: center;
          margin: 35px 0;
        }
        .button {
          display: inline-block;
          background: linear-gradient(135deg, #2e5cb8 0%, #4a7dc9 100%);
          color: white;
          padding: 15px 40px;
          text-decoration: none;
          border-radius: 30px;
          font-weight: 600;
          font-size: 15px;
          box-shadow: 0 4px 15px rgba(46, 92, 184, 0.3);
        }
        .closing-text {
          font-size: 14px;
          color: #666;
          line-height: 1.6;
          margin-top: 30px;
        }
        .footer {
          background-color: #2c3e50;
          color: #ffffff;
          padding: 25px 30px;
          text-align: center;
        }
        .footer p {
          margin: 5px 0;
          font-size: 13px;
          opacity: 0.9;
        }
        .footer-title {
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 10px;
        }
      </style>
    </head>
    <body>
      <div class="email-wrapper">
        <!-- Header -->
        <div class="header">
          <h1>LEGAL MONITORING SYSTEM</h1>
          <p>Permintaan Request Summary</p>
        </div>
        
        <!-- Content -->
        <div class="content">
          <!-- Greeting -->
          <div class="greeting">
            Kepada Yth. <strong>${requesteeNames}</strong>,
          </div>
          
          <!-- Info Message -->
          <div class="info-message">
            Email ini sebagai pemberitahuan pengajuan request summary oleh <strong>Auditor Team</strong>, 
            ${div_name}, ${bu_name}.
          </div>
          
          <!-- Info Box -->
          <div class="info-box">
            <div class="info-row">
              <div class="info-label">Judul Request</div>
              <div class="info-separator">:</div>
              <div class="info-value"><strong>${judul}</strong></div>
            </div>
            <div class="info-row">
              <div class="info-label">Periode</div>
              <div class="info-separator">:</div>
              <div class="info-value">${periode_awal} s/d ${periode_akhir}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Divisi</div>
              <div class="info-separator">:</div>
              <div class="info-value">${div_name}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Business Unit</div>
              <div class="info-separator">:</div>
              <div class="info-value">${bu_name}</div>
            </div>
          </div>
          
          <!-- Section Title -->
          <div class="section-title">Detail Request</div>
          
          <!-- Details Table -->
          <table class="details-table">
            <thead>
              <tr>
                <th width="5%">No</th>
                <th width="40%">Request</th>
                <th width="20%">Notifikasi Email</th>
                <th width="15%">Due Date</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
          
          <!-- Instruction Message -->
          <div class="info-message">
            Setelah melakukan review atas request summary, silahkan dilanjutkan untuk 
            memberikan penolakan atau revisi atau persetujuan di Legal Monitoring System.
          </div>
          
          <!-- Closing -->
          <div class="closing-text">
            Kami mengucapkan terima kasih atas perhatian dan kerjasama dari Bapak/Ibu dan Tim.
          </div>
        </div>
        
        <!-- Footer -->
        <div class="footer">
          <p class="footer-title">Legal Monitoring System - Document Management System</p>
          <p>Email ini dikirim secara otomatis oleh sistem.</p>
          <p>Mohon tidak membalas email ini.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Send feedback notification email
 */
export const sendFeedbackNotification = async (data) => {
  try {
    const {
      listdet_id,
      message,
      attachments,
      progress,
      temuan_id,
      bu_id,
      div_id,
      created_by
    } = data;
    
    // Get detail info
    const detailInfo = await dbDMS.raw(`
      SELECT 
        tld.*,
        tl.list_judul,
        t.temuan_id,
        t.temuan_judul,
        t.temuan_auditee,
        t.temuan_emailauditee
      FROM list_det tld
      INNER JOIN list_hdr tl ON tld.listdet_listid = tl.list_id
      INNER JOIN temuan t ON tl.list_temuanid = t.temuan_id
      WHERE tld.listdet_id = ?
    `, [listdet_id]);
    
    const detail = detailInfo[0] || detailInfo[0][0];
    
    if (!detail) {
      logger({ error: 'Detail not found' }, 'Send feedback notification error', { listdet_id });
      return false;
    }
    
    // Get creator info
    const creator = await dbHris('ptl_hris')
      .select('user_name', 'user_email')
      .where('Emp_Id', created_by)
      .first();
    
    // Get BU and Division names
    const bu = await dbHris('master_bu_new')
      .select('bu_name')
      .where('bu_id', bu_id)
      .first();
    
    // Handle multiple division IDs (comma-separated)
    let divNames = [];
    if (div_id) {
      const divIds = div_id.toString().split(',').map(id => id.trim()).filter(id => id);
      
      if (divIds.length > 0) {
        const divisions = await dbHris('master_div_new')
          .select('nama_div')
          .whereIn('id_div', divIds);
        
        divNames = divisions.map(d => d.nama_div);
      }
    }
    const div_name = divNames.length > 0 ? divNames.join(', ') : '';
    
    // Generate email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
          .email-wrapper { max-width: 700px; margin: 20px auto; background-color: #ffffff; }
          .header { background: linear-gradient(135deg, #2e5cb8 0%, #4a7dc9 100%); padding: 30px 20px; text-align: center; color: white; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px; }
          .info-box { background-color: #f8f9fa; border-left: 4px solid #2e5cb8; padding: 20px; margin: 20px 0; }
          .info-row { display: flex; padding: 8px 0; }
          .info-label { flex: 0 0 150px; font-weight: 600; color: #555; }
          .info-value { flex: 1; color: #333; }
          .feedback-box { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0; }
          .progress-bar { background-color: #e9ecef; border-radius: 10px; height: 30px; margin: 15px 0; }
          .progress-fill { background: linear-gradient(90deg, #28a745 0%, #20c997 100%); height: 100%; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; }
          .footer { background-color: #2c3e50; color: #ffffff; padding: 20px; text-align: center; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="email-wrapper">
          <div class="header">
            <h1>📝 FEEDBACK UPDATE</h1>
            <p>Legal Monitoring System</p>
          </div>
          
          <div class="content">
            <p>Terdapat feedback baru untuk request item:</p>
            
            <div class="info-box">
              <div class="info-row">
                <div class="info-label">Request ID:</div>
                <div class="info-value"><strong>${detail.temuan_id}</strong></div>
              </div>
              <div class="info-row">
                <div class="info-label">Judul:</div>
                <div class="info-value">${detail.temuan_judul}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Perihal:</div>
                <div class="info-value">${detail.list_judul}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Deskripsi:</div>
                <div class="info-value">${detail.listdet_isi}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Due Date:</div>
                <div class="info-value">${dayjs(detail.listdet_duedate).format('DD MMM YYYY')}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Divisi:</div>
                <div class="info-value">${div_name || ''}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Business Unit:</div>
                <div class="info-value">${bu ? bu.bu_name : ''}</div>
              </div>
            </div>
            
            <div class="feedback-box">
              <h3 style="margin-top:0; color:#856404;">💬 Feedback dari ${creator ? creator.user_name : 'User'}:</h3>
              <p style="color:#333; line-height:1.6;">${message}</p>
              ${attachments && attachments.length > 0 ? `
                <p style="margin-top:15px;"><strong>Attachment:</strong></p>
                <ul style="color:#333;">
                  ${attachments.map(f => `<li><a href="${getFileDownloadURL(f)}" target="_blank">${f}</a></li>`).join('')}
                </ul>
              ` : ''}
            </div>
            
            <div style="margin:20px 0;">
              <strong>Progress Update:</strong>
              <div class="progress-bar">
                <div class="progress-fill" style="width:${progress || 0}%;">${progress || 0}%</div>
              </div>
            </div>
            
            <p style="color:#666; margin-top:30px;">
              Silakan login ke sistem untuk melihat detail dan memberikan respons.
            </p>
          </div>
          
          <div class="footer">
            <p><strong>Legal Monitoring System</strong></p>
            <p>Email otomatis - mohon tidak membalas</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    // Setup email transporter
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT),
      secure: false,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    // Prepare recipients
    let toEmails = detail.temuan_emailauditee ? 
      detail.temuan_emailauditee.split(',').map(email => ({ address: email.trim() })) : [];
    
    // Override for non-production
    if (process.env.ENVIRONMENT !== 'PRODUCTION') {
      toEmails = [{ address: process.env.EMAILDUMMY }];
    }
    
    // Send email
    const mailOptions = {
      from: {
        name: 'LEGAL MONITORING SYSTEM',
        address: process.env.MAIL_FROM || 'legal@dbc.co.id'
      },
      to: toEmails,
      subject: `Feedback Update - ${detail.temuan_judul}`,
      html: emailHtml
    };
    
    await transporter.sendMail(mailOptions);
    
    logger({ success: true }, 'Feedback notification email sent', { listdet_id });
    
    return true;
    
  } catch (error) {
    logger(error, 'Send feedback notification error', data);
    // Don't throw, just log
    return false;
  }
};

/**
 * Send closing notification email
 */
export const sendClosingNotification = async (data) => {
  try {
    const {
      listdet_id,
      message,
      attachments,
      temuan_id,
      bu_id,
      div_id,
      closed_by
    } = data;
    
    // Get detail info
    const detailInfo = await dbDMS.raw(`
      SELECT 
        tld.*,
        tl.list_judul,
        t.temuan_id,
        t.temuan_judul,
        t.temuan_auditee,
        t.temuan_emailauditee
      FROM list_det tld
      INNER JOIN list_hdr tl ON tld.listdet_listid = tl.list_id
      INNER JOIN temuan t ON tl.list_temuanid = t.temuan_id
      WHERE tld.listdet_id = ?
    `, [listdet_id]);
    
    const detail = detailInfo[0] || detailInfo[0][0];
    
    if (!detail) {
      logger({ error: 'Detail not found' }, 'Send closing notification error', { listdet_id });
      return false;
    }
    
    // Get closer info
    const closer = await dbHris('ptl_hris')
      .select('user_name', 'user_email')
      .where('Emp_Id', closed_by)
      .first();
    
    // Get BU and Division names
    const bu = await dbHris('master_bu_new')
      .select('bu_name')
      .where('bu_id', bu_id)
      .first();
    
    // Handle multiple division IDs (comma-separated)
    let divNames = [];
    if (div_id) {
      const divIds = div_id.toString().split(',').map(id => id.trim()).filter(id => id);
      
      if (divIds.length > 0) {
        const divisions = await dbHris('master_div_new')
          .select('nama_div')
          .whereIn('id_div', divIds);
        
        divNames = divisions.map(d => d.nama_div);
      }
    }
    const div_name = divNames.length > 0 ? divNames.join(', ') : '';
    
    // Generate email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
          .email-wrapper { max-width: 700px; margin: 20px auto; background-color: #ffffff; }
          .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 30px 20px; text-align: center; color: white; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px; }
          .success-badge { background-color: #d4edda; border: 2px solid #28a745; color: #155724; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0; font-weight: 600; font-size: 16px; }
          .info-box { background-color: #f8f9fa; border-left: 4px solid #28a745; padding: 20px; margin: 20px 0; }
          .info-row { display: flex; padding: 8px 0; }
          .info-label { flex: 0 0 150px; font-weight: 600; color: #555; }
          .info-value { flex: 1; color: #333; }
          .feedback-box { background-color: #e7f3ff; border-left: 4px solid #2e5cb8; padding: 20px; margin: 20px 0; }
          .footer { background-color: #2c3e50; color: #ffffff; padding: 20px; text-align: center; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="email-wrapper">
          <div class="header">
            <h1>✅ ITEM CLOSED</h1>
            <p>Legal Monitoring System</p>
          </div>
          
          <div class="content">
            <div class="success-badge">
              ✓ Item request telah diselesaikan (Closed)
            </div>
            
            <div class="info-box">
              <div class="info-row">
                <div class="info-label">Request ID:</div>
                <div class="info-value"><strong>${detail.temuan_id}</strong></div>
              </div>
              <div class="info-row">
                <div class="info-label">Judul:</div>
                <div class="info-value">${detail.temuan_judul}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Perihal:</div>
                <div class="info-value">${detail.list_judul}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Deskripsi:</div>
                <div class="info-value">${detail.listdet_isi}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Due Date:</div>
                <div class="info-value">${dayjs(detail.listdet_duedate).format('DD MMM YYYY')}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Ditutup oleh:</div>
                <div class="info-value">${closer ? closer.user_name : 'User'}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Divisi:</div>
                <div class="info-value">${div_name || ''}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Business Unit:</div>
                <div class="info-value">${bu ? bu.bu_name : ''}</div>
              </div>
            </div>
            
            ${message ? `
              <div class="feedback-box">
                <h3 style="margin-top:0; color:#004085;">💬 Catatan Penutupan:</h3>
                <p style="color:#333; line-height:1.6;">${message}</p>
                ${attachments && attachments.length > 0 ? `
                  <p style="margin-top:15px;"><strong>Attachment:</strong></p>
                  <ul style="color:#333;">
                    ${attachments.map(f => `<li><a href="${getFileDownloadURL(f)}" target="_blank">${f}</a></li>`).join('')}
                  </ul>
                ` : ''}
              </div>
            ` : ''}
            
            <p style="color:#666; margin-top:30px;">
              Item ini telah diselesaikan dengan progress 100%. Terima kasih atas kerjasamanya.
            </p>
          </div>
          
          <div class="footer">
            <p><strong>Legal Monitoring System</strong></p>
            <p>Email otomatis - mohon tidak membalas</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    // Setup email transporter
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT),
      secure: false,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    // Prepare recipients
    let toEmails = detail.temuan_emailauditee ? 
      detail.temuan_emailauditee.split(',').map(email => ({ address: email.trim() })) : [];
    
    // Override for non-production
    if (process.env.ENVIRONMENT !== 'PRODUCTION') {
      toEmails = [{ address: process.env.EMAILDUMMY }];
    }
    
    // Send email
    const mailOptions = {
      from: {
        name: 'LEGAL MONITORING SYSTEM',
        address: process.env.MAIL_FROM || 'legal@dbc.co.id'
      },
      to: toEmails,
      subject: `Item Closed - ${detail.temuan_judul}`,
      html: emailHtml
    };
    
    await transporter.sendMail(mailOptions);
    
    logger({ success: true }, 'Closing notification email sent', { listdet_id });
    
    return true;
    
  } catch (error) {
    logger(error, 'Send closing notification error', data);
    // Don't throw, just log
    return false;
  }
};
