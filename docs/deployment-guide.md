# Docker Deployment Guide for Vocabulary App

## Prerequisites
Before starting, gather the following information:
- **Server IP Address**: The public or static IP of your deployment server
- **Server Hostname**: Domain name (optional, for SSL/HTTPS setup)
- **SSH Access**: Username and password or SSH key for the deployment server
- **Repository URL**: The Git repository URL for the application

## Configuration Variables

Replace these placeholders with your actual values throughout this guide:

| Variable | Example | Description |
|----------|---------|-------------|
| `<SERVER_IP>` | 203.0.113.45 | Public/static IP of your deployment server |
| `<SERVER_HOSTNAME>` | vocab-app.example.com | Domain name (optional, for SSL) |
| `<SSH_USER>` | ubuntu | SSH username on deployment server |
| `<APP_PATH>` | /home/ubuntu/vocabulary-app | Where to clone the repository |
| `<REPO_URL>` | https://github.com/user/Chinese-Education-App.git | Your Git repository URL |

> **Note on App Location**: The app is deployed to a user directory (e.g., `/home/ubuntu/vocabulary-app`) instead of `/var/www` due to Snap Docker's security confinement, which restricts access to certain system directories. If you're using Docker installed via Snap (common on Ubuntu), it can only access directories like `/home`, `/tmp`, and `/var/snap` by default.

## Step 1: SSH into Your Deployment Server
```bash
ssh <SSH_USER>@<SERVER_IP>
```

Example:
```bash
ssh ubuntu@203.0.113.45
```

## Step 2: Update System and Install Docker
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add user to docker group
sudo usermod -aG docker $USER

# Install additional dependencies
sudo apt install -y git ufw

# Verify installations
docker --version
docker-compose --version

# Log out and back in for docker group changes to take effect
exit
# SSH back in
ssh <SSH_USER>@<SERVER_IP>
```

## Step 3: Clone and Setup Application
```bash
# Clone repository to home directory (compatible with Snap Docker)
cd ~
git clone <REPO_URL> vocabulary-app
cd vocabulary-app
```

Example:
```bash
git clone https://github.com/user/Chinese-Education-App.git vocabulary-app
```

## Step 4: Configure Production Environment
```bash
# Create production environment file
cat > .env << EOF
# Database Configuration
# IMPORTANT: DB_PASSWORD and POSTGRES_PASSWORD must be identical.
# POSTGRES_PASSWORD initializes the postgres user; DB_PASSWORD is what the backend uses to connect.
POSTGRES_PASSWORD=your-secure-production-password-here
DB_PASSWORD=your-secure-production-password-here
DB_HOST=postgres
DB_PORT=5432
DB_NAME=cow_db
DB_USER=cow_user

# Application Configuration
JWT_SECRET=your-super-secure-jwt-secret-here-make-it-32-plus-characters
CLIENT_URL=http://<SERVER_IP>
NODE_ENV=production
PORT=5000
EOF

# Set secure permissions on environment file
chmod 600 .env
```

Replace `<SERVER_IP>` with your actual server IP or domain.

**Important:**
- Replace the database password with a strong, unique password
- Replace the JWT secret with a cryptographically random string (minimum 32 characters)
- Generate secure values: `openssl rand -base64 32`

## Step 5: Build and Start Docker Services
```bash
# Build and start production services
docker-compose -f docker-compose.prod.yml up --build -d

# Verify services are running
docker-compose -f docker-compose.prod.yml ps

# Check service logs
docker-compose -f docker-compose.prod.yml logs -f
```

## Step 6: Import Multi-Language Dictionaries
**IMPORTANT:** This step is required to populate the database with dictionary data for Chinese, Japanese, Korean, and Vietnamese. This process takes 15-30 minutes.

```bash
# Make the import script executable
chmod +x server/scripts/import-all-dictionaries.sh

# Run the complete dictionary import process
# This will:
# - Run all database migrations (including multi-language support)
# - Download all 4 language dictionary files
# - Import all dictionaries into the database
bash server/scripts/import-all-dictionaries.sh production
```

**What this script does:**
- ✅ Runs database migrations (05-09) for multi-language support and texts table
- ✅ Downloads dictionary files:
  - Chinese (CC-CEDICT) - ~120,000 entries
  - Japanese (JMdict) - ~180,000 entries
  - Korean (CC-KEDICT) - ~50,000 entries
  - Vietnamese - ~40,000 entries
- ✅ Imports all dictionaries with progress tracking
- ✅ Verifies each import and displays a summary

**Expected output:**
```
🇨🇳 Chinese dictionary imported: ~120,000 entries
🇯🇵 Japanese dictionary imported: ~180,000 entries
🇰🇷 Korean dictionary imported: ~50,000 entries
🇻🇳 Vietnamese dictionary imported: ~40,000 entries
Total dictionary entries: ~390,000
```

**Note:** The dictionary data is stored in a Docker volume (`postgres_data`) and will persist across container restarts. You only need to run this import process once per deployment, or after a database reset.

## Step 7: Verify Docker Services and Database
```bash
# Check if all containers are running
docker ps

