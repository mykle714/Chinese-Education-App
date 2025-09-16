import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { CustomError } from './types/index.js';
import 'dotenv/config';

// JWT secret key - should be in environment variables in production
const JWT_SECRET = process.env.JWT_SECRET;

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
      };
    }
  }
}

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  // Get the token from either Authorization header or cookies
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN format
  const cookieToken = req.cookies?.token; // Cookie token from new DAL architecture
  
  const token = headerToken || cookieToken;
  
  if (!token || token === 'undefined' || token === 'null' || token === '') {
    const error: CustomError = new Error('Authentication token is required');
    error.code = 'ERR_MISSING_TOKEN';
    error.statusCode = 401;
    return res.status(401).json({ 
      error: error.message,
      code: error.code
    });
  }
  
  // Additional validation for malformed tokens
  if (token === 'undefined' || token === 'null' || token === '') {
    console.error('🚨 Malformed token detected:', { token, type: typeof token });
    const customError: CustomError = new Error('Malformed authentication token');
    customError.code = 'ERR_MALFORMED_TOKEN';
    customError.statusCode = 401;
    return res.status(401).json({ 
      error: customError.message,
      code: customError.code
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Error verifying token:', error);
    console.error('🚨 Token that failed verification:', { 
      token: token.substring(0, 50) + '...', 
      length: token.length,
      type: typeof token 
    });
    const customError: CustomError = new Error('Invalid or expired token');
    customError.code = 'ERR_INVALID_TOKEN';
    customError.statusCode = 401;
    return res.status(401).json({ 
      error: customError.message,
      code: customError.code
    });
  }
}
