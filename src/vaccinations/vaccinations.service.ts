import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VACCINE_CATALOG } from './vaccine-catalog.data';
import { CURATED_VACCINATION_CENTERS } from './vaccination-centers.data';
import {
  FamilyMemberProfile,
  VaccinationCenter,
  VaccinationPassport,
  VaccinationRecord,
  VaccinationStatus,
  VaccineAppointment,
  VaccineCatalogItem,
} from './vaccination.types';
import {
  AddCustomVaccineDto,
  BookVaccineAppointmentDto,
  FindNearbyCentersDto,
  GetVaccineDirectoryDto,
  GetVaccineScheduleDto,
  RecordVaccineAdministeredDto,
  TriggerVaccineReminderDto,
  UpdateVaccineRecordDto,
} from './dto/vaccination.dto';

@Injectable()
export class VaccinationsService {
  private readonly logger = new Logger(VaccinationsService.name);

  // In-memory data stores for vaccination records and appointments
  private readonly recordsStore = new Map<string, VaccinationRecord[]>();
  private readonly appointmentsStore = new Map<string, VaccineAppointment[]>();

  private readonly OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Default Family Profiles (Aligned with MediNexus Prototype) ───
  public getDefaultFamilyProfiles(userId = 'default-user'): FamilyMemberProfile[] {
    return [
      {
        id: 'mem-self',
        name: 'Rajesh Kumar',
        relationship: 'Self',
        dateOfBirth: '1988-04-15', // 38y
        gender: 'MALE',
        bloodGroup: 'O+',
        allergies: ['Penicillin'],
        preExistingConditions: ['Mild Hypertension'],
      },
      {
        id: 'mem-spouse',
        name: 'Priya Kumar',
        relationship: 'Spouse',
        dateOfBirth: '1991-08-22', // 35y
        gender: 'FEMALE',
        bloodGroup: 'A+',
        allergies: [],
        preExistingConditions: ['Hypothyroidism'],
      },
      {
        id: 'mem-child',
        name: 'Ananya Kumar',
        relationship: 'Child',
        dateOfBirth: '2018-06-10', // 8y
        gender: 'FEMALE',
        bloodGroup: 'O+',
        allergies: ['Dust'],
        preExistingConditions: [],
      },
      {
        id: 'mem-father',
        name: 'Srinivas Kumar',
        relationship: 'Father',
        dateOfBirth: '1958-11-03', // 68y
        gender: 'MALE',
        bloodGroup: 'B+',
        allergies: ['Sulfa drugs'],
        preExistingConditions: ['Cardiovascular Disease', 'Type 2 Diabetes'],
      },
    ];
  }

