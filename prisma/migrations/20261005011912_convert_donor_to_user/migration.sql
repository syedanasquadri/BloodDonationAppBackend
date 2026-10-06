/*
  Warnings:

  - You are about to drop the column `requesterName` on the `DonationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `requesterPhone` on the `DonationRequest` table. All the data in the column will be lost.
  - You are about to drop the `Donor` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `requesterId` to the `DonationRequest` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "DonationRequest" DROP CONSTRAINT "DonationRequest_donorId_fkey";

-- AlterTable
ALTER TABLE "DonationRequest" DROP COLUMN "requesterName",
DROP COLUMN "requesterPhone",
ADD COLUMN     "requesterId" INTEGER NOT NULL;

-- DropTable
DROP TABLE "Donor";

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "bloodGroup" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- AddForeignKey
ALTER TABLE "DonationRequest" ADD CONSTRAINT "DonationRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationRequest" ADD CONSTRAINT "DonationRequest_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
