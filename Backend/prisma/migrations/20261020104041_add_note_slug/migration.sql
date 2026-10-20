/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `Note` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Note_slug_key" ON "Note"("slug");
