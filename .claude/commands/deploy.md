# Deploy to Production

Deploy the current branch to the production server at 174.127.171.180.

## Environment

- **Server**: 174.127.171.180 (already set up — Docker, firewall, port forwarding are all configured)
- **App directory on server**: `~/vocabulary-app`
- **SSH**: User SSHs in manually. You do not have SSH access — give the user the commands to run.
- **Deployment type**: "Future Updates" only (no initial setup needed)

## Steps

### 1. Commit & push (run locally)

Stage and commit all relevant changes, then push to `origin main`.

Check for new migration files in `database/migrations/` — note them so the user knows to run them.

### 2. Tell the user to run on the server

Always present ALL server commands as a single copy-pasteable block — never split across multiple steps or prose sections. If there are migrations, include them inline. Example:

```bash
cd ~/vocabulary-app
git pull origin main
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up --build -d

# Migration(s)
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/<migration-file>.sql

# Verify
docker-compose -f docker-compose.prod.yml ps
curl http://localhost:5000/api/health
```

If there are no migrations, omit that section but keep everything else in one block.
