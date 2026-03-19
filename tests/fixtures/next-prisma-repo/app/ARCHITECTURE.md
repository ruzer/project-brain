# Architecture Overview

## Runtime Architecture

- Next.js App Router serves UI and API routes from the same app package.

## Service Layer

- Profile reads and writes flow through dedicated services before reaching route handlers.

## Authentication & Authorization

- Session checks gate vendor dashboard access.
