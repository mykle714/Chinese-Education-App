# Windows Development Setup Guide

## Overview
This project is developed natively on Windows while using Docker containerization for all services. This approach provides a modern development experience on Windows with parity to the production Ubuntu deployment environment.

**Important:** Windows development introduces several environment-specific considerations that must be managed to ensure compatibility between Windows development and Linux production containers. This guide documents these challenges and their solutions.

---

## Critical Issues to Account For

### 1. Line Endings (Most Common - HIGH PRIORITY)
**Problem:** 
- WSL uses Unix line endings (LF)
- Windows uses CRLF (Carriage Return + Line Feed)
- Docker containers and Ubuntu expect LF
- Files with CRLF can cause silent failures in shell scripts, Docker ENTRYPOINT, and configuration files

**Symptoms:**
- Scripts fail with cryptic "command not found" or "no such file" errors in containers
- Configuration files have unexpected formatting
- Git shows all files as modified when switching environments

**Solution:**
1. Configure Git globally on Windows:
   ```bash
   git config --global core.autocrlf input
   git config --global core.safecrlf warn
   ```
   
2. Create `.gitattributes` in repo root:
   ```
   * text=auto
   * eol=lf
   *.md text eol=lf
   *.json text eol=lf
   *.yml text eol=lf
   *.yaml text eol=lf
   *.ts text eol=lf
   *.js text eol=lf
   *.sh text eol=lf
   *.bash text eol=lf
   *.py text eol=lf
   Dockerfile text eol=lf
   docker-compose.yml text eol=lf
   docker-compose.prod.yml text eol=lf
   .env* text eol=lf
   ```

3. If files already have CRLF:
   ```bash
   # In Git Bash or PowerShell 7+ with git
   git add --renormalize .
   git commit -m "Normalize line endings to LF"
   ```

---

### 2. Shell/Scripting Compatibility (HIGH PRIORITY)
**Problem:**
- Windows native: `cmd.exe` and PowerShell have different syntax than Unix shells
- Docker commands with pipes, heredocs, variable substitution, and complex shell features don't translate directly
- Any npm scripts, PM2 configurations, or shell scripts may break

**Symptoms:**
- Commands work in WSL but fail on Windows
- Docker Compose/Docker commands with pipes fail
- Shell variable expansion doesn't work as expected
- Environment variable loading differs

**Solution:**
1. Use **PowerShell 7+** (more Unix-like, includes better support for shell operators)
   - Download from Microsoft Store or https://github.com/PowerShell/PowerShell/releases
   - Set as default shell in Windows Terminal

2. Use **Git Bash** for Unix-like shell access on Windows
   - Provides bash, pipe operators, and Unix utilities
   - Use for running shell scripts and complex Docker commands

3. Avoid relying on shell-specific features in configuration:
   - Use Docker to run scripts instead of running on host
   - Keep npm scripts simple and cross-platform compatible
   - Use Node.js or Docker for complex task automation

4. For Docker Compose and scripts: Test all commands in both PowerShell 7+ and Git Bash

---

### 3. Docker Volume Mounting Paths (HIGH PRIORITY)
**Problem:**
- Docker Desktop on Windows handles paths differently than WSL2
- Windows paths use backslashes and drive letters (C:\path\to\project)
- Relative paths may behave unexpectedly
- Path case sensitivity differs between Windows and Linux

**Symptoms:**
- Volume mounts fail silently or volumes appear empty in containers
- Files not accessible inside containers
- Permission denied errors inside containers
- Changes made in containers don't persist to host

**Solution:**
1. Always use absolute paths in `docker-compose.yml`:
   ```yaml
   # ❌ Avoid relative paths
   volumes:
     - ./src:/app/src
   
   # ✅ Use absolute Windows paths (with forward slashes)
   volumes:
     - C:/path/to/project/src:/app/src
   ```

