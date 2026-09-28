"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding Medicine Master database...');
    const medicines = [
        {
            brandName: 'Pregamax M',
            genericName: 'Pregabalin + Methylcobalamin',
            composition: 'Pregabalin 75mg, Methylcobalamin 1500mcg',
            category: 'Neuropathic Pain',
            manufacturer: 'Sandoz',
            strength: '75mg',
        },
        {
            brandName: 'Dolo 650',
            genericName: 'Paracetamol',
            composition: 'Paracetamol 650mg',
            category: 'Analgesic / Antipyretic',
            manufacturer: 'Micro Labs Ltd',
            strength: '650mg',
        },
        {
            brandName: 'HAPIRAB-D',
            genericName: 'Rabeprazole + Domperidone',
            composition: 'Rabeprazole 20mg, Domperidone 30mg',
            category: 'Antacid / Antireflux',
            manufacturer: 'Glenmark Pharmaceuticals',
            strength: '20mg/30mg',
        },
        {
            brandName: 'PROVANOL-SR',
            genericName: 'Propranolol',
            composition: 'Propranolol 40mg',
            category: 'Beta-blocker',
            manufacturer: 'Cipla Ltd',
            strength: '40mg',
        },
        {
            brandName: 'Glycomet 500',
            genericName: 'Metformin',
            composition: 'Metformin Hydrochloride 500mg',
            category: 'Antidiabetic',
            manufacturer: 'USV Private Ltd',
            strength: '500mg',
        },
        {
            brandName: 'Augmentin 625 Duo',
            genericName: 'Amoxicillin + Clavulanic Acid',
            composition: 'Amoxicillin 500mg, Clavulanic Acid 125mg',
            category: 'Antibiotic',
            manufacturer: 'GlaxoSmithKline',
            strength: '625mg',
        },
        {
            brandName: 'Limcee',
            genericName: 'Vitamin C',
            composition: 'Vitamin C (Ascorbic Acid) 500mg',
            category: 'Nutritional Supplement',
            manufacturer: 'Abbott',
            strength: '500mg',
        },
    ];
    for (const med of medicines) {
        await prisma.medicineMaster.upsert({
            where: { id: med.brandName },
            create: med,
            update: med,
        });
    }
    for (const med of medicines) {
        const existing = await prisma.medicineMaster.findFirst({
            where: { brandName: med.brandName },
        });
        if (!existing) {
            await prisma.medicineMaster.create({ data: med });
            console.log(`Created MedicineMaster entry: ${med.brandName}`);
        }
        else {
            console.log(`MedicineMaster entry already exists: ${med.brandName}`);
        }
    }
    console.log('Medicine Master seeding completed successfully.');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map