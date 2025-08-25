# Contributing Guidelines

## Test Scripts and Queries

All test scripts and SQL queries should be placed in the `tests` directory. This includes:

- JavaScript test scripts
- SQL query files
- Database utility scripts
- Any scripts used for testing or database management

When creating a new test script or query:

1. Place the file in the `server/tests` directory
2. Use descriptive names that indicate the purpose of the script
3. Add a brief description of the script to the `tests/README.md` file

## Running Tests

To run a test script:

```bash
node tests/script-name.js
```

For example:

```bash
node tests/test-login.js
```

## Code Style

- Use ES modules (import/export) instead of CommonJS (require/module.exports)
- Follow the existing code style and patterns
- Add appropriate error handling
- Include comments to explain complex logic
