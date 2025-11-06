# Domain Migration Guide: ilikemichael.duckdns.org → mren.me

This guide explains how to migrate your production server from the old DuckDNS domain to the new `mren.me` domain.

## Overview

**Old Domain:** `ilikemichael.duckdns.org`  
**New Domain:** `mren.me`  
**Migration Date:** [To be completed]

---

## What Changed in This Repository

The following files have been updated to use `mren.me`:

1. ✅ **nginx.conf** - Server name and SSL certificate paths
2. ✅ **server/server.ts** - CORS allowed origins  
3. ✅ **HTTPS_SETUP_GUIDE.md** - All domain references
4. ✅ **HTTPS_SETUP_SUMMARY.md** - All domain references

---

## Prerequisites

Before starting the migration:

- [ ] DNS for `mren.me` is pointing to your server IP
- [ ] You have SSH access to the production server
- [ ] You have pushed all code changes to the git repository
- [ ] You have a backup of your current SSL certificates (optional, for rollback)

---

## Migration Steps

### Step 1: Verify DNS Configuration

Ensure your new domain is pointing to your server:

```bash
# From your local machine
dig mren.me

# Or use nslookup
nslookup mren.me
```

The A record should point to your server's public IP address.

---

### Step 2: SSH to Production Server

```bash
ssh username@your-server-ip
```

---

### Step 3: Navigate to Application Directory

```bash
cd ~/vocabulary-app  # Or your application path
```

---

### Step 4: Pull Latest Code Changes

```bash
# Pull the updated code with new domain
git pull origin main

# Verify the changes
git log -1
```

---

### Step 5: Update Environment Variables

Update your production `.env` file:

```bash
# Edit the environment file
nano .env
```

Change the CLIENT_URL:

```bash
# Old:
# CLIENT_URL=https://ilikemichael.duckdns.org

# New:
CLIENT_URL=https://mren.me
```

Save and exit (Ctrl+X, then Y, then Enter).

---

### Step 6: Stop Docker Containers

```bash
docker-compose -f docker-compose.prod.yml down
```

Verify all containers are stopped:

```bash
docker ps
```

---

### Step 7: Obtain New SSL Certificate

Request a new SSL certificate for `mren.me`:

```bash
sudo certbot certonly --standalone -d mren.me --preferred-challenges http
```

**During the process:**
1. **Email address:** Enter your email for renewal notifications
2. **Terms of Service:** Agree by typing 'Y'
3. **Share email:** Optional, type 'N' to decline

**Expected output:**
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/mren.me/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/mren.me/privkey.pem
```

---

### Step 8: Verify New Certificate

```bash
sudo ls -la /etc/letsencrypt/live/mren.me/
```

You should see:
- `fullchain.pem`
- `privkey.pem`
- `cert.pem`
- `chain.pem`

---

### Step 9: Set Certificate Permissions

```bash
sudo chmod 755 /etc/letsencrypt/live
sudo chmod 755 /etc/letsencrypt/archive
```

---

### Step 10: Restart Docker Containers

```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

Wait 30-60 seconds for containers to start, then verify:

```bash
docker-compose -f docker-compose.prod.yml ps
```

All services should show "Up" status.

---

### Step 11: Check Container Logs

Monitor the logs to ensure everything starts correctly:

```bash
# Check frontend logs
docker-compose -f docker-compose.prod.yml logs frontend

# Check backend logs
docker-compose -f docker-compose.prod.yml logs backend
```

Look for any errors related to SSL certificates or CORS.

---

### Step 12: Test New Domain

### From the server:

```bash
# Test HTTP redirect
curl -I http://localhost
# Should return: HTTP/1.1 301 Moved Permanently
# Location: https://mren.me/

# Test HTTPS
curl -I https://mren.me
# Should return: HTTP/2 200

# Test backend health
curl http://localhost:5000/api/health
```

### From your local machine or browser:

1. Visit `http://mren.me` → should redirect to HTTPS
2. Visit `https://mren.me` → should show your app
3. Check SSL certificate (click padlock icon in browser)
4. Test app functionality:
   - Login with test account
   - Create/view vocabulary entries
   - Check leaderboard
   - Verify all features work

---

### Step 13: Update Certificate Auto-Renewal

Update the cron job to use the new domain:

```bash
sudo crontab -e
```

Find the old line:
```bash
0 0 1 * * certbot renew --quiet --deploy-hook "docker-compose -f ~/vocabulary-app/docker-compose.prod.yml restart frontend"
```

