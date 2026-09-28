import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dedupeKeyFor(item: any) {
  return normalizeKey([item.brandName, item.strength, item.manufacturer].filter(Boolean).join('|'));
}

function saltDisplayName(salts: Array<{ name: string; strength?: string }>, fallback: string) {
  if (!salts?.length) return fallback;
  return salts
    .map((salt) => [salt.name, salt.strength].filter(Boolean).join(' '))
    .join(' + ');
}

function saltKeyFor(item: any) {
  if (item.salts?.length) {
    return item.salts
      .map((salt: any) => normalizeKey([salt.name, salt.strength].filter(Boolean).join(' ')))
      .sort()
      .join('+');
  }

  return normalizeKey(item.composition || item.genericName || item.brandName);
}

const medicines: Array<any> = [
  {
    brandName: 'Pregamax M',
    genericName: 'Pregabalin + Methylcobalamin',
    composition: 'Pregabalin 75mg, Methylcobalamin 1500mcg',
    salts: [
      { name: 'Pregabalin', strength: '75mg' },
      { name: 'Methylcobalamin', strength: '1500mcg' },
    ],
    category: 'Neuropathic pain support',
    manufacturer: 'Sandoz',
    strength: '75mg/1500mcg',
    type: 'capsule',
    packages: [{ packSize: 'Strip of 10 capsules' }],
    detail: {
      uses: 'Used for selected nerve pain conditions when prescribed by a clinician.',
      howToTake: 'Take exactly as prescribed. It may cause sleepiness, so avoid driving if drowsy.',
      whenToTake: 'Often taken at the same time each day; follow the prescription schedule.',
      sideEffects: ['Dizziness', 'Sleepiness', 'Swelling', 'Weight gain'],
      warnings: 'Do not stop suddenly without medical advice. Use caution with alcohol or sedatives.',
      storage: 'Store in a cool, dry place away from children.',
    },
  },
  {
    brandName: 'Dolo 650',
    genericName: 'Paracetamol',
    composition: 'Paracetamol 650mg',
    salts: [{ name: 'Paracetamol', strength: '650mg' }],
    category: 'Analgesic / antipyretic',
    manufacturer: 'Micro Labs Ltd',
    strength: '650mg',
    type: 'tablet',
    packages: [
      {
        gtin: '0000-TEST-DOLO650-STRIP15',
        barcodeType: 'TEST',
        packSize: 'Strip of 15 tablets',
        isDemo: true,
      },
    ],
    detail: {
      uses: 'Commonly used for fever and mild to moderate pain.',
      howToTake: 'Take exactly as prescribed or as directed on the label. Do not exceed the recommended daily dose.',
      whenToTake: 'Often taken when fever or pain is present, according to the prescribed schedule.',
      sideEffects: ['Nausea', 'Rash', 'Liver injury risk with overdose'],
      warnings: 'Avoid overdose. Ask a clinician before use in liver disease or heavy alcohol use.',
      storage: 'Store in a cool, dry place away from children.',
    },
  },
  {
    brandName: 'HAPIRAB-D',
    genericName: 'Rabeprazole + Domperidone',
    composition: 'Rabeprazole 20mg, Domperidone 30mg',
    salts: [
      { name: 'Rabeprazole', strength: '20mg' },
      { name: 'Domperidone', strength: '30mg' },
    ],
    category: 'Antacid / antireflux',
    manufacturer: 'Glenmark Pharmaceuticals',
    strength: '20mg/30mg',
    type: 'capsule',
    packages: [{ packSize: 'Strip of 10 capsules' }],
    detail: {
      uses: 'Used for acidity, reflux, or nausea-related symptoms when prescribed.',
      howToTake: 'Usually taken before food when prescribed, but follow your doctor or pharmacist instructions.',
      whenToTake: 'Take at the time written on your prescription label.',
      sideEffects: ['Dry mouth', 'Headache', 'Stomach discomfort'],
      warnings: 'Tell a clinician about heart rhythm problems, liver disease, or other regular medicines.',
      storage: 'Store at room temperature away from moisture.',
    },
  },
  {
    brandName: 'Glycomet 500',
    genericName: 'Metformin',
    composition: 'Metformin Hydrochloride 500mg',
    salts: [{ name: 'Metformin Hydrochloride', strength: '500mg' }],
    category: 'Antidiabetic',
    manufacturer: 'USV Private Ltd',
    strength: '500mg',
    type: 'tablet',
    packages: [{ packSize: 'Strip of 20 tablets' }],
    detail: {
      uses: 'Used to help control blood sugar in type 2 diabetes.',
      howToTake: 'Usually taken with food to reduce stomach upset. Follow the exact prescribed dose.',
      whenToTake: 'Take at the same time each day according to the schedule given by your clinician.',
      sideEffects: ['Nausea', 'Loose stools', 'Metallic taste'],
      warnings: 'Seek medical advice for kidney disease, severe dehydration, or before contrast scans.',
      storage: 'Store at room temperature away from moisture.',
    },
  },
  {
    brandName: 'Augmentin 625 Duo',
    genericName: 'Amoxicillin + Clavulanic Acid',
    composition: 'Amoxicillin 500mg, Clavulanic Acid 125mg',
    salts: [
      { name: 'Amoxicillin', strength: '500mg' },
      { name: 'Clavulanic Acid', strength: '125mg' },
    ],
    category: 'Antibiotic',
    manufacturer: 'GlaxoSmithKline',
    strength: '625mg',
    type: 'tablet',
    packages: [{ packSize: 'Strip of 10 tablets' }],
    detail: {
      uses: 'Antibiotic used for certain bacterial infections.',
      howToTake: 'Take with food if advised and complete the full prescribed course.',
      whenToTake: 'Take at evenly spaced times according to the prescription.',
      sideEffects: ['Diarrhoea', 'Nausea', 'Rash'],
      warnings: 'Do not take if allergic to penicillin-class antibiotics. Seek help for swelling or breathing trouble.',
      storage: 'Store tablets in a cool, dry place. Follow bottle instructions for suspensions.',
    },
  },
  {
    brandName: 'Azithral 500',
    genericName: 'Azithromycin',
    composition: 'Azithromycin 500mg',
    salts: [{ name: 'Azithromycin', strength: '500mg' }],
    category: 'Antibiotic',
    manufacturer: 'Alembic Pharmaceuticals',
    strength: '500mg',
    type: 'tablet',
    packages: [{ packSize: 'Strip of 3 tablets' }],
    detail: {
      uses: 'Antibiotic used for certain bacterial infections.',
      howToTake: 'Take for the full prescribed course. Do not use for viral infections unless directed by a clinician.',
      whenToTake: 'Usually taken once daily, but follow the prescription label.',
      sideEffects: ['Nausea', 'Diarrhoea', 'Abdominal discomfort'],
      warnings: 'Tell a clinician about heart rhythm problems, liver disease, or allergy to macrolide antibiotics.',
      storage: 'Store as directed on the pack. Some suspensions may need special storage after mixing.',
    },
  },
  {
    brandName: 'Limcee',
    genericName: 'Vitamin C',
    composition: 'Vitamin C (Ascorbic Acid) 500mg',
    salts: [{ name: 'Ascorbic Acid', strength: '500mg' }],
    category: 'Nutritional supplement',
    manufacturer: 'Abbott',
    strength: '500mg',
    type: 'tablet',
    packages: [{ packSize: 'Strip of 15 tablets' }],
    detail: {
      uses: 'Vitamin C supplement used when extra vitamin C is advised.',
      howToTake: 'Take as prescribed or as directed on the label.',
      whenToTake: 'Take at the time recommended by your clinician or pharmacist.',
      sideEffects: ['Stomach upset', 'Nausea', 'Loose stools'],
      warnings: 'Ask a clinician before high-dose use if you have kidney stone history or kidney disease.',
      storage: 'Store in a cool, dry place away from sunlight.',
    },
  },
];

