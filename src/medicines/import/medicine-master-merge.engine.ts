import { SaltCanonicalizer } from './salt-canonicalizer';

type PrismaLike = any;

export interface MedicineMasterMergeSummary {
  groupsFound: number;
  groupsMerged: number;
  mastersArchived: number;
  packagesMoved: number;
  packageRefsRepointed: number;
  userMedicinesRepointed: number;
  reviewRefsRepointed: number;
  dryRun: boolean;
  groups: MedicineMasterMergeGroup[];
}

export interface MedicineMasterMergeGroup {
  identityKey: string;
  winner: MedicineMasterMergeCandidate;
  losers: MedicineMasterMergeCandidate[];
}

export interface MedicineMasterMergeCandidate {
  id: string;
  brandName: string;
  manufacturer?: string | null;
  composition?: string | null;
  strength?: string | null;
  source: string;
  isVerified: boolean;
  packages: number;
  userMedicines: number;
  reviewItems: number;
  rank: number;
}

export class MedicineMasterMergeEngine {
  private readonly canonicalizer = new SaltCanonicalizer();

  constructor(private readonly prisma: PrismaLike) {}

  async findDuplicateGroups(): Promise<MedicineMasterMergeGroup[]> {
    const masters = await this.prisma.medicineMaster.findMany({
      where: { isArchived: false },
      include: {
        saltProfile: { select: { saltKey: true } },
        packages: true,
        userMedicines: { select: { id: true } },
        reviewItems: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const groups = new Map<string, any[]>();

    for (const master of masters) {
      const key = this.identityKey(master);
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(master);
      groups.set(key, group);
    }

    return Array.from(groups.entries())
      .filter(([, group]) => group.length > 1)
      .map(([identityKey, group]) => this.toMergeGroup(identityKey, group));
  }

  async mergeDuplicates(options: { dryRun?: boolean; limit?: number } = {}) {
    const dryRun = options.dryRun ?? true;
    const groups = (await this.findDuplicateGroups()).slice(0, options.limit);
    const summary: MedicineMasterMergeSummary = {
      groupsFound: groups.length,
      groupsMerged: 0,
      mastersArchived: 0,
      packagesMoved: 0,
      packageRefsRepointed: 0,
      userMedicinesRepointed: 0,
      reviewRefsRepointed: 0,
      dryRun,
      groups,
    };

    if (dryRun) return summary;

    for (const group of groups) {
      const result = await this.mergeGroup(group);
      summary.groupsMerged += 1;
      summary.mastersArchived += result.mastersArchived;
      summary.packagesMoved += result.packagesMoved;
      summary.packageRefsRepointed += result.packageRefsRepointed;
      summary.userMedicinesRepointed += result.userMedicinesRepointed;
      summary.reviewRefsRepointed += result.reviewRefsRepointed;
    }

    return summary;
  }

  private toMergeGroup(identityKey: string, masters: any[]): MedicineMasterMergeGroup {
    const ranked = masters
      .map((master) => ({ master, candidate: this.toCandidate(master) }))
      .sort((left, right) => right.candidate.rank - left.candidate.rank);

    return {
      identityKey,
      winner: ranked[0].candidate,
      losers: ranked.slice(1).map((row) => row.candidate),
    };
  }

  private async mergeGroup(group: MedicineMasterMergeGroup) {
    return this.prisma.$transaction(async (tx: PrismaLike) => {
      const winner = await tx.medicineMaster.findFirst({
        where: { id: group.winner.id, isArchived: false },
        include: { packages: true },
      });

      if (!winner) {
        throw new Error(`Winner master not found or archived: ${group.winner.id}`);
      }

      const result = {
        mastersArchived: 0,
        packagesMoved: 0,
        packageRefsRepointed: 0,
        userMedicinesRepointed: 0,
        reviewRefsRepointed: 0,
      };

      for (const loserCandidate of group.losers) {
        const loser = await tx.medicineMaster.findFirst({
          where: { id: loserCandidate.id, isArchived: false },
          include: { packages: true },
        });

        if (!loser) continue;

        const userUpdate = await tx.medicine.updateMany({
          where: { medicineMasterId: loser.id },
          data: { medicineMasterId: winner.id },
        });
        result.userMedicinesRepointed += userUpdate.count;

        const reviewUpdate = await tx.medicineDataReview.updateMany({
          where: { medicineMasterId: loser.id },
          data: { medicineMasterId: winner.id },
        });
        result.reviewRefsRepointed += reviewUpdate.count;

        for (const pack of loser.packages) {
          const targetPackage = await this.findEquivalentPackage(tx, winner.id, pack);

          if (targetPackage) {
            const medicinePackageUpdate = await tx.medicine.updateMany({
              where: { medicinePackageId: pack.id },
              data: { medicinePackageId: targetPackage.id },
            });
            const reviewPackageUpdate = await tx.medicineDataReview.updateMany({
              where: { medicinePackageId: pack.id },
              data: { medicinePackageId: targetPackage.id },
            });
            result.packageRefsRepointed +=
              medicinePackageUpdate.count + reviewPackageUpdate.count;
          } else {
            await tx.medicinePackage.update({
              where: { id: pack.id },
              data: { medicineId: winner.id },
            });
            result.packagesMoved += 1;
          }
        }

        await tx.medicineMaster.update({
          where: { id: loser.id },
          data: {
            isArchived: true,
            mergedIntoId: winner.id,
            mergedAt: new Date(),
            mergeReason: `Equivalent medicine identity: ${group.identityKey}`,
          },
        });
        result.mastersArchived += 1;
      }

      return result;
    });
  }

  private async findEquivalentPackage(tx: PrismaLike, winnerId: string, pack: any) {
    if (pack.gtin) {
      const byGtin = await tx.medicinePackage.findFirst({
        where: { medicineId: winnerId, gtin: pack.gtin },
      });
      if (byGtin) return byGtin;

      return null;
    }

    const targetPackKey = this.canonicalizer.normalizePackSize(pack.packSize);
    if (!targetPackKey) return null;

    const candidates = await tx.medicinePackage.findMany({
      where: { medicineId: winnerId, gtin: null },
    });

    return (
      candidates.find(
        (candidate: any) =>
          this.canonicalizer.normalizePackSize(candidate.packSize) === targetPackKey,
      ) ?? null
    );
  }

  private identityKey(master: any) {
    return this.canonicalizer.buildEquivalentIdentityKey({
      brandName: master.brandName,
      saltKey: master.saltProfile?.saltKey,
      manufacturer: master.manufacturer,
    });
  }

  private toCandidate(master: any): MedicineMasterMergeCandidate {
    return {
      id: master.id,
      brandName: master.brandName,
      manufacturer: master.manufacturer,
      composition: master.composition,
      strength: master.strength,
      source: master.source,
      isVerified: master.isVerified,
      packages: master.packages?.length ?? 0,
      userMedicines: master.userMedicines?.length ?? 0,
      reviewItems: master.reviewItems?.length ?? 0,
      rank: this.rank(master),
    };
  }

  private rank(master: any) {
    const packages = master.packages ?? [];
    const verifiedPackages = packages.filter((pack: any) => pack.isVerified).length;
    const imagedPackages = packages.filter(
      (pack: any) => pack.stripImageUrl || pack.pillImageUrl,
    ).length;

    return (
      (master.source === 'ADMIN' ? 1000 : 0) +
      (master.isVerified ? 500 : 0) +
      verifiedPackages * 100 +
      imagedPackages * 50 +
      (master.userMedicines?.length ?? 0) * 20 +
      (master.reviewItems?.length ?? 0) * 10 +
      packages.length * 5 +
      String(master.manufacturer ?? '').length / 100
    );
  }
}
