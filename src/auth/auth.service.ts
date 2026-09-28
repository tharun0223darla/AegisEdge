import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserRole } from '../common/enums/userrole.enum';
import {
  CareInvitationStatus,
  UserRole as PrismaUserRole,
} from '@prisma/client';
import { createHash } from 'crypto';
import { EmailVerificationService } from './email-verification.service';
import { NotificationsService } from '../notifications/notifications.service';

const BCRYPT_ROUNDS = 12;
const ACCOUNT_MODE_TO_PRISMA_ROLE = {
  [UserRole.PATIENT]: PrismaUserRole.PATIENT,
  [UserRole.CAREGIVER]: PrismaUserRole.CAREGIVER,
} as const;

function getRefreshTokenSecret(): string {
  return (
    process.env.JWT_REFRESH_SECRET ??
    process.env.JWT_SECRET ??
    'change-refresh-in-production'
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private auditLogs: AuditLogsService,
    private emailVerification: EmailVerificationService,
    private notifications: NotificationsService,
  ) {}
  // Register
  async register(
    dto: RegisterDto,
    auditContext: { ipAddress?: string; userAgent?: string } = {},
  ) {
    this.emailVerification.assertDeliveryReady();
    const normalizedEmail = dto.email.toLowerCase();
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingByEmail) {
      throw new ConflictException('An account with this email already exists');
    }

    if (dto.phone) {
      const existingByPhone = await this.prisma.user.findUnique({
        where: { phone: dto.phone },
      });
      if (existingByPhone) {
        throw new ConflictException(
          'An account with this phone number already exists',
        );
      }
    }

    const requestedRole = dto.role ?? UserRole.PATIENT;

    if (![UserRole.PATIENT, UserRole.CAREGIVER].includes(requestedRole)) {
      throw new BadRequestException(
        'Only patient and caregiver accounts can be created publicly.',
      );
    }
    if (dto.careInvitationToken) {
      await this.assertCareInvitation(normalizedEmail, dto.careInvitationToken);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        phone: dto.phone,
        passwordHash,
        role: requestedRole,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
    });

    await this.auditLogs.log({
      userId: user.id,
      action: 'CREATED',
      entityType: 'User',
      entityId: user.id,
      newValues: { email: user.email, role: user.role },
    });

    this.logger.log(`New user registered: ${user.email} [${user.role}]`);

    const delivery = await this.emailVerification.issue({
      userId: user.id,
      email: user.email,
      careInvitationToken: dto.careInvitationToken,
      auditContext,
    });

    return {
      verificationRequired: true,
      email: this.maskEmail(user.email),
      deliveryStatus: delivery.status,
      message:
        delivery.status === 'SENT'
          ? 'Account created. Check your email to verify it before signing in.'
          : 'Account created, but the verification email could not be delivered. Use resend verification to try again.',
    };
  }
  // Login
  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      this.logger.warn(`Failed login attempt for email: ${dto.email}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Account is deactivated. Please contact support.',
      );
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      this.logger.warn(`Wrong password for: ${dto.email}`);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isVerified) {
      throw new ForbiddenException(
        'Verify your email before signing in. You can request a new verification link.',
      );
    }
    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.auditLogs.log({
      userId: user.id,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    this.logger.log(`User logged in: ${user.email}`);

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        isVerified: user.isVerified,
        lastLoginAt: user.lastLoginAt,
      },
      ...tokens,
    };
  }

  async verifyEmail(
    token: string,
    auditContext: { ipAddress?: string; userAgent?: string } = {},
  ) {
    return this.emailVerification.verify(token, auditContext);
  }

  async resendEmailVerification(
    email: string,
    careInvitationToken?: string,
    auditContext: { ipAddress?: string; userAgent?: string } = {},
  ) {
    this.emailVerification.assertDeliveryReady();
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, isActive: true, isVerified: true },
    });
    if (user?.isActive && !user.isVerified) {
      const verifiedCareInvitationToken =
        careInvitationToken &&
        (await this.isCareInvitationValid(user.email, careInvitationToken))
          ? careInvitationToken
          : undefined;
      await this.emailVerification.issue({
        userId: user.id,
        email: user.email,
        careInvitationToken: verifiedCareInvitationToken,
        enforceCooldown: true,
        auditContext,
      });
    }
    return {
      accepted: true,
      message:
        'If an unverified account exists for this email, a new link has been sent.',
    };
  }
  // Refresh token
  async refreshTokens(userId: string, refreshToken: string) {
    let payload: { sub: string; email: string; role: string };

    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: getRefreshTokenSecret(),
      });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    if (payload.sub !== userId) {
      throw new BadRequestException('Token user mismatch');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        isVerified: true,
      },
    });

    if (!user || !user.isActive || !user.isVerified) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    return this.generateTokens(user.id, user.email, user.role);
  }

  private async assertCareInvitation(email: string, token: string) {
    if (await this.isCareInvitationValid(email, token)) return;
    throw new BadRequestException(
      'The caregiver invitation is invalid, expired, or belongs to another email.',
    );
  }

  private async isCareInvitationValid(email: string, token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invitation = await this.prisma.careInvitation.findUnique({
      where: { tokenHash },
      select: { invitedEmail: true, status: true, expiresAt: true },
    });
    return Boolean(
      invitation &&
      invitation.status === CareInvitationStatus.PENDING &&
      invitation.expiresAt > new Date() &&
      invitation.invitedEmail === email,
    );
  }

  private maskEmail(email: string): string {
    const separator = email.lastIndexOf('@');
    const local = separator > 0 ? email.slice(0, separator) : email;
    const domain = separator > 0 ? email.slice(separator + 1) : 'unknown';
    return `${local.slice(0, 2)}***@${domain}`;
  }
  // Helpers
  private async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_SECRET,
        expiresIn: 900, // 15 minutes
      }),
      this.jwtService.signAsync(payload, {
        secret: getRefreshTokenSecret(),
        expiresIn: 2_592_000, // 30 days
      }),
    ]);

    return { accessToken, refreshToken };
  }

  // Current user profile
  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        isVerified: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async switchAccountMode(
    userId: string,
    targetRole: UserRole.PATIENT | UserRole.CAREGIVER,
    auditContext: { ipAddress?: string; userAgent?: string } = {},
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        isVerified: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (!user?.isActive || !user.isVerified) {
      throw new UnauthorizedException('Account is not active and verified');
    }
    if (
      user.role !== PrismaUserRole.PATIENT &&
      user.role !== PrismaUserRole.CAREGIVER
    ) {
      throw new ForbiddenException(
        'Administrator and doctor accounts cannot switch account modes',
      );
    }

    const targetPrismaRole = ACCOUNT_MODE_TO_PRISMA_ROLE[targetRole];
    const updated =
      user.role === targetPrismaRole
        ? user
        : await this.prisma.user.update({
            where: { id: userId },
            data: { role: targetPrismaRole },
            select: {
              id: true,
              email: true,
              phone: true,
              role: true,
              isActive: true,
              isVerified: true,
              lastLoginAt: true,
              createdAt: true,
            },
          });

    if (user.role !== targetPrismaRole) {
      await this.auditLogs.log({
        userId,
        action: 'UPDATED',
        entityType: 'UserAccountMode',
        entityId: userId,
        oldValues: { role: user.role },
        newValues: { role: targetPrismaRole },
        ...auditContext,
      });
    }

    const tokens = await this.generateTokens(
      updated.id,
      updated.email,
      updated.role,
    );
    return { user: updated, ...tokens };
  }

  // Change Password
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const passwordMatch = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!passwordMatch) {
      throw new BadRequestException('Incorrect current password');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.auditLogs.log({
      userId,
      action: 'PASSWORD_CHANGED',
      entity: 'User',
      entityId: userId,
      newValues: { message: 'Password successfully updated' },
    });

    try {
      await this.notifications.sendOptionalEmail(
        {
          userId,
          title: 'Your MediTrack password was changed',
          body: 'Your MediTrack account password was changed. If this was not you, secure your email account and contact support immediately.',
          metadata: { type: 'PASSWORD_CHANGED', actionUrl: '/settings' },
          dedupeKey: `password-changed:${Date.now()}`,
        },
        'PASSWORD_CHANGED',
      );
    } catch (error) {
      this.logger.warn(
        `Password changed but security email could not be queued (${error instanceof Error ? error.name : 'UnknownError'})`,
      );
    }

    return { success: true, message: 'Password updated successfully' };
  }
}
