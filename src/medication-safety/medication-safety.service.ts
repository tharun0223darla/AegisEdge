import { createHash } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AllergyClinicalStatus,
  AuditAction,
  CarePermission,
  CareRelationshipStatus,
  MedicationSafetyFindingStatus,
  MedicationSafetyRule,
  MedicationSafetySeverity,
  Prisma,
  SafetyRecordSource,
  SafetyVerificationStatus,
} from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { SaltCanonicalizer } from '../medicines/import/salt-canonicalizer';
import {
  AcknowledgeSafetyFindingDto,
  CreateAllergyDto,
  UpdateAllergyDto,
  UpdateSafetyProfileDto,
} from './dto/medication-safety.dto';

interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
}

interface IngredientEvidence {
  key: string;
  display: string;
  source: 'SALT_PROFILE' | 'MASTER_COMPOSITION';
}

export interface SafetyCandidate {
  fingerprint: string;
  rule: MedicationSafetyRule;
  severity: MedicationSafetySeverity;
  title: string;
  summary: string;
  ingredientKeys: string[];
  medicineIds: string[];
  evidence: Prisma.InputJsonValue;
  sourceRefs: Prisma.InputJsonValue;
}

export type EvaluatedMedicine = {
  id: string;
  name: string;
  strength: string | null;
  form: string;
  medicineMasterId: string | null;
  medicinePackageId: string | null;
  medicineMaster: {
    id: string;
    brandName: string;
    genericName: string | null;
    composition: string | null;
    salts: Prisma.JsonValue | null;
    saltProfile: {
      id: string;
      saltKey: string;
      displayName: string;
      ingredients: Prisma.JsonValue;
    } | null;
  } | null;
  schedules: Array<{
    id: string;
    frequency: string;
    timesOfDay: string[];
    daysOfWeek: number[];
    startDate: Date;
    endDate: Date | null;
  }>;
};

export type EvaluatedAllergy = Prisma.AllergyIntoleranceGetPayload<{
  include: { saltProfile: { select: { ingredients: true } } };
}>;

type FindingWithMedicines = Prisma.MedicationSafetyFindingGetPayload<{
  include: { medicines: { include: { medicine: true } } };
}>;

