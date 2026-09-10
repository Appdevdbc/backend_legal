import { dbHris, dbWJS } from '../../config/db.js';
import { getErrorResponse, mySimpleCrypt } from '../../helpers/utils.js';
import { logger } from '../../helpers/logger.js';
import { resolveToken } from '../../middleware/verifyToken.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const COOKIE_NAME = process.env.COOKIE_NAME || 'token';

/**
 * Bangun opsi cookie auth httpOnly.
 * @param {number} [maxAge] - umur cookie (ms). Dihilangkan untuk clearCookie.
 */
const buildCookieOptions = (maxAge) => {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.ENVIRONMENT === 'PRODUCTION',
    path: '/',
  };
  if (maxAge != null) options.maxAge = maxAge;
  return options;
};

/** Ambil token dari request (cookie > SSE query > Bearer). */
const getRequestToken = (req) => resolveToken({
  cookies: req.cookies,
  accept: req.headers['accept'],
  authorization: req.headers.authorization,
  query: req.query,
});

/**
 * Login - Authenticate user with NIK and password
 * 
 * New table structure (master_user):
 * - account_nik: stores NIK (used for lookup)
 * - account_username: stores NIK (duplicate)
 * - account_password: NOT USED (password validated from portal)
 * - account_type: NOT USED for validation (only for menu settings)
 * - account_bu: stores BU ID
 * - emp_id: stores Emp_Id from portal (may be NULL)
 */
export const login = async (req, res) => {
  try {
    const { nik, password } = req.body;

    // Get user from master_user table by NIK
    const user = await dbWJS('master_user')
      .select('account_nik', 'account_username', 'emp_id', 'account_bu')
      .where('account_nik', nik)
      .first();

    if (!user) {
      return res.status(406).json({
        success: false,
        type: 'error',
        message: `User ${nik} belum terdaftar pada aplikasi ini`
      });
    }

    // Lookup in portal using emp_id if exists, otherwise use NIK
    const lookupValue = user.emp_id || user.account_nik;
    
    const portalUser = await dbHris('ptl_hris as a')
      .select(
        'a.Emp_Id',
        'a.user_pass',
        'a.user_newid',
        'a.user_name',
        'a.grade',
        'a.jabatan',
        'a.employee_mgr_pk',
        'a.map_dept_pk',
        'a.map_div_pk',
        'a.bu_id',
        'b.nama_div',
        'd.nama_dept',
        'c.map_dir_pk'
      )
      .leftJoin('master_div as b', 'b.id_div', 'a.map_div_pk')
      .leftJoin('mapping_dir_div_dept as c', function() {
        this.on('c.map_dept_pk', '=', 'a.map_dept_pk')
          .orOn('c.map_div_pk', '=', 'a.map_div_pk');
      })
      .leftJoin('master_dept as d', 'd.id_dept', 'a.map_dept_pk')
      .where('a.user_active', 'Active')
      .where('a.Emp_Id', lookupValue)
      .first();

    if (!portalUser) {
      return res.status(406).json({
        success: false,
        type: 'error',
        message: `User ${nik} sudah tidak aktif di portal`
      });
    }

    // Validate password (only in production) - using portal password
    if (process.env.ENVIRONMENT === 'PRODUCTION') {
      const hashedPassword = await mySimpleCrypt(password);
      if (portalUser.user_pass !== hashedPassword) {
        return res.status(406).json({
          success: false,
          type: 'error',
          message: 'NIK/Password tidak sesuai'
        });
      }
    }

    // Get direktorat info
    const direktorat = await dbWJS('v_master_dir')
      .where('direktorat_pk', portalUser.map_dir_pk)
      .first();

    // Get idle time from portal policy
    const portalPolicy = await dbWJS('v_ptl_policy').where('id', 0).first();
    const idleTime = process.env.ENVIRONMENT === 'PRODUCTION' 
      ? (portalPolicy?.idle_time || 3600000)
      : 3600000; // 1 hour for dev

    // Generate JWT token
    const token = jwt.sign(
      { user: portalUser.Emp_Id },
      process.env.TOKEN,
      { expiresIn: idleTime }
    );

    // Update emp_id in master_user if it was NULL
    if (!user.emp_id) {
      await dbWJS('master_user')
        .where('account_nik', user.account_nik)
        .update({
          emp_id: portalUser.Emp_Id
        });
    }

    // Log access
    await dbWJS('log_akses').insert({
      empid: portalUser.Emp_Id,
      nik: user.account_nik,
      status: 'login',
      keterangan: 'user',
      nama_url: req.body.url || '/wjs'
    });

    // Set token sebagai httpOnly cookie (TIDAK dikembalikan di body)
    res.cookie(COOKIE_NAME, token, buildCookieOptions(idleTime));

    // Return success response (TANPA token)
    res.status(200).json({
      success: true,
      message: 'Login berhasil',
      data: {
        user: {
          id: portalUser.Emp_Id,
          nik: user.account_nik,
          name: portalUser.user_name, // Name from portal
          email: null, // master_user doesn't have email field
          grade: portalUser.grade,
          jabatan: portalUser.jabatan,
          bu_id: user.account_bu || portalUser.bu_id,
          domain: user.account_bu || portalUser.bu_id,
          dept_id: portalUser.map_dept_pk,
          dept_name: portalUser.nama_dept,
          div_id: portalUser.map_div_pk,
          div_name: portalUser.nama_div,
          dir_id: direktorat?.direktorat_pk,
          dir_name: direktorat?.direktorat_name
        },
        idle: idleTime
      }
    });
  } catch (error) {
    logger(error, 'POST /wjs/auth/login', req.body);
    return res.status(406).json({
      success: false,
      ...getErrorResponse(error)
    });
  }
};

