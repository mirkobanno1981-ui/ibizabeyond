-- Generated IbizaBeyond Full Schema
-- Created at 2026-04-02T17:48:43.339Z

-- Extensions
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Set search path
SET search_path TO public, extensions, auth;

-- Schemas
CREATE SCHEMA IF NOT EXISTS auth;

-- Custom types (Enums)

-- Tables

-- Foreign Key Constraints