  // ── Initialize Default Records for a User / Family ─────────────
  private ensureUserRecords(userId: string): VaccinationRecord[] {
    if (this.recordsStore.has(userId) && this.recordsStore.get(userId)!.length > 0) {
      return this.recordsStore.get(userId)!;
    }

    const initialRecords: VaccinationRecord[] = [
      // ── Ananya Kumar (Child, 8y) ──
      {
        id: 'rec-ananya-bcg',
        userId,
        memberId: 'mem-child',
        memberName: 'Ananya Kumar',
        vaccineId: 'vac-bcg',
        vaccineName: 'BCG (Bacillus Calmette-Guérin)',
        vaccineCode: 'BCG',
        doseNumber: 1,
        totalDoses: 1,
        targetAgeMonths: 0,
        dueDate: '2018-06-10',
        status: 'COMPLETED',
        administeredDate: '2018-06-11',
        administeredBy: 'Dr. S. Kulkarni, MD (Pediatrics)',
        clinicOrCenterName: 'Cloudnine Maternity & Pediatric Hospital',
        centerLocation: 'Jayanagar, Bengaluru',
        batchNumber: 'BCG-2018-8472',
        brandName: 'Serum Institute BCG',
        certificateHash: 'sha256-bcg-992a188f',
        reminderEnabled: false,
        reminderDaysBefore: [7, 1],
        isCustom: false,
        createdAt: '2018-06-11T10:00:00Z',
        updatedAt: '2018-06-11T10:00:00Z',
      },
      {
        id: 'rec-ananya-penta1',
        userId,
        memberId: 'mem-child',
        memberName: 'Ananya Kumar',
        vaccineId: 'vac-penta-1',
        vaccineName: 'Pentavalent 1 (DTP-HepB-Hib)',
        vaccineCode: 'Penta-1',
        doseNumber: 1,
        totalDoses: 3,
        targetAgeMonths: 1.5,
        dueDate: '2018-07-22',
        status: 'COMPLETED',
        administeredDate: '2018-07-25',
        administeredBy: 'Dr. S. Kulkarni',
        clinicOrCenterName: 'Cloudnine Hospital',
        batchNumber: 'PNT-77491-A',
        brandName: 'Pentavac PFS',
        reminderEnabled: false,
        reminderDaysBefore: [7, 1],
        isCustom: false,
        createdAt: '2018-07-25T10:00:00Z',
        updatedAt: '2018-07-25T10:00:00Z',
      },
      {
        id: 'rec-ananya-mmr1',
        userId,
        memberId: 'mem-child',
        memberName: 'Ananya Kumar',
        vaccineId: 'vac-mmr-1',
        vaccineName: 'MR / MMR Vaccine (Dose 1)',
        vaccineCode: 'MMR-1',
        doseNumber: 1,
        totalDoses: 2,
        targetAgeMonths: 9,
        dueDate: '2019-03-10',
        status: 'COMPLETED',
        administeredDate: '2019-03-15',
        administeredBy: 'Dr. Neha Verma',
        clinicOrCenterName: 'Rainbow Children’s Hospital',
        batchNumber: 'MMR-9938-X',
        brandName: 'Tresivac MMR',
        reminderEnabled: false,
        reminderDaysBefore: [7, 1],
        isCustom: false,
        createdAt: '2019-03-15T11:00:00Z',
        updatedAt: '2019-03-15T11:00:00Z',
      },
      {
        id: 'rec-ananya-dtp-b2',
        userId,
        memberId: 'mem-child',
        memberName: 'Ananya Kumar',
        vaccineId: 'vac-dtp-booster-2',
        vaccineName: 'DTP Booster 2 (School Entry)',
        vaccineCode: 'DTP-B2',
        doseNumber: 5,
        totalDoses: 5,
        targetAgeMonths: 60,
        dueDate: '2023-06-10',
        status: 'COMPLETED',
        administeredDate: '2023-06-18',
        administeredBy: 'Dr. Kapoor',
        clinicOrCenterName: 'Koramangala Pediatric Health Centre',
        batchNumber: 'DTP-B2-0199',
        reminderEnabled: false,
        reminderDaysBefore: [7, 1],
        isCustom: false,
        createdAt: '2023-06-18T09:30:00Z',
        updatedAt: '2023-06-18T09:30:00Z',
      },
      {
        id: 'rec-ananya-hpv1',
        userId,
        memberId: 'mem-child',
        memberName: 'Ananya Kumar',
        vaccineId: 'vac-hpv-9',
        vaccineName: 'HPV Vaccine (Human Papillomavirus 9-Valent)',
        vaccineCode: 'HPV-9',
        doseNumber: 1,
        totalDoses: 2,
        targetAgeMonths: 108, // 9y
        dueDate: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0], // Due soon
        status: 'DUE_SOON',
        clinicOrCenterName: 'Rainbow Children’s Hospital or BBMP UPHC',
        reminderEnabled: true,
        reminderDaysBefore: [14, 7, 1],
        notes: 'Target age 9 years approaching. Recommended before onset of adolescence.',
        isCustom: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'rec-ananya-tdap1',
        userId,
        memberId: 'mem-child',
        memberName: 'Ananya Kumar',
        vaccineId: 'vac-tdap-adolescent',
        vaccineName: 'Tdap / Td Booster (Age 10 Booster)',
        vaccineCode: 'Tdap-10',
        doseNumber: 1,
        totalDoses: 2,
        targetAgeMonths: 120, // 10y
        dueDate: new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
        status: 'UPCOMING',
        reminderEnabled: true,
        reminderDaysBefore: [30, 7],
        isCustom: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },

      // ── Rajesh Kumar (Self, 38y) ──
      {
        id: 'rec-rajesh-covid',
        userId,
        memberId: 'mem-self',
        memberName: 'Rajesh Kumar',
        vaccineId: 'vac-covid-booster',
        vaccineName: 'COVID-19 XBB / JN.1 Updated Booster',
        vaccineCode: 'COVID-BOOST',
        doseNumber: 1,
        totalDoses: 1,
        targetAgeMonths: 420,
        dueDate: '2025-10-15',
        status: 'COMPLETED',
        administeredDate: '2025-10-20',
        administeredBy: 'Dr. Rao',
        clinicOrCenterName: 'Manipal Hospital Immunization Clinic',
        batchNumber: 'COV-JN1-7788',
        brandName: 'Corbevax',
        certificateHash: 'sha256-cov-88194a',
        reminderEnabled: false,
        reminderDaysBefore: [7],
        isCustom: false,
        createdAt: '2025-10-20T14:00:00Z',
        updatedAt: '2025-10-20T14:00:00Z',
      },
      {
        id: 'rec-rajesh-flu',
        userId,
        memberId: 'mem-self',
        memberName: 'Rajesh Kumar',
        vaccineId: 'vac-flu-annual',
        vaccineName: 'Influenza Vaccine (Quadrivalent Annual Flu Shot)',
        vaccineCode: 'FLU-ANNUAL',
        doseNumber: 1,
        totalDoses: 1,
        targetAgeMonths: 456,
        dueDate: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0], // Due soon
        status: 'DUE_SOON',
        clinicOrCenterName: 'Manipal Hospital or Apollo Clinic',
        reminderEnabled: true,
        reminderDaysBefore: [7, 1],
        notes: 'Annual booster ahead of winter monsoon respiratory season.',
        isCustom: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },

