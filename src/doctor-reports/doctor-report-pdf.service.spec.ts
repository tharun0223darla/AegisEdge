import { DoctorReportSection } from '@prisma/client';
import { DoctorReportPdfService } from './doctor-report-pdf.service';

describe('DoctorReportPdfService', () => {
  it('creates a valid bounded PDF from an immutable snapshot', async () => {
    const pdf = await new DoctorReportPdfService().render('Doctor visit', {
      version: 1,
      generatedAt: '2026-08-10T10:00:00.000Z',
      range: {
        start: '2026-08-01T00:00:00.000Z',
        end: '2026-08-10T23:59:59.999Z',
      },
      sections: [DoctorReportSection.MEDICATIONS],
      patient: {
        displayName: 'Asha Rao',
        dateOfBirth: null,
        bloodGroup: 'O+',
        conditions: [],
      },
      medications: {
        items: [],
        total: 0,
        truncated: false,
        lastUpdatedAt: null,
      },
      limitations: ['Only saved data is included.'],
      disclaimer: 'Not medical advice.',
    });

    expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length).toBe(1);
    expect(pdf.length).toBeGreaterThan(1_000);
    expect(pdf.length).toBeLessThan(2_000_000);
  });
});
