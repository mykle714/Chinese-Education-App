## [v0.2.1] - 10/19/2025

### Added
- Added swiping controls for the flashcards page
- Allowed documents to be viewed when you first arrive on the reader page in mobile

### Changed
- Changed flashcards view history icon

### Fixed
- Fixed viewport scrolling issues on the flashcards page
- Stopped header word wrap across all pages by setting font size to viewport width
- Fixed activity not being detected
- Fixed a timezone issue where work was being saved under a future date
- Fixed a front end issue where work was not being shown on the calendar

### Removed
- Removed the Dashboard header in favor of just having it say welcome back

### To-do (major)
- [Reader] Add multiple card viewers for the selected text

### To-do (minor)
- [Reader] Document description is running off the card
- [Reader] Rename Personal tab to Your Cards
- [Profile] Email runs off the screen in mobile

## [v0.2.0] - 10/18/2025

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
