# API Documentation

## Auth

### POST /api/auth/login

- Auth: No.

## Profiles

### GET /api/profile/public

- Auth: Required.

### PUT /api/profile/public

- Auth: Required.

### GET /api/users/[username]/public

- Auth: No.

## Reports

### POST /api/reports

- Auth: Required.
- Targets: vendor, listing.
- Status: open, reviewing, resolved.
