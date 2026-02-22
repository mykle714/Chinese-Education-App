# 🤖 AI Agent Reference Guide

Welcome! If you're an AI agent working on this project and you're confused, **this guide points you to the right documentation**.

## 📚 Documentation Structure

All project documentation is organized in the `/docs` directory. This keeps the root clean and makes it easy to find information.

---

## 🎯 Quick Navigation by Topic

### Understanding the Project
- **Start here**: [`README.md`](README.md) - Project overview, features, and setup
- **Design goals & architecture**: [`docs/designGuidelines.md`](docs/designGuidelines.md) - UI/UX goals, current features, database schema

### 🐳 Development & Docker Setup
- **Docker overview**: [`docs/DOCKER_GUIDE.md`](docs/DOCKER_GUIDE.md) - Services, dev/prod environments
- **Docker commands**: [`docs/DOCKER_COMMANDS.md`](docs/DOCKER_COMMANDS.md) - Container management reference
- **Environment migration**: [`docs/WSL_TO_WINDOWS_MIGRATION_GUIDE.md`](docs/WSL_TO_WINDOWS_MIGRATION_GUIDE.md) - WSL to Windows native development

### 🚀 Deployment & Production
- **Deployment guide**: [`docs/deployment-guide.md`](docs/deployment-guide.md) - Server setup, Docker deployment
- **Deployment checklist**: [`docs/deployment-checklist.md`](docs/deployment-checklist.md) - Pre-deployment verification
- **HTTPS setup**: [`docs/HTTPS_SETUP_GUIDE.md`](docs/HTTPS_SETUP_GUIDE.md) - Let's Encrypt SSL for mren.me
- **Database setup**: [`docs/POSTGRESQL_MIGRATION_GUIDE.md`](docs/POSTGRESQL_MIGRATION_GUIDE.md) - PostgreSQL configuration and migration

### 🌍 Multi-Language Support
- **System overview**: [`docs/MULTI_LANGUAGE_IMPLEMENTATION.md`](docs/MULTI_LANGUAGE_IMPLEMENTATION.md) - How multi-language works
- **Supported languages**: [`docs/MULTI_LANGUAGE_STATUS.md`](docs/MULTI_LANGUAGE_STATUS.md) - Status of Chinese, Japanese, Korean, Vietnamese
- **Add new language**: [`docs/ADDING_NEW_LANGUAGE_GUIDE.md`](docs/ADDING_NEW_LANGUAGE_GUIDE.md) - Template for adding new languages

### ⚙️ Core Features

#### Work Points System
- **System architecture**: [`docs/WORK_POINTS_SYSTEM.md`](docs/WORK_POINTS_SYSTEM.md) - How work points track study time
- **Display updates**: [`docs/WORK_POINTS_DISPLAY_UPDATE_IMPLEMENTATION.md`](docs/WORK_POINTS_DISPLAY_UPDATE_IMPLEMENTATION.md)
- **Increment logic**: [`docs/WORK_POINTS_INCREMENT_IMPLEMENTATION.md`](docs/WORK_POINTS_INCREMENT_IMPLEMENTATION.md)
- **Server sync**: [`docs/WORK_POINTS_SYNC_IMPLEMENTATION.md`](docs/WORK_POINTS_SYNC_IMPLEMENTATION.md)

#### Authentication & Users
- **Token expiration**: [`docs/TOKEN_EXPIRATION_IMPLEMENTATION.md`](docs/TOKEN_EXPIRATION_IMPLEMENTATION.md) - Auto-redirect on token expiry
- **Public/Private users**: [`docs/PUBLIC_PRIVATE_USERS_IMPLEMENTATION.md`](docs/PUBLIC_PRIVATE_USERS_IMPLEMENTATION.md) - Leaderboard privacy feature
- **Auth setup**: [`server/auth-setup-guide.md`](server/auth-setup-guide.md) - Authentication configuration

#### Vocabulary & Study
- **Flashcard history**: [`docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md`](docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md) - Spaced repetition tracking
- **User documents**: [`docs/USER_DOCUMENT_FEATURE_SUMMARY.md`](docs/USER_DOCUMENT_FEATURE_SUMMARY.md) - Document/text management
- **Vocab enrichment**: [`docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md`](docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md) - Vocabulary enrichment system
- **AI enrichment**: [`docs/AI_ENRICHMENT_TEST_GUIDE.md`](docs/AI_ENRICHMENT_TEST_GUIDE.md) - AI-powered enrichment testing
- **Breakdown feature**: [`docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md`](docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md) - Breakdown feature documentation

