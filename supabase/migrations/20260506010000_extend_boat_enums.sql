-- Boat enum values referenced by BoatEditModal/BoatIngestModal that didn't exist.
ALTER TYPE fuel_policy ADD VALUE IF NOT EXISTS 'Paid by Consumption';
ALTER TYPE fuel_policy ADD VALUE IF NOT EXISTS 'Full to Full';
ALTER TYPE skipper_type ADD VALUE IF NOT EXISTS 'Required';
