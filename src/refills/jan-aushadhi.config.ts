export interface JanAushadhiGenericMapping {
  saltName: string;
  genericName: string;
  strength: string;
  brandedAveragePrice: number; // INR per strip of 10
  janAushadhiPrice: number; // PMBJP price per strip of 10
  composition: string;
  pmbjpCode: string;
  therapeuticCategory: string;
}

export const JAN_AUSHADHI_REGISTRY: Record<string, JanAushadhiGenericMapping> = {
  telmisartan: {
    saltName: 'Telmisartan',
    genericName: 'Telmisartan Tablets IP 40mg',
    strength: '40mg',
    brandedAveragePrice: 145,
    janAushadhiPrice: 22,
    composition: 'Telmisartan IP 40mg',
    pmbjpCode: 'PMBJP-CV-0142',
    therapeuticCategory: 'Cardiovascular / Antihypertensive',
  },
  metformin: {
    saltName: 'Metformin',
    genericName: 'Metformin Hydrochloride Prolonged-Release Tablets IP 500mg',
    strength: '500mg',
    brandedAveragePrice: 75,
    janAushadhiPrice: 14,
    composition: 'Metformin Hydrochloride IP 500mg',
    pmbjpCode: 'PMBJP-DM-0089',
    therapeuticCategory: 'Antidiabetic / Biguanide',
  },
  atorvastatin: {
    saltName: 'Atorvastatin',
    genericName: 'Atorvastatin Calcium Tablets IP 10mg',
    strength: '10mg',
    brandedAveragePrice: 185,
    janAushadhiPrice: 28,
    composition: 'Atorvastatin Calcium IP 10mg',
    pmbjpCode: 'PMBJP-CV-0219',
    therapeuticCategory: 'Lipid-Lowering / Statin',
  },
  pantoprazole: {
    saltName: 'Pantoprazole',
    genericName: 'Pantoprazole Gastro-Resistant Tablets IP 40mg',
    strength: '40mg',
    brandedAveragePrice: 130,
    janAushadhiPrice: 20,
    composition: 'Pantoprazole Sodium IP 40mg',
    pmbjpCode: 'PMBJP-GI-0305',
    therapeuticCategory: 'Gastrointestinal / Proton Pump Inhibitor',
  },
  ramipril: {
    saltName: 'Ramipril',
    genericName: 'Ramipril Tablets IP 5mg',
    strength: '5mg',
    brandedAveragePrice: 120,
    janAushadhiPrice: 18,
    composition: 'Ramipril IP 5mg',
    pmbjpCode: 'PMBJP-CV-0164',
    therapeuticCategory: 'Cardiovascular / ACE Inhibitor',
  },
  amlodipine: {
    saltName: 'Amlodipine',
    genericName: 'Amlodipine Besylate Tablets IP 5mg',
    strength: '5mg',
    brandedAveragePrice: 65,
    janAushadhiPrice: 9,
    composition: 'Amlodipine Besylate IP 5mg',
    pmbjpCode: 'PMBJP-CV-0033',
    therapeuticCategory: 'Cardiovascular / Calcium Channel Blocker',
  },
  paracetamol: {
    saltName: 'Paracetamol',
    genericName: 'Paracetamol Tablets IP 650mg',
    strength: '650mg',
    brandedAveragePrice: 42,
    janAushadhiPrice: 11,
    composition: 'Paracetamol IP 650mg',
    pmbjpCode: 'PMBJP-AN-0012',
    therapeuticCategory: 'Analgesic / Antipyretic',
  },
};

export function findJanAushadhiSubstitute(
  medicineName: string,
  composition?: string | null,
): JanAushadhiGenericMapping | null {
  const query = (medicineName + ' ' + (composition ?? '')).toLowerCase();

  for (const [key, mapping] of Object.entries(JAN_AUSHADHI_REGISTRY)) {
    if (
      query.includes(key) ||
      query.includes(mapping.saltName.toLowerCase()) ||
      query.includes(mapping.genericName.toLowerCase())
    ) {
      return mapping;
    }
  }

  return null;
}
