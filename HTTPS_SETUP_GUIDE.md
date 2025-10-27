# HTTPS Setup Guide for ilikemichael.duckdns.org

This guide will help you enable HTTPS for your vocabulary app using Let's Encrypt SSL certificates.

## Prerequisites
- Your app is currently running at http://174.127.171.180 or http://ilikemichael.duckdns.org
- DuckDNS domain (ilikemichael.duckdns.org) is pointing to 174.127.171.180
- You have SSH access to the server
- Docker containers are running

## Overview
After completing this guide, your app will:
- ✅ Run on standard ports 80 (HTTP) and 443 (HTTPS)
- ✅ Automatically redirect HTTP to HTTPS
- ✅ Have a valid SSL certificate from Let's Encrypt
- ✅ Auto-renew certificates every 90 days

---

## Step 1: SSH to Your Server

```bash
ssh username@174.127.171.180
```

Replace `username` with your actual server username.

---

## Step 2: Navigate to Application Directory

```bash
cd /var/www/vocabulary-app
```

Or wherever your application is located on the server.

---

## Step 3: Pull Latest Changes

```bash
git pull origin main
```

This will pull the updated `nginx.conf` and `docker-compose.prod.yml` files.

---

## Step 4: Update Environment File (if needed)

Check if your `.env` file has the correct CLIENT_URL:

```bash
cat .env | grep CLIENT_URL
```

If it still shows `http://`, update it to:

```bash
# Edit the file
nano .env

# Change this line:
# CLIENT_URL=http://174.127.171.180
# To:
CLIENT_URL=https://ilikemichael.duckdns.org
```

Save and exit (Ctrl+X, then Y, then Enter).

---

## Step 5: Install Certbot

Certbot is the Let's Encrypt client that will obtain SSL certificates.

```bash
sudo apt update
sudo apt install certbot -y
```

Verify installation:

```bash
certbot --version
```

---

## Step 6: Stop Docker Containers Temporarily

We need to free up port 80 for Certbot to verify domain ownership.

```bash
docker-compose -f docker-compose.prod.yml down
```

Verify containers are stopped:

```bash
docker ps
```

You should see no containers running.

---

## Step 7: Obtain SSL Certificate

Run Certbot in standalone mode:

```bash
sudo certbot certonly --standalone -d ilikemichael.duckdns.org --preferred-challenges http
```

**During the process, you'll be asked:**

1. **Email address:** Enter your email for renewal notifications
2. **Terms of Service:** Agree by typing 'Y'
3. **Share email:** Optional, type 'N' to decline

**Expected output:**
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/ilikemichael.duckdns.org/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/ilikemichael.duckdns.org/privkey.pem
```

---

## Step 8: Verify Certificate Files

Check that certificates were created:

```bash
sudo ls -la /etc/letsencrypt/live/ilikemichael.duckdns.org/
```

You should see:
- `fullchain.pem`
- `privkey.pem`
- `cert.pem`
- `chain.pem`

---

## Step 9: Set Certificate Permissions

Ensure Docker can read the certificates:

```bash
sudo chmod 755 /etc/letsencrypt/live
sudo chmod 755 /etc/letsencrypt/archive
```

---

## Step 10: Restart Docker Containers

Start the containers with the new HTTPS configuration:

```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

Wait for containers to start (30-60 seconds), then verify:

```bash
docker-compose -f docker-compose.prod.yml ps
```

All services should show "Up" status.

---

## Step 11: Check Container Logs

Monitor the frontend logs to ensure Nginx started successfully:

```bash
docker-compose -f docker-compose.prod.yml logs frontend
```

Look for messages indicating Nginx started successfully. If you see SSL certificate errors, check that the certificate files exist and have correct permissions.

---

## Step 12: Update Router Port Forwarding

On your router admin panel (typically 192.168.1.1 or 192.168.0.1):

1. **Find existing port forwarding rules**
2. **Update or add these rules:**
   - **Port 80 (HTTP):** Forward to your server's internal IP
   - **Port 443 (HTTPS):** Forward to your server's internal IP
   - **Remove port 8080** forwarding if it exists

---

## Step 13: Test HTTPS

### Test from the server itself:

```bash
# Test HTTP redirect
curl -I http://localhost
# Should return: HTTP/1.1 301 Moved Permanently
# Location: https://ilikemichael.duckdns.org/

# Test HTTPS
curl -I https://ilikemichael.duckdns.org
# Should return: HTTP/2 200
```

### Test from your browser:

1. Open: `http://ilikemichael.duckdns.org`
   - Should automatically redirect to HTTPS
   
2. Open: `https://ilikemichael.duckdns.org`
   - Should show your app with a valid SSL certificate (green padlock)
   - Click the padlock to verify certificate details

---

## Step 14: Set Up Automatic Certificate Renewal

Let's Encrypt certificates expire every 90 days. Set up automatic renewal:

```bash
# Test renewal process (dry run)
sudo certbot renew --dry-run
```

If successful, set up a cron job:

```bash
sudo crontab -e
```

