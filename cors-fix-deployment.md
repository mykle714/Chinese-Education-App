# CORS Fix Deployment Guide

## The Problem
Your hosted vocabulary app was getting CORS errors during login because the server's CORS configuration only allowed localhost development URLs, not your production URL (http://174.127.171.180).

## The Fix
Updated `server/server.ts` to include your production URLs in the allowed origins list:

```javascript
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:5175',
  'http://127.0.0.1:5175',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://174.127.171.180', // ← Added this for production HTTP
  'https://174.127.171.180' // ← Added this for future HTTPS
];
```

## Deployment Steps

### Step 1: Update Your Server Code
On your deployment server, pull the latest changes:

```bash
# SSH into your deployment server
ssh username@174.127.171.180

# Navigate to your app directory
cd /var/www/vocabulary-app

# Pull the latest changes from Git
git pull origin main

# Install any new dependencies (if needed)
npm install
cd server && npm install && cd ..
```

### Step 2: Restart Your Backend
```bash
# Restart PM2 to apply the changes
pm2 restart vocabulary-backend

# Check that it's running
pm2 status

# Check logs for any errors
pm2 logs vocabulary-backend --lines 10
```

### Step 3: Test the Fix
```bash
# Test that your backend is responding
curl http://localhost:5000/api/

# Should return some response (not "connection refused")
```

### Step 4: Test Login from Frontend
1. **Open your vocabulary app** in a browser: `http://174.127.171.180`
2. **Try to log in** with your credentials
3. **Check browser console** (F12 → Console) - should see no CORS errors
4. **Login should work** successfully

## Alternative: Manual File Update

If you can't use Git, manually update the file:

```bash
# Edit the server file directly
nano /var/www/vocabulary-app/server/server.ts

# Find the CORS section and add these two lines to allowedOrigins array:
# 'http://174.127.171.180',
# 'https://174.127.171.180'

# Save and restart
pm2 restart vocabulary-backend
```

## Verification

After applying the fix, you should see:
- ✅ No CORS errors in browser console
- ✅ Login requests succeed
- ✅ User can access protected pages after login

## Troubleshooting

### If login still fails:
```bash
# Check PM2 logs for errors
pm2 logs vocabulary-backend

# Check if backend is running on correct port
sudo netstat -tlnp | grep :3001

# Test backend directly
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass"}'
```

### If you see "Origin not allowed by CORS" in logs:
- Double-check that your frontend is accessing `http://174.127.171.180`
- Verify the CORS configuration was updated correctly
- Make sure PM2 restarted successfully

The CORS fix should resolve your login issues immediately after restarting the backend!