async function main() {
  console.log('Seeding Medicine Master database...');

  for (const item of medicines) {
    const { detail, packages, ...medicine } = item;
    const saltKey = saltKeyFor(item);
    const displayName = saltDisplayName(item.salts, medicine.composition ?? medicine.genericName);
    const sourceRef = [
      {
        sourceType: 'local_starter_knowledge_base',
        title: 'MediTrack starter patient education seed',
        note:
          'Development seed text. Replace with verified/licensed Indian brand data plus ingredient-level label sources before production release.',
      },
    ];
    const sourceRefs = {
      uses: sourceRef,
      howToTake: sourceRef,
      whenToTake: sourceRef,
      sideEffects: sourceRef,
      warnings: sourceRef,
      storage: sourceRef,
    };
    const saltProfile = await prisma.saltProfile.upsert({
      where: { saltKey },
      create: {
        saltKey,
        displayName,
        ingredients: medicine.salts,
        uses: detail.uses,
        howToTake: detail.howToTake,
        whenToTake: detail.whenToTake,
        sideEffects: detail.sideEffects,
        warnings: detail.warnings,
        storage: detail.storage,
        sourceRefs,
        enrichmentStatus: 'COMPLETE',
        source: 'IMPORT',
      },
      update: {
        displayName,
        ingredients: medicine.salts,
        uses: detail.uses,
        howToTake: detail.howToTake,
        whenToTake: detail.whenToTake,
        sideEffects: detail.sideEffects,
        warnings: detail.warnings,
        storage: detail.storage,
        sourceRefs,
        enrichmentStatus: 'COMPLETE',
      },
    });
    const dedupeKey = dedupeKeyFor(medicine);
    const existing = await prisma.medicineMaster.findFirst({
      where: {
        OR: [{ dedupeKey }, { brandName: medicine.brandName }],
      },
    });

    const saved = existing
      ? await prisma.medicineMaster.update({
          where: { id: existing.id },
          data: {
            ...medicine,
            normalizedName: normalizeName(medicine.brandName),
            saltProfileId: saltProfile.id,
            dedupeKey,
            source: 'IMPORT',
          },
        })
      : await prisma.medicineMaster.create({
          data: {
            ...medicine,
            normalizedName: normalizeName(medicine.brandName),
            saltProfileId: saltProfile.id,
            dedupeKey,
            source: 'IMPORT',
          },
        });

    for (const pack of packages) {
      const existingPackage = pack.gtin
        ? await prisma.medicinePackage.findUnique({ where: { gtin: pack.gtin } })
        : await prisma.medicinePackage.findFirst({
            where: { medicineId: saved.id, packSize: pack.packSize },
          });

      const packageData = {
        medicineId: saved.id,
        gtin: pack.gtin,
        barcodeType: pack.barcodeType,
        packSize: pack.packSize,
        isDemo: pack.isDemo ?? false,
        isVerified: false,
        source: 'IMPORT' as const,
      };

      if (existingPackage) {
        await prisma.medicinePackage.update({
          where: { id: existingPackage.id },
          data: packageData,
        });
      } else {
        await prisma.medicinePackage.create({ data: packageData });
      }
    }

    console.log(`Upserted MedicineMaster entry: ${medicine.brandName}`);
  }

  console.log('Medicine Master seeding completed successfully.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
