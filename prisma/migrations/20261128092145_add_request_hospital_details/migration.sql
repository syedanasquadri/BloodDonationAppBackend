-- CreateEnum
CREATE TYPE "UrgencyLevel" AS ENUM ('CRITICAL', 'WITHIN_24H', 'SCHEDULED');

-- AlterTable
ALTER TABLE "DonationRequest" ADD COLUMN     "hospitalCity" TEXT,
ADD COLUMN     "hospitalName" TEXT,
ADD COLUMN     "urgency" "UrgencyLevel" NOT NULL DEFAULT 'WITHIN_24H';