/**
 * Logout - Log user logout activity
 */
export const logout = async (req, res) => {
  try {
    const token = getRequestToken(req);
    // Selalu hapus cookie, walau token tidak ada
    res.clearCookie(COOKIE_NAME, buildCookieOptions());

    if (!token) {
      return res.status(200).json({ success: true, message: 'Logged out' });
    }

    const decoded = jwt.verify(token, process.env.TOKEN);
    const empid = decoded.user;

    // Get user info from master_user
    const user = await dbWJS('master_user')
      .select('account_nik', 'account_username', 'emp_id')
      .where('emp_id', empid)
      .first();

    if (user) {
      // Log logout activity
      await dbWJS('log_akses').insert({
        empid: user.emp_id,
        nik: user.account_nik,
        status: 'logout',
        keterangan: 'user',
        nama_url: req.body.url || '/wjs'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Logout berhasil'
    });
  } catch (error) {
    logger(error, 'POST /wjs/auth/logout', req.body);
    return res.status(200).json({
      success: true,
      message: 'Logged out'
    });
  }
};

/**
 * Verify - Verify token validity
 */
export const verify = async (req, res) => {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token tidak ditemukan'
      });
    }

    const decoded = jwt.verify(token, process.env.TOKEN);
    
    // Check if user is still active in portal
    const portalUser = await dbHris('ptl_hris')
      .where('Emp_Id', decoded.user)
      .where('user_active', 'Active')
      .first();

    if (!portalUser) {
      return res.status(401).json({
        success: false,
        message: 'User tidak aktif'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Token valid'
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token tidak valid atau expired'
    });
  }
};

/**
 * Get Current User - Get authenticated user data
 */
export const getCurrentUser = async (req, res) => {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token tidak ditemukan'
      });
    }

    const decoded = jwt.verify(token, process.env.TOKEN);
    
    // Get user from master_user
    const user = await dbWJS('master_user')
      .select('account_nik', 'account_username', 'emp_id', 'account_bu')
      .where('emp_id', decoded.user)
      .first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    // Get portal user info
    const portalUser = await dbHris('ptl_hris')
      .select('user_newid', 'user_name', 'grade', 'jabatan', 'map_dept_pk', 'map_div_pk')
      .where('Emp_Id', decoded.user)
      .where('user_active', 'Active')
      .first();

    if (!portalUser) {
      return res.status(401).json({
        success: false,
        message: 'User tidak aktif'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: user.emp_id,
        nik: user.account_nik,
        name: portalUser.user_name,
        email: null,
        grade: portalUser.grade,
        jabatan: portalUser.jabatan,
        bu_id: user.account_bu,
        dept_id: portalUser.map_dept_pk,
        div_id: portalUser.map_div_pk
      }
    });
  } catch (error) {
    logger(error, 'GET /wjs/auth/me', {});
    return res.status(401).json({
      success: false,
      message: 'Token tidak valid'
    });
  }
};

/**
 * Refresh Token - Generate new token
 */
export const refreshToken = async (req, res) => {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token tidak ditemukan'
      });
    }

    const decoded = jwt.verify(token, process.env.TOKEN);
    
    // Check if user is still active
    const portalUser = await dbHris('ptl_hris')
      .where('Emp_Id', decoded.user)
      .where('user_active', 'Active')
      .first();

    if (!portalUser) {
      return res.status(401).json({
        success: false,
        message: 'User tidak aktif'
      });
    }

    // Get idle time
    const portalPolicy = await dbWJS('v_ptl_policy').where('id', 0).first();
    const idleTime = process.env.ENVIRONMENT === 'PRODUCTION' 
      ? portalPolicy.idle_time 
      : 3600000;

    // Generate new token
    const newToken = jwt.sign(
      { user: decoded.user },
      process.env.TOKEN,
      { expiresIn: idleTime }
    );

    // Set token baru sebagai httpOnly cookie (TIDAK dikembalikan di body)
    res.cookie(COOKIE_NAME, newToken, buildCookieOptions(idleTime));

    res.status(200).json({
      success: true,
      message: 'Token diperbarui'
    });
  } catch (error) {
    logger(error, 'POST /wjs/auth/refresh', {});
    return res.status(401).json({
      success: false,
      message: 'Token tidak valid'
    });
  }
};