@Injectable()
export class MedicationSafetyService {
  private readonly logger = new Logger(MedicationSafetyService.name);
  private readonly canonicalizer = new SaltCanonicalizer();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getProfile(userId: string) {
    return this.prisma.patientSafetyProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async updateProfile(
    userId: string,
    dto: UpdateSafetyProfileDto,
    auditContext: AuditContext = {},
  ) {
    const profile = await this.prisma.patientSafetyProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...dto,
        source: SafetyRecordSource.PATIENT_REPORTED,
        verificationStatus: SafetyVerificationStatus.UNVERIFIED,
        lastReviewedAt: new Date(),
      },
      update: {
        ...dto,
        source: SafetyRecordSource.PATIENT_REPORTED,
        verificationStatus: SafetyVerificationStatus.UNVERIFIED,
        lastReviewedAt: new Date(),
      },
    });
    await this.auditLogs.log({
      userId,
      action: AuditAction.SAFETY_PROFILE_UPDATED,
      entityType: 'PatientSafetyProfile',
      entityId: profile.id,
      newValues: {
        pregnancyStatus: profile.pregnancyStatus,
        kidneyCondition: profile.kidneyCondition,
        liverCondition: profile.liverCondition,
        verificationStatus: profile.verificationStatus,
      },
      ...auditContext,
    });
    return profile;
  }

  listAllergies(userId: string) {
    return this.prisma.allergyIntolerance.findMany({
      where: {
        userId,
        clinicalStatus: { not: AllergyClinicalStatus.ENTERED_IN_ERROR },
      },
      include: {
        saltProfile: { select: { id: true, saltKey: true, displayName: true } },
      },
      orderBy: [{ clinicalStatus: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createAllergy(
    userId: string,
    dto: CreateAllergyDto,
    auditContext: AuditContext = {},
  ) {
    const substanceRaw = dto.substance.trim();
    const normalizedSubstance = this.normalizeIngredient(substanceRaw);
    await this.assertSaltProfile(dto.saltProfileId);

    const existing = await this.prisma.allergyIntolerance.findFirst({
      where: {
        userId,
        normalizedSubstance,
        clinicalStatus: AllergyClinicalStatus.ACTIVE,
      },
    });
    if (existing) {
      throw new ConflictException(
        'This active allergy or intolerance is already recorded.',
      );
    }

    const allergy = await this.prisma.allergyIntolerance.create({
      data: {
        userId,
        saltProfileId: dto.saltProfileId,
        substanceRaw,
        normalizedSubstance,
        category: dto.category,
        criticality: dto.criticality,
        reaction: this.optionalText(dto.reaction),
        source: SafetyRecordSource.PATIENT_REPORTED,
        verificationStatus: SafetyVerificationStatus.UNVERIFIED,
      },
      include: {
        saltProfile: { select: { id: true, saltKey: true, displayName: true } },
      },
    });
    await this.auditLogs.log({
      userId,
      action: AuditAction.ALLERGY_RECORDED,
      entityType: 'AllergyIntolerance',
      entityId: allergy.id,
      newValues: {
        substance: allergy.substanceRaw,
        category: allergy.category,
        verificationStatus: allergy.verificationStatus,
      },
      ...auditContext,
    });
    await this.evaluateUser(userId);
    return allergy;
  }

  async updateAllergy(
    userId: string,
    id: string,
    dto: UpdateAllergyDto,
    auditContext: AuditContext = {},
  ) {
    const existing = await this.ownedAllergy(userId, id);
    await this.assertSaltProfile(dto.saltProfileId);
    const substanceRaw = dto.substance?.trim() ?? existing.substanceRaw;
    const normalizedSubstance = this.normalizeIngredient(substanceRaw);

    const duplicate = await this.prisma.allergyIntolerance.findFirst({
      where: {
        id: { not: id },
        userId,
        normalizedSubstance,
        clinicalStatus: AllergyClinicalStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (
      duplicate &&
      dto.clinicalStatus !== AllergyClinicalStatus.ENTERED_IN_ERROR
    ) {
      throw new ConflictException(
        'This active allergy or intolerance is already recorded.',
      );
    }

    const allergy = await this.prisma.allergyIntolerance.update({
      where: { id },
      data: {
        ...(dto.substance !== undefined
          ? { substanceRaw, normalizedSubstance }
          : {}),
        ...(dto.saltProfileId !== undefined
          ? { saltProfileId: dto.saltProfileId || null }
          : {}),
        category: dto.category,
        criticality: dto.criticality,
        reaction:
          dto.reaction !== undefined
            ? this.optionalText(dto.reaction)
            : undefined,
        clinicalStatus: dto.clinicalStatus,
        source: SafetyRecordSource.PATIENT_REPORTED,
        verificationStatus: SafetyVerificationStatus.UNVERIFIED,
        verifiedAt: null,
      },
      include: {
        saltProfile: { select: { id: true, saltKey: true, displayName: true } },
      },
    });
    await this.auditLogs.log({
      userId,
      action: AuditAction.ALLERGY_UPDATED,
      entityType: 'AllergyIntolerance',
      entityId: allergy.id,
      oldValues: {
        substance: existing.substanceRaw,
        clinicalStatus: existing.clinicalStatus,
      },
      newValues: {
        substance: allergy.substanceRaw,
        clinicalStatus: allergy.clinicalStatus,
        verificationStatus: allergy.verificationStatus,
      },
      ...auditContext,
    });
    await this.evaluateUser(userId);
    return allergy;
  }

  async removeAllergy(
    userId: string,
    id: string,
    auditContext: AuditContext = {},
  ) {
    const existing = await this.ownedAllergy(userId, id);
    const allergy = await this.prisma.allergyIntolerance.update({
      where: { id },
      data: {
        clinicalStatus: AllergyClinicalStatus.ENTERED_IN_ERROR,
        verificationStatus: SafetyVerificationStatus.ENTERED_IN_ERROR,
      },
    });
    await this.auditLogs.log({
      userId,
      action: AuditAction.ALLERGY_REMOVED,
      entityType: 'AllergyIntolerance',
      entityId: id,
      oldValues: { substance: existing.substanceRaw },
      newValues: { clinicalStatus: allergy.clinicalStatus },
      ...auditContext,
    });
    await this.evaluateUser(userId);
    return { id, removed: true };
  }

  async getOverview(userId: string, auditContext: AuditContext = {}) {
    await this.evaluateUser(userId);
    const result = await this.readOverview(userId);
    await this.auditLogs.log({
      userId,
      action: AuditAction.MEDICATION_SAFETY_REVIEWED,
      entityType: 'MedicationSafetyOverview',
      newValues: { openFindings: result.summary.open },
      ...auditContext,
    });
    return result;
  }

  async reconcile(userId: string, auditContext: AuditContext = {}) {
    const evaluated = await this.evaluateUser(userId);
    const result = await this.readOverview(userId);
    await this.auditLogs.log({
      userId,
      action: AuditAction.MEDICATION_SAFETY_REVIEWED,
      entityType: 'MedicationSafetyReconciliation',
      newValues: evaluated,
      ...auditContext,
    });
    return result;
  }

  async getCaregiverOverview(
    caregiverId: string,
    patientId: string,
    auditContext: AuditContext = {},
  ) {
    const now = new Date();
    const relationship = await this.prisma.careRelationship.findFirst({
      where: {
        caregiverId,
        patientId,
        status: CareRelationshipStatus.ACTIVE,
        permissions: { has: CarePermission.VIEW_MEDICATION_SAFETY },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (!relationship) {
      throw new ForbiddenException(
        'Medication safety access was not shared or has expired.',
      );
    }
    await this.evaluateUser(patientId);
    const result = await this.readOverview(patientId);
    await this.auditLogs.log({
      userId: caregiverId,
      action: AuditAction.CAREGIVER_DATA_ACCESSED,
      entityType: 'MedicationSafetyOverview',
      entityId: patientId,
      newValues: {
        relationshipId: relationship.id,
        permission: CarePermission.VIEW_MEDICATION_SAFETY,
      },
      ...auditContext,
    });
    return {
      ...result,
      allergies: result.allergies.map((allergy) => ({
        id: allergy.id,
        substanceRaw: allergy.substanceRaw,
        category: allergy.category,
        criticality: allergy.criticality,
        clinicalStatus: allergy.clinicalStatus,
        verificationStatus: allergy.verificationStatus,
      })),
      readOnly: true,
    };
  }

  async acknowledgeFinding(
    userId: string,
    id: string,
    dto: AcknowledgeSafetyFindingDto,
    auditContext: AuditContext = {},
  ) {
    const finding = await this.prisma.medicationSafetyFinding.findFirst({
      where: { id, userId },
    });
    if (!finding) throw new NotFoundException('Safety finding not found.');
    if (finding.status === MedicationSafetyFindingStatus.RESOLVED) {
      throw new ConflictException('This safety finding is already resolved.');
    }
    const updated = await this.prisma.medicationSafetyFinding.update({
      where: { id },
      data: {
        status: MedicationSafetyFindingStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        resolutionReason: this.optionalText(dto.note),
      },
      include: { medicines: { include: { medicine: true } } },
    });
    await this.auditLogs.log({
      userId,
      action: AuditAction.SAFETY_FINDING_ACKNOWLEDGED,
      entityType: 'MedicationSafetyFinding',
      entityId: id,
      newValues: {
        rule: finding.rule,
        noteProvided: Boolean(dto.note?.trim()),
      },
      ...auditContext,
    });
    return this.mapFinding(updated);
  }

  async evaluateUser(userId: string) {
    const [medicines, allergies] = await Promise.all([
      this.prisma.medicine.findMany({
        where: { userId, isActive: true },
        select: {
          id: true,
          name: true,
          strength: true,
          form: true,
          medicineMasterId: true,
          medicinePackageId: true,
          medicineMaster: {
            select: {
              id: true,
              brandName: true,
              genericName: true,
              composition: true,
              salts: true,
              saltProfile: {
                select: {
                  id: true,
                  saltKey: true,
                  displayName: true,
                  ingredients: true,
                },
              },
            },
          },
          schedules: {
            where: { isActive: true },
            select: {
              id: true,
              frequency: true,
              timesOfDay: true,
              daysOfWeek: true,
              startDate: true,
              endDate: true,
            },
          },
        },
      }),
      this.prisma.allergyIntolerance.findMany({
        where: { userId, clinicalStatus: AllergyClinicalStatus.ACTIVE },
        include: { saltProfile: { select: { ingredients: true } } },
      }),
    ]);

    const candidates = this.buildCandidates(userId, medicines, allergies);
    await this.persistCandidates(userId, candidates);
    return {
      evaluatedMedicines: medicines.length,
      evaluatedAllergies: allergies.length,
      detectedFindings: candidates.length,
    };
  }

  private async readOverview(userId: string) {
    const [profile, allergies, findings, medicines] = await Promise.all([
      this.getProfile(userId),
      this.listAllergies(userId),
      this.prisma.medicationSafetyFinding.findMany({
        where: {
          userId,
          status: {
            in: [
              MedicationSafetyFindingStatus.OPEN,
              MedicationSafetyFindingStatus.ACKNOWLEDGED,
            ],
          },
        },
        include: { medicines: { include: { medicine: true } } },
        orderBy: [{ severity: 'desc' }, { lastDetectedAt: 'desc' }],
      }),
      this.prisma.medicine.findMany({
        where: { userId, isActive: true },
        select: {
          id: true,
          name: true,
          genericName: true,
          strength: true,
          form: true,
          medicineMasterId: true,
          schedules: { where: { isActive: true }, select: { id: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      profile,
      allergies,
      findings: findings.map((finding) => this.mapFinding(finding)),
      medicines,
      summary: {
        activeMedicines: medicines.length,
        activeAllergies: allergies.filter(
          (item) => item.clinicalStatus === AllergyClinicalStatus.ACTIVE,
        ).length,
        open: findings.filter(
          (item) => item.status === MedicationSafetyFindingStatus.OPEN,
        ).length,
        acknowledged: findings.filter(
          (item) => item.status === MedicationSafetyFindingStatus.ACKNOWLEDGED,
        ).length,
        high: findings.filter(
          (item) => item.severity === MedicationSafetySeverity.HIGH,
        ).length,
      },
      evaluatedAt: new Date().toISOString(),
      disclaimer:
        'This review compares saved identities, ingredients, allergies, and schedules. It does not diagnose, replace a pharmacist or clinician, or tell you to stop or change a medicine.',
    };
  }

  buildCandidates(
    userId: string,
    medicines: EvaluatedMedicine[],
    allergies: EvaluatedAllergy[],
  ) {
    const candidates: SafetyCandidate[] = [];
    const ingredientsByMedicine = new Map<string, IngredientEvidence[]>();
    for (const medicine of medicines) {
      const ingredients = this.ingredientsForMedicine(medicine);
      ingredientsByMedicine.set(medicine.id, ingredients);
      if (!ingredients.length) {
        candidates.push(
          this.candidate(
            userId,
            MedicationSafetyRule.UNKNOWN_COMPOSITION,
            MedicationSafetySeverity.INFO,
            'Composition needs confirmation',
            `${medicine.name} has no reliable ingredient identity yet. Confirm the package or composition before relying on automated safety checks.`,
            [],
            [medicine.id],
            { medicineId: medicine.id, medicineName: medicine.name },
          ),
        );
      }
    }

    const exactGroups = new Map<string, EvaluatedMedicine[]>();
    for (const medicine of medicines) {
      const key = medicine.medicineMasterId
        ? `master:${medicine.medicineMasterId}`
        : `manual:${this.normalizeIdentity(`${medicine.name}|${medicine.strength ?? ''}|${medicine.form}`)}`;
      exactGroups.set(key, [...(exactGroups.get(key) ?? []), medicine]);
    }
    for (const group of exactGroups.values()) {
      if (group.length < 2) continue;
      const ids = group.map((item) => item.id).sort();
      candidates.push(
        this.candidate(
          userId,
          MedicationSafetyRule.EXACT_DUPLICATE,
          MedicationSafetySeverity.WARNING,
          'Possible duplicate medicine record',
          `${group[0].name} appears more than once in your active medicine list. Confirm whether these entries represent the same treatment or different packs.`,
          [],
          ids,
          {
            medicineIds: ids,
            matchedBy: group[0].medicineMasterId
              ? 'MEDICINE_MASTER'
              : 'EXACT_MANUAL_IDENTITY',
          },
        ),
      );
    }

    const byIngredient = new Map<string, EvaluatedMedicine[]>();
    const ingredientDisplay = new Map<string, string>();
    for (const medicine of medicines) {
      for (const ingredient of ingredientsByMedicine.get(medicine.id) ?? []) {
        ingredientDisplay.set(ingredient.key, ingredient.display);
        byIngredient.set(ingredient.key, [
          ...(byIngredient.get(ingredient.key) ?? []),
          medicine,
        ]);
      }
    }
    for (const [ingredientKey, rawGroup] of byIngredient) {
      const group = this.uniqueBy(rawGroup, (item) => item.id);
      if (group.length < 2) continue;
      const masterIds = new Set(
        group.map((item) => item.medicineMasterId).filter(Boolean),
      );
      if (masterIds.size === 1 && group.every((item) => item.medicineMasterId))
        continue;
      const ids = group.map((item) => item.id).sort();
      const display = ingredientDisplay.get(ingredientKey) ?? ingredientKey;
      candidates.push(
        this.candidate(
          userId,
          MedicationSafetyRule.DUPLICATE_INGREDIENT,
          MedicationSafetySeverity.WARNING,
          'Same active ingredient appears in multiple medicines',
          `${display} appears in ${group.map((item) => item.name).join(' and ')}. This may be intentional; confirm the combined plan with a pharmacist or clinician.`,
          [ingredientKey],
          ids,
          { medicineIds: ids, ingredient: ingredientKey },
        ),
      );

      for (let left = 0; left < group.length; left += 1) {
        for (let right = left + 1; right < group.length; right += 1) {
          const overlap = this.overlappingSchedules(group[left], group[right]);
          if (!overlap.length) continue;
          const pairIds = [group[left].id, group[right].id].sort();
          candidates.push(
            this.candidate(
              userId,
              MedicationSafetyRule.OVERLAPPING_SCHEDULE,
              MedicationSafetySeverity.WARNING,
              'Overlapping schedule for the same ingredient',
              `${group[left].name} and ${group[right].name} share ${display} and have overlapping saved times. Confirm the schedule before taking either medicine.`,
              [ingredientKey],
              pairIds,
              {
                medicineIds: pairIds,
                ingredient: ingredientKey,
                overlaps: overlap,
              },
            ),
          );
        }
      }
    }

    for (const allergy of allergies) {
      const allergyKeys = this.ingredientsForAllergy(allergy);
      for (const medicine of medicines) {
        const matches = (ingredientsByMedicine.get(medicine.id) ?? []).filter(
          (ingredient) => allergyKeys.has(ingredient.key),
        );
        if (!matches.length) continue;
        candidates.push(
          this.candidate(
            userId,
            MedicationSafetyRule.ALLERGY_CONFLICT,
            MedicationSafetySeverity.HIGH,
            'Saved ingredient matches a recorded allergy',
            `${medicine.name} contains ${matches.map((item) => item.display).join(', ')}, which exactly matches your recorded ${allergy.category.toLowerCase()}. Do not make treatment changes here; contact a pharmacist or clinician promptly to verify.`,
            matches.map((item) => item.key),
            [medicine.id],
            {
              medicineId: medicine.id,
              allergyId: allergy.id,
              allergyVerificationStatus: allergy.verificationStatus,
              exactIngredientMatch: true,
            },
          ),
        );
      }
    }

    return this.uniqueBy(candidates, (candidate) => candidate.fingerprint);
  }

  private candidate(
    userId: string,
    rule: MedicationSafetyRule,
    severity: MedicationSafetySeverity,
    title: string,
    summary: string,
    ingredientKeys: string[],
    medicineIds: string[],
    evidence: Prisma.InputJsonValue,
  ): SafetyCandidate {
    const stable = [
      rule,
      ...[...medicineIds].sort(),
      ...[...ingredientKeys].sort(),
    ];
    if (typeof evidence === 'object' && evidence && 'allergyId' in evidence) {
      stable.push(String((evidence as Record<string, unknown>).allergyId));
    }
    return {
      fingerprint: createHash('sha256')
        .update(`${userId}:${stable.join(':')}`)
        .digest('hex'),
      rule,
      severity,
      title,
      summary,
      ingredientKeys: [...new Set(ingredientKeys)].sort(),
      medicineIds: [...new Set(medicineIds)].sort(),
      evidence,
      sourceRefs: [
        {
          sourceType: 'SAVED_MEDICINE_IDENTITY',
          rule,
          evaluatedFields: [
            'medicineMaster',
            'saltProfile',
            'allergy',
            'schedule',
          ],
        },
      ],
    };
  }

  private async persistCandidates(
    userId: string,
    candidates: SafetyCandidate[],
  ) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const fingerprints = candidates.map((item) => item.fingerprint);
      const existing = await tx.medicationSafetyFinding.findMany({
        where: { userId, fingerprint: { in: fingerprints } },
        select: { fingerprint: true, status: true },
      });
      const statusByFingerprint = new Map(
        existing.map((item) => [item.fingerprint, item.status]),
      );

      for (const candidate of candidates) {
        const priorStatus = statusByFingerprint.get(candidate.fingerprint);
        const nextStatus =
          priorStatus === MedicationSafetyFindingStatus.RESOLVED
            ? MedicationSafetyFindingStatus.OPEN
            : priorStatus;
        const finding = await tx.medicationSafetyFinding.upsert({
          where: { fingerprint: candidate.fingerprint },
          create: {
            userId,
            fingerprint: candidate.fingerprint,
            rule: candidate.rule,
            severity: candidate.severity,
            title: candidate.title,
            summary: candidate.summary,
            triggerIngredients: candidate.ingredientKeys,
            evidence: candidate.evidence,
            sourceRefs: candidate.sourceRefs,
            firstDetectedAt: now,
            lastDetectedAt: now,
          },
          update: {
            severity: candidate.severity,
            title: candidate.title,
            summary: candidate.summary,
            triggerIngredients: candidate.ingredientKeys,
            evidence: candidate.evidence,
            sourceRefs: candidate.sourceRefs,
            lastDetectedAt: now,
            ...(nextStatus
              ? {
                  status: nextStatus,
                  ...(nextStatus === MedicationSafetyFindingStatus.OPEN
                    ? { resolvedAt: null, resolutionReason: null }
                    : {}),
                }
              : {}),
          },
        });
        await tx.medicationSafetyFindingMedicine.deleteMany({
          where: { findingId: finding.id },
        });
        if (candidate.medicineIds.length) {
          await tx.medicationSafetyFindingMedicine.createMany({
            data: candidate.medicineIds.map((medicineId) => ({
              findingId: finding.id,
              medicineId,
            })),
            skipDuplicates: true,
          });
        }
      }

      await tx.medicationSafetyFinding.updateMany({
        where: {
          userId,
          status: {
            in: [
              MedicationSafetyFindingStatus.OPEN,
              MedicationSafetyFindingStatus.ACKNOWLEDGED,
            ],
          },
          ...(fingerprints.length
            ? { fingerprint: { notIn: fingerprints } }
            : {}),
        },
        data: {
          status: MedicationSafetyFindingStatus.RESOLVED,
          resolvedAt: now,
          resolutionReason: 'NO_LONGER_DETECTED',
        },
      });
    });
  }

  private ingredientsForMedicine(medicine: EvaluatedMedicine) {
    const profileIngredients =
      medicine.medicineMaster?.saltProfile?.ingredients;
    const fromProfile = this.ingredientsFromJson(
      profileIngredients,
      'SALT_PROFILE',
    );
    if (fromProfile.length) return fromProfile;

    const master = medicine.medicineMaster;
    const fromSalts = this.ingredientsFromJson(
      master?.salts,
      'MASTER_COMPOSITION',
    );
    if (fromSalts.length) return fromSalts;

    for (const value of [master?.composition, master?.genericName]) {
      if (!value?.trim()) continue;
      const parsed = this.ingredientsFromText(value, 'MASTER_COMPOSITION');
      if (parsed.length) return parsed;
    }
    return [];
  }

  private ingredientsForAllergy(allergy: EvaluatedAllergy) {
    const profile = this.ingredientsFromJson(
      allergy.saltProfile?.ingredients,
      'SALT_PROFILE',
    );
    return new Set(
      profile.length
        ? profile.map((item) => item.key)
        : [
            this.normalizeIngredient(
              allergy.normalizedSubstance || allergy.substanceRaw,
            ),
          ],
    );
  }

  private ingredientsFromJson(
    value: Prisma.JsonValue | null | undefined,
    source: IngredientEvidence['source'],
  ) {
    if (!Array.isArray(value)) return [];
    const results: IngredientEvidence[] = [];
    for (const item of value) {
      let raw = '';
      if (typeof item === 'string') {
        raw = item;
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const record = item;
        const candidate = record.ingredient ?? record.name ?? record.raw;
        raw = typeof candidate === 'string' ? candidate : '';
      }
      if (!raw.trim()) continue;
      results.push(...this.ingredientsFromText(raw, source));
    }
    return this.uniqueBy(results, (item) => item.key);
  }

  private ingredientsFromText(
    value: string,
    source: IngredientEvidence['source'],
  ) {
    try {
      return this.canonicalizer
        .canonicalizeComposition(value)
        .ingredients.map((ingredient) => ({
          key: this.normalizeIdentity(ingredient.ingredient),
          display: this.titleCase(ingredient.ingredient),
          source,
        }))
        .filter((item) => item.key.length >= 2);
    } catch {
      return [];
    }
  }

  private overlappingSchedules(
    left: EvaluatedMedicine,
    right: EvaluatedMedicine,
  ) {
    const overlaps: Array<{
      time: string;
      leftScheduleId: string;
      rightScheduleId: string;
    }> = [];
    for (const leftSchedule of left.schedules) {
      if (leftSchedule.frequency === 'AS_NEEDED') continue;
      for (const rightSchedule of right.schedules) {
        if (rightSchedule.frequency === 'AS_NEEDED') continue;
        if (!this.dateRangesOverlap(leftSchedule, rightSchedule)) continue;
        if (
          !this.daysOverlap(leftSchedule.daysOfWeek, rightSchedule.daysOfWeek)
        )
          continue;
        const rightTimes = new Set(
          rightSchedule.timesOfDay.map((time) => this.normalizeTime(time)),
        );
        for (const time of leftSchedule.timesOfDay.map((value) =>
          this.normalizeTime(value),
        )) {
          if (!rightTimes.has(time)) continue;
          overlaps.push({
            time,
            leftScheduleId: leftSchedule.id,
            rightScheduleId: rightSchedule.id,
          });
        }
      }
    }
    return this.uniqueBy(
      overlaps,
      (item) => `${item.leftScheduleId}:${item.rightScheduleId}:${item.time}`,
    );
  }

  private dateRangesOverlap(
    left: { startDate: Date; endDate: Date | null },
    right: { startDate: Date; endDate: Date | null },
  ) {
    const leftEnd = left.endDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightEnd = right.endDate?.getTime() ?? Number.POSITIVE_INFINITY;
    return (
      left.startDate.getTime() <= rightEnd &&
      right.startDate.getTime() <= leftEnd
    );
  }

  private daysOverlap(left: number[], right: number[]) {
    const leftDays = left.length ? left : [0, 1, 2, 3, 4, 5, 6];
    const rightDays = new Set(right.length ? right : [0, 1, 2, 3, 4, 5, 6]);
    return leftDays.some((day) => rightDays.has(day));
  }

  private normalizeTime(value: string) {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return value.trim();
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }

  private normalizeIngredient(value: string) {
    const parsed = this.ingredientsFromText(value, 'MASTER_COMPOSITION');
    return parsed[0]?.key ?? this.normalizeIdentity(value);
  }

  private normalizeIdentity(value: string) {
    return value
      .toLowerCase()
      .replace(/\bh\.?c\.?l\.?\b/g, ' hydrochloride ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private titleCase(value: string) {
    return value
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private async assertSaltProfile(id?: string) {
    if (!id) return;
    const profile = await this.prisma.saltProfile.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Salt profile not found.');
  }

  private async ownedAllergy(userId: string, id: string) {
    const allergy = await this.prisma.allergyIntolerance.findFirst({
      where: { id, userId },
    });
    if (!allergy)
      throw new NotFoundException('Allergy or intolerance not found.');
    return allergy;
  }

  private mapFinding(finding: FindingWithMedicines) {
    return {
      id: finding.id,
      rule: finding.rule,
      severity: finding.severity,
      status: finding.status,
      title: finding.title,
      summary: finding.summary,
      triggerIngredients: finding.triggerIngredients,
      evidence: finding.evidence,
      sourceRefs: finding.sourceRefs,
      firstDetectedAt: finding.firstDetectedAt,
      lastDetectedAt: finding.lastDetectedAt,
      acknowledgedAt: finding.acknowledgedAt,
      medicines: finding.medicines.map((link) => ({
        id: link.medicine.id,
        name: link.medicine.name,
        strength: link.medicine.strength,
        form: link.medicine.form,
      })),
    };
  }

  private optionalText(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private uniqueBy<T>(items: T[], key: (item: T) => string) {
    return [...new Map(items.map((item) => [key(item), item])).values()];
  }
}