      // ── Priya Kumar (Spouse, 35y) ──
      {
        id: 'rec-priya-flu',
        userId,
        memberId: 'mem-spouse',
        memberName: 'Priya Kumar',
        vaccineId: 'vac-flu-annual',
        vaccineName: 'Influenza Vaccine (Quadrivalent Annual Flu Shot)',
        vaccineCode: 'FLU-ANNUAL',
        doseNumber: 1,
        totalDoses: 1,
        targetAgeMonths: 420,
        dueDate: new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0], // Overdue
        status: 'OVERDUE',
        clinicOrCenterName: 'Cloudnine Clinic',
        reminderEnabled: true,
        reminderDaysBefore: [7, 1],
        notes: 'Overdue annual flu immunization. Strongly recommended for thyroid metabolic resilience.',
        isCustom: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },

      // ── Srinivas Kumar (Father, 68y) ──
      {
        id: 'rec-srinivas-pcv20',
        userId,
        memberId: 'mem-father',
        memberName: 'Srinivas Kumar',
        vaccineId: 'vac-pcv20-senior',
        vaccineName: 'Pneumococcal 20-Valent (Adult & Senior)',
        vaccineCode: 'PCV20-SR',
        doseNumber: 1,
        totalDoses: 1,
        targetAgeMonths: 800,
        dueDate: '2025-08-14',
        status: 'COMPLETED',
        administeredDate: '2025-08-20',
        administeredBy: 'Dr. Rao (Cardiologist)',
        clinicOrCenterName: 'Apollo Hospitals Preventive Center',
        batchNumber: 'PCV20-SR-9938',
        brandName: 'Prevnar 20',
        certificateHash: 'sha256-pcv20-sr-7718',
        reminderEnabled: false,
        reminderDaysBefore: [7],
        isCustom: false,
        createdAt: '2025-08-20T10:00:00Z',
        updatedAt: '2025-08-20T10:00:00Z',
      },
      {
        id: 'rec-srinivas-shingles',
        userId,
        memberId: 'mem-father',
        memberName: 'Srinivas Kumar',
        vaccineId: 'vac-shingles',
        vaccineName: 'Recombinant Zoster (Shingles Vaccine - Shingrix Dose 1)',
        vaccineCode: 'RZV-SHINGRIX',
        doseNumber: 1,
        totalDoses: 2,
        targetAgeMonths: 816,
        dueDate: new Date(Date.now() + 20 * 86400000).toISOString().split('T')[0],
        status: 'DUE_SOON',
        clinicOrCenterName: 'Apollo Hospitals or Manipal Hospital',
        reminderEnabled: true,
        reminderDaysBefore: [14, 7, 1],
        notes: 'Prevents excruciating shingles neuropathy and post-herpetic neuralgia.',
        isCustom: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    this.recordsStore.set(userId, initialRecords);
    return initialRecords;
  }

  // ── 1. Vaccine Directory / Encyclopedia ──────────────────────
  public getVaccineDirectory(dto: GetVaccineDirectoryDto): VaccineCatalogItem[] {
    let result = [...VACCINE_CATALOG];

    if (dto.category && dto.category !== 'ALL') {
      result = result.filter((item) => item.category === dto.category);
    }

    if (dto.isMandatoryOnly) {
      result = result.filter((item) => item.isMandatory);
    }

    if (dto.isUipFreeOnly) {
      result = result.filter((item) => item.isUipGovernmentFree);
    }

    if (dto.search && dto.search.trim()) {
      const q = dto.search.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q) ||
          item.shortDescription.toLowerCase().includes(q) ||
          item.diseasePrevented.some((d) => d.toLowerCase().includes(q)),
      );
    }

    return result;
  }

  public getVaccineDetailsById(vaccineId: string): VaccineCatalogItem {
    const item = VACCINE_CATALOG.find((v) => v.id === vaccineId || v.code.toLowerCase() === vaccineId.toLowerCase());
    if (!item) {
      throw new NotFoundException(`Vaccine with identifier '${vaccineId}' not found in catalog.`);
    }
    return item;
  }

  // ── 2. User / Family Immunization Schedule & Records ─────────
  public getVaccinationSchedule(userId: string, dto: GetVaccineScheduleDto) {
    const allRecords = this.ensureUserRecords(userId);
    const profiles = this.getDefaultFamilyProfiles(userId);

    let filtered = [...allRecords];

    if (dto.memberId && dto.memberId !== 'ALL') {
      filtered = filtered.filter((r) => r.memberId === dto.memberId);
    }

    if (dto.status && dto.status !== 'ALL') {
      filtered = filtered.filter((r) => r.status === dto.status);
    }

    // Sort by Due Date ascending
    filtered.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

    const totalScheduled = filtered.length;
    const completedCount = filtered.filter((r) => r.status === 'COMPLETED').length;
    const dueSoonCount = filtered.filter((r) => r.status === 'DUE_SOON').length;
    const overdueCount = filtered.filter((r) => r.status === 'OVERDUE').length;
    const upcomingCount = filtered.filter((r) => r.status === 'UPCOMING').length;

    const completionPercentage = totalScheduled > 0 ? Math.round((completedCount / totalScheduled) * 100) : 0;

    return {
      familyProfiles: profiles,
      activeMemberId: dto.memberId || 'ALL',
      summary: {
        totalScheduled,
        completedCount,
        dueSoonCount,
        overdueCount,
        upcomingCount,
        completionPercentage,
      },
      records: filtered,
    };
  }

  // ── 3. Record Administered Vaccine ───────────────────────────
  public recordVaccineAdministered(userId: string, dto: RecordVaccineAdministeredDto): VaccinationRecord {
    const userRecords = this.ensureUserRecords(userId);
    const vaccine = VACCINE_CATALOG.find((v) => v.id === dto.vaccineId || v.code === dto.vaccineId);

    const existingIndex = userRecords.findIndex(
      (r) =>
        r.memberId === (dto.memberId || 'mem-self') &&
        (r.vaccineId === dto.vaccineId || r.vaccineCode === vaccine?.code) &&
        r.doseNumber === dto.doseNumber,
    );

    const certHash = `sha256-${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();

    if (existingIndex >= 0) {
      const updated: VaccinationRecord = {
        ...userRecords[existingIndex],
        status: 'COMPLETED',
        administeredDate: dto.administeredDate,
        administeredBy: dto.administeredBy || 'Authorized Medical Officer',
        clinicOrCenterName: dto.clinicOrCenterName || 'Primary Health Center',
        centerLocation: dto.centerLocation || 'City Center',
        batchNumber: dto.batchNumber || `BATCH-${Math.floor(100000 + Math.random() * 900000)}`,
        brandName: dto.brandName || vaccine?.manufacturerBrands?.[0] || 'Standard Formulation',
        adverseReactions: dto.adverseReactions,
        notes: dto.notes,
        certificateUrl: dto.certificateUrl,
        certificateHash: certHash,
        updatedAt: now,
      };
      userRecords[existingIndex] = updated;
      this.recordsStore.set(userId, userRecords);
      return updated;
    }

    const newRecord: VaccinationRecord = {
      id: `rec-${uuidv4().slice(0, 8)}`,
      userId,
      memberId: dto.memberId || 'mem-self',
      memberName: dto.memberName || 'Self',
      vaccineId: dto.vaccineId,
      vaccineName: vaccine?.name || dto.vaccineId,
      vaccineCode: vaccine?.code || 'CUSTOM',
      doseNumber: dto.doseNumber,
      totalDoses: vaccine?.totalDosesInSeries || 1,
      targetAgeMonths: vaccine?.recommendedAgeMonthsMin || 0,
      dueDate: dto.administeredDate,
      status: 'COMPLETED',
      administeredDate: dto.administeredDate,
      administeredBy: dto.administeredBy || 'Authorized Medical Officer',
      clinicOrCenterName: dto.clinicOrCenterName || 'Primary Health Center',
      centerLocation: dto.centerLocation,
      batchNumber: dto.batchNumber || `BATCH-${Math.floor(100000 + Math.random() * 900000)}`,
      brandName: dto.brandName || vaccine?.manufacturerBrands?.[0] || 'Standard Formulation',
      adverseReactions: dto.adverseReactions,
      notes: dto.notes,
      certificateUrl: dto.certificateUrl,
      certificateHash: certHash,
      reminderEnabled: false,
      reminderDaysBefore: [7],
      isCustom: !vaccine,
      createdAt: now,
      updatedAt: now,
    };

    userRecords.push(newRecord);
    this.recordsStore.set(userId, userRecords);
    return newRecord;
  }

  // ── 4. Update Existing Record ────────────────────────────────
  public updateVaccineRecord(userId: string, recordId: string, dto: UpdateVaccineRecordDto): VaccinationRecord {
    const userRecords = this.ensureUserRecords(userId);
    const index = userRecords.findIndex((r) => r.id === recordId);

    if (index === -1) {
      throw new NotFoundException(`Vaccination record with ID '${recordId}' not found.`);
    }

    const current = userRecords[index];
    const updated: VaccinationRecord = {
      ...current,
      status: (dto.status as VaccinationStatus) ?? current.status,
      administeredDate: dto.administeredDate ?? current.administeredDate,
      administeredBy: dto.administeredBy ?? current.administeredBy,
      clinicOrCenterName: dto.clinicOrCenterName ?? current.clinicOrCenterName,
      batchNumber: dto.batchNumber ?? current.batchNumber,
      brandName: dto.brandName ?? current.brandName,
      adverseReactions: dto.adverseReactions ?? current.adverseReactions,
      notes: dto.notes ?? current.notes,
      reminderEnabled: dto.reminderEnabled ?? current.reminderEnabled,
      reminderDaysBefore: dto.reminderDaysBefore ?? current.reminderDaysBefore,
      updatedAt: new Date().toISOString(),
    };

    userRecords[index] = updated;
    this.recordsStore.set(userId, userRecords);
    return updated;
  }

  // ── 5. Add Custom Vaccine Record ─────────────────────────────
  public addCustomVaccine(userId: string, dto: AddCustomVaccineDto): VaccinationRecord {
    const userRecords = this.ensureUserRecords(userId);
    const now = new Date().toISOString();

    const record: VaccinationRecord = {
      id: `rec-cust-${uuidv4().slice(0, 8)}`,
      userId,
      memberId: dto.memberId || 'mem-self',
      memberName: dto.memberName || 'Self',
      vaccineId: `vac-custom-${uuidv4().slice(0, 6)}`,
      vaccineName: dto.vaccineName,
      vaccineCode: dto.vaccineCode || 'CUSTOM',
      doseNumber: dto.doseNumber,
      totalDoses: dto.totalDoses,
      targetAgeMonths: 0,
      dueDate: dto.dueDate,
      status: (dto.status as VaccinationStatus) || 'UPCOMING',
      administeredDate: dto.administeredDate,
      administeredBy: dto.administeredBy,
      clinicOrCenterName: dto.clinicOrCenterName,
      batchNumber: dto.batchNumber,
      notes: dto.notes,
      reminderEnabled: true,
      reminderDaysBefore: [7, 1],
      isCustom: true,
      createdAt: now,
      updatedAt: now,
    };

    userRecords.push(record);
    this.recordsStore.set(userId, userRecords);
    return record;
  }

  // ── 6. Delete Record ─────────────────────────────────────────
  public deleteVaccineRecord(userId: string, recordId: string) {
    const userRecords = this.ensureUserRecords(userId);
    const filtered = userRecords.filter((r) => r.id !== recordId);
    this.recordsStore.set(userId, filtered);
    return { success: true, message: `Record ${recordId} removed successfully.` };
  }

  // ── 7. Find Nearby Vaccination Centers & Hospitals ───────────
  public async findNearbyCenters(dto: FindNearbyCentersDto): Promise<VaccinationCenter[]> {
    const radiusMeters = dto.radius || 25000;
    const { latitude, longitude } = dto;

    let centers: VaccinationCenter[] = [];

    try {
      // Query OpenStreetMap Overpass for clinics and hospitals
      const overpassQuery = `
        [out:json][timeout:10];
        (
          node["healthcare"="vaccination_centre"](around:${radiusMeters},${latitude},${longitude});
          node["amenity"="clinic"](around:${radiusMeters},${latitude},${longitude});
          node["amenity"="hospital"](around:${radiusMeters},${latitude},${longitude});
          way["amenity"="hospital"](around:${radiusMeters},${latitude},${longitude});
        );
        out center 30;
      `;

      for (const endpoint of this.OVERPASS_ENDPOINTS) {
        try {
          const res = await axios.post(
            endpoint,
            `data=${encodeURIComponent(overpassQuery)}`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 6000 },
          );

          if (res.data && Array.isArray(res.data.elements)) {
            const elements = res.data.elements;
            const osmCenters: VaccinationCenter[] = elements
              .filter((el: any) => el.tags && el.tags.name)
              .map((el: any) => {
                const lat = el.lat ?? el.center?.lat;
                const lon = el.lon ?? el.center?.lon;
                const name = el.tags.name;
                const isGovt =
                  el.tags.operator_type === 'public' ||
                  /phc|uphc|government|govt|civil|district|general/i.test(name);
                const isPediatric = /child|pediatric|mother|maternity|kids/i.test(name);

                const distKm = this.calculateDistanceKm(latitude, longitude, lat, lon);

                const type: any = isGovt
                  ? 'GOVERNMENT_PHC'
                  : isPediatric
                    ? 'PEDIATRIC_CLINIC'
                    : 'PRIVATE_HOSPITAL';

                return {
                  id: `osm-${el.id}`,
                  name,
                  type,
                  address: el.tags['addr:full'] || el.tags['addr:street'] || `${name}, Regional Health Zone`,
                  city: el.tags['addr:city'] || 'Metropolitan Area',
                  state: el.tags['addr:state'] || 'India',
                  pincode: el.tags['addr:postcode'],
                  latitude: lat,
                  longitude: lon,
                  distanceKm: Math.round(distKm * 10) / 10,
                  distanceText: `${(Math.round(distKm * 10) / 10).toFixed(1)} km`,
                  contactPhone: el.tags.phone || el.tags['contact:phone'] || '+91 800-VACCINE',
                  openingHours: el.tags.opening_hours || (isGovt ? '09:00 AM - 04:00 PM' : '08:00 AM - 08:00 PM'),
                  operatingDays: 'Monday to Saturday',
                  isGovtFreeUip: isGovt,
                  vaccinesAvailable: isGovt
                    ? ['BCG', 'Polio', 'Pentavalent', 'Rotavirus', 'PCV', 'MR/MMR', 'DPT', 'Tdap', 'Rabies PEP']
                    : ['All Pediatric Vaccines', 'Gardasil 9 HPV', 'Fluarix Tetra', 'Shingrix', 'Prevnar 20'],
                  walkInAllowed: true,
                  appointmentRequired: !isGovt,
                  rating: 4.2 + (Math.abs(el.id) % 7) * 0.1,
                  reviewsCount: 50 + (Math.abs(el.id) % 300),
                  mapUrl: `https://maps.google.com/?q=${lat},${lon}`,
                  directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
                  source: 'OpenStreetMap',
                };
              });

            if (osmCenters.length > 0) {
              centers = osmCenters;
              break;
            }
          }
        } catch (endpointErr) {
          this.logger.warn(`Overpass endpoint ${endpoint} failed, trying next...`);
        }
      }
    } catch (err) {
      this.logger.error('Error fetching OpenStreetMap vaccination centers', err);
    }

    // Blend with curated directory with distance calculation
    const curatedWithDistances: VaccinationCenter[] = CURATED_VACCINATION_CENTERS.map((c) => {
      const distKm = this.calculateDistanceKm(latitude, longitude, c.latitude, c.longitude);
      return {
        ...c,
        distanceKm: Math.round(distKm * 10) / 10,
        distanceText: `${(Math.round(distKm * 10) / 10).toFixed(1)} km`,
      };
    });

    const combined = [...centers, ...curatedWithDistances];

    // Deduplicate by name similarity
    const uniqueMap = new Map<string, VaccinationCenter>();
    for (const item of combined) {
      const key = item.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
      if (!uniqueMap.has(key) || (uniqueMap.get(key)!.distanceKm || 9999) > (item.distanceKm || 9999)) {
        uniqueMap.set(key, item);
      }
    }

    let finalCenters = Array.from(uniqueMap.values());

    // Apply filters
    if (dto.type && dto.type !== 'ALL') {
      finalCenters = finalCenters.filter((c) => c.type === dto.type);
    }

    if (dto.isGovtFreeOnly) {
      finalCenters = finalCenters.filter((c) => c.isGovtFreeUip);
    }

    if (dto.vaccineQuery && dto.vaccineQuery.trim()) {
      const vq = dto.vaccineQuery.toLowerCase().trim();
      finalCenters = finalCenters.filter((c) =>
        c.vaccinesAvailable.some((v) => v.toLowerCase().includes(vq)),
      );
    }

    if (dto.searchQuery && dto.searchQuery.trim()) {
      const sq = dto.searchQuery.toLowerCase().trim();
      finalCenters = finalCenters.filter(
        (c) =>
          c.name.toLowerCase().includes(sq) ||
          c.address.toLowerCase().includes(sq) ||
          c.city.toLowerCase().includes(sq),
      );
    }

    // Sort by distance ascending
    finalCenters.sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));

    return finalCenters;
  }

  // ── 8. Book Vaccine Appointment ──────────────────────────────
  public bookAppointment(userId: string, dto: BookVaccineAppointmentDto): VaccineAppointment {
    const userAppointments = this.appointmentsStore.get(userId) || [];
    const center = CURATED_VACCINATION_CENTERS.find((c) => c.id === dto.centerId);

    const bookingRef = `VAX-BK-${Math.floor(100000 + Math.random() * 900000)}`;

    const appointment: VaccineAppointment = {
      id: `apt-${uuidv4().slice(0, 8)}`,
      userId,
      memberId: dto.memberId || 'mem-self',
      memberName: dto.memberName,
      vaccineId: dto.vaccineId,
      vaccineName: dto.vaccineName,
      doseNumber: dto.doseNumber,
      centerId: dto.centerId,
      centerName: center?.name || 'Authorized Immunization Center',
      centerAddress: center?.address || 'City Healthcare Facility',
      appointmentDate: dto.appointmentDate,
      timeSlot: dto.timeSlot,
      status: 'CONFIRMED',
      bookingRef,
      notes: dto.notes,
      createdAt: new Date().toISOString(),
    };

    userAppointments.push(appointment);
    this.appointmentsStore.set(userId, userAppointments);

    // Notify user
    this.notificationsService
      .send({
        userId,
        title: `Vaccination Appointment Confirmed (${dto.vaccineName})`,
        body: `Your slot for ${dto.memberName} at ${appointment.centerName} is confirmed for ${dto.appointmentDate} at ${dto.timeSlot}. Booking Ref: ${bookingRef}`,
        channel: 'LOCAL' as any,
        metadata: { appointmentId: appointment.id, bookingRef },
      })
      .catch((err) => this.logger.warn('Failed to send appointment notification', err));

    return appointment;
  }

  // ── 9. Digital Vaccination Passport & Certificate Generation ─
  public getVaccinationPassport(userId: string, memberId = 'mem-child'): VaccinationPassport {
    const records = this.ensureUserRecords(userId).filter((r) => r.memberId === memberId);
    const profiles = this.getDefaultFamilyProfiles(userId);
    const patientProfile = profiles.find((p) => p.id === memberId) || profiles[0];

    const completed = records.filter((r) => r.status === 'COMPLETED');
    const dueSoon = records.filter((r) => r.status === 'DUE_SOON');
    const overdue = records.filter((r) => r.status === 'OVERDUE');

    const birthYear = new Date(patientProfile.dateOfBirth).getFullYear();
    const currentYear = new Date().getFullYear();
    const ageYears = Math.max(0, currentYear - birthYear);

    const verificationHash = crypto
      .createHash('sha256')
      .update(`${patientProfile.name}-${patientProfile.dateOfBirth}-${completed.length}-${userId}`)
      .digest('hex');

    const passportNumber = `MED-VAX-${patientProfile.name.slice(0, 3).toUpperCase()}-${birthYear}-${patientProfile.bloodGroup?.replace('+', 'P').replace('-', 'M') || '01'}`;

    return {
      passportNumber,
      verificationHash,
      issuedAt: new Date().toISOString(),
      patient: {
        name: patientProfile.name,
        relationship: patientProfile.relationship,
        dateOfBirth: patientProfile.dateOfBirth,
        ageYears,
        bloodGroup: patientProfile.bloodGroup,
        emergencyContact: '+91 98765 43210 (Primary Account)',
      },
      summary: {
        totalScheduled: records.length,
        completedCount: completed.length,
        dueSoonCount: dueSoon.length,
        overdueCount: overdue.length,
        completionPercentage: records.length > 0 ? Math.round((completed.length / records.length) * 100) : 0,
      },
      immunizationHistory: completed.map((r) => ({
        vaccineName: r.vaccineName,
        doseNumber: r.doseNumber,
        totalDoses: r.totalDoses,
        administeredDate: r.administeredDate || r.dueDate,
        batchNumber: r.batchNumber,
        centerName: r.clinicOrCenterName,
        doctorName: r.administeredBy,
        verified: true,
      })),
      upcomingImmunizations: [...dueSoon, ...overdue].map((r) => ({
        vaccineName: r.vaccineName,
        doseNumber: r.doseNumber,
        dueDate: r.dueDate,
        status: r.status,
      })),
    };
  }

  // ── 10. Trigger Reminder Alert ───────────────────────────────
  public async triggerReminder(userId: string, dto: TriggerVaccineReminderDto) {
    const userRecords = this.ensureUserRecords(userId);
    const record = userRecords.find((r) => r.id === dto.recordId);

    if (!record) {
      throw new NotFoundException(`Record ${dto.recordId} not found.`);
    }

    const title = `Vaccine Reminder: ${record.vaccineName} (Dose ${record.doseNumber})`;
    const body =
      dto.customMessage ||
      `Immunization dose for ${record.memberName} is scheduled on ${record.dueDate}. Protect against preventable infectious diseases by completing on time.`;

    await this.notificationsService.send({
      userId,
      title,
      body,
      channel: 'LOCAL' as any,
      metadata: { recordId: record.id, vaccineCode: record.vaccineCode },
    });

    return { success: true, message: `Vaccination reminder sent to notifications log.` };
  }

  // ── Utility: Haversine Distance in Kilometers ────────────────
  private calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in KM
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
