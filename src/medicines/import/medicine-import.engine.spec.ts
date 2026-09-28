import { MedicineImportEngine } from './medicine-import.engine';

describe('MedicineImportEngine', () => {
  it('normalizes 1mg metadata columns for staging and package import', () => {
    const engine = new MedicineImportEngine({} as any);
    const row = (engine as any).normalizeRow({
      brand_name: 'Abixim 100mg Tablet',
      composition: 'Cefixime (100mg)',
      manufacturer: 'Abbott',
      pack_size: 'strip of 10 tablets',
      price: '₹87.5',
      prescription_required: 'true',
      source_dataset: '1mg-2025',
    });

    expect(row.validationErrors).toEqual([]);
    expect(row.brandName).toBe('Abixim 100mg');
    expect(row.composition).toBe('Cefixime (100mg)');
    expect(row.manufacturer).toBe('Abbott');
    expect(row.packSize).toBe('strip of 10 tablets');
    expect(row.type).toBe('tablet');
    expect(row.mrpPrice).toBe('87.50');
    expect(row.priceCurrency).toBe('INR');
    expect(row.priceSource).toBe('1mg-2025');
    expect(row.prescriptionRequired).toBe(true);
    expect(row.salt?.saltKey).toBe('cefixime-100mg');
  });

  it('warns and skips malformed prices without rejecting the identity row', () => {
    const engine = new MedicineImportEngine({} as any);
    const row = (engine as any).normalizeRow({
      brand_name: 'Gabastar 300mg Tablet',
      composition: 'Gabapentin (300mg)',
      manufacturer: 'Grievers Remedies',
      pack_size: 'strip of 10 tablets',
      price: 'not-a-price',
      prescription_required: 'false',
    });

    expect(row.validationErrors).toEqual([]);
    expect(row.mrpPrice).toBeUndefined();
    expect(row.prescriptionRequired).toBe(false);
    expect(row.warnings).toContain('price ignored: invalid decimal value.');
  });
});
