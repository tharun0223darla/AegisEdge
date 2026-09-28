import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreatePatientProfileDto } from './dto/create-patient-profile.dto';
import { UpdatePatientProfileDto } from './dto/update-patient-profile.dto';
import { UserRole } from '../common/enums/userrole.enum';

@Injectable()
export class PatientsService {
  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  // ── Create profile ────────────────────────────────────────
  async createProfile(userId: string, dto: CreatePatientProfileDto) {
    // Only PATIENT role users should have patient profiles
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) throw new NotFoundException('User not found');

    if (user.role !== UserRole.PATIENT) {
      throw new ForbiddenException('Only patients can create a patient profile');
    }

    const existing = await this.prisma.patientProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException(
        'A patient profile already exists. Use PATCH to update it.',
      );
    }

    const profile = await this.prisma.patientProfile.create({
      data: {
        userId,
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      },
    });

    await this.auditLogs.log({
      userId,
      action: 'CREATED',
      entityType: 'PatientProfile',
      entityId: profile.id,
      newValues: { firstName: profile.firstName, lastName: profile.lastName },
    });

    return profile;
  }

  // ── Get own profile ───────────────────────────────────────
  async getMyProfile(userId: string) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: { email: true, phone: true, role: true, lastLoginAt: true },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException(
        'Patient profile not found. Please create your profile first.',
      );
    }

    return profile;
  }

  // ── Update profile ────────────────────────────────────────
  async updateProfile(userId: string, dto: UpdatePatientProfileDto) {
    const existing = await this.prisma.patientProfile.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw new NotFoundException(
        'Patient profile not found. Please create your profile first.',
      );
    }

    const updated = await this.prisma.patientProfile.update({
      where: { userId },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      },
    });

    await this.auditLogs.log({
      userId,
      action: 'UPDATED',
      entityType: 'PatientProfile',
      entityId: updated.id,
      oldValues: {
        firstName: existing.firstName,
        lastName: existing.lastName,
        weight: existing.weight,
        height: existing.height,
      },
      newValues: { ...dto },
    });

    return updated;
  }

  // ── Admin: get any patient profile ────────────────────────
  async getProfileById(profileId: string) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { id: profileId },
      include: {
        user: {
          select: { email: true, phone: true, role: true },
        },
      },
    });

    if (!profile) throw new NotFoundException('Patient profile not found');
    return profile;
  }

  // ── Admin: list all patient profiles (paginated) ──────────
  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [total, profiles] = await Promise.all([
      this.prisma.patientProfile.count(),
      this.prisma.patientProfile.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { email: true, role: true, isActive: true } },
        },
      }),
    ]);

    return {
      data: profiles,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
