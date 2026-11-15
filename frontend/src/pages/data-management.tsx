import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Papa from "papaparse";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Server,
  UploadCloud,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { InfoNote, SectionHeading } from "@/components/common/notes";
import { ErrorState } from "@/components/common/states";
import { PageSkeleton } from "@/components/common/loading";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useDataQuality, useDatasets, useHealth } from "@/api/queries";
import { api } from "@/api";
import type { ApiErrorShape } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { API_MODE } from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import {
  OPTIONAL_INVOICE_COLUMNS,
  REQUIRED_INVOICE_COLUMNS,
  VALIDATION_RULES,
  unknownColumns,
  validateInvoiceCsv,
} from "@/lib/upload-validation";
import { cn } from "@/lib/utils";
import type { DatasetsResponse, UploadValidationResult } from "@/types";

type DatasetRow = DatasetsResponse["datasets"][number];

interface UploadHistoryEntry {
  id: string;
  fileName: string;
  sizeKb: number;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  validatedAt: string;
}

interface UploadFailure {
  status?: number;
  message: string;
  totalRows?: number;
  rejectedRows?: number;
  existingInvoiceRows?: number;
  issues: { row: number; column: string; message: string }[];
}

interface UploadOutcome {
  fileName: string;
  importedInvoices: number;
  importedCustomers: number;
  customersCreated: number;
  customersReused: number;
  scoringStatus: "queued" | "queue_failed";
  scoringError: string | null;
}

const MAX_FILE_MB = 25;

