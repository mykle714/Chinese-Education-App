import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { User, UserCreateData, UserLoginData, AuthResponse, Language } from '../types/index.js';
import { ValidationError, DuplicateError, NotFoundError, DALError } from '../types/dal.js';

// JWT secret key - should be in environment variables in production
const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

/**
 * User Service - Contains all business logic for user operations
 * Handles authentication, validation, password management, etc.
 */
export class UserService {
  constructor(private userDAL: IUserDAL) {}

  /**
   * Create a new user with password hashing and validation
   */
  async createUser(userData: UserCreateData): Promise<User> {
    // Business validation
    this.validateUserData(userData);
    
    // Check if user already exists
    const existingUser = await this.userDAL.findByEmail(userData.email);
    if (existingUser) {
      throw new DuplicateError('Email already exists');
    }
    
    // Hash password (business logic)
    const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);
    
    // Create user with hashed password
    const newUser = await this.userDAL.create({
      ...userData,
      password: hashedPassword
    });
    
    // Remove password from response for security
    delete newUser.password;
    
    return newUser;
  }

  /**
   * Authenticate user and generate JWT token
   */
  async authenticateUser(email: string, password: string): Promise<AuthResponse> {
    // Validation
    if (!email) {
      throw new ValidationError('Email is required');
    }
    if (!password) {
      throw new ValidationError('Password is required');
    }
    
    // Find user with password for authentication
    const user = await this.userDAL.findByEmailWithPassword(email);
    if (!user) {
      throw new ValidationError('Invalid email or password');
    }
    
    // Verify password (business logic)
    const isPasswordValid = await bcrypt.compare(password, user.password!);
    if (!isPasswordValid) {
      throw new ValidationError('Invalid email or password');
    }
    
    
    // Generate JWT token (business logic)
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Remove password from response
    delete user.password;
    
    return { user, token };
  }

  /**
   * Verify JWT token and get user
   */
  async getUserFromToken(token: string): Promise<User> {
    if (!token) {
      throw new ValidationError('Token is required');
    }
    
    try {
      // Verify token (business logic)
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      
      // Get user by ID
      const user = await this.userDAL.findById(decoded.userId);
      if (!user) {
        throw new NotFoundError('User not found');
      }
      
      return user;
    } catch (error: any) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        throw new ValidationError('Invalid or expired token');
      }
      throw error;
    }
  }

  /**
   * Change user password with current password verification
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<User> {
    // Validation
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!currentPassword) {
      throw new ValidationError('Current password is required');
    }
    if (!newPassword) {
      throw new ValidationError('New password is required');
    }
    
    // Business rule: validate new password strength
    this.validatePasswordStrength(newPassword);
    
    // Get user with password for verification
    const user = await this.userDAL.findByEmailWithPassword(
      (await this.userDAL.findById(userId))?.email || ''
    );
    
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Verify current password (business logic)
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password!);
    if (!isCurrentPasswordValid) {
      throw new ValidationError('Current password is incorrect');
    }
    
    // Hash new password (business logic)
    const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    
    // Update password
    const success = await this.userDAL.updatePassword(userId, hashedNewPassword);
    if (!success) {
      throw new DALError('Failed to update password', 'ERR_PASSWORD_UPDATE_FAILED');
    }
    
    // Return updated user (without password)
    const updatedUser = await this.userDAL.findById(userId);
    if (!updatedUser) {
      throw new NotFoundError('User not found after update');
    }
    
    return updatedUser;
  }

  /**
   * Get user profile by ID
   */
  async getUserProfile(userId: string): Promise<User> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    return user;
  }

  /**
   * Update user profile information
   */
  async updateUserProfile(userId: string, updateData: { email?: string; name?: string; selectedLanguage?: Language }): Promise<User> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    
    // Business validation
    if (updateData.email) {
      this.validateEmail(updateData.email);
      
      // Check if new email is already taken by another user
      const existingUser = await this.userDAL.findByEmail(updateData.email);
      if (existingUser && existingUser.id !== userId) {
        throw new DuplicateError('Email already exists');
      }
    }
    
    if (updateData.name) {
      this.validateName(updateData.name);
    }
    
    // Update user
    const updatedUser = await this.userDAL.update(userId, updateData);
    return updatedUser;
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId: string): Promise<{
    totalVocabEntries: number;
    createdAt: Date;
  }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    
    return await this.userDAL.getUserStats(userId);
  }

  /**
   * Get all users (admin function)
   */
  async getAllUsers(): Promise<User[]> {
    return await this.userDAL.findAll();
  }

  /**
   * Get users with vocabulary counts (admin function)
   */
  async getUsersWithVocabCounts(): Promise<Array<User & { vocabCount: number }>> {
    return await this.userDAL.findUsersWithVocabCount();
  }

  /**
   * Get total work points for a user
   */
  async getTotalWorkPoints(userId: string): Promise<number> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    
    return await this.userDAL.getTotalWorkPoints(userId);
  }

  /**
   * Increment total work points for a user (used during daily sync)
   */
  async incrementTotalWorkPoints(userId: string, pointsToAdd: number): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (pointsToAdd < 0) {
      throw new ValidationError('Points to add must be positive');
    }
    
    return await this.userDAL.incrementTotalWorkPoints(userId, pointsToAdd);
  }

  // Private validation methods (business logic)

  /**
   * Validate user registration data
   */
  private validateUserData(userData: UserCreateData): void {
    if (!userData.email) {
      throw new ValidationError('Email is required');
    }
    if (!userData.name) {
      throw new ValidationError('Name is required');
    }
    if (!userData.password) {
      throw new ValidationError('Password is required');
    }
    
    this.validateEmail(userData.email);
    this.validateName(userData.name);
    this.validatePasswordStrength(userData.password);
  }

  /**
   * Validate email format
   */
  private validateEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError('Invalid email format');
    }
    
    if (email.length > 255) {
      throw new ValidationError('Email is too long (maximum 255 characters)');
    }
  }

  /**
   * Validate name
   */
  private validateName(name: string): void {
    if (name.trim().length < 2) {
      throw new ValidationError('Name must be at least 2 characters long');
    }
    
    if (name.length > 100) {
      throw new ValidationError('Name is too long (maximum 100 characters)');
    }
    
    // Business rule: no special characters in name
    const nameRegex = /^[a-zA-Z\s\-'\.]+$/;
    if (!nameRegex.test(name)) {
      throw new ValidationError('Name can only contain letters, spaces, hyphens, apostrophes, and periods');
    }
  }

  /**
   * Validate password strength
   */
  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }
    
    if (password.length > 128) {
      throw new ValidationError('Password is too long (maximum 128 characters)');
    }
    
    // Business rule: password must contain at least one letter and one number
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    
    if (!hasLetter || !hasNumber) {
      throw new ValidationError('Password must contain at least one letter and one number');
    }
    
    // Business rule: check for common weak passwords
    const commonPasswords = ['password', '12345678', 'qwerty123', 'password123'];
    if (commonPasswords.includes(password.toLowerCase())) {
      throw new ValidationError('Password is too common. Please choose a stronger password');
    }
  }
}
