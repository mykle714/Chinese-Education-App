# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.2.0]

### Added
- Added support for Korean, Japanese, and Vietnamese
- Allow users to create a new blank document
- Allow users to edit and delete documents
- Added trottling and batching to activity tracking to stop high user activity from lagging the client

### Changed
- Changed leaderboard to exclude test accounts
- Reduced the font size of the changelog
- Increased the activity timeout to 15 seconds
- Reduced the minimum required minutes to count towards a streak to 3

### Fixed
- Fixed Total Study Time always showing 0 minutes.
- Fixed calendar moving to next day too early.
- Fixed calendar dates off by 1

### Removed
- Removed the concept of a public document so that all docs are tied to a user.


## [v0.1.0]

### Added
- Added Calendar to home page dashboard
- Added leadboard (temporarily) for users to view each other's progress during test phase

### Changed
- Home screen columns now have equal width instead of 2:1 ratio

### Fixed
- Streak behavior
- Reader card display bug