**Choose an editor (nano is easiest), then add this line at the bottom:**

```bash
0 0 1 * * certbot renew --quiet --deploy-hook "docker-compose -f /var/www/vocabulary-app/docker-compose.prod.yml restart frontend"
```

This will:
- Check for renewal on the 1st of every month at midnight
- Restart the frontend container if certificates are renewed
- Send email notifications if renewal fails

Save and exit (Ctrl+X, then Y, then Enter).

Verify the cron job was added:

```bash
sudo crontab -l
```

---

## Step 15: Verify Everything Works

### Check all services:

```bash
# Check Docker containers
docker-compose -f docker-compose.prod.yml ps

# Check backend health
curl http://localhost:5000/api/health

# Check HTTPS
curl -I https://ilikemichael.duckdns.org
```

### Test in browser:

1. Visit `http://ilikemichael.duckdns.org` → should redirect to HTTPS
2. Visit `https://ilikemichael.duckdns.org` → should show your app
3. Check SSL certificate (click padlock icon)
4. Test all app functionality (login, dictionary lookups, etc.)

---

## Troubleshooting

### Issue: "Connection refused" when accessing HTTPS

**Solution:** Check if frontend container is running:
```bash
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs frontend
```

### Issue: "SSL certificate problem" or "certificate not found"

**Solutions:**
1. Verify certificate files exist:
   ```bash
   sudo ls -la /etc/letsencrypt/live/ilikemichael.duckdns.org/
   ```

2. Check file permissions:
   ```bash
   sudo chmod 755 /etc/letsencrypt/live
   sudo chmod 755 /etc/letsencrypt/archive
   ```

3. Restart frontend container:
   ```bash
   docker-compose -f docker-compose.prod.yml restart frontend
   ```

### Issue: HTTP doesn't redirect to HTTPS

**Solution:** Check Nginx configuration:
```bash
docker exec cow-frontend-prod cat /etc/nginx/conf.d/default.conf
```

Should show both HTTP (port 80) and HTTPS (port 443) server blocks.

### Issue: Certbot fails with "Port 80 in use"

**Solution:** Stop Docker containers first:
```bash
docker-compose -f docker-compose.prod.yml down
sudo certbot certonly --standalone -d ilikemichael.duckdns.org
docker-compose -f docker-compose.prod.yml up -d
```

### Issue: Can't access app from outside network

**Solutions:**
1. Verify router port forwarding for ports 80 and 443
2. Check firewall rules:
   ```bash
   sudo ufw status
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```

### Issue: Certificate renewal fails

**Solution:** Run manual renewal with verbose output:
```bash
sudo certbot renew --force-renewal
docker-compose -f /var/www/vocabulary-app/docker-compose.prod.yml restart frontend
```

---

## Security Notes

✅ **HTTPS is now enabled** - All traffic is encrypted
✅ **HTTP redirects to HTTPS** - Users are automatically protected
✅ **HSTS enabled** - Browsers will always use HTTPS
✅ **Modern TLS protocols** - TLS 1.2 and 1.3 only
✅ **Strong ciphers** - Secure encryption algorithms

---

## Certificate Information

- **Issuer:** Let's Encrypt
- **Valid for:** 90 days
- **Auto-renewal:** Configured via cron job
- **Domain:** ilikemichael.duckdns.org
- **Certificate path:** `/etc/letsencrypt/live/ilikemichael.duckdns.org/`

---

## Quick Reference Commands

```bash
# View certificate expiration
sudo certbot certificates

# Manually renew certificate
sudo certbot renew --force-renewal

# Restart frontend container after renewal
docker-compose -f docker-compose.prod.yml restart frontend

# Check SSL certificate
openssl s_client -connect ilikemichael.duckdns.org:443 -servername ilikemichael.duckdns.org

# View container logs
docker-compose -f docker-compose.prod.yml logs -f frontend

# Test from command line
curl -I https://ilikemichael.duckdns.org
```

---

## What's Changed

### Configuration Files Updated:
1. ✅ `nginx.conf` - Added HTTPS server block and HTTP redirect
2. ✅ `docker-compose.prod.yml` - Changed ports from 8080→80, added SSL volume mount

### On Your Server:
1. ✅ SSL certificates installed at `/etc/letsencrypt/`
2. ✅ Docker using standard ports 80 and 443
3. ✅ Automatic certificate renewal configured

### Your App:
- **Old URL:** `http://174.127.171.180:8080` ❌
- **New URL:** `https://ilikemichael.duckdns.org` ✅

---

## Success Indicators

✅ Green padlock in browser address bar
✅ URL shows `https://ilikemichael.duckdns.org`
✅ `http://` automatically redirects to `https://`
✅ No security warnings in browser
✅ All app features work correctly
✅ Certificate is valid and trusted

---

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review Docker logs: `docker-compose -f docker-compose.prod.yml logs`
3. Verify certificate: `sudo certbot certificates`
4. Test connectivity: `curl -I https://ilikemichael.duckdns.org`

Your vocabulary app should now be securely accessible at:
**https://ilikemichael.duckdns.org** 🔒
