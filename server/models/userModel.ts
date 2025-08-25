import db from '../db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User, UserCreateData, UserLoginData, AuthResponse, CustomError } from '../types/index.js';

// JWT secret key - should be in environment variables in production
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';
const SALT_ROUNDS = 10;

export async function getAllUsers(): Promise<User[]> {
  try {
    const pool = await db.poolPromise;
    const result = await pool.request().query('SELECT * FROM Users');
    return result.recordset;
  } catch (error: any) {
    console.error('Error getting all users:', error);
    const customError: CustomError = new Error('Failed to retrieve users');
    customError.code = 'ERR_FETCH_USERS_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

export async function getUserById(id: string): Promise<User> {
  try {
    if (!id) {
      const error: CustomError = new Error('User ID is required');
      error.code = 'ERR_MISSING_USER_ID';
      error.statusCode = 400;
      throw error;
    }
    
    const pool = await db.poolPromise;
    const result = await pool
      .request()
      .input('id', db.sql.UniqueIdentifier, id)
      .query('SELECT * FROM Users WHERE id = @id');
    
    if (result.recordset.length === 0) {
      const error: CustomError = new Error('User not found');
      error.code = 'ERR_USER_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    
    return result.recordset[0];
  } catch (error: any) {
    console.error('Error getting user by id:', error);
    // If it's already a custom error with a code, just rethrow it
    if (error.code && error.statusCode) {
      throw error;
    }
    // Otherwise, create a new error with a code
    const customError: CustomError = new Error('Failed to retrieve user');
    customError.code = 'ERR_FETCH_USER_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

export async function createUser(data: UserCreateData): Promise<User> {
  try {
    // Validate required fields
    if (!data.email) {
      const error: CustomError = new Error('Email is required');
      error.code = 'ERR_MISSING_EMAIL';
      error.statusCode = 400;
      throw error;
    }
    
    if (!data.name) {
      const error: CustomError = new Error('Name is required');
      error.code = 'ERR_MISSING_NAME';
      error.statusCode = 400;
      throw error;
    }
    
    if (!data.password) {
      const error: CustomError = new Error('Password is required');
      error.code = 'ERR_MISSING_PASSWORD';
      error.statusCode = 400;
      throw error;
    }
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
    
    const pool = await db.poolPromise;
    const result = await pool
      .request()
      .input('email', db.sql.NVarChar, data.email)
      .input('name', db.sql.NVarChar, data.name)
      .input('password', db.sql.NVarChar, hashedPassword)
      .query('INSERT INTO Users (email, name, password) OUTPUT INSERTED.* VALUES (@email, @name, @password)');
    
    // Don't return the password
    const user = result.recordset[0];
    delete user.password;
    
    return user;
  } catch (error: any) {
    console.error('Error creating user:', error);
    // If it's a SQL error for duplicate email, add a specific error code
    if (error.number === 2627 || error.number === 2601) {
      const customError: CustomError = new Error('Email already exists');
      customError.code = 'ERR_DUPLICATE_EMAIL';
      customError.statusCode = 409;
      throw customError;
    }
    throw error;
  }
}

export async function loginUser(data: UserLoginData): Promise<AuthResponse> {
  try {
    // Validate required fields
    if (!data.email) {
      const error: CustomError = new Error('Email is required');
      error.code = 'ERR_MISSING_EMAIL';
      error.statusCode = 400;
      throw error;
    }
    
    if (!data.password) {
      const error: CustomError = new Error('Password is required');
      error.code = 'ERR_MISSING_PASSWORD';
      error.statusCode = 400;
      throw error;
    }
    
    const pool = await db.poolPromise;
    const result = await pool
      .request()
      .input('email', db.sql.NVarChar, data.email)
      .query('SELECT * FROM Users WHERE email = @email');
    
    if (result.recordset.length === 0) {
      const error: CustomError = new Error('Invalid email or password');
      error.code = 'ERR_INVALID_CREDENTIALS';
      error.statusCode = 401;
      throw error;
    }
    
    // Check if more than one user was found with the same email (data integrity issue)
    if (result.recordset.length > 1) {
      const error: CustomError = new Error('Multiple accounts found with the same email. Please contact support.');
      error.code = 'ERR_DUPLICATE_ACCOUNTS';
      error.statusCode = 500;
      throw error;
    }
    
    const user = result.recordset[0];
    
    // Compare passwords
    const isPasswordValid = await bcrypt.compare(data.password, user.password);
    
    if (!isPasswordValid) {
      const error: CustomError = new Error('Invalid email or password');
      error.code = 'ERR_INVALID_CREDENTIALS';
      error.statusCode = 401;
      throw error;
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Don't return the password
    delete user.password;
    
    return { user, token };
  } catch (error: any) {
    console.error('Error logging in user:', error);
    // If it's already a custom error with a code, just rethrow it
    if (error.code && error.statusCode) {
      throw error;
    }
    // Otherwise, create a new error with a code
    const customError: CustomError = new Error('Failed to login');
    customError.code = 'ERR_LOGIN_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

export async function getUserByToken(token: string): Promise<User> {
  try {
    if (!token) {
      const error: CustomError = new Error('Token is required');
      error.code = 'ERR_MISSING_TOKEN';
      error.statusCode = 400;
      throw error;
    }
    
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    
    // Get user by ID
    const user = await getUserById(decoded.userId);
    
    // Don't return the password
    delete user.password;
    
    return user;
  } catch (error: any) {
    console.error('Error getting user by token:', error);
    // If it's a JWT error, return an authentication error
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      const customError: CustomError = new Error('Invalid or expired token');
      customError.code = 'ERR_INVALID_TOKEN';
      customError.statusCode = 401;
      throw customError;
    }
    // If it's already a custom error with a code, just rethrow it
    if (error.code && error.statusCode) {
      throw error;
    }
    // Otherwise, create a new error with a code
    const customError: CustomError = new Error('Failed to authenticate user');
    customError.code = 'ERR_AUTH_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string): Promise<User> {
  try {
    // Validate required fields
    if (!userId) {
      const error: CustomError = new Error('User ID is required');
      error.code = 'ERR_MISSING_USER_ID';
      error.statusCode = 400;
      throw error;
    }
    
    if (!currentPassword) {
      const error: CustomError = new Error('Current password is required');
      error.code = 'ERR_MISSING_CURRENT_PASSWORD';
      error.statusCode = 400;
      throw error;
    }
    
    if (!newPassword) {
      const error: CustomError = new Error('New password is required');
      error.code = 'ERR_MISSING_NEW_PASSWORD';
      error.statusCode = 400;
      throw error;
    }
    
    // Get the user to verify the current password
    const pool = await db.poolPromise;
    const userResult = await pool
      .request()
      .input('id', db.sql.UniqueIdentifier, userId)
      .query('SELECT * FROM Users WHERE id = @id');
    
    if (userResult.recordset.length === 0) {
      const error: CustomError = new Error('User not found');
      error.code = 'ERR_USER_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    
    const user = userResult.recordset[0];
    
    // Verify the current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    
    if (!isPasswordValid) {
      const error: CustomError = new Error('Current password is incorrect');
      error.code = 'ERR_INVALID_CURRENT_PASSWORD';
      error.statusCode = 401;
      throw error;
    }
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    
    // Update the password in the database
    const updateResult = await pool
      .request()
      .input('id', db.sql.UniqueIdentifier, userId)
      .input('password', db.sql.NVarChar, hashedPassword)
      .query('UPDATE Users SET password = @password WHERE id = @id; SELECT * FROM Users WHERE id = @id');
    
    if (updateResult.recordset.length === 0) {
      const error: CustomError = new Error('Failed to update password');
      error.code = 'ERR_PASSWORD_UPDATE_FAILED';
      error.statusCode = 500;
      throw error;
    }
    
    // Don't return the password
    const updatedUser = updateResult.recordset[0];
    delete updatedUser.password;
    
    return updatedUser;
  } catch (error: any) {
    console.error('Error changing user password:', error);
    // If it's already a custom error with a code, just rethrow it
    if (error.code && error.statusCode) {
      throw error;
    }
    // Otherwise, create a new error with a code
    const customError: CustomError = new Error('Failed to change password');
    customError.code = 'ERR_PASSWORD_CHANGE_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}
