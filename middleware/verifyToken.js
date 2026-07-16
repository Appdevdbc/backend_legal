import dotenv from "dotenv";  
dotenv.config();  
import jwt from "jsonwebtoken";  
import { dbDMS, dbHris } from "../config/db.js";  

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  { method: 'POST', path: '/login' },
  { method: 'POST', path: '/wjs/auth/login' },
  { method: 'POST', path: '/login_portal' },
  { method: 'POST', path: '/refresh_token' },
  { method: 'GET', path: '/api/v1/roles' },
  { method: 'POST', path: '/api/v1/sync-users' }
];

/**
 * Check if the current request is a public route
 */
const isPublicRoute = (method, path) => {
  return PUBLIC_ROUTES.some(
    route => route.method === method && route.path === path
  );
};

  
export const cekToken = async (req, res, next) => {  
  try {  
    // Check if this is a public route (no token required)
    if (isPublicRoute(req.method, req.path)) {  
      return next();  
    }
    
    // Protected route - verify token
    let token;  

    if (req.headers['accept'] === 'text/event-stream') {   
      token = req.query.token;
    } else {  
      token = req.headers.authorization?.split(' ')[1];  
    }  

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
 
