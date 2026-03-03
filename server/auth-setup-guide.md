# Authentication Setup Guide

This guide explains the current JWT-based authentication system for the Vocabulary Manager application.

## Authentication Architecture

The application uses **JWT (JSON Web Tokens)** for authentication:
- User credentials (email/password) are validated against hashed passwords stored in the database
- Successful login returns a JWT token stored in localStorage
- Tokens are included in API requests via the `Authorization` header
- Tokens expire based on the `JWT_EXPIRATION` setting (default: 7 days)

## Environment Configuration

Authentication requires the following environment variables (set in `.env`):

```env
JWT_SECRET=<your-secret-key-here>
JWT_EXPIRATION=7d
NODE_ENV=development
```

**Important**: `JWT_SECRET` should be a strong, random string (minimum 32 characters recommended).

## Database Schema

The `users` table contains the following authentication-related columns:

```sql
-- Users table (relevant columns)
id UUID PRIMARY KEY
email VARCHAR UNIQUE NOT NULL
password VARCHAR NOT NULL          -- bcrypt hashed password
createdAt TIMESTAMP DEFAULT now()
updatedAt TIMESTAMP DEFAULT now()
```

## User Registration

New users can register through the UI by:

1. Navigating to `/register`
2. Entering email and password
3. Password is hashed with bcrypt before storage
4. User record is created in the `users` table

## Test Users

For development/testing, test users are pre-populated in the database. See [docs/TEST_USERS.md](../docs/TEST_USERS.md) for:
- Available test user credentials
- Seeding test data via Docker initialization scripts

To reset test users:
```bash
# Stop and remove containers, then restart with fresh data
docker-compose down -v
docker-compose up
```

## Testing the Authentication Flow

### 1. Start the Development Environment

```bash
# From the project root
docker-compose up
```

This starts:
- React frontend (Vite dev server on port 5175)
- Express backend (API server on port 3001)
- PostgreSQL database

### 2. Test Login

Navigate to `http://localhost:5175/login` and authenticate with:
- **Email**: One of the test user emails from TEST_USERS.md
- **Password**: Corresponding test password

### 3. Verify Token Storage

After successful login, you should see:
- User redirected to home page
- JWT token stored in `localStorage` under key `token`
- Token sent in `Authorization: Bearer <token>` header for protected API calls

To view the token (in browser console):
```javascript
localStorage.getItem('token')
```

### 4. Test Token Expiration

JWT tokens expire based on the `JWT_EXPIRATION` setting. To test expiration:
- Set `JWT_EXPIRATION=1m` in `.env` to use 1-minute expiration
- Login and wait for token to expire
- Expired token requests return 401 Unauthorized
- User is automatically redirected to login page

### 5. Test Protected Routes

Verify authentication is enforced on protected routes:
- Try accessing `/account` without logging in → redirected to `/login`
- Login successfully → can access `/account`
- Clear localStorage and refresh → redirected to `/login`

## Security Considerations

### In Development
- JWT_SECRET can be a simple string
- HTTPS not required locally
- Test users are pre-seeded in Docker init scripts

### In Production

1. **Strong JWT_SECRET**: Use a cryptographically random string (minimum 32 characters)
   ```bash
   # Generate a secure secret
   openssl rand -base64 32
   ```

2. **HTTPS/TLS**: Always use HTTPS to protect tokens in transit
   - See [docs/HTTPS_SETUP_GUIDE.md](../docs/HTTPS_SETUP_GUIDE.md)

3. **Token Management**:
   - Set appropriate `JWT_EXPIRATION` (7-30 days typical)
   - Consider implementing refresh tokens for longer sessions
   - See [docs/TOKEN_EXPIRATION_IMPLEMENTATION.md](../docs/TOKEN_EXPIRATION_IMPLEMENTATION.md)

4. **Password Security**:
   - Passwords are hashed with bcrypt (not reversible)
   - bcrypt automatically handles salt generation
   - Never log or expose unhashed passwords

5. **Additional Protections**:
   - Implement rate limiting on login attempts
   - Log authentication events for security auditing
   - Monitor for suspicious login patterns
   - Consider adding multi-factor authentication (MFA)

## Troubleshooting

### Login Fails
- **Check**: User email exists in database
- **Check**: Password is correct (case-sensitive)
- **Fix**: Verify test users are seeded in database via Docker init scripts

### Token Invalid/Expired
- **Check**: Browser's localStorage for the token
- **Check**: Token hasn't been deleted or corrupted
- **Fix**: Log out and log back in to get a fresh token

### API Requests Rejected (401)
- **Check**: `Authorization` header is set with `Bearer <token>`
- **Check**: Token hasn't expired
- **Fix**: Check `JWT_EXPIRATION` setting and user's login time

### CORS Errors During Login
- **Check**: Frontend and backend URLs in CORS configuration
- **Check**: Request includes credentials (`credentials: 'include'`)
- **Fix**: Verify `REACT_APP_API_URL` matches backend server address

## Related Documentation

- [TOKEN_EXPIRATION_IMPLEMENTATION.md](../docs/TOKEN_EXPIRATION_IMPLEMENTATION.md) - Token lifecycle and expiration
- [TEST_USERS.md](../docs/TEST_USERS.md) - Available test users for development
- [HTTPS_SETUP_GUIDE.md](../docs/HTTPS_SETUP_GUIDE.md) - Securing authentication in production
