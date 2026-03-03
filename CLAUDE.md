# Claude Development Guide

This document helps Claude navigate to the appropriate documentation for common development tasks.

## Writing .md files
Do not write content descibing what you just completed; you should write the status/structure of the service/code. The files are meant to be for future AI  agents.

## 🚀 Getting Started

- **Project Overview**: See [README.md](./README.md)
- **Docker Setup**: See [README_DOCKER.md](./README_DOCKER.md)
- **Server Development**: See [server/README.md](./server/README.md)
- **General Reference**: See [AI_REFERENCE.md](./AI_REFERENCE.md)

## 💾 Database Tasks

### PostgreSQL Queries
When querying or working with the PostgreSQL database:
→ See [POSTGRES_QUERY_GUIDE.md](./POSTGRES_QUERY_GUIDE.md)

**Key Points**:
- Always use lowercase table names: `dictionaryentries` (not `"DictionaryEntries"`)
- Run db scripts from the `server/` directory
- Use parameterized queries to prevent SQL injection
- Always release database clients

## 🗣️ Multi-Language Support

For adding or modifying language support:
→ See [docs/MULTI_LANGUAGE_IMPLEMENTATION.md](./docs/MULTI_LANGUAGE_IMPLEMENTATION.md)

For adding a completely new language:
→ See [docs/ADDING_NEW_LANGUAGE_GUIDE.md](./docs/ADDING_NEW_LANGUAGE_GUIDE.md)

## 🔐 Authentication & Users

### Token Management
→ See [docs/TOKEN_EXPIRATION_IMPLEMENTATION.md](./docs/TOKEN_EXPIRATION_IMPLEMENTATION.md)

## 📚 Features

### Work Points System
→ See [docs/WORK_POINTS_SYSTEM.md](./docs/WORK_POINTS_SYSTEM.md)

For work points increment implementation:
→ See [docs/WORK_POINTS_INCREMENT_IMPLEMENTATION.md](./docs/WORK_POINTS_INCREMENT_IMPLEMENTATION.md)

### Flashcards & Review History
→ See [docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md](./docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md)

### Vocabulary Enrichment
→ See [docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md](./docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md)

### Character Breakdown Feature
→ See [docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md](./docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md)

### User Document Feature
→ See [docs/USER_DOCUMENT_FEATURE_SUMMARY.md](./docs/USER_DOCUMENT_FEATURE_SUMMARY.md)

## 🐳 Deployment & DevOps

### Docker Commands & Setup
→ See [docs/DOCKER_COMMANDS.md](./docs/DOCKER_COMMANDS.md)
→ See [docs/DOCKER_GUIDE.md](./docs/DOCKER_GUIDE.md)

### HTTPS/SSL Setup
→ See [docs/HTTPS_SETUP_GUIDE.md](./docs/HTTPS_SETUP_GUIDE.md)

### Deployment Checklist
→ See [docs/deployment-checklist.md](./docs/deployment-checklist.md)

### Deployment Guide
→ See [docs/deployment-guide.md](./docs/deployment-guide.md)

### Windows/WSL Migration
→ See [docs/WSL_TO_WINDOWS_MIGRATION_GUIDE.md](./docs/WSL_TO_WINDOWS_MIGRATION_GUIDE.md)

## 🧪 Testing & Data

### Test Users
→ See [docs/TEST_USERS.md](./docs/TEST_USERS.md)

### Backfill Scripts
→ See [README_BACKFILL_SCRIPT.md](./README_BACKFILL_SCRIPT.md)

### AI Enrichment Testing
→ See [docs/AI_ENRICHMENT_TEST_GUIDE.md](./docs/AI_ENRICHMENT_TEST_GUIDE.md)

## 📋 Contributing

For contribution guidelines:
→ See [server/CONTRIBUTING.md](./server/CONTRIBUTING.md)

For design guidelines:
→ See [docs/designGuidelines.md](./docs/designGuidelines.md)

## How to Use This Guide

1. **Read this file first** to find the relevant documentation for your task
2. **Navigate to the specific doc** mentioned in the arrow (→)
3. **Follow the detailed instructions** in that document
4. If you need more context, check related documentation links

---

**Last Updated**: 2025-02-28
