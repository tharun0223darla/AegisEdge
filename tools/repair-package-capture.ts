import {
  AuditAction,
  MedSource,
  MedicineReviewStatus,
  MedicineReviewType,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const medicineId = option('--medicine-id');
  const brandName = option('--brand');
  const composition = option('--composition');
  const strength = option('--strength');
  const commit = process.argv.includes('--commit');

  if (!medicineId || !brandName || !composition) {
    throw new Error(
      'Usage: npm run repair:package-capture -- --medicine-id <id> --brand "HP Kit" --composition "Amoxicillin + Tinidazole + Omeprazole" [--strength 10mg] [--commit]',
    );
  }

  const medicine = await prisma.medicine.findUnique({
    where: { id: medicineId },
    select: {
      id: true,
      userId: true,
      name: true,
      brandName: true,
      genericName: true,
      source: true,
      medicineMasterId: true,
      medicinePackageId: true,
      userStripImageUrl: true,
      userStripOcrText: true,
      strength: true,
      form: true,
    },
  });

  if (!medicine) throw new Error(`Medicine ${medicineId} was not found.`);
  if (medicine.source !== MedSource.PACKAGE_IMAGE) {
    throw new Error(
      'Refusing repair: medicine was not captured from a package image.',
    );
  }
  if (!medicine.userStripImageUrl || !medicine.userStripOcrText?.trim()) {
    throw new Error(
      'Refusing repair: package image or OCR evidence is missing.',
    );
  }

  const normalizedKey = `repair:package-image:${medicine.id}`;
  const preview = {
    medicineId: medicine.id,
    oldIdentity: {
      name: medicine.name,
      brandName: medicine.brandName,
      genericName: medicine.genericName,
      medicineMasterId: medicine.medicineMasterId,
      medicinePackageId: medicine.medicinePackageId,
    },
    correctedIdentity: {
      name: brandName,
      brandName,
      genericName: composition,
      strength: strength ?? medicine.strength,
      medicineMasterId: null,
      medicinePackageId: null,
    },
    evidence: {
      imagePresent: true,
      ocrTextLength: medicine.userStripOcrText.length,
    },
    reviewKey: normalizedKey,
    dryRun: !commit,
  };

  console.log(JSON.stringify(preview, null, 2));
  if (!commit) {
    console.log(
      'Dry run only. Re-run with --commit after reviewing the correction.',
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.medicine.update({
      where: { id: medicine.id },
      data: {
        name: brandName,
        brandName,
        genericName: composition,
        ...(strength ? { strength } : {}),
        medicineMasterId: null,
        medicinePackageId: null,
        captureReviewKey: normalizedKey,
        visualConfirmed: false,
      },
    });

    await tx.medicineDataReview.upsert({
      where: { normalizedKey },
      create: {
        type: MedicineReviewType.LOW_CONFIDENCE_MATCH,
        status: MedicineReviewStatus.OPEN,
        submittedById: medicine.userId,
        normalizedKey,
        source: MedSource.PACKAGE_IMAGE,
        rawName: brandName,
        strength: medicine.strength,
        form: medicine.form,
        userStripImageUrl: medicine.userStripImageUrl,
        notes:
          'Package OCR identity contradicted the previously linked master.',
        payload: {
          brandName,
          genericName: composition,
          strength: strength ?? medicine.strength,
          previousMedicineMasterId: medicine.medicineMasterId,
          previousMedicinePackageId: medicine.medicinePackageId,
          ocrEvidencePresent: true,
        },
      },
      update: {
        status: MedicineReviewStatus.OPEN,
        rawName: brandName,
        demandCount: { increment: 1 },
        payload: {
          brandName,
          genericName: composition,
          strength: strength ?? medicine.strength,
          previousMedicineMasterId: medicine.medicineMasterId,
          previousMedicinePackageId: medicine.medicinePackageId,
          ocrEvidencePresent: true,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: medicine.userId,
        action: AuditAction.UPDATED,
        entityType: 'Medicine',
        entityId: medicine.id,
        oldValues: {
          name: medicine.name,
          brandName: medicine.brandName,
          genericName: medicine.genericName,
          strength: medicine.strength,
          medicineMasterId: medicine.medicineMasterId,
          medicinePackageId: medicine.medicinePackageId,
        },
        newValues: {
          name: brandName,
          brandName,
          genericName: composition,
          strength: strength ?? medicine.strength,
          medicineMasterId: null,
          medicinePackageId: null,
          captureReviewKey: normalizedKey,
        },
      },
    });
  });

  console.log('Package capture repaired and queued for admin review.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
