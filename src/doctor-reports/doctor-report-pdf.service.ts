import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { DoctorReportSnapshot } from './doctor-report.types';

const PAGE_BOTTOM = 720;

@Injectable()
export class DoctorReportPdfService {
  render(title: string, snapshot: DoctorReportSnapshot): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({
        size: 'A4',
        margins: { top: 48, right: 48, bottom: 56, left: 48 },
        bufferPages: true,
        info: {
          Title: title,
          Author: 'MediTrack AI',
          Subject: 'Patient-provided doctor visit report',
          CreationDate: new Date(snapshot.generatedAt),
        },
      });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);

      this.header(document, title, snapshot);
      this.patient(document, snapshot);
      if (snapshot.medications) this.medications(document, snapshot);
      if (snapshot.adherence) this.adherence(document, snapshot);
      if (snapshot.allergies) this.allergies(document, snapshot);
      if (snapshot.safety) this.safety(document, snapshot);
      if (snapshot.refills) this.refills(document, snapshot);
      if (snapshot.vitals) this.vitals(document, snapshot);
      this.limitations(document, snapshot);
      this.addFooters(document);
      document.end();
    });
  }

  private header(
    document: PDFKit.PDFDocument,
    title: string,
    snapshot: DoctorReportSnapshot,
  ) {
    document
      .fillColor('#0f766e')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('MEDITRACK AI');
    document
      .moveDown(0.4)
      .fillColor('#111827')
      .fontSize(20)
      .text(this.text(title, 120));
    document
      .moveDown(0.4)
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#4b5563')
      .text(
        `Generated ${this.dateTime(snapshot.generatedAt)} | Report period ${this.date(snapshot.range.start)} to ${this.date(snapshot.range.end)}`,
      );
    document
      .moveDown(0.8)
      .strokeColor('#d1d5db')
      .moveTo(48, document.y)
      .lineTo(547, document.y)
      .stroke();
    document.moveDown(0.8);
  }

  private patient(
    document: PDFKit.PDFDocument,
    snapshot: DoctorReportSnapshot,
  ) {
    this.sectionTitle(document, 'Patient');
    this.keyValue(document, 'Name', snapshot.patient.displayName);
    if (snapshot.patient.contactEmail) {
      this.keyValue(document, 'Account email', snapshot.patient.contactEmail);
    }
    this.keyValue(
      document,
      'Date of birth',
      snapshot.patient.dateOfBirth
        ? this.date(snapshot.patient.dateOfBirth)
        : 'Not recorded',
    );
    this.keyValue(
      document,
      'Blood group',
      snapshot.patient.bloodGroup ?? 'Not recorded',
    );
    this.keyValue(
      document,
      'Recorded conditions',
      snapshot.patient.conditions.length
        ? snapshot.patient.conditions.join(', ')
        : 'None recorded',
    );
  }

  private medications(
    document: PDFKit.PDFDocument,
    snapshot: DoctorReportSnapshot,
  ) {
    const section = snapshot.medications!;
    this.sectionTitle(document, `Active medicines (${section.total})`);
    if (!section.items.length)
      return this.empty(document, 'No active medicines recorded.');
    section.items.forEach((medicine) => {
      this.ensureSpace(document, 90);
      document
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#111827')
        .text(medicine.name);
      document.font('Helvetica').fontSize(9).fillColor('#374151');
      this.keyValue(
        document,
        'Composition',
        medicine.composition ?? medicine.genericName ?? 'Not recorded',
      );
      this.keyValue(
        document,
        'Strength / form',
        [medicine.strength, medicine.form].filter(Boolean).join(' / '),
      );
      this.keyValue(
        document,
        'Schedule',
        medicine.schedules.length
          ? medicine.schedules
              .map(
                (schedule) =>
                  `${schedule.dosesPerIntake} ${this.quantityUnit(schedule.dosesPerIntake, schedule.unit)}, ${schedule.frequency.toLowerCase().replaceAll('_', ' ')}${schedule.timesOfDay.length ? ` at ${schedule.timesOfDay.join(', ')}` : ''}`,
              )
              .join('; ')
          : 'No active schedule recorded',
      );
      if (medicine.instructions)
        this.keyValue(document, 'Saved instructions', medicine.instructions);
      document.moveDown(0.35);
    });
  }

  private adherence(
    document: PDFKit.PDFDocument,
    snapshot: DoctorReportSnapshot,
  ) {
    const section = snapshot.adherence!;
    this.sectionTitle(document, 'Dose adherence');
    this.keyValue(document, 'Scheduled doses', String(section.totalScheduled));
    this.keyValue(
      document,
      'Recorded outcome',
      `Taken ${section.taken}; missed ${section.missed}; skipped ${section.skipped}; snoozed ${section.snoozed}; pending ${section.pending}`,
    );
    this.keyValue(
      document,
      'Adherence',
      section.adherencePercent === null
        ? 'Not enough completed dose records'
        : `${section.adherencePercent.toFixed(1)}%`,
    );
    section.byMedicine.forEach((item) =>
      this.bullet(
        document,
        `${item.name}: ${item.taken} taken, ${item.missed} missed, ${item.skipped} skipped${item.adherencePercent === null ? '' : ` (${item.adherencePercent.toFixed(1)}%)`}`,
      ),
    );
    this.note(document, section.methodology);
  }

  private allergies(
    document: PDFKit.PDFDocument,
    snapshot: DoctorReportSnapshot,
  ) {
    const section = snapshot.allergies!;
    this.sectionTitle(
      document,
      `Allergies and intolerances (${section.total})`,
    );
    if (!section.items.length)
      return this.empty(document, 'No active allergy records saved.');
    section.items.forEach((item) =>
      this.bullet(
        document,
        `${item.substance} - ${item.category.toLowerCase()} / ${item.criticality.toLowerCase()} criticality${item.reaction ? `; reaction: ${item.reaction}` : ''} [${item.verificationStatus.toLowerCase()}]`,
      ),
    );
  }

  private safety(document: PDFKit.PDFDocument, snapshot: DoctorReportSnapshot) {
    const section = snapshot.safety!;
    if (!section.items.length) this.ensureSpace(document, 110);
    this.sectionTitle(document, `Medication safety prompts (${section.total})`);
    if (!section.items.length)
      this.empty(document, 'No open safety prompts in saved records.');
    section.items.forEach((item) => {
      this.ensureSpace(document, 58);
      document
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(item.severity === 'HIGH' ? '#b91c1c' : '#111827')
        .text(`${item.severity}: ${item.title}`);
      document.font('Helvetica').fillColor('#374151').text(item.summary);
      if (item.medicines.length)
        document.text(`Records: ${item.medicines.join(', ')}`);
      document.moveDown(0.4);
    });
    this.note(document, section.disclaimer);
  }

  private refills(
    document: PDFKit.PDFDocument,
    snapshot: DoctorReportSnapshot,
  ) {
    const section = snapshot.refills!;
    this.sectionTitle(document, 'Stock and refill status');
    if (!section.items.length)
      return this.empty(document, 'No active medicine stock records.');
    section.items.forEach((item) =>
      this.bullet(
        document,
        `${this.medicineLabel(item.medicineName, item.strength)}: ${item.remainingQuantity ?? 'unknown'} ${item.unit ?? 'units'} remaining; ${item.status.toLowerCase()}${item.refillReminderDate ? `; refill reminder ${this.date(item.refillReminderDate)}` : ''}`,
      ),
    );
  }

  private vitals(document: PDFKit.PDFDocument, snapshot: DoctorReportSnapshot) {
    const section = snapshot.vitals!;
    this.sectionTitle(document, `Recorded health readings (${section.total})`);
    if (!section.items.length)
      this.empty(document, 'No health readings in this period.');
    section.items
      .slice(0, 250)
      .forEach((item) =>
        this.bullet(
          document,
          `${item.metricType.replaceAll('_', ' ')}: ${this.metricValue(item.value)} ${item.unit} on ${this.dateTime(item.recordedAt)} [${item.source.toLowerCase()}, ${item.quality.toLowerCase()}]`,
        ),
      );
    if (section.items.length > 250) {
      this.note(
        document,
        `${section.items.length - 250} additional readings remain in the immutable digital snapshot.`,
      );
    }
    this.note(document, section.disclaimer);
  }

  private limitations(
    document: PDFKit.PDFDocument,
    snapshot: DoctorReportSnapshot,
  ) {
    this.sectionTitle(document, 'Limitations and safety notice');
    snapshot.limitations.forEach((item) => this.bullet(document, item));
    document.moveDown(0.5).font('Helvetica-Bold').fontSize(9);
    const notice = this.text(snapshot.disclaimer, 2_000);
    const noticeWidth = 475;
    const noticeHeight = document.heightOfString(notice, {
      width: noticeWidth,
    });
    const boxHeight = Math.max(48, noticeHeight + 24);
    this.ensureSpace(document, boxHeight + 8);
    const boxY = document.y;
    document
      .roundedRect(48, boxY, 499, boxHeight, 4)
      .fillAndStroke('#f3f4f6', '#d1d5db');
    document
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(notice, 60, boxY + 12, { width: noticeWidth });
    document.y = boxY + boxHeight + 8;
  }

  private sectionTitle(document: PDFKit.PDFDocument, value: string) {
    this.ensureSpace(document, 54);
    document
      .moveDown(0.8)
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#0f766e')
      .text(value);
    document.moveDown(0.4);
  }

  private keyValue(document: PDFKit.PDFDocument, label: string, value: string) {
    this.ensureSpace(document, 28);
    document
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#4b5563')
      .text(`${label}: `, { continued: true })
      .font('Helvetica')
      .fillColor('#111827')
      .text(this.text(value || 'Not recorded', 2_000));
  }

  private bullet(document: PDFKit.PDFDocument, value: string) {
    this.ensureSpace(document, 34);
    document
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#111827')
      .text(`- ${this.text(value, 2_000)}`, { indent: 8, paragraphGap: 3 });
  }

  private note(document: PDFKit.PDFDocument, value: string) {
    this.ensureSpace(document, 42);
    document
      .moveDown(0.3)
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor('#6b7280')
      .text(this.text(value, 2_000));
  }

  private empty(document: PDFKit.PDFDocument, value: string) {
    document
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor('#6b7280')
      .text(value);
  }

  private ensureSpace(document: PDFKit.PDFDocument, required: number) {
    if (document.y + required > PAGE_BOTTOM) document.addPage();
  }

  private addFooters(document: PDFKit.PDFDocument) {
    const range = document.bufferedPageRange();
    for (
      let index = range.start;
      index < range.start + range.count;
      index += 1
    ) {
      document.switchToPage(index);
      const footerY = document.page.height - 70;
      document
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#6b7280')
        .text(
          `MediTrack patient-provided snapshot | Page ${index + 1} of ${range.count}`,
          48,
          footerY,
          {
            width: 499,
            align: 'center',
            lineBreak: false,
          },
        );
    }
  }

  private metricValue(value: unknown) {
    if (typeof value === 'number' || typeof value === 'string')
      return String(value);
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .slice(0, 5)
        .map(([key, entry]) => `${key} ${String(entry)}`)
        .join(', ');
    }
    return 'unavailable';
  }

  private medicineLabel(name: string, strength: string | null) {
    if (!strength) return name;
    const compact = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9%]+/g, '');
    return compact(name).includes(compact(strength))
      ? name
      : `${name} ${strength}`;
  }

  private quantityUnit(quantity: number, unit: string) {
    if (quantity !== 1) return unit;
    return unit.toLowerCase().endsWith('s') &&
      !unit.toLowerCase().endsWith('ss')
      ? unit.slice(0, -1)
      : unit;
  }

  private date(value: string) {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(value));
  }

  private dateTime(value: string) {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(value));
  }

  private text(value: string, limit: number) {
    const withoutControls = Array.from(value, (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    }).join('');
    return withoutControls.replace(/\s+/g, ' ').trim().slice(0, limit);
  }
}
