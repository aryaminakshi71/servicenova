export type CrmCustomerRecord = {
  customerId: string;
  customerName: string;
  tier: "standard" | "priority" | "enterprise";
  openServiceCount: number;
  lastServiceAt: string;
  notes: string[];
};

export type CrmWorkOrderEvent = {
  jobId: string;
  customerId: string;
  status: "open" | "assigned" | "in_progress" | "closed";
  timestamp: string;
};

export interface CrmAdapter {
  getCustomerContext(
    customerId: string,
  ): CrmCustomerRecord | null | Promise<CrmCustomerRecord | null>;
  recordWorkOrderEvent(event: CrmWorkOrderEvent): void | Promise<void>;
}

export type InvoiceRequest = {
  jobId: string;
  customerId: string;
  currency: "USD";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  lineItems: Array<{ description: string; amountCents: number }>;
};

export type InvoiceRecord = {
  id: string;
  jobId: string;
  customerId: string;
  currency: "USD";
  status: "draft" | "issued";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  lineItems: Array<{ description: string; amountCents: number }>;
  createdAt: string;
};

export interface InvoicingAdapter {
  createInvoice(
    request: InvoiceRequest,
  ): InvoiceRecord | Promise<InvoiceRecord>;
  getInvoice(
    invoiceId: string,
  ): InvoiceRecord | null | Promise<InvoiceRecord | null>;
  listInvoices(): InvoiceRecord[] | Promise<InvoiceRecord[]>;
}

export type IntegrationAdapters = {
  crm: CrmAdapter;
  invoicing: InvoicingAdapter;
};
