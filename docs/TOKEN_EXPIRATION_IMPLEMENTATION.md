# Token Expiration Auto-Redirect Implementation

## Overview
Implemented automatic redirection to the login page when a user's authentication token expires. This provides a seamless user experience by detecting expired sessions and redirecting users without manual intervention.

## What Was Implemented

### 1. Global Fetch Interceptor (`src/utils/fetchInterceptor.ts`) ⭐ PRIMARY SOLUTION
Created a **global fetch wrapper** that intercepts ALL fetch calls:
- **Wraps native fetch()**: Overrides `window.fetch` to monitor all HTTP responses
- **Detects 401/403**: Automatically catches authentication errors
- **Auto-redirect**: Clears auth state and redirects to login
- **Zero migration needed**: Works with all existing fetch calls immediately

### 2. Axios API Client (`src/utils/apiClient.ts`) - SUPPLEMENTARY
Also created an axios-based client for new code:
- **Request Interceptor**: Prepares requests with proper authentication
- **Response Interceptor**: Detects 401/403 responses
- **Can be used optionally**: For new features or gradual migration

### 3. AuthContext Integration (`src/AuthContext.tsx`)
Updated the AuthContext to:
- Initialize the global fetch interceptor on app startup
- Register token expiration handlers for both fetch and axios
- Provide unified `handleTokenExpiration` that:
  - Clears localStorage token
  - Resets user state
  - Navigates to `/login`

## How It Works

### Before Implementation
1. User's token expires
2. API calls fail with 401/403 errors
3. User sees error messages but stays on the page
4. User must manually logout or refresh

### After Implementation
1. User's token expires
2. Any API call triggers the response interceptor
3. Interceptor detects 401/403 status
4. **Automatically** clears auth state and localStorage
5. Sets `sessionExpired` flag in localStorage
6. **Automatically** redirects to `/login`
7. Login page displays: **"Your session has expired. Please log in again."** (warning alert)
8. User can log in again with clear understanding of what happened

## Docker Setup Completed

The implementation is now fully deployed in your Docker containers:
- ✅ Axios dependency installed
- ✅ Frontend container rebuilt with new dependencies
- ✅ Backend container running
- ✅ All services operational

## Authentication Architecture

### Cookie-Based Authentication 🍪
The app uses **HTTP-only cookies** for secure authentication:
- **Cookies** (primary): Server sets HTTP-only cookies, sent automatically with `credentials: 'include'`
- **localStorage** (UI state): Stores a token reference for client-side auth state tracking
- **Why both**: Cookies provide security (HTTP-only, protected from XSS), localStorage provides UI reactivity

**Security Benefits:**
- HTTP-only cookies cannot be accessed by JavaScript (XSS protection)
- Cookies are automatically included in requests (no manual header management)
- localStorage token is only for UI state, not actual authentication

## Testing the Implementation

### Manual Testing Steps

1. **Access the application**
   ```
   Open http://localhost:3000 in your browser
   ```

2. **Login to the application**
   ```
   Navigate to /login and authenticate
   ```

3. **Simulate token expiration** (choose one method):
   
   **Method A: Delete Authentication Cookie** ⭐ **RECOMMENDED**
   - Open browser DevTools (F12)
   - Go to **Application** → **Cookies** → `http://localhost:3000`
   - Find and delete the auth cookie (e.g., `connect.sid`, `token`, or `session`)
   - Navigate to any page or perform any action (e.g., Flashcards, Entries)
   - **Expected**: Immediate redirect to `/login`
   
   **Method B: Delete localStorage token** (UI state only)
   - Open browser DevTools (F12)
   - Go to Application → Local Storage
   - Delete the `token` value
   - This clears UI state but backend may still have valid cookie
   
   **Method C: Wait for natural expiration**
   - Leave the app idle for the token expiration duration
   - Return and try to perform any action
   
   **Method D: Server-side invalidation** (if available)
   - Use server admin tools to invalidate the session
   - Try to perform any action in the app

4. **Expected Behavior**
   - On the next API call, you should be:
     - Automatically redirected to `/login`
     - Auth state cleared (both cookie and localStorage)
     - No error messages or broken UI state
     - Console message: "Token expired or unauthorized (detected by fetch interceptor)"

### Testing with Any Page (Now Works Everywhere!)

Since the global fetch interceptor is active, you can test on **any page**:

1. Login to the app
2. Navigate to **any page** (Flashcards, Entries, Reader, etc.)
3. Delete the **authentication cookie** (see Method A above)
4. Perform any action that makes an API call
5. **Expected**: Immediate redirect to `/login` (no error dialogs)

**No more page-by-page migration needed!** The fetch interceptor covers all pages automatically.

## Optional: Using Axios API Client for New Code

While the global fetch interceptor handles all existing code automatically, you may optionally use the axios client for new features:

**Benefits of using apiClient:**
- Cleaner syntax (auto JSON parsing)
- Built-in request/response transformations
- Easier error handling

**Example usage:**
```typescript
import apiClient from "../utils/apiClient";

// GET request
const response = await apiClient.get('/api/endpoint');
const data = response.data;

// POST request
const response = await apiClient.post('/api/endpoint', { key: 'value' });

// Error handling
try {
  const response = await apiClient.get('/api/data');
} catch (err: any) {
  const errorMessage = err.response?.data?.error || err.message;
}
```

**Note:** Using fetch() still works perfectly - the global interceptor handles token expiration for both!

## Benefits

1. **Better UX**: No confusing error messages or broken states
2. **Consistent behavior**: All pages handle expiration the same way
3. **Centralized logic**: Token expiration handled in one place
4. **Maintainable**: Easy to add more interceptor logic if needed
5. **Secure**: Prevents users from staying in a broken auth state

## Technical Details

### API Client Configuration
- Base URL: Pulled from `API_BASE_URL` constant
- Credentials: `withCredentials: true` for cookie-based auth
- Headers: Default `Content-Type: application/json`

### Interceptor Behavior
- **Request**: Adds token to headers (if needed)
- **Response Success**: Passes through unchanged
- **Response Error (401/403)**: 
  - Logs to console
  - Clears localStorage
  - Calls clearAuthState
  - Navigates to login
  - Rejects promise (allows component error handling if needed)

## Future Enhancements

Consider implementing:
1. Token refresh mechanism (if backend supports it)
2. User notification before redirect (toast message)
3. Return URL tracking (redirect back after login)
4. Retry failed requests after token refresh
5. Global loading state during auth operations
