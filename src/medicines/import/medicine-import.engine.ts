import { createReadStream } from 'fs';
import { basename } from 'path';
import { SaltCanonicalizer, type CanonicalSaltProfile } from './salt-canonicalizer';

type PrismaLike = any;

export interface ImportOptions {
  uploadedById?: string;
  filePath: string;
  originalFileName?: string;
  datasetName?: string;
  datasetVersion?: string;
  maxRows?: number;
}

export interface CommitOptions {
  batchSize?: number;
  onProgress?: (progress: {
    processedRows: number;
    committedRows: number;
    skippedRows: number;
    pendingRows: number;
  }) => void;
}

interface NormalizedImportRow {
  brandName?: string;
  genericName?: string;
  composition?: string;
  manufacturer?: string;
  strength?: string;
  type?: string;
  isDiscontinued?: boolean;
  prescriptionRequired?: boolean;
  packSize?: string;
  gtin?: string;
  stripImageUrl?: string;
  pillImageUrl?: string;
  mrpPrice?: string;
  priceCurrency?: string;
  priceSource?: string;
  salt?: CanonicalSaltProfile;
  dedupeKey?: string;
  normalizedName?: string;
  validationErrors: string[];
  warnings: string[];
}

const HEADER_ALIASES: Record<string, keyof NormalizedImportRow> = {
  brand: 'brandName',
  brandname: 'brandName',
  medicine: 'brandName',
  medicinename: 'brandName',
  name: 'brandName',
  product: 'brandName',
  productname: 'brandName',
  generic: 'genericName',
  genericname: 'genericName',
  salt: 'composition',
  salts: 'composition',
  composition: 'composition',
  ingredient: 'composition',
  ingredients: 'composition',
  strength: 'strength',
  manufacturer: 'manufacturer',
  manufacturername: 'manufacturer',
  mfr: 'manufacturer',
  company: 'manufacturer',
  type: 'type',
  form: 'type',
  pack: 'packSize',
  packsize: 'packSize',
  packsizelabel: 'packSize',
  packing: 'packSize',
  price: 'mrpPrice',
  mrp: 'mrpPrice',
  mrpprice: 'mrpPrice',
  maximumretailprice: 'mrpPrice',
  currency: 'priceCurrency',
  pricecurrency: 'priceCurrency',
  pricesource: 'priceSource',
  sourcedataset: 'priceSource',
  source_dataset: 'priceSource',
  prescriptionrequired: 'prescriptionRequired',
  requiresprescription: 'prescriptionRequired',
  rxrequired: 'prescriptionRequired',
  rx: 'prescriptionRequired',
  gtin: 'gtin',
  barcode: 'gtin',
  stripimageurl: 'stripImageUrl',
  stripimage: 'stripImageUrl',
  pillimageurl: 'pillImageUrl',
  pillimage: 'pillImageUrl',
};

export class MedicineImportEngine {
  private readonly canonicalizer = new SaltCanonicalizer();
  private static readonly DEFAULT_COMMIT_BATCH_SIZE = 50;
  private static readonly MAX_COMMIT_BATCH_SIZE = 500;

  constructor(private readonly prisma: PrismaLike) {}

