import dotenv from "dotenv";  
dotenv.config();  
import jwt from "jsonwebtoken";  
import { dbDMS, dbHris } from "../config/db.js";  

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  { method: 'POST', path: '/login' },
  { method: 'POST', path: '/wjs/auth/login' },
  { method: 'POST', path: '/login_portal' },
  { method: 'POST', path: '/refresh_token' }
];

/**
 * Check if the current request is a public route
 */
const isPublicRoute = (method, path) => {
  return PUBLIC_ROUTES.some(
    route => route.method === method && route.path === path
  );
};

/**
 * Pure function to resolve the auth token from a request's parts.
 * Priority:
 *   1. httpOnly cookie (COOKIE_NAME)          -> utama
 *   2. query.token when SSE (text/event-stream)
 *   3. Authorization: Bearer <token>          -> backward compatible
 *
 * @param {Object} parts
 * @param {Object} [parts.cookies]        req.cookies
 * @param {string} [parts.accept]         req.headers['accept']
 * @param {string} [parts.authorization]  req.headers.authorization
 * @param {Object} [parts.query]          req.query
 * @returns {string|null} the token, or null if none present
 */
export const resolveToken = ({ cookies, accept, authorization, query } = {}) => {
  const cookieName = process.env.COOKIE_NAME || 'token';

  // 1. httpOnly cookie (utama)
  const cookieToken = cookies?.[cookieName];
  if (cookieToken) return cookieToken;

  // 2. SSE: token dari query
  if (accept === 'text/event-stream' && query?.token) {
    return query.token;
  }

  // 3. Authorization header: Bearer <token> (backward compatible)
  if (authorization) {
    const parts = authorization.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0]) && parts[1]) {
      return parts[1];
    }
  }

  return null;
};

  
export const cekToken = async (req, res, next) => {  
  try {  
    // Check if this is a public route (no token required)
    if (isPublicRoute(req.method, req.path)) {  
      return next();  
    }
    
    // Protected route - resolve token (cookie > SSE query > Bearer)
    const token = resolveToken({
      cookies: req.cookies,
      accept: req.headers['accept'],
      authorization: req.headers.authorization,
      query: req.query,
    });

    if (!token) return res.status(401).json({ message: "Invalid Token" });

    const decoded = jwt.verify(token, process.env.TOKEN);  
    const response = await dbHris("ptl_hris")  
      .where("Emp_Id", decoded.user)  
      .where("user_active", "Active")  
      .first();
  
    if (response) {  
      return next();  
    } else {  
      return res.status(401).json({ message: "Token sudah tidak sesuai atau expired", decoded });  
    }  
  } catch (error) {  
    console.error("cekToken error:", error.message);  
    return res.status(402).json({ message: "Token sudah tidak sesuai atau expired" });  
  }  
};  
 