2. Use forward slashes even on Windows (Docker converts them):
   ```yaml
   volumes:
     - ${PWD}/src:/app/src  # Use ${PWD} in PowerShell or Git Bash
   ```

3. Prefer Docker named volumes for data that doesn't need host access:
   ```yaml
   volumes:
     database_data:
   
   services:
     postgres:
       volumes:
         - database_data:/var/lib/postgresql/data
   ```

4. Test volume mounts carefully:
   ```bash
   docker run -v C:/path/to/project:/app ubuntu ls -la /app
   ```

5. Use `docker-compose exec` to verify mounts inside running containers:
   ```bash
   docker-compose exec <service> ls -la /app
   ```

---

### 4. File Permissions (MEDIUM PRIORITY)
**Problem:**
- NTFS filesystem doesn't have Unix-style execute bits
- Files mounted from Windows volumes don't have proper permissions in containers
- Shell scripts need execute permissions to run

**Symptoms:**
- "Permission denied" errors when running shell scripts in containers
- Inconsistent permissions between development and production
- Some executables may not work in containers

**Solution:**
1. Set permissions explicitly in Dockerfile:
   ```dockerfile
   COPY ./scripts/*.sh /app/scripts/
   RUN chmod +x /app/scripts/*.sh
   ```

2. For development: Less critical, but ensure Dockerfile sets proper permissions for production

3. Use Docker entrypoint to handle permissions if needed:
   ```dockerfile
   ENTRYPOINT ["/bin/bash", "-c", "chmod +x /app/scripts/* && exec \"$@\""]
   ```

---

### 5. Environment Variables & Path Separators (MEDIUM PRIORITY)
**Problem:**
- Windows uses semicolons (`;`) to separate PATH entries; Unix uses colons (`:`)
- Environment variable syntax differs between shells
- Some tools may not recognize Windows paths in environment variables

**Symptoms:**
- Environment variables not loaded correctly in containers
- PATH issues when running commands
- Docker-related environment variables not recognized

**Solution:**
1. Use `.env` files for Docker Compose (Docker handles conversion):
   ```
   # .env
   DATABASE_URL=postgresql://user:pass@postgres:5432/dbname
   NODE_ENV=development
   ```

2. Load `.env` in `docker-compose.yml`:
   ```yaml
   env_file:
     - .env
   ```

3. For host environment variables, use absolute paths:
   - Avoid using complex PATH manipulation
   - Reference dependencies through Docker or absolute paths

4. In npm scripts, use `cross-env` for cross-platform compatibility:
   ```json
   {
     "scripts": {
       "dev": "cross-env NODE_ENV=development vite"
     }
   }
   ```

---

### 6. Docker Desktop Configuration (HIGH PRIORITY)
**Problem:**
- Docker Desktop on Windows has specific resource limits and configurations
- WSL2 backend vs Hyper-V backend differences
- Network connectivity and DNS resolution can differ

**Solution:**
1. Ensure Docker Desktop is using **WSL2 backend** (not Hyper-V):
   - Settings → Resources → WSL integration
   - Enable "Ubuntu" or your preferred WSL distro

2. Verify Docker daemon is running:
   ```bash
   docker ps  # Should work without errors
   docker-compose --version
   ```

3. Configure adequate resources in Docker Desktop:
   - Settings → Resources → Memory: At least 4GB
   - Settings → Resources → CPU: At least 2 cores
   - Settings → Resources → Disk: Adequate space (check current usage)

4. Test Docker functionality:
   ```bash
   docker run hello-world
   docker-compose up --help
   ```

---

### 7. Development Workflow Differences (MEDIUM PRIORITY)
**Problem:**
- Editor integration with containers may differ
- Hot reload/file watching may behave differently
- Build processes may have different caching

**Symptoms:**
- Changes don't reflect in running containers
- Builds take longer than expected
- IDE features (linting, IntelliSense) may not work with containers

**Solution:**
1. Use file watching carefully:
   - Docker Desktop on Windows may have slower file notification
   - Consider using polling if watching fails
   - In npm scripts: use `--poll` flag if needed (Vite, Jest, etc.)

