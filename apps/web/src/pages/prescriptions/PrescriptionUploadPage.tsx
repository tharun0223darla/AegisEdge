import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, FileText, Calendar, ArrowRight, Trash2, CheckCircle2, AlertCircle, Camera } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import { usePrescriptions, useUploadPrescription, useDeletePrescription } from '@/hooks/usePrescriptions';
import { extractErrorMessage } from '@/lib/api-client';
import { formatDate } from '@/lib/date';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CameraCaptureModal } from '@/components/shared/CameraCaptureModal';

export default function PrescriptionUploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const { data: prescriptions, isLoading } = usePrescriptions();
  const uploadPrescription = useUploadPrescription();
  const deletePrescription = useDeletePrescription();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [prescriptionToDelete, setPrescriptionToDelete] = useState<string | null>(null);

  const processPrescriptionFile = (file: File) => {
    // Guard: Max 5MB
    if (file.size > 5 * 1024 * 1024) {
      notify.error('File size must be under 5MB');
      return;
    }

    setUploadProgress(0);
    uploadPrescription.mutate(
      {
        file,
        onProgress: (pct) => setUploadProgress(pct),
      },
      {
        onSuccess: (res) => {
          setUploadProgress(null);
          const prescriptionId = res.prescription?.id;
          const visionQueued =
            res.extractionMode === 'VISION_JOB_QUEUED' ||
            res.ocr?.status === 'QUEUED' ||
            Boolean(res.visionJob);

          if (visionQueued) {
            notify.success(
              res.message ||
                res.ocr?.message ||
                'Prescription uploaded. Vision extraction is processing.'
            );
            navigate(
              prescriptionId
                ? `/prescriptions/${prescriptionId}`
                : '/prescriptions'
            );
            return;
          }

          if (res.reviewRequired && res.failureStage) {
            notify.error(
              `OCR ingestion failed at stage: ${res.failureStage}. Please enter details manually.`
            );
            navigate('/prescriptions');
            return;
          }

          notify.success('Prescription uploaded successfully!');
          navigate(
            prescriptionId
              ? `/prescriptions/${prescriptionId}`
              : '/prescriptions'
          );
        },
        onError: (err) => {
          setUploadProgress(null);
          notify.error(extractErrorMessage(err, 'Failed to upload prescription'));
        },
      }
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPrescriptionFile(file);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering navigation
    setPrescriptionToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!prescriptionToDelete) return;
    deletePrescription.mutate(prescriptionToDelete, {
      onSuccess: () => {
        notify.success('Prescription deleted');
        setDeleteConfirmOpen(false);
        setPrescriptionToDelete(null);
      },
      onError: (err) => {
        notify.error(extractErrorMessage(err, 'Failed to delete prescription'));
        setDeleteConfirmOpen(false);
        setPrescriptionToDelete(null);
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Prescriptions"
        description="Upload your medical prescriptions and the AI will help import medicines into your schedules."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Upload Widget */}
        <Card className="lg:col-span-1 border-dashed border-2 border-brand-500/30 bg-surface/50 hover:bg-surface/80 transition-all flex flex-col justify-center items-center text-center p-8">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/jpeg,image/png,application/pdf"
            onChange={handleFileChange}
          />
          <div className="rounded-full bg-brand-500/10 p-4 mb-4 text-brand-400">
            <UploadCloud className="h-10 w-10" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary mb-2">Upload prescription</h3>
          <p className="text-xs text-text-muted max-w-[200px] mb-6">
            Supports JPG, PNG, and PDF (Max 5MB). Ingestion details will be scanned automatically.
          </p>

          {uploadProgress !== null ? (
            <div className="w-full max-w-[200px]">
              <div className="flex justify-between text-xs text-text-primary mb-1">
                <span>Scanning...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-brand-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs justify-center">
              <Button
                type="button"
                onClick={() => setCameraModalOpen(true)}
                disabled={uploadPrescription.isPending}
                className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 py-2.5 shadow-md"
              >
                <Camera className="h-4 w-4" />
                <span>Laptop Camera</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadPrescription.isPending}
                className="text-xs"
              >
                {uploadPrescription.isPending ? <Spinner size="sm" /> : 'Choose File'}
              </Button>
            </div>
          )}
        </Card>

        {/* History / List */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <FileText className="h-5 w-5 text-brand-400" /> Prescriptions History
          </h2>

          {isLoading ? (
            <div className="flex justify-center items-center h-48">
              <Spinner size="lg" />
            </div>
          ) : !prescriptions || prescriptions.length === 0 ? (
            <Card className="p-8 text-center flex flex-col items-center justify-center bg-surface">
              <div className="bg-surface-raised p-4 rounded-full text-text-muted mb-3">
                <FileText className="h-8 w-8" />
              </div>
              <p className="text-sm text-text-muted">No prescriptions uploaded yet.</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {prescriptions.map((p) => {
                const isConfirmed = !!p.confirmedAt;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-2xl border border-border bg-surface px-5 py-4 hover:border-brand-500/50 hover:bg-surface-raised transition-all cursor-pointer group"
                    onClick={() => navigate(`/prescriptions/${p.id}`)}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-xl ${isConfirmed ? 'bg-success/10 text-success' : 'bg-brand-500/10 text-brand-400'}`}>
                        <FileText className="h-6 w-6" />
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-text-primary group-hover:text-brand-400 transition-colors">
                            {p.doctorName || 'Dr. Self / Unspecified'}
                          </span>
                          <Badge tone={isConfirmed ? 'success' : 'warning'}>
                            {isConfirmed ? (
                              <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Confirmed</span>
                            ) : (
                              <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Unconfirmed</span>
                            )}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 mt-1.5 text-xs text-text-muted">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" /> {formatDate(p.createdAt)}
                          </span>
                          {p.notes && <span className="truncate max-w-[200px]">{p.notes}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleDelete(p.id, e)}
                        disabled={deletePrescription.isPending}
                        aria-label="Delete prescription"
                      >
                        <Trash2 className="h-4 w-4 text-danger hover:scale-110 transition-transform" />
                      </Button>
                      <ArrowRight className="h-5 w-5 text-text-muted group-hover:text-brand-400 group-hover:translate-x-1 transition-all" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete Prescription"
        description="Are you sure you want to delete this prescription? This action cannot be undone."
        confirmLabel="Delete"
        destructive
        isLoading={deletePrescription.isPending}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setPrescriptionToDelete(null);
        }}
      />

      <CameraCaptureModal
        open={cameraModalOpen}
        onClose={() => setCameraModalOpen(false)}
        onCapture={processPrescriptionFile}
        title="Capture Prescription Document"
        subtitle="Align your physical doctor's prescription sheet in front of your laptop webcam and click Capture"
      />
      </div>
    </div>
  );
}
