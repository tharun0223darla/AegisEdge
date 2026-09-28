import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllergyClinicalStatus,
  DoctorReportSection,
  DoseStatus,
  MedicationSafetyFindingStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ComposeDoctorReportDto } from './dto/doctor-report.dto';
import {
  DOCTOR_REPORT_SECTIONS,
  type DoctorReportSnapshot,
} from './doctor-report.types';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const MAX_MEDICINES = 200;
const MAX_DOSE_LOGS = 20_000;
const MAX_ALLERGIES = 100;
const MAX_SAFETY_FINDINGS = 100;
const MAX_VITALS = 5_000;
const MAX_TEXT_LENGTH = 2_000;

type MedicationRows = Awaited<
  ReturnType<DoctorReportComposerService['loadMedications']>
>;
type DoseLogRows = Awaited<
  ReturnType<DoctorReportComposerService['loadDoseLogs']>
>;
type AllergyRows = Awaited<
  ReturnType<DoctorReportComposerService['loadAllergies']>
>;
type SafetyFindingRows = Awaited<
  ReturnType<DoctorReportComposerService['loadSafetyFindings']>
>;
type RefillRows = Awaited<
  ReturnType<DoctorReportComposerService['loadRefills']>
>;
type VitalRows = Awaited<ReturnType<DoctorReportComposerService['loadVitals']>>;

@Injectable()
export class DoctorReportComposerService {
  constructor(private readonly prisma: PrismaService) {}