2. For development servers, ensure proper volume mounts:
   ```yaml
   services:
     app:
       volumes:
         - C:/path/to/project/src:/app/src
         - /app/node_modules  # Don't override node_modules
   ```

3. Run builds inside containers to avoid path issues:
   - Build in container: `docker-compose run app npm run build`
   - Don't rely on host builds being identical

---

## Migration Checklist

### Before Starting Development on Windows:
- [ ] Install Docker Desktop for Windows
- [ ] Configure WSL2 backend in Docker Desktop
- [ ] Install PowerShell 7+ or use Git Bash
- [ ] Clone repository with `core.autocrlf=input`
- [ ] Create/verify `.gitattributes` file
- [ ] Test `docker ps` and `docker-compose --version`

### For Each Service/Container:
- [ ] Verify volume mounts with absolute paths
- [ ] Test file modifications persist to host
- [ ] Ensure shell scripts have execute permissions in Dockerfile
- [ ] Test environment variable loading
- [ ] Verify networking between containers (if multi-container setup)

### Before Committing Changes:
- [ ] Verify all files have LF line endings
- [ ] Test full workflow: `docker-compose up`
- [ ] Build and test in containers
- [ ] Verify builds work identically on target Ubuntu machine

### Deployment to Ubuntu:
- [ ] Test entire stack on Ubuntu target machine
- [ ] Verify all volume mounts work with Ubuntu paths
- [ ] Confirm Docker configurations work without modification
- [ ] Test in production environment before full deployment

---

## Troubleshooting Common Issues

### "command not found" in Docker containers
- Check line endings: `git status` should show no modifications
- Verify permissions: `docker-compose exec <service> chmod +x /path/to/script`
- Check volume mounts: `docker-compose exec <service> ls -la /app`

### Volume mount appears empty in container
- Verify absolute path is correct: `echo %CD%` (PowerShell) to get current path
- Use forward slashes in docker-compose.yml: `C:/project/path`
- Test with: `docker run -v C:/path:/test ubuntu ls -la /test`

### Environment variables not loading
- Check `.env` file exists and is in docker-compose.yml: `env_file: - .env`
- Verify no CRLF in `.env` file
- Debug with: `docker-compose exec <service> env | grep VARIABLE_NAME`

### Scripts fail randomly
- Check if using PowerShell without version 7+: Upgrade or use Git Bash
- Verify no shell-specific syntax in npm scripts
- Run inside Docker: `docker-compose run app npm run <script>`

### Host can't connect to Docker services
- Check if using correct hostname: Service name in docker-compose.yml from host
- From host, use `localhost` or `127.0.0.1`
- From container, use service name (e.g., `postgres` instead of `localhost`)

---

## Resources & References
- [Docker Desktop Windows Documentation](https://docs.docker.com/desktop/install/windows-install/)
- [WSL2 Guide](https://docs.docker.com/desktop/wsl/)
- [PowerShell 7 Download](https://github.com/PowerShell/PowerShell/releases)
- [Git Attributes Documentation](https://git-scm.com/docs/gitattributes)
- [Docker Compose File Reference](https://docs.docker.com/compose/compose-file/)

---

## Notes for AI Agents
When making changes or running commands in this project:
1. **Always verify line endings** - Ensure all text files use LF (Unix), not CRLF (Windows)
2. **Test Docker commands carefully** - Commands that work on Linux may fail on Windows with PowerShell
3. **Use absolute paths in docker-compose.yml** - Never rely on relative paths for volumes
4. **Document shell scripts** - Avoid bash-specific features or provide fallbacks
5. **Verify on target platform** - Test critical functionality on Ubuntu before deployment
6. **Check environment variables** - Ensure .env files exist and are loaded correctly
7. **Monitor volume mounts** - Use `docker-compose exec` to verify files are accessible inside containers
