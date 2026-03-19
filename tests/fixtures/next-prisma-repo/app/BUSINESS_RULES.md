# Business Rules

## Scope & Sources

- Rules below are extracted from live code only.
- Primary sources:
  - `src/app/api/*`
  - `src/services/*`
  - `prisma/schema.prisma`

## Roles, Profiles, Permissions

- Admin
- Vendor
- Public

## Profiles

- Public profile data is updated through `/api/profile/public`.
- Public profile visibility is resolved through `/api/users/[username]/public`.

## Reports

- Any authenticated user can create a report about a published listing.
- Only admins can resolve or dismiss reports.