  async ingestCsv(options: ImportOptions) {
    this.assertCsv(options.filePath);

    const batch = await this.prisma.medicineImportBatch.create({
      data: {
        uploadedById: options.uploadedById,
        originalFileName: options.originalFileName ?? basename(options.filePath),
        storedPath: options.filePath,
        datasetName: options.datasetName,
        datasetVersion: options.datasetVersion,
      },
    });

    const seenDedupe = new Set<string>();
    const seenImportIdentities = new Set<string>();
    let totalRows = 0;
    let validRows = 0;
    let invalidRows = 0;
    let duplicateRows = 0;
    let createRows = 0;
    let updateRows = 0;
    let saltsToCreate = 0;
    let saltsToReuse = 0;
    const stagingBuffer: any[] = [];
    const newSaltKeys = new Set<string>();
    const existingSaltKeys = new Set<string>();

    try {
      for await (const parsed of this.readCsvObjects(options.filePath)) {
        if (options.maxRows && totalRows >= options.maxRows) break;
        totalRows += 1;
        const normalized = this.normalizeRow(parsed.record);
        const rowNumber = parsed.rowNumber;
        let action: 'CREATE' | 'UPDATE' | 'DUPLICATE_IN_FILE' | 'INVALID' | 'NOOP' =
          'INVALID';
        let existingMedicineMasterId: string | undefined;
        let existingSaltProfileId: string | undefined;
        let duplicateInFile = false;

        const importIdentityKey = this.importIdentityKey(normalized);

        if (
          (normalized.dedupeKey && seenDedupe.has(normalized.dedupeKey)) ||
          (importIdentityKey && seenImportIdentities.has(importIdentityKey))
        ) {
          duplicateInFile = true;
          normalized.warnings.push('Duplicate within import file; first row wins.');
          action = 'DUPLICATE_IN_FILE';
          duplicateRows += 1;
        } else if (normalized.validationErrors.length > 0) {
          action = 'INVALID';
          invalidRows += 1;
        } else {
          if (normalized.dedupeKey) seenDedupe.add(normalized.dedupeKey);
          if (importIdentityKey) seenImportIdentities.add(importIdentityKey);

          const [existingMaster, existingSalt] = await Promise.all([
            this.findExistingMasterForNormalizedRow(this.prisma, normalized),
            this.prisma.saltProfile.findUnique({
              where: { saltKey: normalized.salt?.saltKey },
              select: { id: true },
            }),
          ]);
          const existingPackage = await this.findExistingPackageForNormalizedRow(
            normalized,
            existingMaster,
          );

          existingMedicineMasterId = existingMaster?.id;
          existingSaltProfileId = existingSalt?.id;

          if (existingMaster?.source === 'ADMIN' || existingMaster?.isVerified) {
            action = 'NOOP';
            normalized.warnings.push('Existing admin/verified master will not be overwritten.');
          } else if (
            existingMaster &&
            this.masterMatchesNormalizedRow(existingMaster, normalized) &&
            this.packageMatchesNormalizedRow(existingPackage, normalized)
          ) {
            action = 'NOOP';
            normalized.warnings.push('Existing import record already matches this row.');
          } else if (existingMaster) {
            action = 'UPDATE';
            updateRows += 1;
          } else {
            action = 'CREATE';
            createRows += 1;
          }

          if (existingSalt) {
            existingSaltKeys.add(normalized.salt!.saltKey);
          } else {
            newSaltKeys.add(normalized.salt!.saltKey);
          }

          validRows += 1;
        }

        stagingBuffer.push({
          importBatchId: batch.id,
          rowNumber,
          action,
          raw: parsed.record,
          normalized: this.toNormalizedJson(normalized),
          brandName: normalized.brandName,
          normalizedName: normalized.normalizedName,
          genericName: normalized.genericName,
          composition: normalized.composition,
          manufacturer: normalized.manufacturer,
          strength: normalized.strength,
          type: normalized.type,
          isDiscontinued: normalized.isDiscontinued ?? false,
          prescriptionRequired: normalized.prescriptionRequired,
          packSize: normalized.packSize,
          gtin: normalized.gtin,
          stripImageUrl: normalized.stripImageUrl,
          pillImageUrl: normalized.pillImageUrl,
          mrpPrice: normalized.mrpPrice,
          priceCurrency: normalized.priceCurrency,
          priceSource: normalized.priceSource,
          saltKey: normalized.salt?.saltKey,
          saltDisplayName: normalized.salt?.displayName,
          ingredients: normalized.salt?.ingredients,
          dedupeKey: normalized.dedupeKey,
          validationErrors: normalized.validationErrors,
          warnings: normalized.warnings,
          duplicateInFile,
          existingMedicineMasterId,
          existingSaltProfileId,
        });

        if (stagingBuffer.length >= 1000) {
          await this.flushStaging(stagingBuffer);
        }
      }

      await this.flushStaging(stagingBuffer);
      saltsToCreate = newSaltKeys.size;
      saltsToReuse = existingSaltKeys.size;

      await this.prisma.medicineImportBatch.update({
        where: { id: batch.id },
        data: {
          totalRows,
          validRows,
          invalidRows,
          duplicateRows,
          createRows,
          updateRows,
          saltsToCreate,
          saltsToReuse,
          report: {
            totalRows,
            validRows,
            invalidRows,
            duplicateRows,
            createRows,
            updateRows,
            saltsToCreate,
            saltsToReuse,
          },
        },
      });

      return this.preview(batch.id);
    } catch (error) {
      await this.prisma.medicineImportBatch.update({
        where: { id: batch.id },
        data: { status: 'FAILED', report: { error: this.errorMessage(error) } },
      });
      throw error;
    }
  }

  async preview(batchId: string) {
    const batch = await this.prisma.medicineImportBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) throw new Error(`Import batch not found: ${batchId}`);

