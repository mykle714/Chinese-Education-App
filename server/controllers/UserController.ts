import { Request, Response } from 'express';
import { UserService } from '../services/UserService.js';
import { ValidationError, DuplicateError, NotFoundError, DALError } from '../types/dal.js';

/**
 * User Controller - Handles HTTP requests and responses for user operations
 * Delegates business logic to UserService
 */
export class UserController {
  constructor(private userService: UserService) {}

  /**
   * Register a new user
   * POST /api/auth/register
   */
  async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, name, password } = req.body;
      
      const newUser = await this.userService.createUser({
        email,
        name,
        password
      });
      
      res.status(201).json(newUser);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Login user
   * POST /api/auth/login
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      
      const authResult = await this.userService.authenticateUser(email, password);
      
      // Set token in HTTP-only cookie
      res.cookie('token', authResult.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });
      
      res.json(authResult);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Logout user
   * POST /api/auth/logout
   */
  async logout(req: Request, res: Response): Promise<void> {
    try {
      res.clearCookie('token');
      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get current authenticated user
   * GET /api/auth/me
   */
  async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      // Extract user ID from authenticated request
      const userId = (req as any).user?.userId;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      const user = await this.userService.getUserProfile(userId);
      res.json(user);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Change user password
   * POST /api/auth/change-password
   */
  async changePassword(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const { currentPassword, newPassword } = req.body;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      const updatedUser = await this.userService.changePassword(
        userId,
        currentPassword,
        newPassword
      );
      
      res.json({
        user: updatedUser,
        message: 'Password changed successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Update user profile
   * PUT /api/users/profile
   */
  async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const { email, name } = req.body;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      const updatedUser = await this.userService.updateUserProfile(userId, {
        email,
        name
      });
      
      res.json(updatedUser);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get user profile by ID
   * GET /api/users/:id
   */
  async getUserById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      const user = await this.userService.getUserProfile(id);
      res.json(user);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get user statistics
   * GET /api/users/:id/stats
   */
  async getUserStats(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      const stats = await this.userService.getUserStats(id);
      res.json(stats);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get all users (admin function)
   * GET /api/users
   */
  async getAllUsers(req: Request, res: Response): Promise<void> {
    try {
      const users = await this.userService.getAllUsers();
      res.json(users);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get users with vocabulary counts (admin function)
   * GET /api/users/with-vocab-counts
   */
  async getUsersWithVocabCounts(req: Request, res: Response): Promise<void> {
    try {
      const users = await this.userService.getUsersWithVocabCounts();
      res.json(users);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get total work points for a user
   * GET /api/users/:id/total-work-points
   */
  async getTotalWorkPoints(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      const totalWorkPoints = await this.userService.getTotalWorkPoints(id);
      res.json({ totalWorkPoints });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Create new user (admin function)
   * POST /api/users
   */
  async createUser(req: Request, res: Response): Promise<void> {
    try {
      const { email, name, password } = req.body;
      
      const newUser = await this.userService.createUser({
        email,
        name,
        password
      });
      
      res.status(201).json(newUser);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Handle and convert errors to appropriate HTTP responses
   * Uses sanitized error messages to prevent sensitive information exposure
   */
  private handleError(error: any, res: Response): void {
    // Log full error details server-side for debugging
    console.error('UserController error:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
      timestamp: new Date().toISOString()
    });
    
    // Handle DAL errors with sanitization
    if (error instanceof ValidationError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    if (error instanceof DuplicateError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    if (error instanceof NotFoundError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    if (error instanceof DALError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    // Handle legacy custom errors from existing code
    if (error.code && error.statusCode) {
      // For legacy errors, sanitize manually
      let sanitizedMessage = error.message;
      sanitizedMessage = sanitizedMessage.replace(/mykle\.database\.windows\.net/gi, '[server]');
      sanitizedMessage = sanitizedMessage.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[server]');
      sanitizedMessage = sanitizedMessage.replace(/:\d{4,5}/g, '');
      sanitizedMessage = sanitizedMessage.replace(/in \d+ms/g, '');
      
      res.status(error.statusCode).json({
        error: sanitizedMessage,
        code: error.code
      });
      return;
    }
    
    // Handle JWT errors
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      res.status(401).json({
        error: 'Invalid or expired token',
        code: 'ERR_INVALID_TOKEN'
      });
      return;
    }
    
    // Generic server error - never expose internal details
    res.status(500).json({
      error: 'Internal server error',
      code: 'ERR_INTERNAL_SERVER_ERROR'
    });
  }
}