### 🧪 Testing & Development
- **Test users**: [`docs/TEST_USERS.md`](docs/TEST_USERS.md) - Auto-created test users for development
- **Server README**: [`server/README.md`](server/README.md) - Backend API endpoints
- **Contributing**: [`server/CONTRIBUTING.md`](server/CONTRIBUTING.md) - Contribution guidelines
- **Test docs**: [`server/tests/README.md`](server/tests/README.md) - Test script documentation

### 📝 Version History
- **Changelog**: [`docs/CHANGELOG.md`](docs/CHANGELOG.md) - Feature history and version releases

---

## 🔍 Common Questions

**Q: How do I set up the development environment?**  
A: See [`docs/DOCKER_GUIDE.md`](docs/DOCKER_GUIDE.md) and [`docs/DOCKER_COMMANDS.md`](docs/DOCKER_COMMANDS.md)

**Q: How does the work points system work?**  
A: Read [`docs/WORK_POINTS_SYSTEM.md`](docs/WORK_POINTS_SYSTEM.md)

**Q: How do I add a new language?**  
A: Follow [`docs/ADDING_NEW_LANGUAGE_GUIDE.md`](docs/ADDING_NEW_LANGUAGE_GUIDE.md)

**Q: How do I deploy to production?**  
A: Use [`docs/deployment-guide.md`](docs/deployment-guide.md) and [`docs/deployment-checklist.md`](docs/deployment-checklist.md)

**Q: What languages are supported?**  
A: Check [`docs/MULTI_LANGUAGE_STATUS.md`](docs/MULTI_LANGUAGE_STATUS.md)

**Q: How do I set up HTTPS?**  
A: See [`docs/HTTPS_SETUP_GUIDE.md`](docs/HTTPS_SETUP_GUIDE.md)

**Q: I'm moving from WSL to Windows native development, what should I know?**  
A: Read [`docs/WSL_TO_WINDOWS_MIGRATION_GUIDE.md`](docs/WSL_TO_WINDOWS_MIGRATION_GUIDE.md)

---

## 📂 Directory Structure

```
/home/cow/
├── README.md                          # Start here! Project overview
├── AI_REFERENCE.md                    # This file
├── docs/                              # All documentation
│   ├── ADDING_NEW_LANGUAGE_GUIDE.md
│   ├── AI_ENRICHMENT_TEST_GUIDE.md
│   ├── BREAKDOWN_FEATURE_IMPLEMENTATION.md
│   ├── CHANGELOG.md
│   ├── DOCKER_COMMANDS.md
│   ├── DOCKER_GUIDE.md
│   ├── FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md
│   ├── HTTPS_SETUP_GUIDE.md
│   ├── MULTI_LANGUAGE_IMPLEMENTATION.md
│   ├── MULTI_LANGUAGE_STATUS.md
│   ├── POSTGRESQL_MIGRATION_GUIDE.md
│   ├── PUBLIC_PRIVATE_USERS_IMPLEMENTATION.md
│   ├── TEST_USERS.md
│   ├── TOKEN_EXPIRATION_IMPLEMENTATION.md
│   ├── USER_DOCUMENT_FEATURE_SUMMARY.md
│   ├── VOCAB_ENRICHMENT_IMPLEMENTATION.md
│   ├── WORK_POINTS_DISPLAY_UPDATE_IMPLEMENTATION.md
│   ├── WORK_POINTS_INCREMENT_IMPLEMENTATION.md
│   ├── WORK_POINTS_SYNC_IMPLEMENTATION.md
│   ├── WORK_POINTS_SYSTEM.md
│   ├── WSL_TO_WINDOWS_MIGRATION_GUIDE.md
│   ├── deployment-checklist.md
│   ├── deployment-guide.md
│   └── designGuidelines.md
├── server/
│   ├── README.md
│   ├── CONTRIBUTING.md
│   ├── auth-setup-guide.md
│   └── tests/
│       └── README.md
├── src/                               # Frontend source
├── package.json                       # Frontend dependencies
├── docker-compose.yml                 # Dev environment
├── docker-compose.prod.yml            # Prod environment
└── ... (other config files)
```

---

## 💡 Tips for AI Agents

1. **Read the relevant docs before making changes** - They contain important architectural decisions
2. **Check CHANGELOG.md for recent features** - Understand what was added and when
3. **Feature implementation docs detail the "why"** - They explain design decisions, not just code changes
4. **designGuidelines.md describes current features** - Useful for understanding scope
5. **When confused about development setup, check DOCKER_GUIDE.md first**
6. **Multi-language system is documented thoroughly** - Use ADDING_NEW_LANGUAGE_GUIDE.md as a template

---

## 📞 When You're Stuck

If you can't find what you're looking for:
1. Check the CHANGELOG to see what features exist
2. Read designGuidelines.md for feature scope
3. Look at the appropriate feature implementation doc
4. Check server/README.md for API endpoints
5. Search the docs/ directory for keywords

Good luck! 🚀
