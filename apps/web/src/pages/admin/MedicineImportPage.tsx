import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, DatabaseZap, FileUp, RefreshCw, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { notify } from '@/components/ui/Toast';
import { extractErrorMessage } from '@/lib/api-client';
import { medicinesService } from '@/services/medicines.service';
import type {
  MedicineImportBatch,
  MedicineImportPreview,
  MedicineImportRowAction,
  MedicineImportStatus,
} from '@/types/medicine';

const actionTone: Record<MedicineImportRowAction, BadgeTone> = {
  CREATE: 'success',
  UPDATE: 'info',
  DUPLICATE_IN_FILE: 'warning',
  INVALID: 'danger',
  NOOP: 'muted',
};

const statusTone: Record<MedicineImportStatus, BadgeTone> = {
  STAGED: 'warning',
  COMMITTING: 'info',
  COMMITTED: 'success',
  DISCARDED: 'muted',
  FAILED: 'danger',
};

function Stat({ label, value, tone = 'muted' }: { label: string; value: number; tone?: BadgeTone }) {
  return (
    <div className="rounded-lg border border-border bg-bg-inset px-3 py-2">
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-lg font-semibold text-text-primary">{value.toLocaleString()}</span>
        <Badge tone={tone} dot />
      </div>
    </div>
  );
}

function BatchLine({
  batch,
  onPreview,
}: {
  batch: MedicineImportBatch;
  onPreview: (batchId: string) => void;
}) {
  return (
    <TR>
      <TD className="min-w-52">
        <p className="font-medium text-text-primary">{batch.originalFileName ?? batch.id}</p>
        <p className="mt-1 text-xs text-text-muted">
          {[batch.datasetName, batch.datasetVersion].filter(Boolean).join(' | ') || batch.id}
        </p>
      </TD>
      <TD>
        <Badge tone={statusTone[batch.status]}>{batch.status}</Badge>
      </TD>
      <TD>{batch.totalRows.toLocaleString()}</TD>
      <TD>{batch.createRows.toLocaleString()}</TD>
      <TD>{batch.updateRows.toLocaleString()}</TD>
      <TD>{batch.invalidRows.toLocaleString()}</TD>
      <TD>
        <Button size="sm" variant="secondary" onClick={() => onPreview(batch.id)}>
          Preview
        </Button>
      </TD>
    </TR>
  );
}