export default function DataManagementPage() {
  const quality = useDataQuality();
  const datasets = useDatasets();
  const health = useHealth();
  const queryClient = useQueryClient();

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<UploadValidationResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submissionFailure, setSubmissionFailure] = useState<UploadFailure | null>(null);
  const [uploadOutcome, setUploadOutcome] = useState<UploadOutcome | null>(null);
  const [history, setHistory] = useState<UploadHistoryEntry[]>([]);
  const [scoringJobId, setScoringJobId] = useState<string | null>(null);
  const [startingRescore, setStartingRescore] = useState(false);
  const scoringJob = useQuery({
    queryKey: ["scoring-job", scoringJobId],
    queryFn: () => api.scoringJob(scoringJobId!),
    enabled: Boolean(scoringJobId) && API_MODE === "live",
    refetchInterval: (query) => ["queued", "running"].includes(query.state.data?.status ?? "") ? 1000 : false,
  });
  useEffect(() => {
    if (!scoringJob.data || ["queued", "running"].includes(scoringJob.data.status)) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["invoices"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      queryClient.invalidateQueries({ queryKey: queryKeys.risk }),
      queryClient.invalidateQueries({ queryKey: queryKeys.delay }),
      queryClient.invalidateQueries({ queryKey: ["invoice"] }),
      queryClient.invalidateQueries({ queryKey: ["customer"] }),
    ]);
  }, [scoringJob.data?.status, queryClient]);

  const extraColumns = useMemo(
    () => (validation ? unknownColumns(validation.headers) : []),
    [validation],
  );

  async function processFile(file: File) {
    setFileError(null);
    setSubmissionFailure(null);
    setUploadOutcome(null);
    setScoringJobId(null);
    setValidation(null);
    setSelectedFile(file);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFileError("Only .csv files are supported. Export the invoice table as CSV and try again.");
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setFileError(`File is larger than the ${MAX_FILE_MB} MB browser validation limit.`);
      return;
    }
    if (file.size === 0) {
      setFileError("The selected file is empty.");
      return;
    }

    setParsing(true);
    try {
      const result = await new Promise<UploadValidationResult>((resolve, reject) => {
        Papa.parse<Record<string, string>>(file, {
          header: true,
          skipEmptyLines: "greedy",
          transformHeader: (header) => header.trim(),
          complete: (parsed) => {
            const headers = (parsed.meta.fields ?? []).filter(Boolean);
            if (!headers.length) {
              reject(new Error("No header row was found. The first row must contain column names."));
              return;
            }
            resolve(validateInvoiceCsv(file.name, file.size / 1024, headers, parsed.data, health.data?.businessDate));
          },
          error: (error: Error) => reject(error),
        });
      });

      setValidation(result);
      setHistory((previous) =>
        [
          {
            id: `${Date.now()}-${result.fileName}`,
            fileName: result.fileName,
            sizeKb: result.sizeKb,
            totalRows: result.totalRows,
            validRows: result.validRows,
            invalidRows: result.invalidRows,
            validatedAt: result.validatedAt,
          },
          ...previous,
        ].slice(0, 6),
      );
      toast.success(
        result.invalidRows === 0
          ? `${formatNumber(result.validRows)} rows passed validation`
          : `${formatNumber(result.invalidRows)} of ${formatNumber(result.totalRows)} rows need attention`,
      );
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "The file could not be parsed.");
    } finally {
      setParsing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processFile(file);
  }

  async function uploadFile() {
    const file = selectedFile;
    if (!file || !validation || validation.invalidRows > 0) return;
    if (API_MODE !== "live") {
      setFileError("Dataset upload is unavailable in demo mode. Switch to the live API and sign in as a business owner.");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setFileError(null);
    setSubmissionFailure(null);
    try {
      const result = await api.uploadDataset(file, setUploadProgress);
      setUploadOutcome({
        fileName: result.fileName,
        importedInvoices: result.importedInvoices,
        importedCustomers: result.importedCustomers,
        customersCreated: result.customersCreated,
        customersReused: result.customersReused,
        scoringStatus: result.scoringStatus,
        scoringError: result.scoringError,
      });
      setScoringJobId(result.scoringJob?.id ?? null);
      setValidation((current) => current ? { ...current, totalRows: result.totalRows, validRows: result.validRows, invalidRows: result.invalidRows, duplicateRows: result.duplicateRows, issues: result.issues, validationDate: result.validationDate, validatedAt: new Date().toISOString() } : current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices({}) }),
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dataQuality }),
        queryClient.invalidateQueries({ queryKey: queryKeys.datasets }),
        queryClient.invalidateQueries({ queryKey: queryKeys.risk }),
        queryClient.invalidateQueries({ queryKey: queryKeys.delay }),
      ]);
      toast.success(`Imported ${formatNumber(result.importedInvoices)} invoice rows`, {
        description: result.scoringStatus === "queued"
          ? `Automatic ML scoring queued for ${formatNumber(result.scoringJob?.total ?? 0)} unpaid invoices.`
          : "Invoices are committed. Automatic scoring could not be queued; use Re-score in Data Management.",
      });
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      const apiError = error as Partial<ApiErrorShape>;
      const detail = typeof apiError.detail === "object" && apiError.detail !== null
        ? apiError.detail as Record<string, unknown>
        : undefined;
      const issues = Array.isArray(detail?.issues)
        ? detail.issues.filter((issue): issue is { row: number; column: string; message: string } =>
            typeof issue === "object" && issue !== null && "row" in issue && "column" in issue && "message" in issue,
          )
        : [];
      const message = typeof apiError.message === "string" ? apiError.message : "The backend rejected the upload.";
      setSubmissionFailure({
        status: apiError.status,
        message,
        totalRows: typeof detail?.totalRows === "number" ? detail.totalRows : undefined,
        rejectedRows: typeof detail?.rejectedRows === "number" ? detail.rejectedRows : typeof detail?.invalidRows === "number" ? detail.invalidRows : undefined,
        existingInvoiceRows: typeof detail?.existingInvoiceRows === "number" ? detail.existingInvoiceRows : undefined,
        issues,
      });
      toast.error("Backend rejected the CSV", { description: message });
    } finally {
      setUploading(false);
    }
  }

  async function startRescore() {
    setStartingRescore(true);
    try {
      const job = await api.startBulkScoring(false);
      setScoringJobId(job.id);
      toast.success("Checking eligible invoices for current model versions");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start bulk scoring.");
    } finally {
      setStartingRescore(false);
    }
  }

  const isLoading = quality.isLoading || datasets.isLoading || health.isLoading;
  const isError = quality.isError && datasets.isError && health.isError;

  if (isLoading) return <PageSkeleton />;

  const qualityData = quality.data;
  const datasetRows = datasets.data?.datasets ?? [];
  const healthData = health.data;
  const latestScoringResult = scoringJob.data?.results.successful?.slice(-1)[0];

  const qualityColumns: DataTableColumn<DatasetRow>[] = [
    {
      id: "name",
      header: "File",
      cell: (row) => (
        <div className="min-w-[220px]">
          <p className="font-medium text-foreground">{row.name}</p>
          <p className="text-[11px] text-muted-foreground">{row.stage === "raw" ? "Raw input" : "Processed artifact"}</p>
        </div>
      ),
    },
    {
      id: "stage",
      header: "Stage",
      cell: (row) => (
        <Badge variant={row.stage === "raw" ? "medium" : "teal"} className="capitalize">
          {row.stage}
        </Badge>
      ),
    },
    {
      id: "rows",
      header: "Rows",
      align: "right",
      cell: (row) => <span className="tabular">{formatNumber(row.rows)}</span>,
    },
    {
      id: "size",
      header: "Size",
      align: "right",
      cell: (row) => <span className="tabular text-muted-foreground">{(row.sizeKb / 1024).toFixed(1)} MB</span>,
    },
    {
      id: "modified",
      header: "Last modified",
      align: "right",
      cell: (row) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.modified)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Models & data"
        title="Data management"
        description="Inspect dataset quality, validate an invoice CSV, and import it to the backend when live access is enabled."
        actions={
          <Button variant="outline" asChild>
            <Link to="/settings?tab=api">
              <Server className="h-4 w-4" />
              Integration contract
            </Link>
          </Button>
        }
      />

      {API_MODE === "demo" ? <InfoNote variant="warning"><strong>Demo workspace.</strong> CSV files are validated locally. Switch to live mode and sign in as a business owner to upload to the FastAPI service.</InfoNote> : null}

      {isError ? (
        <ErrorState
          title="Dataset metadata could not be loaded"
          description="The demo fixtures or API endpoints did not respond. Upload validation is still available below."
          onRetry={() => {
            void quality.refetch();
            void datasets.refetch();
            void health.refetch();
          }}
        />
      ) : null}

      {qualityData ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Cleaned invoices"
            value={formatNumber(qualityData.totalRecords)}
            hint={`${formatDate(qualityData.dateRange.start)} → ${formatDate(qualityData.dateRange.end)}`}
            icon={Database}
          />
          <KpiCard
            label="Paid records"
            value={formatNumber(qualityData.paidRecords)}
            hint="Closed invoices available to supervised training"
            icon={BadgeCheck}
            tone="success"
          />
          <KpiCard
            label="Open records"
            value={formatNumber(qualityData.openRecords)}
            hint="Unscored by the current late-payment and delay models"
            icon={FolderOpen}
            tone="accent"
          />
          <KpiCard
            label="Customers"
            value={formatNumber(qualityData.customers)}
            hint={`${formatNumber(qualityData.duplicateInvoiceIds)} duplicate invoice IDs detected`}
            icon={Users}
            tone="teal"
          />
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <SectionHeading
              title="CSV validation"
              description="Validate the invoice schema locally, then submit it to authenticated backend validation and persistence."
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload invoice CSV"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-9 text-center transition-colors",
                dragging
                  ? "border-brand-accent bg-[#F1F6FD]"
                  : "border-border bg-muted/25 hover:border-brand-accent/50 hover:bg-muted/40",
              )}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <UploadCloud className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-semibold text-foreground">
                {parsing ? "Validating file…" : "Drop an invoice CSV here"}
              </p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                or click to browse. UTF-8 CSV up to {MAX_FILE_MB} MB. The header row must use the pipeline column names.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void processFile(file);
                }}
              />
            </div>

            {fileError ? (
              <div className="flex items-start gap-2 rounded-lg border border-risk-high/20 bg-risk-high-soft/60 px-3.5 py-3 text-xs text-[#991B1B]">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{fileError}</span>
              </div>
            ) : null}

            {submissionFailure ? (
              <div role="alert" className="space-y-2 rounded-lg border border-risk-high/20 bg-risk-high-soft/60 px-3.5 py-3 text-xs text-[#991B1B]">
                <p className="font-semibold">
                  Upload rejected{submissionFailure.status ? ` · HTTP ${submissionFailure.status}` : ""} · 0 invoices and 0 customers imported
                </p>
                <p>{submissionFailure.message}</p>
                {submissionFailure.rejectedRows != null ? <p>{formatNumber(submissionFailure.rejectedRows)} of {formatNumber(submissionFailure.totalRows ?? validation?.totalRows ?? 0)} rows rejected.</p> : null}
                {submissionFailure.existingInvoiceRows ? <p>{formatNumber(submissionFailure.existingInvoiceRows)} invoice IDs already exist. Existing records were preserved.</p> : null}
                {submissionFailure.issues.length ? (
                  <ul className="max-h-36 list-inside list-disc overflow-y-auto border-t border-risk-high/15 pt-2">
                    {submissionFailure.issues.slice(0, 8).map((issue, index) => <li key={`${issue.row}-${issue.column}-${index}`}>Row {issue.row} · {issue.column}: {issue.message}</li>)}
                    {submissionFailure.issues.length > 8 ? <li>And {formatNumber(submissionFailure.issues.length - 8)} more reported issues.</li> : null}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {uploadOutcome ? (
              <div role="status" className="space-y-1 rounded-lg border border-risk-low/20 bg-risk-low/5 px-3.5 py-3 text-xs text-foreground">
                <p className="font-semibold">Upload committed · {uploadOutcome.fileName}</p>
                <p>{formatNumber(uploadOutcome.importedInvoices)} invoices imported · {formatNumber(uploadOutcome.importedCustomers)} customer records used ({formatNumber(uploadOutcome.customersCreated)} created, {formatNumber(uploadOutcome.customersReused)} reused).</p>
                <p className="text-muted-foreground">Scoring status: {uploadOutcome.scoringStatus === "queued" ? "queued separately" : "queue failed; imported records are safe"}{uploadOutcome.scoringError ? ` · ${uploadOutcome.scoringError}` : ""}</p>
              </div>
            ) : null}

            {validation ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-muted/25 px-4 py-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{validation.fileName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {validation.sizeKb >= 1024
                          ? `${(validation.sizeKb / 1024).toFixed(2)} MB`
                          : `${validation.sizeKb.toFixed(1)} KB`}{" "}
                        · validated {formatDateTime(validation.validatedAt)} · business date {validation.validationDate}
                      </p>
                    </div>
                  </div>
                  <Badge variant={validation.invalidRows === 0 ? "low" : "high"}>
                    {validation.invalidRows === 0 ? "Schema passed" : "Needs fixes"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Rows", value: validation.totalRows, tone: "text-foreground" },
                    { label: "Valid", value: validation.validRows, tone: "text-risk-low" },
                    { label: "Invalid", value: validation.invalidRows, tone: "text-risk-high" },
                    { label: "Duplicates", value: validation.duplicateRows, tone: "text-risk-medium" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-border px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {item.label}
                      </p>
                      <p className={cn("mt-1 text-lg font-semibold tabular", item.tone)}>
                        {formatNumber(item.value)}
                      </p>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Row validity</span>
                    <span className="tabular">
                      {validation.totalRows
                        ? `${((validation.validRows / validation.totalRows) * 100).toFixed(1)}%`
                        : "—"}
                    </span>
                  </div>
                  <Progress
                    value={validation.totalRows ? (validation.validRows / validation.totalRows) * 100 : 0}
                    indicatorClassName={
                      validation.invalidRows === 0
                        ? "bg-risk-low"
                        : validation.invalidRows / Math.max(validation.totalRows, 1) > 0.1
                          ? "bg-risk-high"
                          : "bg-risk-medium"
                    }
                  />
                </div>

                {extraColumns.length ? (
                  <InfoNote variant="warning">
                    Unrecognised columns will be ignored by the pipeline: <strong>{extraColumns.join(", ")}</strong>.
                  </InfoNote>
                ) : null}

                {validation.missingValues.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-foreground">Empty values by column</p>
                    <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-lg border border-border p-3 sm:grid-cols-2">
                      {validation.missingValues.map((entry) => (
                        <div key={entry.column} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate font-mono text-muted-foreground">{entry.column}</span>
                          <span className="tabular text-foreground">{formatNumber(entry.missing)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {validation.issues.length ? (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">Validation issues</p>
                      <p className="text-[11px] text-muted-foreground">
                        Showing {Math.min(validation.issues.length, 40)} of {formatNumber(validation.issues.length)}
                        {validation.issues.length >= 250 ? "+" : ""}
                      </p>
                    </div>
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-muted/80 text-[10px] uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Row</th>
                            <th className="px-3 py-2 font-semibold">Column</th>
                            <th className="px-3 py-2 font-semibold">Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {validation.issues.slice(0, 40).map((issue, index) => (
                            <tr key={`${issue.row}-${issue.column}-${index}`} className="border-t border-border/70">
                              <td className="whitespace-nowrap px-3 py-1.5 tabular text-muted-foreground">
                                {issue.row === 0 ? "Header" : issue.row}
                              </td>
                              <td className="whitespace-nowrap px-3 py-1.5 font-mono text-muted-foreground">
                                {issue.column}
                              </td>
                              <td className="px-3 py-1.5 text-foreground">{issue.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <InfoNote variant="success">
                    All rows satisfy the schema checks. Sending the file to the backend is still required before scoring.
                  </InfoNote>
                )}

                {validation.preview.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-foreground">
                      Preview · first {validation.preview.length} rows
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                          <tr>
                            {validation.headers.slice(0, 10).map((header) => (
                              <th key={header} className="whitespace-nowrap px-3 py-2 font-semibold">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {validation.preview.map((row, index) => (
                            <tr key={index} className="border-t border-border/70">
                              {validation.headers.slice(0, 10).map((header) => (
                                <td key={header} className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                                  {row[header] || "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={uploading || parsing || validation.invalidRows > 0 || API_MODE !== "live"}
                    onClick={() => void uploadFile()}
                  >
                    <UploadCloud className="h-4 w-4" />
                    {uploading ? `Uploading ${uploadProgress}%…` : "Send to backend"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setValidation(null);
                      setFileError(null);
                    }}
                  >
                    Validate another file
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    {API_MODE === "live" ? "Requires a business_owner account. Invalid files are rejected before import." : "Live mode is required to upload this CSV."}
                  </p>
                  {uploading ? <Progress value={uploadProgress} className="min-w-32 flex-1" /> : null}
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border border-border bg-muted/20 p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Session validation history
              </p>
              {history.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  No files validated yet. History is held in this browser session only.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border/70">
                  {history.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{entry.fileName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateTime(entry.validatedAt)} · {formatNumber(entry.totalRows)} rows
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="tabular text-risk-low">{formatNumber(entry.validRows)} valid</span>
                        {entry.invalidRows ? (
                          <span className="tabular text-risk-high">{formatNumber(entry.invalidRows)} invalid</span>
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-risk-low" />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {API_MODE === "live" ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Automatic invoice scoring</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Saved XGBoost and HistGradientBoosting outputs for unpaid invoices.</p>
                </div>
                <Button size="sm" variant="outline" disabled={startingRescore || scoringJob.data?.status === "running" || scoringJob.data?.status === "queued"} onClick={() => void startRescore()}>
                  {startingRescore ? "Starting…" : "Re-score changed invoices"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {scoringJob.data ? (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium capitalize text-foreground">{scoringJob.data.status.replaceAll("_", " ")}</span>
                    <span className="tabular text-muted-foreground">{formatNumber(scoringJob.data.processed)} / {formatNumber(scoringJob.data.total)}</span>
                  </div>
                  <Progress value={scoringJob.data.progressPercent} />
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-md bg-risk-low/10 p-2"><strong className="block text-risk-low">{formatNumber(scoringJob.data.succeeded)}</strong>predicted</div>
                    <div className="rounded-md bg-muted p-2"><strong className="block text-foreground">{formatNumber(scoringJob.data.skipped)}</strong>skipped</div>
                    <div className="rounded-md bg-risk-high/10 p-2"><strong className="block text-risk-high">{formatNumber(scoringJob.data.failed)}</strong>failed</div>
                  </div>
                  {scoringJob.data.results.skippedInvoices?.length ? <div className="space-y-1 text-xs text-muted-foreground"><p className="font-medium text-foreground">Skipped invoices</p>{scoringJob.data.results.skippedInvoices.slice(0, 4).map((item) => <p key={item.invoiceId}>{item.invoiceId}: {item.reason}</p>)}</div> : null}
                  {scoringJob.data.results.failures?.length ? <div className="space-y-1 text-xs text-risk-high"><p className="font-medium">Failures</p>{scoringJob.data.results.failures.slice(0, 4).map((item, index) => <p key={`${item.invoiceId ?? "job"}-${index}`}>{item.invoiceId ? `${item.invoiceId}: ` : ""}{item.reason}</p>)}</div> : null}
                  {latestScoringResult ? <p className="text-xs text-muted-foreground">Latest saved output for {latestScoringResult.invoiceId}: {latestScoringResult.probability == null ? "classifier pending" : `${(latestScoringResult.probability * 100).toFixed(1)}% · ${latestScoringResult.predictedLate ? "predicted late" : "predicted not late"} · ${latestScoringResult.riskBand} risk`} · {latestScoringResult.predictedDelayDays == null ? "delay pending" : `${latestScoringResult.predictedDelayDays.toFixed(1)} days`} · {latestScoringResult.lateModelVersion} / {latestScoringResult.delayModelVersion} · {latestScoringResult.predictedAt ? formatDateTime(latestScoringResult.predictedAt) : ""}</p> : null}
                </>
              ) : scoringJobId && scoringJob.isError ? (
                <p className="text-xs text-risk-high">Scoring progress could not be loaded. {scoringJob.error instanceof Error ? scoringJob.error.message : ""}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Upload a CSV to start automatic scoring, or re-score changed invoices to check for updated model versions and invoice features.</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        <div className="space-y-5">
          {healthData ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">API & model status</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">Reported by the configured data source</p>
                  </div>
                  <Badge variant={healthData.status === "ok" ? "low" : healthData.status === "demo" ? "accent" : "medium"}>
                    {healthData.status === "ok" ? "Operational" : healthData.status === "demo" ? "Demo" : "Degraded"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Mode</dt>
                    <dd className="mt-0.5 font-medium capitalize text-foreground">
                      {healthData.mode === "demo" ? "Demo fixtures" : "Live backend"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">API version</dt>
                    <dd className="mt-0.5 font-mono text-[11px] text-foreground">{healthData.apiVersion}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Configured base</dt>
                    <dd className="mt-0.5 font-mono text-[11px] text-foreground">
                      {API_MODE === "demo" ? "public/demo-data" : "VITE_API_BASE_URL"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Checked</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{formatDateTime(healthData.timestamp)}</dd>
                  </div>
                </dl>
                <div className="space-y-1.5 border-t border-border pt-3">
                  {healthData.models.map((model) => (
                    <div key={model.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-foreground">{model.id.replace(/-/g, " ")}</span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            model.status === "available" ? "bg-risk-low" : "bg-risk-medium",
                          )}
                        />
                        <span className="capitalize text-muted-foreground">
                          {model.status.replace(/_/g, " ")}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Demo responses are read from recorded fixtures. The backend should implement the same payload shape.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Required columns</CardTitle>
              <p className="text-xs text-muted-foreground">Invoice schema expected by the ML pipeline</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {REQUIRED_INVOICE_COLUMNS.map((column) => (
                  <code
                    key={column}
                    className="rounded border border-brand-accent/15 bg-primary-soft px-1.5 py-0.5 text-[11px] text-brand-navy"
                  >
                    {column}
                  </code>
                ))}
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Optional
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {OPTIONAL_INVOICE_COLUMNS.map((column) => (
                    <code
                      key={column}
                      className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {column}
                    </code>
                  ))}
                </div>
              </div>
              <ul className="space-y-1.5 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
                {VALIDATION_RULES.map((rule) => (
                  <li key={rule} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-accent" />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {qualityData ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cleaned dataset profile</CardTitle>
              <p className="text-xs text-muted-foreground">{qualityData.dataset}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-x-4 gap-y-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Coverage</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {formatDate(qualityData.dateRange.start)} → {formatDate(qualityData.dateRange.end)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Duplicate invoice IDs</dt>
                  <dd className="mt-0.5 font-medium tabular text-foreground">
                    {formatNumber(qualityData.duplicateInvoiceIds)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Invalid records</dt>
                  <dd className="mt-0.5 font-medium tabular text-foreground">
                    {formatNumber(qualityData.invalidRecords.total)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Due before invoice</dt>
                  <dd className="mt-0.5 font-medium tabular text-foreground">
                    {formatNumber(qualityData.invalidRecords.dueBeforeInvoice)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Payment before invoice</dt>
                  <dd className="mt-0.5 font-medium tabular text-foreground">
                    {formatNumber(qualityData.invalidRecords.paymentBeforeInvoice)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Non-positive amount</dt>
                  <dd className="mt-0.5 font-medium tabular text-foreground">
                    {formatNumber(qualityData.invalidRecords.nonPositiveAmount)}
                  </dd>
                </div>
              </dl>

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Currency mix · nominal, no FX conversion
                </p>
                {Object.entries(qualityData.currencyCounts).map(([currency, count]) => {
                  const share = count / Math.max(qualityData.totalRecords, 1);
                  return (
                    <div key={currency} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-foreground">{currency}</span>
                        <span className="tabular text-muted-foreground">
                          {formatNumber(count)} · {(share * 100).toFixed(1)}%
                        </span>
                      </div>
                      <Progress value={share * 100} indicatorClassName={currency === "USD" ? "bg-brand-navy" : "bg-brand-teal"} />
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border pt-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Missing values by column
                </p>
                <div className="grid max-h-44 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                  {qualityData.missingByColumn.map((entry) => (
                    <div key={entry.column} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate font-mono text-muted-foreground">{entry.column}</span>
                      <span className="tabular text-foreground">{formatNumber(entry.missing)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Pipeline artifacts</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(datasetRows.length)} files recorded from the training workspace
                  </p>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/model-performance">
                    Model details
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <DataTable
                data={datasetRows}
                columns={qualityColumns}
                getRowId={(row) => row.name}
                className="rounded-none border-0 border-t"
                skeletonRows={6}
              />
              <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Sizes and row counts describe the recorded artifacts; they are not refreshed live.
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-card">
        <span>
          Need the exact request and response shapes? The integration contract lists every endpoint the frontend expects.
        </span>
        <Button variant="outline" size="sm" asChild>
          <Link to="/settings?tab=api">
            <Download className="h-3.5 w-3.5" />
            View API contract
          </Link>
        </Button>
      </div>
    </div>
  );
}