  async compose(userId: string, dto: ComposeDoctorReportDto) {
    const range = this.normalizeRange(dto.startDate, dto.endDate);
    const sections = this.normalizeSections(dto.sections);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: {
        email: true,
        patientProfile: {
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            bloodGroup: true,
            conditions: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Patient account not found');

    const [
      medications,
      doseLogs,
      allergies,
      findings,
      refillMedicines,
      vitals,
    ] = await Promise.all([
      sections.includes(DoctorReportSection.MEDICATIONS)
        ? this.loadMedications(userId)
        : Promise.resolve([] as MedicationRows),
      sections.includes(DoctorReportSection.ADHERENCE)
        ? this.loadDoseLogs(userId, range.start, range.end)
        : Promise.resolve([] as DoseLogRows),
      sections.includes(DoctorReportSection.ALLERGIES)
        ? this.loadAllergies(userId)
        : Promise.resolve([] as AllergyRows),
      sections.includes(DoctorReportSection.SAFETY)
        ? this.loadSafetyFindings(userId)
        : Promise.resolve([] as SafetyFindingRows),
      sections.includes(DoctorReportSection.REFILLS)
        ? this.loadRefills(userId)
        : Promise.resolve([] as RefillRows),
      sections.includes(DoctorReportSection.VITALS)
        ? this.loadVitals(userId, range.start, range.end)
        : Promise.resolve([] as VitalRows),
    ]);

    const profile = user.patientProfile;
    const snapshot: DoctorReportSnapshot = {
      version: 1,
      generatedAt: new Date().toISOString(),
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      sections,
      patient: {
        displayName: profile
          ? this.cleanText(`${profile.firstName} ${profile.lastName}`, 120)
          : user.email
            ? this.cleanText(user.email, 254)
            : 'Patient',
        contactEmail: user.email ? this.cleanText(user.email, 254) : null,
        dateOfBirth: profile?.dateOfBirth?.toISOString() ?? null,
        bloodGroup: profile?.bloodGroup ?? null,
        conditions: (profile?.conditions ?? [])
          .slice(0, 50)
          .map((value) => this.cleanText(value, 120)),
      },
      ...(sections.includes(DoctorReportSection.MEDICATIONS)
        ? { medications: this.composeMedications(medications) }
        : {}),
      ...(sections.includes(DoctorReportSection.ADHERENCE)
        ? { adherence: this.composeAdherence(doseLogs) }
        : {}),
      ...(sections.includes(DoctorReportSection.ALLERGIES)
        ? { allergies: this.composeAllergies(allergies) }
        : {}),
      ...(sections.includes(DoctorReportSection.SAFETY)
        ? { safety: this.composeSafety(findings) }
        : {}),
      ...(sections.includes(DoctorReportSection.REFILLS)
        ? { refills: this.composeRefills(refillMedicines) }
        : {}),
      ...(sections.includes(DoctorReportSection.VITALS)
        ? { vitals: this.composeVitals(vitals) }
        : {}),
      limitations: [
        'This snapshot contains only information saved in MediTrack at the generation time.',
        'Missing or unverified data is shown as unavailable; it is not inferred.',
        'Raw prescription, bill, and package images are not included.',
      ],
      disclaimer:
        'This report supports a clinician conversation. It is not a diagnosis, prescription, emergency service, or instruction to change treatment.',
    };

    return {
      title:
        dto.title?.trim() ||
        `Doctor visit report - ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date())}`,
      snapshot,
    };
  }

  private normalizeRange(startValue: string, endValue: string) {
    const start = this.startOfUtcDay(startValue);
    const end = this.endOfUtcDay(endValue);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      throw new BadRequestException('Choose a valid report date range.');
    }
    if (start > end) {
      throw new BadRequestException('Start date must be before end date.');
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(
        `Report date range cannot exceed ${MAX_RANGE_DAYS} days.`,
      );
    }
    if (start.getTime() > Date.now() + DAY_MS) {
      throw new BadRequestException(
        'Report start date cannot be in the future.',
      );
    }
    return { start, end };
  }

  private normalizeSections(sections: DoctorReportSection[]) {
    const selected = new Set(sections);
    return DOCTOR_REPORT_SECTIONS.filter((section) => selected.has(section));
  }

  loadMedications(userId: string) {
    return this.prisma.medicine.findMany({
      where: { userId, isActive: true },
      take: MAX_MEDICINES + 1,
      orderBy: { name: 'asc' },
      select: {
        name: true,
        genericName: true,
        form: true,
        strength: true,
        instructions: true,
        updatedAt: true,
        medicineMaster: { select: { composition: true } },
        schedules: {
          where: { isActive: true },
          orderBy: { startDate: 'asc' },
          select: {
            frequency: true,
            timesOfDay: true,
            daysOfWeek: true,
            dosesPerIntake: true,
            unit: true,
            startDate: true,
            endDate: true,
            timezone: true,
          },
        },
      },
    });
  }

  loadDoseLogs(userId: string, start: Date, end: Date) {
    return this.prisma.doseLog.findMany({
      where: { userId, scheduledAt: { gte: start, lte: end } },
      take: MAX_DOSE_LOGS + 1,
      orderBy: { scheduledAt: 'asc' },
      select: {
        status: true,
        updatedAt: true,
        medicine: { select: { name: true } },
      },
    });
  }

  loadAllergies(userId: string) {
    return this.prisma.allergyIntolerance.findMany({
      where: { userId, clinicalStatus: AllergyClinicalStatus.ACTIVE },
      take: MAX_ALLERGIES + 1,
      orderBy: { substanceRaw: 'asc' },
      select: {
        substanceRaw: true,
        category: true,
        criticality: true,
        reaction: true,
        verificationStatus: true,
        source: true,
        updatedAt: true,
      },
    });
  }

  loadSafetyFindings(userId: string) {
    return this.prisma.medicationSafetyFinding.findMany({
      where: {
        userId,
        status: {
          in: [
            MedicationSafetyFindingStatus.OPEN,
            MedicationSafetyFindingStatus.ACKNOWLEDGED,
          ],
        },
      },
      take: MAX_SAFETY_FINDINGS + 1,
      orderBy: [{ severity: 'desc' }, { lastDetectedAt: 'desc' }],
      select: {
        severity: true,
        status: true,
        title: true,
        summary: true,
        lastDetectedAt: true,
        medicines: { select: { medicine: { select: { name: true } } } },
      },
    });
  }

  loadRefills(userId: string) {
    return this.prisma.medicine.findMany({
      where: { userId, isActive: true },
      take: MAX_MEDICINES + 1,
      orderBy: { name: 'asc' },
      select: {
        name: true,
        strength: true,
        unit: true,
        remainingQuantity: true,
        refillThreshold: true,
        updatedAt: true,
        refillLogs: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            expectedFinishDate: true,
            refillReminderDate: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  loadVitals(userId: string, start: Date, end: Date) {
    return this.prisma.healthMetric.findMany({
      where: { userId, recordedAt: { gte: start, lte: end } },
      take: MAX_VITALS + 1,
      orderBy: { recordedAt: 'desc' },
      select: {
        metricType: true,
        value: true,
        unit: true,
        recordedAt: true,
        receivedAt: true,
        source: true,
        quality: true,
        qualityFlags: true,
      },
    });
  }

  private composeMedications(rows: MedicationRows) {
    const items = rows.slice(0, MAX_MEDICINES).map((medicine) => ({
      name: this.cleanText(medicine.name, 160),
      genericName: this.optionalText(medicine.genericName, 240),
      composition: this.optionalText(medicine.medicineMaster?.composition, 500),
      form: medicine.form,
      strength: this.optionalText(medicine.strength, 80),
      instructions: this.optionalText(medicine.instructions, MAX_TEXT_LENGTH),
      schedules: medicine.schedules.slice(0, 20).map((schedule) => ({
        frequency: schedule.frequency,
        timesOfDay: schedule.timesOfDay.slice(0, 12),
        daysOfWeek: schedule.daysOfWeek.slice(0, 7),
        dosesPerIntake: schedule.dosesPerIntake,
        unit: this.cleanText(schedule.unit, 40),
        startDate: schedule.startDate.toISOString(),
        endDate: schedule.endDate?.toISOString() ?? null,
        timezone: this.cleanText(schedule.timezone, 80),
      })),
      lastUpdatedAt: medicine.updatedAt.toISOString(),
    }));
    return {
      items,
      total: items.length,
      truncated: rows.length > MAX_MEDICINES,
      lastUpdatedAt: this.latestIso(rows.map((item) => item.updatedAt)),
    };
  }

  private composeAdherence(rows: DoseLogRows) {
    const limited = rows.slice(0, MAX_DOSE_LOGS);
    const counts = this.statusCounts(limited.map((row) => row.status));
    const grouped = new Map<string, DoseStatus[]>();
    for (const row of limited) {
      const statuses = grouped.get(row.medicine.name) ?? [];
      statuses.push(row.status);
      grouped.set(row.medicine.name, statuses);
    }
    const byMedicine = [...grouped.entries()].map(([name, statuses]) => {
      const item = this.statusCounts(statuses);
      return {
        name: this.cleanText(name, 160),
        taken: item.taken,
        missed: item.missed,
        skipped: item.skipped,
        recordedDoses: item.recordedDoses,
        adherencePercent: item.adherencePercent,
      };
    });
    return {
      totalScheduled: limited.length,
      ...counts,
      byMedicine,
      truncated: rows.length > MAX_DOSE_LOGS,
      methodology:
        'Adherence is taken doses divided by taken, missed, and skipped doses. Pending and snoozed doses are reported separately and excluded from the percentage.',
      lastUpdatedAt: this.latestIso(limited.map((item) => item.updatedAt)),
    };
  }

  private composeAllergies(rows: AllergyRows) {
    const items = rows.slice(0, MAX_ALLERGIES).map((item) => ({
      substance: this.cleanText(item.substanceRaw, 200),
      category: item.category,
      criticality: item.criticality,
      reaction: this.optionalText(item.reaction, 500),
      verificationStatus: item.verificationStatus,
      source: item.source,
      lastUpdatedAt: item.updatedAt.toISOString(),
    }));
    return {
      items,
      total: items.length,
      truncated: rows.length > MAX_ALLERGIES,
      lastUpdatedAt: this.latestIso(rows.map((item) => item.updatedAt)),
    };
  }

  private composeSafety(rows: SafetyFindingRows) {
    const items = rows.slice(0, MAX_SAFETY_FINDINGS).map((item) => ({
      severity: item.severity,
      status: item.status,
      title: this.cleanText(item.title, 200),
      summary: this.cleanText(item.summary, MAX_TEXT_LENGTH),
      medicines: item.medicines
        .slice(0, 20)
        .map((link) => this.cleanText(link.medicine.name, 160)),
      lastDetectedAt: item.lastDetectedAt.toISOString(),
    }));
    return {
      items,
      total: items.length,
      truncated: rows.length > MAX_SAFETY_FINDINGS,
      lastUpdatedAt: this.latestIso(rows.map((item) => item.lastDetectedAt)),
      disclaimer:
        'Safety findings are deterministic prompts to review saved records. They do not diagnose an interaction or replace a pharmacist or clinician.',
    };
  }

  private composeRefills(rows: RefillRows) {
    const items = rows.slice(0, MAX_MEDICINES).map((medicine) => {
      const latest = medicine.refillLogs[0];
      const threshold = medicine.refillThreshold;
      const remaining = medicine.remainingQuantity;
      const status =
        remaining === null
          ? ('UNKNOWN' as const)
          : remaining <= 0
            ? ('OUT' as const)
            : threshold !== null && remaining <= threshold
              ? ('LOW' as const)
              : ('ADEQUATE' as const);
      const updatedAt =
        latest?.updatedAt && latest.updatedAt > medicine.updatedAt
          ? latest.updatedAt
          : medicine.updatedAt;
      return {
        medicineName: this.cleanText(medicine.name, 160),
        strength: this.optionalText(medicine.strength, 80),
        remainingQuantity: remaining,
        unit: this.optionalText(medicine.unit, 40),
        refillThreshold: threshold,
        status,
        expectedFinishDate: latest?.expectedFinishDate.toISOString() ?? null,
        refillReminderDate: latest?.refillReminderDate.toISOString() ?? null,
        lastUpdatedAt: updatedAt.toISOString(),
      };
    });
    return {
      items,
      total: items.length,
      truncated: rows.length > MAX_MEDICINES,
      lastUpdatedAt: this.latestIso(
        items.map((item) => new Date(item.lastUpdatedAt)),
      ),
    };
  }

  private composeVitals(rows: VitalRows) {
    const items = rows.slice(0, MAX_VITALS).map((item) => ({
      metricType: item.metricType,
      value: item.value,
      unit: this.cleanText(item.unit, 30),
      recordedAt: item.recordedAt.toISOString(),
      receivedAt: item.receivedAt.toISOString(),
      source: item.source,
      quality: item.quality,
      qualityFlags: item.qualityFlags.slice(0, 20),
    }));
    return {
      items,
      total: items.length,
      truncated: rows.length > MAX_VITALS,
      lastUpdatedAt: this.latestIso(rows.map((item) => item.receivedAt)),
      disclaimer:
        'Device and patient-entered readings may be incomplete or inaccurate. Quality and source are preserved for clinician review; no diagnosis is inferred.',
    };
  }

  private statusCounts(statuses: DoseStatus[]) {
    const count = (status: DoseStatus) =>
      statuses.filter((item) => item === status).length;
    const taken = count(DoseStatus.TAKEN);
    const missed = count(DoseStatus.MISSED);
    const skipped = count(DoseStatus.SKIPPED);
    const recordedDoses = taken + missed + skipped;
    return {
      taken,
      missed,
      skipped,
      snoozed: count(DoseStatus.SNOOZED),
      pending: count(DoseStatus.PENDING),
      recordedDoses,
      adherencePercent:
        recordedDoses > 0
          ? Math.round((taken / recordedDoses) * 10_000) / 100
          : null,
    };
  }

  private startOfUtcDay(value: string) {
    const date = new Date(value);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  private endOfUtcDay(value: string) {
    const date = new Date(value);
    date.setUTCHours(23, 59, 59, 999);
    return date;
  }

  private latestIso(values: Date[]) {
    if (!values.length) return null;
    return new Date(
      Math.max(...values.map((value) => value.getTime())),
    ).toISOString();
  }

  private optionalText(value: string | null | undefined, limit: number) {
    return value?.trim() ? this.cleanText(value, limit) : null;
  }

  private cleanText(value: string, limit: number) {
    return value.replace(/\s+/g, ' ').trim().slice(0, limit);
  }
}
