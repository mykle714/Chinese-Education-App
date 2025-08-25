import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { CustomError } from './types/index.js';

// JWT secret key - should be in environment variables in production
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

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
  // Get the token from the Authorization header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN format
  
  if (!token) {
    const error: CustomError = new Error('Authentication token is required');
    error.code = 'ERR_MISSING_TOKEN';
    error.statusCode = 401;
    return res.status(401).json({ 
      error: error.message,
      code: error.code
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Error verifying token:', error);
    const customError: CustomError = new Error('Invalid or expired token');
    customError.code = 'ERR_INVALID_TOKEN';
    customError.statusCode = 401;
    return res.status(401).json({ 
      error: customError.message,
      code: customError.code
    });
  }
}