    const [sampleRows, actionCounts] = await Promise.all([
      this.prisma.medicineImportStagingRow.findMany({
        where: { importBatchId: batchId },
        orderBy: { rowNumber: 'asc' },
        take: 50,
      }),
      this.prisma.medicineImportStagingRow.groupBy({
        by: ['action'],
        where: { importBatchId: batchId },
        _count: { _all: true },
      }),
    ]);

    return {
      batch,
      actionCounts: actionCounts.reduce((acc: Record<string, number>, row: any) => {
        acc[row.action] = row._count._all;
        return acc;
      }, {}),
      sampleRows,
    };
  }

  async commit(batchId: string, options: CommitOptions = {}) {
    const batchSize = Math.max(
      10,
      Math.min(
        options.batchSize ?? MedicineImportEngine.DEFAULT_COMMIT_BATCH_SIZE,
        MedicineImportEngine.MAX_COMMIT_BATCH_SIZE,
      ),
    );
    const batch = await this.prisma.medicineImportBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) throw new Error(`Import batch not found: ${batchId}`);
    if (!['STAGED', 'FAILED', 'COMMITTING'].includes(batch.status)) {
      throw new Error(`Import batch ${batchId} is not staged.`);
    }

    if (batch.status !== 'COMMITTING') {
      await this.prisma.medicineImportBatch.update({
        where: { id: batchId },
        data: { status: 'COMMITTING' },
      });
    }

    let committedRows = 0;
    let skippedRows = 0;
    let createdMasters = 0;
    let updatedMasters = 0;
    let createdSalts = 0;
    let reusedSalts = 0;
    let cursor: string | undefined;
    let pendingRows = await this.prisma.medicineImportStagingRow.count({
      where: {
        importBatchId: batchId,
        action: { in: ['CREATE', 'UPDATE', 'NOOP'] },
        committedAt: null,
      },
    });

    try {
      while (true) {
        const rows = await this.prisma.medicineImportStagingRow.findMany({
          where: {
            importBatchId: batchId,
            action: { in: ['CREATE', 'UPDATE', 'NOOP'] },
            committedAt: null,
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        if (!rows.length) break;
        cursor = rows[rows.length - 1].id;

        await this.prisma.$transaction(async (tx: PrismaLike) => {
          const saltSeeds = Array.from(
            new Map(
              rows
                .filter((row) => row.action !== 'NOOP' && row.saltKey)
                .map((row) => [
                  row.saltKey,
                  {
                    saltKey: row.saltKey,
                    displayName: row.saltDisplayName,
                    ingredients: row.ingredients,
                    enrichmentStatus: 'NEEDS_SOURCE' as const,
                    source: 'IMPORT' as const,
                    isVerified: false,
                  },
                ]),
            ).values(),
          );

          if (saltSeeds.length) {
            const saltCreateResult = await tx.saltProfile.createMany({
              data: saltSeeds,
              skipDuplicates: true,
            });
            createdSalts += saltCreateResult.count;
          }

          for (const row of rows) {
            if (row.action === 'NOOP') {
              skippedRows += 1;
              await tx.medicineImportStagingRow.update({
                where: { id: row.id },
                data: { committedAt: new Date() },
              });
              continue;
            }

            const existingMaster = await this.findExistingMasterForStagingRow(tx, row);

            if (existingMaster?.source === 'ADMIN' || existingMaster?.isVerified) {
              skippedRows += 1;
              await tx.medicineImportStagingRow.update({
                where: { id: row.id },
                data: {
                  action: 'NOOP',
                  committedAt: new Date(),
                  warnings: [...row.warnings, 'Skipped at commit: admin/verified record won.'],
                },
              });
              continue;
            }

            const existingPackageBeforeWrite = await this.findExistingPackageForStagingRow(
              tx,
              row,
              existingMaster,
            );

            if (
              existingMaster &&
              this.masterMatchesStagingRow(existingMaster, row) &&
              this.packageMatchesStagingRow(existingPackageBeforeWrite, row)
            ) {
              skippedRows += 1;
              await tx.medicineImportStagingRow.update({
                where: { id: row.id },
                data: {
                  action: 'NOOP',
                  committedMedicineMasterId: existingMaster.id,
                  committedPackageId: existingPackageBeforeWrite?.id,
                  committedAt: new Date(),
                  warnings: [...row.warnings, 'No-op at commit: record already matched.'],
                },
              });
              continue;
            }

            let salt = await tx.saltProfile.findUnique({
              where: { saltKey: row.saltKey },
              select: { id: true },
            });

            if (!salt) {
              throw new Error(`Salt profile could not be linked for row ${row.rowNumber}.`);
            } else {
              reusedSalts += 1;
            }

            const masterData = {
              brandName: row.brandName,
              normalizedName: row.normalizedName,
              genericName: row.genericName,
              composition: row.composition,
              salts: row.ingredients,
              manufacturer: row.manufacturer,
              strength: row.strength,
              type: row.type,
              isDiscontinued: row.isDiscontinued ?? false,
              prescriptionRequired: row.prescriptionRequired ?? undefined,
              saltProfileId: salt.id,
              source: 'IMPORT',
              isVerified: false,
            };

            const master = existingMaster
              ? await tx.medicineMaster.update({
                  where: { id: existingMaster.id },
                  data: masterData,
                })
              : row.dedupeKey
                ? await tx.medicineMaster.upsert({
                    where: { dedupeKey: row.dedupeKey },
                    update: masterData,
                    create: { ...masterData, dedupeKey: row.dedupeKey },
                  })
                : await tx.medicineMaster.create({
                    data: { ...masterData, dedupeKey: row.dedupeKey },
                  });

            if (existingMaster) updatedMasters += 1;
            else createdMasters += 1;

            let packageId: string | undefined;
            if (
              row.gtin ||
              row.packSize ||
              row.stripImageUrl ||
              row.pillImageUrl ||
              row.mrpPrice
            ) {
              const existingPackage = existingPackageBeforeWrite;

              const packageData = {
                medicineId: master.id,
                gtin: row.gtin || undefined,
                packSize: row.packSize || undefined,
                stripImageUrl: row.stripImageUrl || undefined,
                pillImageUrl: row.pillImageUrl || undefined,
                mrpPrice: row.mrpPrice ?? undefined,
                priceCurrency: row.mrpPrice ? row.priceCurrency || 'INR' : undefined,
                priceSource: row.priceSource || undefined,
                priceLastSeenAt: row.mrpPrice ? new Date() : undefined,
                source: 'IMPORT',
                isVerified: false,
              };

              if (existingPackage?.source === 'ADMIN' || existingPackage?.isVerified) {
                packageId = existingPackage.id;
              } else if (existingPackage) {
                const updatedPackage = await tx.medicinePackage.update({
                  where: { id: existingPackage.id },
                  data: packageData,
                });
                packageId = updatedPackage.id;
              } else {
                const createdPackage = await tx.medicinePackage.create({
                  data: packageData,
                });
                packageId = createdPackage.id;
              }
            }

            committedRows += 1;
            await tx.medicineImportStagingRow.update({
              where: { id: row.id },
              data: {
                committedMedicineMasterId: master.id,
                committedSaltProfileId: salt.id,
                committedPackageId: packageId,
                committedAt: new Date(),
              },
            });
          }
        }, { maxWait: 10_000, timeout: 120_000 });

        pendingRows = Math.max(0, pendingRows - rows.length);
        options.onProgress?.({
          processedRows: committedRows + skippedRows,
          committedRows,
          skippedRows,
          pendingRows,
        });
      }

      const finalCommittedRows = await this.prisma.medicineImportStagingRow.count({
        where: {
          importBatchId: batchId,
          action: { in: ['CREATE', 'UPDATE'] },
          committedAt: { not: null },
        },
      });
      const finalSkippedRows = await this.prisma.medicineImportStagingRow.count({
        where: {
          importBatchId: batchId,
          action: 'NOOP',
          committedAt: { not: null },
        },
      });

      const report = {
        committedRows: finalCommittedRows,
        skippedRows: finalSkippedRows,
        runCommittedRows: committedRows,
        runSkippedRows: skippedRows,
        createdMasters,
        updatedMasters,
        createdSalts,
        reusedSalts,
      };

      await this.prisma.medicineImportBatch.update({
        where: { id: batchId },
        data: {
          status: 'COMMITTED',
          committedRows: finalCommittedRows,
          skippedRows: finalSkippedRows,
          committedAt: new Date(),
          report,
        },
      });

      return { batchId, ...report };
    } catch (error) {
      await this.prisma.medicineImportBatch.update({
        where: { id: batchId },
        data: { status: 'FAILED', report: { error: this.errorMessage(error) } },
      });
      throw error;
    }
  }

  async discard(batchId: string) {
    return this.prisma.medicineImportBatch.update({
      where: { id: batchId },
      data: { status: 'DISCARDED' },
    });
  }

  private normalizeRow(record: Record<string, string>): NormalizedImportRow {
    const mapped: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(record)) {
      const mappedKey = HEADER_ALIASES[this.headerKey(key)];
      if (mappedKey) mapped[mappedKey] = this.emptyToUndefined(value);
    }

    const rawBrandName = mapped.brandName?.trim();
    const composition = this.compositionFromRecord(record, mapped);
    const brandName = rawBrandName ? this.cleanBrandName(rawBrandName, composition) : undefined;
    const genericName = mapped.genericName?.trim();
    const validationErrors: string[] = [];
    const warnings: string[] = [];

    if (!brandName) validationErrors.push('brandName is required.');
    if (!composition) validationErrors.push('composition/salt is required.');

    const normalized: NormalizedImportRow = {
      brandName,
      genericName,
      composition,
      manufacturer: mapped.manufacturer?.trim(),
      strength: mapped.strength?.trim(),
      type: this.inferForm(mapped.type, rawBrandName, mapped.packSize),
      isDiscontinued: this.parseBoolean(this.rawValue(record, 'Is_discontinued', 'is_discontinued')),
      prescriptionRequired: this.parseOptionalBoolean(mapped.prescriptionRequired),
      packSize: mapped.packSize?.trim(),
      gtin: mapped.gtin?.trim(),
      stripImageUrl: this.validUrlOrWarn(mapped.stripImageUrl, 'stripImageUrl', warnings),
      pillImageUrl: this.validUrlOrWarn(mapped.pillImageUrl, 'pillImageUrl', warnings),
      mrpPrice: this.parsePrice(mapped.mrpPrice, warnings),
      priceCurrency: this.normalizeCurrency(mapped.priceCurrency),
      priceSource: mapped.priceSource?.trim(),
      validationErrors,
      warnings,
    };

    if (normalized.gtin) {
      const gtinError = this.validateGtin(normalized.gtin);
      if (gtinError) validationErrors.push(gtinError);
    }

    if (brandName) {
      normalized.normalizedName = this.canonicalizer.normalizeBrand(brandName);
      normalized.dedupeKey = this.canonicalizer.buildDedupeKey({
        brandName,
        strength: normalized.strength,
        manufacturer: normalized.manufacturer,
      });
    }

    if (composition) {
      try {
        normalized.salt = this.canonicalizer.canonicalizeComposition(composition);
      } catch (error) {
        validationErrors.push(this.errorMessage(error));
      }
    }

    return normalized;
  }

  private compositionFromRecord(
    record: Record<string, string>,
    mapped: Record<string, string | undefined>,
  ) {
    const parts = [
      mapped.composition,
      this.rawValue(record, 'short_composition1', 'shortcomposition1'),
      this.rawValue(record, 'short_composition2', 'shortcomposition2'),
    ]
      .map((value) => this.emptyToUndefined(value))
      .filter(Boolean) as string[];

    if (parts.length > 0) {
      return parts.map((part) => part.trim()).join(' + ');
    }

    return mapped.genericName?.trim();
  }

  private rawValue(record: Record<string, string>, ...keys: string[]) {
    const wanted = new Set(keys.map((key) => this.headerKey(key)));

    for (const [key, value] of Object.entries(record)) {
      if (wanted.has(this.headerKey(key))) {
        return value;
      }
    }

    return undefined;
  }

  private cleanBrandName(value: string, composition?: string) {
    const knownForms = [
      'tablet',
      'tablets',
      'capsule',
      'capsules',
      'syrup',
      'suspension',
      'injection',
      'drops',
      'drop',
      'cream',
      'ointment',
      'gel',
      'lotion',
      'powder',
      'spray',
      'inhaler',
      'solution',
    ];
    const formPattern = new RegExp(`\\b(?:${knownForms.join('|')})\\b\\.?$`, 'i');
    const cleaned = value.replace(formPattern, '').replace(/\s+/g, ' ').trim();

    if (!composition) return cleaned;

    return cleaned || value.trim();
  }

  private inferForm(rawType?: string, rawName?: string, packSize?: string) {
    const source = `${rawName ?? ''} ${packSize ?? ''}`.toLowerCase();
    const datasetType = rawType?.trim().toLowerCase();

    if (datasetType && !['allopathy', 'homeopathy', 'ayurvedic'].includes(datasetType)) {
      return datasetType;
    }

    if (/\btablets?\b|\btabs?\b/.test(source)) return 'tablet';
    if (/\bcapsules?\b|\bcaps?\b/.test(source)) return 'capsule';
    if (/\bsyrup\b/.test(source)) return 'syrup';
    if (/\bsuspension\b/.test(source)) return 'suspension';
    if (/\binjections?\b|\binj\b/.test(source)) return 'injection';
    if (/\bdrops?\b/.test(source)) return 'drops';
    if (/\bcreams?\b/.test(source)) return 'cream';
    if (/\bointments?\b/.test(source)) return 'ointment';
    if (/\bgels?\b/.test(source)) return 'gel';
    if (/\blotions?\b/.test(source)) return 'lotion';
    if (/\bpowders?\b/.test(source)) return 'powder';
    if (/\bsprays?\b/.test(source)) return 'spray';
    if (/\binhalers?\b/.test(source)) return 'inhaler';
    if (/\bsolutions?\b/.test(source)) return 'solution';

    return undefined;
  }

  private parseBoolean(value?: string) {
    const normalized = value?.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  private parseOptionalBoolean(value?: string) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return undefined;
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return undefined;
  }

  private parsePrice(value: string | undefined, warnings: string[]) {
    if (!value) return undefined;

    const cleaned = value.replace(/[₹,\s]/g, '').trim();
    if (!/^\d+(?:\.\d{1,4})?$/.test(cleaned)) {
      warnings.push('price ignored: invalid decimal value.');
      return undefined;
    }

    const numeric = Number(cleaned);
    if (!Number.isFinite(numeric) || numeric < 0) {
      warnings.push('price ignored: invalid decimal value.');
      return undefined;
    }

    return numeric.toFixed(2);
  }

  private normalizeCurrency(value?: string) {
    const normalized = value?.trim().toUpperCase();
    return normalized || 'INR';
  }

  private toNormalizedJson(row: NormalizedImportRow) {
    return {
      brandName: row.brandName,
      genericName: row.genericName,
      composition: row.composition,
      manufacturer: row.manufacturer,
      strength: row.strength,
      type: row.type,
      isDiscontinued: row.isDiscontinued,
      prescriptionRequired: row.prescriptionRequired,
      packSize: row.packSize,
      gtin: row.gtin,
      mrpPrice: row.mrpPrice,
      priceCurrency: row.priceCurrency,
      priceSource: row.priceSource,
      saltKey: row.salt?.saltKey,
      saltDisplayName: row.salt?.displayName,
      ingredients: row.salt?.ingredients,
      dedupeKey: row.dedupeKey,
    };
  }

  private importIdentityKey(row: NormalizedImportRow) {
    if (!row.brandName || !row.salt?.saltKey) return row.dedupeKey;

    return this.canonicalizer.buildEquivalentIdentityKey({
      brandName: row.brandName,
      saltKey: row.salt.saltKey,
      manufacturer: row.manufacturer,
    });
  }

  private async flushStaging(buffer: any[]) {
    if (!buffer.length) return;
    const rows = buffer.splice(0, buffer.length);
    await this.prisma.medicineImportStagingRow.createMany({ data: rows });
  }

  private async *readCsvObjects(filePath: string) {
    let headers: string[] | null = null;
    let rowNumber = 0;

    for await (const row of this.readCsvRows(filePath)) {
      if (!headers) {
        headers = row.map((value) => value.trim());
        continue;
      }

      if (row.every((value) => value.trim() === '')) continue;
      rowNumber += 1;

      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? '';
      });

      yield { rowNumber, record };
    }
  }

  private async *readCsvRows(filePath: string): AsyncGenerator<string[]> {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for await (const chunk of stream) {
      for (let index = 0; index < chunk.length; index += 1) {
        const char = chunk[index];
        const next = chunk[index + 1];

        if (char === '"') {
          if (inQuotes && next === '"') {
            field += '"';
            index += 1;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }

        if (char === ',' && !inQuotes) {
          row.push(field);
          field = '';
          continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
          if (char === '\r' && next === '\n') index += 1;
          row.push(field);
          yield row;
          row = [];
          field = '';
          continue;
        }

        field += char;
      }
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      yield row;
    }
  }

  private headerKey(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private emptyToUndefined(value?: string) {
    const trimmed = value?.replace(/^\uFEFF/, '').trim();
    return trimmed ? trimmed : undefined;
  }

  private validUrlOrWarn(value: string | undefined, field: string, warnings: string[]) {
    if (!value) return undefined;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        warnings.push(`${field} ignored: URL must be http or https.`);
        return undefined;
      }
      return value;
    } catch {
      warnings.push(`${field} ignored: invalid URL syntax.`);
      return undefined;
    }
  }

  private validateGtin(value: string) {
    if (value.startsWith('0000-TEST-')) {
      return 'Test GTINs cannot be imported.';
    }

    if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) {
      return 'GTIN must be 8, 12, 13, or 14 digits.';
    }

    return this.hasValidGtinChecksum(value) ? null : 'GTIN checksum is invalid.';
  }

  private hasValidGtinChecksum(value: string) {
    const digits = value.split('').map(Number);
    const check = digits.pop();
    let sum = 0;
    digits.reverse().forEach((digit, index) => {
      sum += digit * (index % 2 === 0 ? 3 : 1);
    });
    const calculated = (10 - (sum % 10)) % 10;
    return calculated === check;
  }

  private assertCsv(filePath: string) {
    if (!filePath.toLowerCase().endsWith('.csv')) {
      throw new Error('Only streaming CSV import is supported here. XLSX needs a separate parser path.');
    }
  }

  private async findExistingMasterForNormalizedRow(
    client: PrismaLike,
    row: NormalizedImportRow,
  ) {
    if (!row.dedupeKey) return null;

    const exact = await client.medicineMaster.findUnique({
      where: { dedupeKey: row.dedupeKey },
      include: {
        saltProfile: { select: { saltKey: true } },
        packages: true,
      },
    });

    if (exact && !exact.isArchived) return exact;
    if (exact?.mergedIntoId) {
      return client.medicineMaster.findFirst({
        where: { id: exact.mergedIntoId, isArchived: false },
        include: {
          saltProfile: { select: { saltKey: true } },
          packages: true,
        },
      });
    }

    if (!row.normalizedName || !row.salt?.saltKey) return null;

    const candidates = await client.medicineMaster.findMany({
      where: {
        isArchived: false,
        normalizedName: row.normalizedName,
        saltProfile: { is: { saltKey: row.salt.saltKey } },
      },
      include: {
        saltProfile: { select: { saltKey: true } },
        packages: true,
      },
      take: 25,
    });

    return this.pickEquivalentMaster(candidates, {
      brandName: row.brandName,
      saltKey: row.salt.saltKey,
      manufacturer: row.manufacturer,
    });
  }

  private async findExistingMasterForStagingRow(tx: PrismaLike, row: any) {
    if (!row.dedupeKey) return null;

    const exact = await tx.medicineMaster.findUnique({
      where: { dedupeKey: row.dedupeKey },
      include: {
        saltProfile: { select: { saltKey: true } },
        packages: true,
      },
    });

    if (exact && !exact.isArchived) return exact;
    if (exact?.mergedIntoId) {
      return tx.medicineMaster.findFirst({
        where: { id: exact.mergedIntoId, isArchived: false },
        include: {
          saltProfile: { select: { saltKey: true } },
          packages: true,
        },
      });
    }

    const candidates = await tx.medicineMaster.findMany({
      where: {
        isArchived: false,
        normalizedName: row.normalizedName,
        saltProfile: { is: { saltKey: row.saltKey } },
      },
      include: {
        saltProfile: { select: { saltKey: true } },
        packages: true,
      },
      take: 25,
    });

    return this.pickEquivalentMaster(candidates, {
      brandName: row.brandName,
      saltKey: row.saltKey,
      manufacturer: row.manufacturer,
    });
  }

  private pickEquivalentMaster(
    candidates: any[],
    target: { brandName?: string | null; saltKey?: string | null; manufacturer?: string | null },
  ) {
    const targetKey = this.canonicalizer.buildEquivalentIdentityKey(target);
    const matches = candidates.filter(
      (candidate) =>
        this.canonicalizer.buildEquivalentIdentityKey({
          brandName: candidate.brandName,
          saltKey: candidate.saltProfile?.saltKey,
          manufacturer: candidate.manufacturer,
        }) === targetKey,
    );

    return matches.sort((left, right) => {
      const leftRank = this.masterCompletenessRank(left);
      const rightRank = this.masterCompletenessRank(right);
      return rightRank - leftRank;
    })[0] ?? null;
  }

  private masterCompletenessRank(master: any) {
    return (
      (master.source === 'ADMIN' ? 100 : 0) +
      (master.isVerified ? 50 : 0) +
      ((master.packages ?? []).length > 0 ? 10 : 0) +
      ((master.packages ?? []).some((pack: any) => pack.stripImageUrl || pack.pillImageUrl)
        ? 5
        : 0)
    );
  }

  private async findExistingPackageForNormalizedRow(
    row: NormalizedImportRow,
    existingMaster?: any,
  ) {
    if (!row.gtin && !row.packSize && !row.stripImageUrl && !row.pillImageUrl && !row.mrpPrice) {
      return null;
    }

    if (row.gtin) {
      return this.prisma.medicinePackage.findUnique({
        where: { gtin: row.gtin },
      });
    }

    if (!row.packSize) return null;

    const candidates = existingMaster?.id
      ? await this.prisma.medicinePackage.findMany({
          where: { medicineId: existingMaster.id },
        })
      : [];
    const targetPack = this.canonicalizer.normalizePackSize(row.packSize);

    return (
      candidates.find(
        (pack: any) => this.canonicalizer.normalizePackSize(pack.packSize) === targetPack,
      ) ?? null
    );
  }

  private async findExistingPackageForStagingRow(
    tx: PrismaLike,
    row: any,
    existingMaster?: any,
  ) {
    if (!row.gtin && !row.packSize && !row.stripImageUrl && !row.pillImageUrl && !row.mrpPrice) {
      return null;
    }

    if (row.gtin) {
      return tx.medicinePackage.findUnique({ where: { gtin: row.gtin } });
    }

    if (!existingMaster?.id || !row.packSize) return null;

    const candidates = await tx.medicinePackage.findMany({
      where: { medicineId: existingMaster.id },
    });
    const targetPack = this.canonicalizer.normalizePackSize(row.packSize);

    return (
      candidates.find(
        (pack: any) => this.canonicalizer.normalizePackSize(pack.packSize) === targetPack,
      ) ?? null
    );
  }

  private masterMatchesNormalizedRow(master: any, row: NormalizedImportRow) {
    if (
      row.prescriptionRequired !== undefined &&
      master.prescriptionRequired !== row.prescriptionRequired
    ) {
      return false;
    }

    return this.same(
      this.canonicalizer.buildEquivalentIdentityKey({
        brandName: master.brandName,
        saltKey: master.saltProfile?.saltKey,
        manufacturer: master.manufacturer,
      }),
      this.canonicalizer.buildEquivalentIdentityKey({
        brandName: row.brandName,
        saltKey: row.salt?.saltKey,
        manufacturer: row.manufacturer,
      }),
    );
  }

  private masterMatchesStagingRow(master: any, row: any) {
    if (
      row.prescriptionRequired !== null &&
      row.prescriptionRequired !== undefined &&
      master.prescriptionRequired !== row.prescriptionRequired
    ) {
      return false;
    }

    return this.same(
      this.canonicalizer.buildEquivalentIdentityKey({
        brandName: master.brandName,
        saltKey: master.saltProfile?.saltKey,
        manufacturer: master.manufacturer,
      }),
      this.canonicalizer.buildEquivalentIdentityKey({
        brandName: row.brandName,
        saltKey: row.saltKey,
        manufacturer: row.manufacturer,
      }),
    );
  }

  private packageMatchesNormalizedRow(pack: any, row: NormalizedImportRow) {
    if (!row.gtin && !row.packSize && !row.stripImageUrl && !row.pillImageUrl && !row.mrpPrice) {
      return true;
    }

    if (!pack) return false;

    return this.packageMatchesValues(pack, row);
  }

  private packageMatchesStagingRow(pack: any, row: any) {
    if (!row.gtin && !row.packSize && !row.stripImageUrl && !row.pillImageUrl && !row.mrpPrice) {
      return true;
    }

    if (!pack) return false;

    return this.packageMatchesValues(pack, row);
  }

  private packageMatchesValues(pack: any, row: any) {
    if (row.gtin && !this.same(pack.gtin, row.gtin)) return false;

    if (
      row.packSize &&
      !this.same(
        this.canonicalizer.normalizePackSize(pack.packSize),
        this.canonicalizer.normalizePackSize(row.packSize),
      )
    ) {
      return false;
    }

    if (row.stripImageUrl && !this.same(pack.stripImageUrl, row.stripImageUrl)) {
      return false;
    }

    if (row.pillImageUrl && !this.same(pack.pillImageUrl, row.pillImageUrl)) {
      return false;
    }

    if (row.mrpPrice && !this.samePrice(pack.mrpPrice, row.mrpPrice)) {
      return false;
    }

    return true;
  }

  private same(left: unknown, right: unknown) {
    return String(left ?? '').trim() === String(right ?? '').trim();
  }

  private samePrice(left: unknown, right: unknown) {
    const normalize = (value: unknown) => {
      if (value === null || value === undefined || value === '') return '';
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric.toFixed(2) : String(value).trim();
    };

    return normalize(left) === normalize(right);
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