function PreviewPanel({
  preview,
  onCommit,
  onDiscard,
  isCommitting,
  isDiscarding,
}: {
  preview: MedicineImportPreview;
  onCommit: () => void;
  onDiscard: () => void;
  isCommitting: boolean;
  isDiscarding: boolean;
}) {
  const counts = preview.actionCounts;
  const canCommit = preview.batch.status === 'STAGED' && (counts.CREATE || counts.UPDATE);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{preview.batch.originalFileName ?? 'Staged import'}</CardTitle>
            <p className="mt-1 text-sm text-text-muted">
              {preview.batch.datasetName ?? 'unnamed dataset'}{' '}
              {preview.batch.datasetVersion ? `| ${preview.batch.datasetVersion}` : ''}
            </p>
          </div>
          <Badge tone={statusTone[preview.batch.status]}>{preview.batch.status}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Rows" value={preview.batch.totalRows} />
            <Stat label="Create" value={counts.CREATE ?? 0} tone="success" />
            <Stat label="Update" value={counts.UPDATE ?? 0} tone="info" />
            <Stat label="No-op" value={counts.NOOP ?? 0} />
            <Stat label="Invalid" value={counts.INVALID ?? 0} tone="danger" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="File dupes" value={counts.DUPLICATE_IN_FILE ?? 0} tone="warning" />
            <Stat label="Salts create" value={preview.batch.saltsToCreate} tone="success" />
            <Stat label="Salts reuse" value={preview.batch.saltsToReuse} tone="info" />
            <Stat label="Committed" value={preview.batch.committedRows} tone="success" />
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button
              variant="secondary"
              leftIcon={<Trash2 className="h-4 w-4" />}
              isLoading={isDiscarding}
              disabled={preview.batch.status !== 'STAGED'}
              onClick={onDiscard}
            >
              Discard
            </Button>
            <Button
              leftIcon={<CheckCircle2 className="h-4 w-4" />}
              isLoading={isCommitting}
              disabled={!canCommit}
              onClick={onCommit}
            >
              Commit Valid Rows
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sample Rows</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Row</TH>
                <TH>Action</TH>
                <TH>Brand</TH>
                <TH>Salt</TH>
                <TH>Pack</TH>
                <TH>Issues</TH>
              </TR>
            </THead>
            <TBody>
              {preview.sampleRows.map((row) => (
                <TR key={row.id}>
                  <TD>{row.rowNumber}</TD>
                  <TD>
                    <Badge tone={actionTone[row.action]}>{row.action.replace(/_/g, ' ')}</Badge>
                  </TD>
                  <TD>
                    <p className="font-medium text-text-primary">{row.brandName ?? '-'}</p>
                    <p className="mt-1 text-xs text-text-muted">{row.manufacturer ?? ''}</p>
                  </TD>
                  <TD>
                    <p className="text-text-primary">{row.saltDisplayName ?? row.composition ?? '-'}</p>
                    <p className="mt-1 max-w-72 truncate text-xs text-text-muted">{row.saltKey ?? ''}</p>
                  </TD>
                  <TD>
                    <p>{row.packSize ?? '-'}</p>
                    <p className="mt-1 text-xs text-text-muted">{row.gtin ?? ''}</p>
                  </TD>
                  <TD className="min-w-64">
                    {[...row.validationErrors, ...row.warnings].length ? (
                      <ul className="space-y-1 text-xs">
                        {[...row.validationErrors, ...row.warnings].map((issue, index) => (
                          <li key={`${row.id}-${index}`} className="text-text-muted">
                            {issue}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-text-muted">-</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function MedicineImportPage() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState('');
  const [datasetVersion, setDatasetVersion] = useState('');
  const [preview, setPreview] = useState<MedicineImportPreview | null>(null);

  const imports = useQuery({
    queryKey: ['medicine-imports'],
    queryFn: () => medicinesService.listImports(),
  });

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose a CSV file first.');
      return medicinesService.uploadImport({
        file,
        datasetName: datasetName || undefined,
        datasetVersion: datasetVersion || undefined,
      });
    },
    onSuccess: (result) => {
      setPreview(result);
      setFile(null);
      notify.success('Import staged');
      queryClient.invalidateQueries({ queryKey: ['medicine-imports'] });
    },
    onError: (error) => notify.error(extractErrorMessage(error, 'Failed to stage import')),
  });

  const loadPreview = useMutation({
    mutationFn: (batchId: string) => medicinesService.previewImport(batchId),
    onSuccess: setPreview,
    onError: (error) => notify.error(extractErrorMessage(error, 'Failed to load preview')),
  });

  const commit = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('No import batch selected.');
      return medicinesService.commitImport(preview.batch.id);
    },
    onSuccess: (result) => {
      notify.success(
        `Committed ${result.committedRows.toLocaleString()} rows, skipped ${result.skippedRows.toLocaleString()}`,
      );
      queryClient.invalidateQueries({ queryKey: ['medicine-imports'] });
      if (preview) loadPreview.mutate(preview.batch.id);
    },
    onError: (error) => notify.error(extractErrorMessage(error, 'Failed to commit import')),
  });

  const discard = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('No import batch selected.');
      return medicinesService.discardImport(preview.batch.id);
    },
    onSuccess: (batch) => {
      notify.success('Import discarded');
      setPreview((current) => (current ? { ...current, batch } : current));
      queryClient.invalidateQueries({ queryKey: ['medicine-imports'] });
    },
    onError: (error) => notify.error(extractErrorMessage(error, 'Failed to discard import')),
  });

  const recentBatches = useMemo(() => imports.data?.data ?? [], [imports.data]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    upload.mutate();
  }

  return (
    <div>
      <PageHeader
        title="Medicine Imports"
        description="Stage CSV identity data, reuse salt profiles, and commit only valid rows."
        actions={
          <Button
            variant="secondary"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            isLoading={imports.isFetching}
            onClick={() => imports.refetch()}
          >
            Refresh
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Upload CSV</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <Input
                  label="Dataset name"
                  value={datasetName}
                  onChange={(event) => setDatasetName(event.target.value)}
                  placeholder="indian-master"
                />
                <Input
                  label="Dataset version"
                  value={datasetVersion}
                  onChange={(event) => setDatasetVersion(event.target.value)}
                  placeholder="2026-06"
                />
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                    CSV file
                  </label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    className="block w-full rounded-xl border border-border bg-bg-inset px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-lg file:border-0 file:bg-surface-raised file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text-primary hover:border-border-strong"
                  />
                </div>
                <Button
                  type="submit"
                  fullWidth
                  leftIcon={<FileUp className="h-4 w-4" />}
                  isLoading={upload.isPending}
                  disabled={!file}
                >
                  Stage Import
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Recent Batches</CardTitle>
              <DatabaseZap className="h-5 w-5 text-brand-400" />
            </CardHeader>
            <CardContent>
              {imports.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : recentBatches.length === 0 ? (
                <EmptyState
                  icon={<Ban className="h-8 w-8" />}
                  title="No imports yet"
                  description="Staged batches will appear here."
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Batch</TH>
                      <TH>Status</TH>
                      <TH>Rows</TH>
                      <TH>Create</TH>
                      <TH>Update</TH>
                      <TH>Invalid</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {recentBatches.map((batch) => (
                      <BatchLine
                        key={batch.id}
                        batch={batch}
                        onPreview={(batchId) => loadPreview.mutate(batchId)}
                      />
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {preview ? (
          <PreviewPanel
            preview={preview}
            onCommit={() => commit.mutate()}
            onDiscard={() => discard.mutate()}
            isCommitting={commit.isPending || loadPreview.isPending}
            isDiscarding={discard.isPending}
          />
        ) : (
          <Card>
            <CardContent className="pt-5">
              <EmptyState
                icon={<DatabaseZap className="h-8 w-8" />}
                title="No batch selected"
                description="Upload a CSV or open a recent batch preview."
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
