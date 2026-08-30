-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