**Note:** The cron job doesn't need to change! Certbot's `renew` command automatically handles all domains configured on the server.

However, verify it's working:

```bash
# Test renewal (dry run)
sudo certbot renew --dry-run
```

Should show successful renewal simulation for `mren.me`.

---

### Step 14: Optional - Clean Up Old Certificates

After verifying the new domain works for 24-48 hours, you can optionally remove the old DuckDNS certificates:

```bash
# List all certificates
sudo certbot certificates

# Delete old certificate (ONLY after new one is working!)
sudo certbot delete --cert-name ilikemichael.duckdns.org
```

**Warning:** Only do this after confirming the new domain works perfectly!

---

## Rollback Plan

If something goes wrong, you can rollback:

### Quick Rollback Steps:

1. **Git Revert:**
   ```bash
   cd ~/vocabulary-app
   git revert HEAD  # Reverts the domain change commit
   ```

2. **Restart Containers:**
   ```bash
   docker-compose -f docker-compose.prod.yml down
   docker-compose -f docker-compose.prod.yml up -d --build
   ```

3. **Verify Old Domain:**
   ```bash
   curl -I https://ilikemichael.duckdns.org
   ```

---

## Troubleshooting

### Issue: New domain shows certificate error

**Cause:** SSL certificate not properly issued or nginx not finding it

**Solutions:**
1. Verify certificate exists:
   ```bash
   sudo ls -la /etc/letsencrypt/live/mren.me/
   ```

2. Check nginx config in container:
   ```bash
   docker exec cow-frontend-prod cat /etc/nginx/conf.d/default.conf
   ```

3. Restart frontend container:
   ```bash
   docker-compose -f docker-compose.prod.yml restart frontend
   ```

### Issue: CORS errors in browser console

**Cause:** Backend not allowing new domain

**Solutions:**
1. Verify environment variable:
   ```bash
   cat .env | grep CLIENT_URL
   ```

2. Check backend logs:
   ```bash
   docker-compose -f docker-compose.prod.yml logs backend | grep CORS
   ```

3. Restart backend:
   ```bash
   docker-compose -f docker-compose.prod.yml restart backend
   ```

### Issue: Certbot fails to obtain certificate

**Possible causes:**
- Port 80 is blocked
- DNS not propagated yet
- Domain not pointing to correct IP

**Solutions:**
1. Verify DNS:
   ```bash
   dig mren.me
   ```

2. Check port 80 is free:
   ```bash
   sudo netstat -tlnp | grep :80
   ```

3. Ensure Docker is stopped:
   ```bash
   docker-compose -f docker-compose.prod.yml down
   ```

4. Try again:
   ```bash
   sudo certbot certonly --standalone -d mren.me --preferred-challenges http
   ```

---

## Post-Migration Checklist

After migration is complete:

- [ ] New domain (https://mren.me) loads correctly
- [ ] HTTP redirects to HTTPS
- [ ] SSL certificate is valid (green padlock)
- [ ] All app features work (login, vocab, leaderboard, etc.)
- [ ] No CORS errors in browser console
- [ ] Backend health check responds: `/api/health`
- [ ] Auto-renewal cron job tested with dry-run
- [ ] Old certificates marked for deletion (wait 24-48 hours first)
- [ ] Update any external documentation or links
- [ ] Notify users of new domain (if applicable)

---

## Important Notes

1. **DuckDNS Account:** You can keep your DuckDNS domain active or delete it after migration is successful

2. **Certificate Renewal:** Let's Encrypt certificates expire every 90 days. The cron job handles automatic renewal for all configured domains.

3. **Git Repository:** The repository now uses `mren.me` as the default production domain. Any new deployments will use this domain.

4. **Cloudflare:** If you were previously using Cloudflare with DuckDNS, you'll need to:
   - Remove DuckDNS from Cloudflare
   - Add `mren.me` to Cloudflare (if desired)
   - Configure DNS and proxy settings

---

## Success Verification

Your migration is successful when:

✅ `https://mren.me` loads your application  
✅ Green padlock shows valid SSL certificate  
✅ All app features work correctly  
✅ No console errors related to CORS  
✅ Backend API responds properly  
✅ Certificate auto-renewal test passes  

---

## Support

If you encounter issues during migration:

1. Check the Troubleshooting section above
2. Review container logs: `docker-compose -f docker-compose.prod.yml logs`
3. Verify DNS propagation: `dig mren.me`
4. Test SSL certificate: `sudo certbot certificates`

Your vocabulary app should now be accessible at:  
**https://mren.me** 🔒