# Test backend health endpoint (internal Docker network)
curl http://localhost:5000/api/health

# Test database connection
docker-compose -f docker-compose.prod.yml exec backend node -e "
const { Pool } = require('pg');
const pool = new Pool({
  host: 'postgres',
  port: 5432,
  database: 'cow_db',
  user: 'cow_user',
  password: process.env.POSTGRES_PASSWORD
});
pool.query('SELECT NOW()', (err, res) => {
  console.log(err ? err : 'Database connected successfully');
  pool.end();
});
"
```

## Step 8: Configure Firewall
```bash
# Configure UFW firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP web server
sudo ufw allow 443/tcp   # HTTPS (for future SSL)
sudo ufw enable

# Check firewall status
sudo ufw status
```

**Note:** The production Docker setup binds the frontend to port 80 (HTTP) and 443 (HTTPS).

## Step 9: Router Port Forwarding (If Behind NAT)

If your deployment server is behind a NAT router, configure port forwarding:

1. Access your router admin panel (usually 192.168.1.1 or 192.168.0.1)
2. Find "Port Forwarding" or "Virtual Server" section
3. Add these rules:
   - **Service Name:** Web Server HTTP
   - **External Port:** 80
   - **Internal IP:** [Your server's internal IP on your LAN]
   - **Internal Port:** 80 (Docker frontend)
   - **Protocol:** TCP

   - **Service Name:** Web Server HTTPS
   - **External Port:** 443
   - **Internal IP:** [Your server's internal IP on your LAN]
   - **Internal Port:** 443 (Docker frontend)
   - **Protocol:** TCP

## Step 10: Test Deployment
```bash
# Check Docker container status
docker-compose -f docker-compose.prod.yml ps

# Check Docker service logs
docker-compose -f docker-compose.prod.yml logs

# Check if backend is responding (internal Docker network)
curl http://localhost:5000/api/health

# Check if frontend is responding (internal Docker network)
curl http://localhost/

# Test from external network
# Visit: http://<SERVER_IP> (replace with your actual server IP or domain)
```

## Step 11: Verify Multi-Language Support
```bash
# Check dictionary counts for each language
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "
    SELECT
        language,
        COUNT(*) as entries,
        CASE language
            WHEN 'zh' THEN '🇨🇳 Chinese'
            WHEN 'ja' THEN '🇯🇵 Japanese'
            WHEN 'ko' THEN '🇰🇷 Korean'
            WHEN 'vi' THEN '🇻🇳 Vietnamese'
            ELSE language
        END as language_name
    FROM \"DictionaryEntries\"
    GROUP BY language
    ORDER BY language;
"

# Test a dictionary lookup for each language
# Chinese
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT word1, word2, pronunciation FROM \"DictionaryEntries\" WHERE language='zh' LIMIT 3;"

# Japanese
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT word1, word2, pronunciation FROM \"DictionaryEntries\" WHERE language='ja' LIMIT 3;"

# Korean
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT word1, word2, pronunciation FROM \"DictionaryEntries\" WHERE language='ko' LIMIT 3;"

# Vietnamese
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT word1, definitions FROM \"DictionaryEntries\" WHERE language='vi' LIMIT 3;"
```

## Troubleshooting Commands
```bash
# View Docker service logs
docker-compose -f docker-compose.prod.yml logs -f

# Restart Docker services
docker-compose -f docker-compose.prod.yml restart

# Rebuild and restart services
docker-compose -f docker-compose.prod.yml up --build -d

# Check container resource usage
docker stats

# Check ports
sudo netstat -tlnp | grep :80
sudo netstat -tlnp | grep :443
sudo netstat -tlnp | grep :5000
```

## Dictionary Re-import (If Needed)
If you need to re-import dictionaries (e.g., after a database reset):

```bash
cd ~/vocabulary-app

# Re-run the import script
bash server/scripts/import-all-dictionaries.sh production
```

**Note:** The script is idempotent - it will clear existing entries for each language before importing, so it's safe to run multiple times.

## Future Updates
```bash
# To update the application
cd ~/vocabulary-app
git pull origin main

# Rebuild and restart Docker services
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up --build -d

# Check updated services
docker-compose -f docker-compose.prod.yml ps

# Note: Dictionary data persists in the postgres_data volume
# You don't need to re-import dictionaries after updates unless:
# - The database schema changed (new migrations)
# - You explicitly want to update dictionary data
```

## Data Persistence
Your dictionary data and user data are stored in Docker volumes:
- `postgres_data`: Contains all database data including dictionaries
- This volume persists across container restarts and rebuilds
- To backup: `docker run --rm -v postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz /data`
- To restore: `docker run --rm -v postgres_data:/data -v $(pwd):/backup alpine tar xzf /backup/postgres-backup.tar.gz -C /`

## Access Your Application

Your vocabulary app will be accessible at:
- **HTTP**: `http://<SERVER_IP>`
- **HTTPS**: `https://<SERVER_IP>` (after configuring SSL certificates, see HTTPS_SETUP_GUIDE.md)

Replace `<SERVER_IP>` with your actual server IP address or domain name.
