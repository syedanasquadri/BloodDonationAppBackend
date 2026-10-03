/*
  Warnings:

  - You are about to drop the column `location` on the `Donor` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Donor" DROP COLUMN "location",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "state" TEXT;
