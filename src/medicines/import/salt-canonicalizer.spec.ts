import { SaltCanonicalizer } from './salt-canonicalizer';

describe('SaltCanonicalizer', () => {
  const canonicalizer = new SaltCanonicalizer();

  it('maps common spelling and unit variants of one salt to one saltKey', () => {
    const variants = [
      'Metformin HCl 500',
      'Metformin Hydrochloride 500mg',
      'METFORMIN (500 MG)',
      'metformin hydrochloride 0.5 g',
    ];

    const keys = variants.map((value) => canonicalizer.canonicalizeComposition(value).saltKey);

    expect(new Set(keys)).toEqual(new Set(['metformin-hydrochloride-500mg']));
  });

  it('sorts combination ingredients so order does not change saltKey', () => {
    const first = canonicalizer.canonicalizeComposition(
      'Amoxicillin 500mg + Clavulanic Acid 125mg',
    );
    const second = canonicalizer.canonicalizeComposition(
      'Potassium Clavulanate 125 mg + Amoxycillin 500 mg',
    );

    expect(first.saltKey).toBe(second.saltKey);
    expect(first.saltKey).toBe('amoxicillin-500mg+clavulanic-acid-125mg');
  });

  it('normalizes manufacturer and pack variants for equivalent identity matching', () => {
    expect(canonicalizer.normalizeManufacturer('Micro Labs Ltd')).toBe(
      canonicalizer.normalizeManufacturer('Micro Labs'),
    );
    expect(canonicalizer.normalizeManufacturer('USV Private Ltd')).toBe(
      canonicalizer.normalizeManufacturer('USV'),
    );
    expect(canonicalizer.normalizeManufacturer('GSK')).toBe(
      canonicalizer.normalizeManufacturer('GlaxoSmithKline'),
    );
    expect(canonicalizer.normalizePackSize('Strip of 15 tablets')).toBe(
      canonicalizer.normalizePackSize('strip of 15'),
    );

    expect(
      canonicalizer.buildEquivalentIdentityKey({
        brandName: 'Dolo 650',
        saltKey: 'paracetamol-650mg',
        manufacturer: 'Micro Labs Ltd',
      }),
    ).toBe(
      canonicalizer.buildEquivalentIdentityKey({
        brandName: 'Dolo 650',
        saltKey: 'paracetamol-650mg',
        manufacturer: 'Micro Labs',
      }),
    );
  });

  it('handles real Indian dataset composition formats', () => {
    expect(
      canonicalizer.canonicalizeComposition(
        'Amoxycillin  (500mg)  +   Clavulanic Acid (125mg)',
      ).saltKey,
    ).toBe('amoxicillin-500mg+clavulanic-acid-125mg');
    expect(canonicalizer.canonicalizeComposition('Ambroxol (30mg/5ml)').saltKey).toBe(
      'ambroxol-30mg-per-5ml',
    );
    expect(canonicalizer.canonicalizeComposition('Clobetasol (0.05% w/w)').saltKey).toBe(
      'clobetasol-0.05%ww',
    );
    expect(
      canonicalizer.canonicalizeComposition('Lactobacillus 60 million spores').saltKey,
    ).toBe('lactobacillus-60million-spores');
  });

  it('passes the composition parser fixture', () => {
    const fixture: Array<[string, string]> = [
      ['Paracetamol 650mg', 'paracetamol-650mg'],
      ['Acetaminophen 650 mg', 'paracetamol-650mg'],
      ['PCM 500', 'paracetamol-500mg'],
      ['Metformin HCl 500', 'metformin-hydrochloride-500mg'],
      ['Metformin Hydrochloride 500mg', 'metformin-hydrochloride-500mg'],
      ['METFORMIN (500 MG)', 'metformin-hydrochloride-500mg'],
      ['Metformin hydrochloride 0.5g', 'metformin-hydrochloride-500mg'],
      ['Azithromycin 500 mg', 'azithromycin-500mg'],
      ['Azithromycin 250MG', 'azithromycin-250mg'],
      ['Amoxicillin 500mg + Clavulanic Acid 125mg', 'amoxicillin-500mg+clavulanic-acid-125mg'],
      ['Clavulanate Potassium 125mg + Amoxycillin 500mg', 'amoxicillin-500mg+clavulanic-acid-125mg'],
      ['Amoxycillin 875 mg / Potassium Clavulanate 125 mg', 'amoxicillin-875mg+clavulanic-acid-125mg'],
      ['Rabeprazole 20mg + Domperidone 30mg', 'domperidone-30mg+rabeprazole-20mg'],
      ['Domperidone 30 mg, Rabeprazole 20 mg', 'domperidone-30mg+rabeprazole-20mg'],
      ['Pregabalin 75mg + Methylcobalamin 1500mcg', 'methylcobalamin-1500mcg+pregabalin-75mg'],
      ['Methylcobalamin 1.5mg + Pregabalin 75 mg', 'methylcobalamin-1.5mg+pregabalin-75mg'],
      ['Ascorbic Acid 500mg', 'ascorbic-acid-500mg'],
      ['Vitamin C 500 mg', 'ascorbic-acid-500mg'],
      ['Vit C 0.5 g', 'ascorbic-acid-500mg'],
      ['Cetirizine 10mg', 'cetirizine-10mg'],
      ['Levocetirizine 5 mg', 'levocetirizine-5mg'],
      ['Montelukast 10mg + Levocetirizine 5mg', 'levocetirizine-5mg+montelukast-10mg'],
      ['Pantoprazole 40mg', 'pantoprazole-40mg'],
      ['Pantoprazole Sodium 40 mg', 'pantoprazole-sodium-40mg'],
      ['Atorvastatin 10mg', 'atorvastatin-10mg'],
      ['Rosuvastatin 20 mg', 'rosuvastatin-20mg'],
      ['Telmisartan 40mg', 'telmisartan-40mg'],
      ['Amlodipine 5mg + Telmisartan 40mg', 'amlodipine-5mg+telmisartan-40mg'],
      ['Losartan Potassium 50mg', 'losartan-potassium-50mg'],
      ['Hydrochlorothiazide 12.5mg + Telmisartan 40mg', 'hydrochlorothiazide-12.5mg+telmisartan-40mg'],
      ['Glimepiride 2mg + Metformin HCl 500mg', 'glimepiride-2mg+metformin-hydrochloride-500mg'],
      ['Sitagliptin 100mg', 'sitagliptin-100mg'],
      ['Dapagliflozin 10 mg', 'dapagliflozin-10mg'],
      ['Insulin Glargine 100 IU', 'insulin-glargine-100iu'],
      ['Epoetin Alfa 4000 IU', 'epoetin-alfa-4000iu'],
      ['Tocilizumab 400mg', 'tocilizumab-400mg'],
      ['Remdesivir 100mg', 'remdesivir-100mg'],
      ['Linezolid 600 mg', 'linezolid-600mg'],
      ['Cefixime 200mg', 'cefixime-200mg'],
      ['Cefpodoxime Proxetil 200 mg', 'cefpodoxime-proxetil-200mg'],
      ['Doxycycline 100mg', 'doxycycline-100mg'],
      ['Clindamycin 300 mg', 'clindamycin-300mg'],
      ['Diclofenac Sodium 50mg', 'diclofenac-sodium-50mg'],
      ['Aceclofenac 100mg + Paracetamol 325mg', 'aceclofenac-100mg+paracetamol-325mg'],
      ['Ibuprofen 400 mg', 'ibuprofen-400mg'],
      ['Ondansetron 4mg', 'ondansetron-4mg'],
      ['ORS powder', 'ors-powder'],
      ['Salbutamol 100mcg', 'salbutamol-100mcg'],
      ['Budesonide 200 mcg + Formoterol 6 mcg', 'budesonide-200mcg+formoterol-6mcg'],
      ['Mupirocin 2%', 'mupirocin-2%'],
    ];

    expect(fixture).toHaveLength(50);

    for (const [input, expectedKey] of fixture) {
      expect(canonicalizer.canonicalizeComposition(input).saltKey).toBe(expectedKey);
    }
  });
});
